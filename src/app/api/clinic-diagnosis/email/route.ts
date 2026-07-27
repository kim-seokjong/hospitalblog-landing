import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { recordFunnelEvent } from '@/dev/lib/funnel-server';
import { sendEmail } from '@/payment/email/client';
import { buildDiagnosisLeadSummary } from '@/content/lib/clinic-diagnosis/conversion';
import {
  buildDiagnosisEmail,
  consumeEmailLeadQuota,
  emailLimitMessage,
  normalizeLeadEmail,
  readEmailLeadLimits,
} from '@/content/lib/clinic-diagnosis/email-lead';
import { extractClientIp } from '@/content/lib/clinic-diagnosis/limits';
import { ANON_ID_COOKIE, isValidAnonId } from '@/content/lib/funnel-events';
import { SITE_URL } from '@/dev/lib/seo/site';
import type { DiagnosisReport } from '@/content/lib/clinic-diagnosis/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/clinic-diagnosis/email — 진단 결과를 메일로 보내기 (비회원 공개).
 *
 * body: { token: string, email: string }
 *
 * ★ 이 라우트가 이 개편의 1순위다. 원장이 성적표만 보고 닫으면 우리는 무료 봉사를 한
 *   것이고, 가입을 목표로 잡으면 전환은 0이다. 자기 성적표를 메일로 받는 건 거절할
 *   이유가 없고 — 그 순간 연락처와 그 병원의 구체적 문제 목록이 함께 들어온다.
 *
 * 신뢰 경계:
 * - **리포트 본문을 클라이언트에서 받지 않는다.** 공유 토큰으로 서버가 DB에서 다시
 *   읽는다. 클라가 조작한 진단 결과가 메일로 나가거나 리드에 저장되지 않는다.
 * - 메일 본문에 사용자 입력 문자열을 싣지 않는다(병원명·수치는 전부 서버가 가진 값).
 *
 * 남용 방어 (이 엔드포인트는 비회원이 임의 주소로 메일을 보내게 하는 통로다):
 * - 3중 캡: 전체 일 200 / 수신주소 일 3 / IP 일 5 (env DIAGNOSIS_EMAIL_* 조절)
 * - 인메모리 best-effort — 서버리스 인스턴스 단위 한계는 blog-check-limits 주석 참조.
 *
 * 개인정보:
 * - 수집 목적은 진단 결과 발송과 그 결과에 대한 안내뿐이다(화면에 한 줄로 고지).
 * - 마케팅 수신 동의를 끼워 넣지 않는다. 이메일은 리드 테이블에만 저장하고
 *   퍼널 meta 에는 넣지 않는다.
 *
 * 발송 인프라가 없으면(RESEND_API_KEY 미설정) **리드 저장까지만** 하고
 * sent:false 로 응답한다 — 대표가 수동 발송할 수 있도록 남긴다.
 */

const QUOTA_KEY = '__dp_clinic_dx_email_quota__';

function getQuotaStore(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[QUOTA_KEY] instanceof Map)) g[QUOTA_KEY] = new Map<string, number>();
  return g[QUOTA_KEY] as Map<string, number>;
}

/** 공유 토큰 형식 — 라우트(/clinic-check/r/[token])와 동일 규칙. DB 조회 전에 형태부터 거른다. */
const TOKEN_PATTERN = /^[a-f0-9]{32,80}$/;

/**
 * 메일에 실을 절대 주소. 요청 헤더(Host)로 만들지 않는다 —
 * 위조된 Host 로 남의 도메인을 가리키는 링크가 메일에 실리면 안 된다.
 */
function absoluteReportUrl(token: string): string {
  return `${SITE_URL.replace(/\/+$/, '')}/clinic-check/r/${token}`;
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const email = normalizeLeadEmail(raw?.email);
    if (!email) {
      return NextResponse.json({ error: '이메일 주소를 확인해 주세요.' }, { status: 400 });
    }

    const token = typeof raw?.token === 'string' ? raw.token.trim() : '';
    if (!TOKEN_PATTERN.test(token)) {
      return NextResponse.json(
        { error: '진단 결과를 찾지 못했어요. 진단을 다시 실행해 주세요.' },
        { status: 400 },
      );
    }

    // 캡 — 검증을 통과한 요청만 카운터를 소비한다(형식 오류가 캡을 갉아먹지 않게).
    const decision = consumeEmailLeadQuota(getQuotaStore(), {
      ip: extractClientIp(req.headers),
      email,
      limits: readEmailLeadLimits(),
    });
    if (!decision.allowed) {
      return NextResponse.json({ error: emailLimitMessage(decision.reason) }, { status: 429 });
    }

    // 리포트는 서버가 DB에서 직접 읽는다 — 클라가 보낸 본문은 신뢰하지 않는다.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('clinic_diagnosis_reports')
      .select('results, expires_at')
      .eq('share_token', token)
      .maybeSingle();

    if (error || !data?.results) {
      return NextResponse.json(
        { error: '진단 결과를 찾지 못했어요. 진단을 다시 실행해 주세요.' },
        { status: 404 },
      );
    }
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: '이 진단 결과는 만료됐어요. 진단을 다시 실행해 주세요.' },
        { status: 410 },
      );
    }

    const report = data.results as DiagnosisReport;
    const clinic = report.clinic;
    const summary = buildDiagnosisLeadSummary(report);
    const reportUrl = absoluteReportUrl(token);

    // 발송 — 인프라가 없으면 저장까지만 하고 대표가 수동 발송한다.
    const { subject, html } = buildDiagnosisEmail({
      clinicName: clinic.name,
      summary,
      reportUrl,
      runAt: report.runAt,
    });
    const sendResult = await sendEmail({ to: email, subject, html });

    // ★ 리드 저장이 이 라우트의 본체다. 발송이 실패해도 연락처는 반드시 남긴다.
    const { error: leadError } = await admin.from('clinic_diagnosis_email_leads').insert({
      email,
      mng_no: clinic.mngNo,
      clinic_name: clinic.name.slice(0, 120),
      region: `${clinic.province} ${clinic.region}`.trim().slice(0, 60),
      specialty: clinic.specialty.slice(0, 40),
      phone: clinic.phone.slice(0, 30),
      share_token: token,
      share_url: `/clinic-check/r/${token}`,
      summary,
      diagnosed_at: report.runAt,
      sent: sendResult.success,
      send_error: sendResult.success ? null : (sendResult.error ?? '').slice(0, 300) || null,
      source: 'clinic-check',
    });

    if (leadError) {
      console.error('[clinic-diagnosis/email] 리드 적재 실패:', leadError.message);
      // 저장에 실패하면 이 요청은 목적을 달성하지 못했다 — 성공으로 위장하지 않는다.
      // (메일은 이미 나갔을 수 있으므로 사용자에게는 "다시 시도" 대신 사실만 알린다.)
      if (!sendResult.success) {
        return NextResponse.json(
          { error: '메일 발송을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' },
          { status: 500 },
        );
      }
    }

    // 계측 — 이메일 확보율이 이 개편의 핵심 지표다. 실제 저장·발송 결과로만 기록한다.
    const anonCookie = req.cookies.get(ANON_ID_COOKIE)?.value;
    await recordFunnelEvent({
      event: 'diagnosis_email_submitted',
      anonId: isValidAnonId(anonCookie) ? anonCookie : null,
      meta: { path: '/clinic-check', sent: sendResult.success },
    });

    if (!sendResult.success) {
      // 접수는 됐다(리드 저장 완료). 사용자에게 거짓말하지 않고 상태를 그대로 알린다.
      return NextResponse.json({ ok: true, sent: false });
    }
    return NextResponse.json({ ok: true, sent: true });
  } catch (err) {
    console.error('[clinic-diagnosis/email]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '메일 발송 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

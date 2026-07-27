import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { recordFunnelEvent } from '@/dev/lib/funnel-server';
import { sendEmail } from '@/payment/email/client';
import { buildDiagnosisLeadSummary } from '@/content/lib/clinic-diagnosis/conversion';
import {
  runDiagnosisEmailFlow,
  type CountLeadsResult,
  type EmailFlowDeps,
  type LeadRow,
  type ReportLoad,
  type SaveLeadResult,
} from '@/content/lib/clinic-diagnosis/email-flow';
import {
  hashClientIp,
  kstDayStartIso,
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
 * ★★ 순서·실패 처리는 여기 있지 않다 — `email-flow.ts` 가 결정한다(회귀 테스트 대상).
 *    이 파일은 DB·메일·계측을 연결하는 얇은 어댑터다. 규칙만 다시 적으면:
 *      · **저장이 먼저, 발송이 나중.** 저장 실패 시 메일을 보내지 않고 500 을 낸다.
 *      · 저장 실패를 200 으로 덮지 않는다(발송 성공 여부와 무관).
 *      · 캡을 셀 수 없으면(마이그 056 미적용 등) 발송을 막는다 — 세지 못하는 상태에서
 *        메일을 내보내는 게 제일 위험하다.
 *      · 만료·없는 토큰은 캡을 소비하지 않는다.
 *      · 퍼널은 저장 성공 건만 센다.
 *
 * 신뢰 경계:
 * - **리포트 본문을 클라이언트에서 받지 않는다.** 공유 토큰으로 서버가 DB에서 다시
 *   읽는다. 클라가 조작한 진단 결과가 메일로 나가거나 리드에 저장되지 않는다.
 * - 메일 본문에 사용자 입력 문자열을 싣지 않는다(병원명·수치는 전부 서버가 가진 값).
 *
 * 남용 방어 (비회원이 우리 도메인 발신 메일을 임의 주소로 쏘는 통로다):
 * - 캡은 **DB 집계**다(clinic_diagnosis_email_leads.created_at).
 *   전체 일 200 / IP 일 5 / 토큰 일 3 / 토큰당 서로 다른 주소 2 / 수신주소 일 3.
 * - 초과 문구는 사유와 무관하게 통일한다(특정 주소가 오늘 메일을 받았는지 알아내는
 *   오라클이 되지 않게). 사유는 서버 로그에만.
 *
 * 개인정보:
 * - 수집 목적은 진단 결과 발송과 그 결과에 대한 안내뿐이다(화면에 한 줄 고지).
 * - 마케팅 수신 동의를 끼워 넣지 않는다. 이메일은 리드 테이블에만 저장하고
 *   퍼널 meta·로그에는 넣지 않는다. IP 는 원본 대신 해시만 남긴다(한도 집계 전용).
 */

/** 리드 테이블 — 캡 집계·저장 모두 이 테이블 하나로 한다(마이그 056). */
const LEADS_TABLE = 'clinic_diagnosis_email_leads';

/** 토큰 이력 스캔 상한 — 토큰당 캡(일 3회·주소 2개)보다 훨씬 크므로 판정에 영향이 없다. */
const TOKEN_HISTORY_SCAN = 50;

/** 42P01 = undefined_table (마이그 056 미적용). */
function isMissingTable(code: string | undefined): boolean {
  return code === '42P01';
}

/**
 * 메일에 실을 절대 주소. 요청 헤더(Host)로 만들지 않는다 —
 * 위조된 Host 로 남의 도메인을 가리키는 링크가 메일에 실리면 안 된다.
 */
function absoluteReportUrl(token: string): string {
  return `${SITE_URL.replace(/\/+$/, '')}/clinic-check/r/${token}`;
}

type Admin = ReturnType<typeof createAdminClient>;

/** 공유 토큰으로 저장된 리포트를 읽는다. 조회 실패도 '없음'으로 뭉갠다(존재 여부 비노출). */
async function loadReport(admin: Admin, token: string): Promise<ReportLoad> {
  const { data, error } = await admin
    .from('clinic_diagnosis_reports')
    .select('results, expires_at')
    .eq('share_token', token)
    .maybeSingle();
  if (error || !data?.results) return { kind: 'not_found' };
  return {
    kind: 'ok',
    results: data.results,
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
  };
}

/**
 * 오늘(KST) 기준 발송 집계. **테이블이 없거나 조회가 실패하면 blocked** —
 * 그 경우 발송하지 않는다(세지 못하면 쏘지 않는다).
 */
async function countLeads(
  admin: Admin,
  input: { readonly email: string; readonly ipHash: string; readonly token: string },
): Promise<CountLeadsResult> {
  const dayStart = kstDayStartIso();

  const [globalRes, ipRes, addressRes, tokenRes] = await Promise.all([
    admin.from(LEADS_TABLE).select('id', { count: 'exact', head: true }).gte('created_at', dayStart),
    admin
      .from(LEADS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', input.ipHash)
      .gte('created_at', dayStart),
    admin
      .from(LEADS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('email', input.email)
      .gte('created_at', dayStart),
    // 토큰 이력은 "오늘 몇 번"과 "서로 다른 주소 몇 개"를 함께 봐야 해서 행을 읽는다.
    admin
      .from(LEADS_TABLE)
      .select('email, created_at')
      .eq('share_token', input.token)
      .order('created_at', { ascending: false })
      .limit(TOKEN_HISTORY_SCAN),
  ]);

  for (const error of [globalRes.error, ipRes.error, addressRes.error, tokenRes.error]) {
    if (!error) continue;
    if (isMissingTable(error.code)) return { kind: 'blocked', reason: 'missing_table' };
    console.error('[clinic-diagnosis/email] 캡 집계 실패:', error.message);
    return { kind: 'blocked', reason: 'error' };
  }

  const tokenRows = (tokenRes.data ?? []) as ReadonlyArray<{
    email: string | null;
    created_at: string | null;
  }>;
  const dayStartMs = Date.parse(dayStart);
  const tokenToday = tokenRows.filter((row) => {
    const t = row.created_at ? Date.parse(row.created_at) : NaN;
    return Number.isFinite(t) && t >= dayStartMs;
  }).length;
  const otherAddresses = new Set(
    tokenRows
      .map((row) => (typeof row.email === 'string' ? row.email : ''))
      .filter((value) => value.length > 0 && value !== input.email),
  );

  return {
    kind: 'ok',
    counts: {
      globalToday: globalRes.count ?? 0,
      ipToday: ipRes.count ?? 0,
      addressToday: addressRes.count ?? 0,
      tokenToday,
      tokenOtherAddresses: otherAddresses.size,
    },
  };
}

async function saveLead(admin: Admin, row: LeadRow): Promise<SaveLeadResult> {
  const { data, error } = await admin
    .from(LEADS_TABLE)
    .insert({
      email: row.email,
      mng_no: row.mngNo,
      clinic_name: row.clinicName,
      region: row.region,
      specialty: row.specialty,
      phone: row.phone,
      share_token: row.shareToken,
      share_url: row.shareUrl,
      summary: row.summary,
      diagnosed_at: row.diagnosedAt,
      ip_hash: row.ipHash,
      sent: false,
      send_error: null,
      source: 'clinic-check',
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    return { kind: 'failed', message: error?.message ?? 'id 미반환' };
  }
  return { kind: 'ok', id: String(data.id) };
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const admin = createAdminClient();
    const anonCookie = req.cookies.get(ANON_ID_COOKIE)?.value;

    const deps: EmailFlowDeps = {
      loadReport: (token) => loadReport(admin, token),
      countLeads: (input) => countLeads(admin, input),
      saveLead: (row) => saveLead(admin, row),
      sendEmail: (message) => sendEmail({ ...message, feature: 'clinic-diagnosis' }),
      markSendResult: async (id, sent, sendError) => {
        const { error } = await admin
          .from(LEADS_TABLE)
          .update({ sent, send_error: sendError })
          .eq('id', id);
        if (error) {
          console.error('[clinic-diagnosis/email] 발송 결과 반영 실패:', error.message);
        }
      },
      recordFunnel: async ({ sent }) => {
        // 수신 주소는 meta 에 넣지 않는다(PII 는 리드 테이블에만).
        await recordFunnelEvent({
          event: 'diagnosis_email_submitted',
          anonId: isValidAnonId(anonCookie) ? anonCookie : null,
          meta: { path: '/clinic-check', sent },
        });
      },
      summarize: (report) => buildDiagnosisLeadSummary(report as DiagnosisReport),
      reportUrl: absoluteReportUrl,
      logWarn: (message) => console.warn(`[clinic-diagnosis/email] ${message}`),
      logError: (message) => console.error(`[clinic-diagnosis/email] ${message}`),
    };

    const result = await runDiagnosisEmailFlow(deps, {
      rawToken: raw?.token,
      rawEmail: raw?.email,
      ipHash: hashClientIp(extractClientIp(req.headers), process.env.DIAGNOSIS_EMAIL_IP_SALT ?? ''),
      limits: readEmailLeadLimits(),
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('[clinic-diagnosis/email]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '메일 발송 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

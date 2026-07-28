import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron, cronSecretStatus } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { sendEmail } from '@/payment/email/client';
import { sendTelegram } from '@/dev/lib/telegram';
import { buildDiagnosisEmail } from '@/content/lib/clinic-diagnosis/email-lead';
import {
  buildRetrySummaryText,
  planEmailRetries,
  RETRY_WINDOW_DAYS,
  type RetryCandidate,
} from '@/content/lib/clinic-diagnosis/email-retry';
import { SITE_URL } from '@/dev/lib/seo/site';
import type { DiagnosisLeadSummary } from '@/content/lib/clinic-diagnosis/conversion';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const LEADS_TABLE = 'clinic_diagnosis_email_leads';

/**
 * GET /api/cron/email-retry — 발송 실패한 진단 메일 재발송 (하루 1회).
 *
 * ★ 왜 있는가 (2026-07-28).
 *   진단 메일이 실패하면 리드가 `sent=false` 로 남고 **아무도 다시 보내지 않았다.**
 *   2026-07-27 Resend 도메인 미검증으로 2건이 실패했는데, 도메인이 복구된 뒤에도
 *   그대로 방치돼 있었다. 전화 아웃바운드의 목표가 "이메일 주소 확보" 인데
 *   그 주소로 리포트가 안 나가면 리드가 그냥 죽는다.
 *
 * 하는 일:
 *   ① sent=false 인 리드를 최근 7일 창에서 읽는다
 *   ② 판정은 순수 모듈(email-retry.ts)에 맡긴다 — 영구 실패·토큰 없음·기간 초과 제외
 *   ③ 저장된 clinic_name·summary·share_token 으로 **원래와 같은 메일**을 재구성한다
 *      (진단을 다시 돌리지 않는다 — 비용도 결과도 달라지면 안 된다)
 *   ④ 결과를 sent/send_error 에 반영하고, 성공/실패가 있으면 텔레그램으로 보고한다
 *
 * ⚠️ 스케줄은 반드시 **하루 1회**다. Vercel Hobby 는 그 이상을 배포 단계에서 거부한다
 *    (2026-07-27 에 매시간 cron 하나로 9커밋이 배포 실패했다).
 *    `src/dev/lib/__tests__/cron-frequency.test.ts` 가 이를 강제한다.
 *
 * ★ 전달 보장은 **at-least-once** 다 (의도적 선택, 2026-07-28 교차검증에서 검토).
 *   발송을 먼저 하고 결과를 나중에 기록하므로, 발송 성공 직후 DB 반영이 실패하면
 *   다음 날 같은 메일이 한 번 더 갈 수 있다. 원자적 claim(먼저 sent=true 로 찜하고
 *   발송)으로 바꾸면 중복은 사라지지만, 찜한 뒤 프로세스가 죽으면 **메일은 안 갔는데
 *   보낸 것으로 기록**된다 — 그건 이 기능이 없애려던 바로 그 실패(리드 유실)다.
 *   같은 리포트가 두 번 가는 것은 불편이고, 리드가 죽는 것은 손실이다. 불편을 택한다.
 *   (동일 리포트가 이미 성공한 경우는 아래 중복 검사가 걸러 실제 중복을 크게 줄인다.)
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: 'Unauthorized', cronSecret: cronSecretStatus() },
      { status: 401 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : '알 수 없는 오류';
    console.error('[cron/email-retry] 관리자 클라이언트 생성 실패:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  /**
   * 창보다 넉넉히 읽고 판정은 순수 모듈에 맡긴다(경계 판단을 한 곳에만 둔다).
   *
   * ⚠️ 조회 상한을 200 → 1000 으로 올렸다(2026-07-28 교차검증).
   *    영구 실패·토큰 누락 행이 오래된 순으로 앞을 채우면, 뒤에 있는 **재시도
   *    가능한 행이 조회조차 되지 않는다**(starvation). 창이 7일이라 모집단 자체가
   *    유입 상한(하루 200건) × 8일로 묶여 있으므로 1000 이면 실질적으로 전량이다.
   */
  const since = new Date(Date.now() - (RETRY_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from(LEADS_TABLE)
    .select('id,email,clinic_name,share_token,summary,diagnosed_at,send_error,created_at')
    .eq('sent', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(1000);

  if (error) {
    console.error('[cron/email-retry] 리드 조회 실패:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows: RetryCandidate[] = (data ?? []).map((r) => ({
    id: String(r.id),
    email: typeof r.email === 'string' ? r.email : '',
    clinicName: typeof r.clinic_name === 'string' ? r.clinic_name : null,
    shareToken: typeof r.share_token === 'string' ? r.share_token : null,
    summary: r.summary,
    diagnosedAt: typeof r.diagnosed_at === 'string' ? r.diagnosed_at : null,
    sendError: typeof r.send_error === 'string' ? r.send_error : null,
    createdAt: String(r.created_at),
  }));

  const plan = planEmailRetries(rows);
  let succeeded = 0;
  let failed = 0;
  let deduped = 0;

  for (const target of plan.targets) {
    /**
     * 이미 같은 리포트가 같은 주소로 나간 적이 있으면 보내지 않는다.
     *
     * ⚠️ 기존 발송 경로는 사용자가 재요청할 때마다 **새 행**을 만든다. 그래서
     *    "처음 실패 → 사용자가 다시 요청 → 성공" 이면 실패 행이 남아 있고,
     *    cron 이 같은 리포트를 한 번 더 보내게 된다(2026-07-28 교차검증 지적).
     *    같은 (토큰, 주소) 로 성공한 행이 있으면 목적은 이미 달성됐으므로
     *    행을 해소만 하고 발송은 건너뛴다.
     */
    const { data: already } = await admin
      .from(LEADS_TABLE)
      .select('id')
      .eq('share_token', target.shareToken)
      .eq('email', target.email)
      .eq('sent', true)
      .limit(1);

    if (already && already.length > 0) {
      deduped += 1;
      await admin
        .from(LEADS_TABLE)
        .update({ sent: true, send_error: '중복 — 동일 리포트가 같은 주소로 이미 발송됨' })
        .eq('id', target.id);
      continue;
    }

    const { subject, html } = buildDiagnosisEmail({
      clinicName: target.clinicName ?? '',
      summary: (target.summary ?? null) as DiagnosisLeadSummary | null,
      reportUrl: `${SITE_URL}/clinic-check/r/${target.shareToken}`,
      runAt: target.diagnosedAt ?? '',
    });

    const outcome = await sendEmail({
      to: target.email,
      subject,
      html,
      feature: 'clinic-diagnosis',
    });

    if (outcome.success) succeeded += 1;
    else failed += 1;

    const { error: updateError } = await admin
      .from(LEADS_TABLE)
      .update({
        sent: outcome.success,
        // 성공하면 지난 실패 사유를 지운다 — 남겨두면 다음 사람이 오독한다.
        send_error: outcome.success ? null : (outcome.error ?? '재발송 실패').slice(0, 500),
      })
      .eq('id', target.id);
    if (updateError) {
      console.error('[cron/email-retry] 결과 반영 실패:', updateError.message);
    }
  }

  const summary = {
    attempted: succeeded + failed,
    succeeded,
    failed,
    skipped: plan.skipped.length + deduped,
    deferred: plan.deferred,
  };
  const text = buildRetrySummaryText(summary);

  /**
   * 조용한 날은 알리지 않는다 — 아무 일도 없던 날까지 보고하면 채널이 오염된다.
   *
   * ⚠️ 개별 실패는 sendEmail 내부의 notifyEmailFailure 가 이미 알린다(24시간 5건 상한).
   *    여기 요약과 겹치는 것은 **의도한 중복**이다 — 개별 알림은 "무엇이 왜 실패했나",
   *    요약은 "이번 실행 전체가 어땠나" 로 답하는 질문이 다르다. 개별 알림에 상한이
   *    걸려 있어 폭주하지 않는다.
   */
  if (summary.attempted > 0 || deduped > 0) {
    console.warn(`[cron/email-retry] ${text}`);
    await sendTelegram(text).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, ...summary, deduped });
}

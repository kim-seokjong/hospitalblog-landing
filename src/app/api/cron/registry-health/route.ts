import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron, cronSecretStatus } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { lookupClinicsDetailed } from '@/content/lib/clinic-diagnosis/registry';
import {
  alertHtml,
  alertSubject,
  judgeRegistryHealth,
  REGISTRY_CANARIES,
  shouldAlert,
  type CanaryProbe,
  type RegistryHealthStatus,
} from '@/content/lib/clinic-diagnosis/registry-health';
import { sendEmail } from '@/payment/email/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/registry-health — 행안부 병원 조회 카나리 점검 (매시간).
 *
 * ★ 2026-07-27, 홈페이지 첫 화면의 병원 조회가 전건 실패했는데 **사람이 실존 병원
 *   12곳을 직접 쏴 보고 나서야** 알았다. 그 15분 동안 들어온 원장들은 전부
 *   "그런 병원 없음"을 보고 떠났다. 다시는 사람의 제보로 장애를 알지 않는다.
 *
 * 하는 일:
 *   ① 전국에 수백~수천 곳 있는 상호를 조회한다 (0건이 나올 수 없는 이름)
 *   ② 0건이거나 호출이 실패하면 장애로 판정한다
 *   ③ clinic_registry_health 에 이력을 남기고, **상태가 바뀔 때만** 메일로 알린다
 *
 * 비용: 카나리 2개 × 보통 1콜 = 시간당 2콜, 하루 48콜. 일일 한도(10,000) 대비 0.5%.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized', cronSecret: cronSecretStatus() }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const probes: CanaryProbe[] = [];

  for (const name of REGISTRY_CANARIES) {
    // 폴백을 태우지 않는다 — 여기서 재고 싶은 것은 **행안부 그 자체**다.
    const { trace } = await lookupClinicsDetailed(name);
    const successes = trace.calls.filter((c) => c.ok);
    const first = successes[0] ?? null;
    const bestItems = successes.reduce((max, c) => Math.max(max, c.items), 0);
    probes.push({
      name,
      ok: successes.length > 0,
      totalCount: first ? first.totalCount : -1,
      items: bestItems,
      failure: successes.length > 0 ? null : (trace.calls[0]?.failure ?? '호출 없음'),
    });
  }

  const verdict = judgeRegistryHealth(probes);
  const previousStatus = await readPreviousStatus();
  const alert = shouldAlert(verdict.status, previousStatus);

  // 로그는 상태와 무관하게 남긴다 — DB 가 없어도 Vercel 로그만으로 판정할 수 있어야 한다.
  const line = `[cron/registry-health] status=${verdict.status} prev=${previousStatus ?? 'none'} ${verdict.note}`;
  if (verdict.status === 'ok') console.warn(line);
  else console.error(line);

  let alerted = false;
  if (alert) {
    alerted = await notifyAdmins(verdict.status, alertHtml(verdict, checkedAt));
  }

  await recordHealth(verdict.status, probes, verdict.note, alerted);

  return NextResponse.json({
    ok: true,
    status: verdict.status,
    previousStatus,
    healthy: verdict.healthy,
    zero: verdict.zero,
    failed: verdict.failed,
    note: verdict.note,
    alerted,
    checkedAt,
  });
}

/** 직전 점검 상태. 읽지 못하면 null — 그 경우 알림은 "상태가 ok 가 아니면 보낸다"로 넘어간다. */
async function readPreviousStatus(): Promise<RegistryHealthStatus | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('clinic_registry_health')
      .select('status')
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const status = (data as { status?: unknown }).status;
    return status === 'ok' || status === 'degraded' || status === 'down' ? status : null;
  } catch {
    return null;
  }
}

/** 점검 이력 적재. 실패해도 점검 자체를 실패로 만들지 않는다(알림이 더 중요하다). */
async function recordHealth(
  status: RegistryHealthStatus,
  probes: readonly CanaryProbe[],
  note: string,
  alerted: boolean,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('clinic_registry_health')
      .insert({ status, probes, note: note.slice(0, 500), alerted });
    if (error) console.error('[cron/registry-health] 이력 적재 실패(무시):', error.message);
  } catch (e) {
    console.error('[cron/registry-health] 이력 적재 예외(무시):', e instanceof Error ? e.message : e);
  }
}

/** 관리자 메일 주소 목록. 미설정이면 빈 배열 — 그때는 로그만 남는다. */
function adminRecipients(): readonly string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.includes('@'));
}

async function notifyAdmins(status: RegistryHealthStatus, html: string): Promise<boolean> {
  const recipients = adminRecipients();
  if (recipients.length === 0) {
    console.error('[cron/registry-health] ADMIN_EMAILS 미설정 — 알림을 보낼 곳이 없습니다.');
    return false;
  }
  let sent = false;
  for (const to of recipients) {
    const result = await sendEmail({ to, subject: alertSubject(status), html });
    if (result.success) sent = true;
    else console.error('[cron/registry-health] 알림 발송 실패:', result.error);
  }
  return sent;
}

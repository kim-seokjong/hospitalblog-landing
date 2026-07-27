// 체험 종료 D-3 성과 리포트 — 일 1회 배치 (해지·이탈 방어).
//
// 배경: 체험 회원이 성과를 체감하기 전에 자동결제를 취소·이탈한다
//   (예: 바르다권치과 = 30일 체험 중 글 14개 생성했으나 종료 전 이탈).
// 체험 만료 3일 전(KST) 대상을 찾아 "당신이 만든 N개 글의 성과"를 요약한다.
// D-2·D-1 은 발송 실패분 재시도 윈도우 — 성공분은 notifications 기록으로 중복 차단.
//
// 대상 = **실제 체험 상태인 계정만** (갱신형 월 구독자 제외):
//   ① billing_keys.trial_until 이 만료 윈도우에 든 ACTIVE 키 보유자
//   ② profiles.plan_expires_at 이 윈도우에 들면서, billing_keys.trial_until 이
//      존재하고 아직 미래인(=체험 중) 계정 — 체험 중 자동결제를 취소해 ①에서
//      빠진 케이스(바르다권치과 패턴)를 여기서 잡는다.
//   일반 유료 구독자의 plan_expires_at D-3(매달 도래)에는 발송하지 않는다.
//
// ⚠️ 실고객 발송 게이트: ENABLE_TRIAL_REPORT_SEND (기본 OFF).
//   - OFF(기본): 자동으로 실고객 메일함에 나가지 않는다. 리포트를 생성해 **대표에게만**
//     다이제스트 이메일(TRIAL_REPORT_ADMIN_EMAIL)로 전달 → 대표가 검토 후 직접 발송.
//     TRIAL_REPORT_ADMIN_EMAIL 미설정 시 다이제스트도 발송하지 않고 로그만 남긴다
//     (하드코딩 수신 주소 없음).
//   - ON: 각 실고객에게 리포트 이메일 발송, **발송 성공 시에만** 인앱 알림(trial_report)
//     기록(중복 발송 차단 겸용). 실패분은 미기록으로 남아 다음날 재시도된다.
//
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role 기록.
// 스케줄: vercel.json 일 1회.

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PAID_PLAN_IDS } from '@/payment/lib/plans';
import { sendEmail } from '@/payment/email/client';
import { aggregateRankings, type RankingPointRow } from '@/content/lib/monthly-report';
import { scoreGeoReadiness } from '@/content/lib/geo-tracking';
import {
  findTrialReportTargets,
  buildTrialReportSummary,
  buildTrialReportEmail,
  buildTrialReportAdminDigest,
  TRIAL_REPORT_WINDOW_DAYS,
  type TrialCandidate,
  type TrialTarget,
  type AdminDigestRow,
  type TrialReportSummary,
} from '@/content/lib/trial-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 1회 실행 대상 상한 — 도달 시 로그를 남긴다. 초과분은 만료 임박순 정렬 덕에
// 다음날(D-2·D-1 재시도 윈도우) 배치에서 이어서 처리된다.
const MAX_TARGETS = 500;
const MAX_POSTS = 100; // GEO 준비도 산정용 발행 글 스캔 상한
const MAX_RANKING_ROWS = 3000;
const AGGREGATE_CONCURRENCY = 5; // 사용자별 집계·발송 동시성 (N+1 직렬 방지, DB 과부하 방지)

/** 실고객 실발송 게이트 (기본 OFF — off 면 대표에게만). */
function isCustomerSendEnabled(): boolean {
  const v = (process.env.ENABLE_TRIAL_REPORT_SEND ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** 대표 다이제스트 수신 이메일 — env 미설정이면 null (발송 생략, 하드코딩 금지). */
function adminEmail(): string | null {
  const v = (process.env.TRIAL_REPORT_ADMIN_EMAIL ?? '').trim();
  return v.length > 0 ? v : null;
}

type Admin = ReturnType<typeof createAdminClient>;

interface ProfileRow {
  id: string;
  email: string | null;
  hospital_name: string | null;
  plan: string | null;
  plan_expires_at: string | null;
  created_at: string | null;
}

/** now 기준 [+0d, +4d] ISO 범위 — D-3~D-1 후보를 넉넉히 뽑고 KST 기준으로 정확히 좁힌다. */
function candidateRange(now: Date): { startIso: string; endIso: string } {
  const start = new Date(now);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + TRIAL_REPORT_WINDOW_DAYS + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

interface TrialKeyRow {
  user_id: string | null;
  trial_until: string | null;
  created_at: string | null;
}

/**
 * 후보 수집 — 실제 체험 상태만 (갱신형 월 구독 제외).
 * 쿼리 error 는 throw 해 배치를 중단시킨다(폴백으로 빈 목록을 쓰면 "대상 0건" 오보고).
 */
async function collectCandidates(admin: Admin, now: Date): Promise<TrialCandidate[]> {
  const { startIso, endIso } = candidateRange(now);
  const candidates: TrialCandidate[] = [];

  // ① billing_keys.trial_until (체험 종료일) — ACTIVE 만.
  //    만료 임박순 정렬을 **DB 쿼리에** 건다 — limit 이 정렬 없이 걸리면 후보 초과 시
  //    임의 N건이 잘려 나가 애플리케이션 정렬로도 복구 불가(누락 대상 인지도 불가).
  const { data: trialRows, error: trialErr } = await admin
    .from('billing_keys')
    .select('user_id, trial_until, created_at')
    .eq('status', 'ACTIVE')
    .not('trial_until', 'is', null)
    .gte('trial_until', startIso)
    .lt('trial_until', endIso)
    .order('trial_until', { ascending: true })
    .limit(MAX_TARGETS);
  if (trialErr) throw new Error(`billing_keys(trial_until) 조회 실패: ${trialErr.message}`);
  if ((trialRows ?? []).length >= MAX_TARGETS) {
    console.warn(
      `[trial-report] billing_keys 후보가 limit(${MAX_TARGETS})에 도달 — 만료 임박순 상위만 조회됨, 잔여는 익일 윈도우에서 처리`,
    );
  }

  const trialByUser = new Map<string, { trialUntil: string; startedAt: string | null }>();
  for (const r of (trialRows ?? []) as TrialKeyRow[]) {
    if (r.user_id && r.trial_until) {
      trialByUser.set(r.user_id, { trialUntil: r.trial_until, startedAt: r.created_at ?? null });
    }
  }

  // ② profiles.plan_expires_at — 단, **체험 중인 계정만** (billing_keys.trial_until 존재+미래).
  //    체험 중 자동결제를 취소해 ①(ACTIVE)에서 빠진 계정을 잡는다. 일반 월 구독 갱신 D-3 제외.
  const { data: planRows, error: planErr } = await admin
    .from('profiles')
    .select('id, plan_expires_at')
    .in('plan', PAID_PLAN_IDS)
    .not('plan_expires_at', 'is', null)
    .gte('plan_expires_at', startIso)
    .lt('plan_expires_at', endIso)
    .order('plan_expires_at', { ascending: true })
    .limit(MAX_TARGETS);
  if (planErr) throw new Error(`profiles(plan_expires_at) 조회 실패: ${planErr.message}`);
  if ((planRows ?? []).length >= MAX_TARGETS) {
    console.warn(
      `[trial-report] profiles 후보가 limit(${MAX_TARGETS})에 도달 — 만료 임박순 상위만 조회됨, 잔여는 익일 윈도우에서 처리`,
    );
  }

  const planCandidates = ((planRows ?? []) as Array<{ id: string; plan_expires_at: string | null }>).filter(
    (r) => !!r.id,
  );

  // ②의 체험 상태 교차 확인 — 해당 사용자들의 billing_keys 에서 trial_until(미래) 존재 여부
  const trialStateByUser = new Map<string, string | null>(); // userId → 체험 시작(created_at)
  const planUserIds = planCandidates.map((r) => r.id).filter((id) => !trialByUser.has(id));
  if (planUserIds.length > 0) {
    const { data: keyRows, error: keyErr } = await admin
      .from('billing_keys')
      .select('user_id, trial_until, created_at')
      .in('user_id', planUserIds)
      .not('trial_until', 'is', null)
      .gte('trial_until', now.toISOString());
    if (keyErr) throw new Error(`billing_keys(체험 상태 교차확인) 조회 실패: ${keyErr.message}`);
    for (const r of (keyRows ?? []) as TrialKeyRow[]) {
      if (r.user_id) trialStateByUser.set(r.user_id, r.created_at ?? null);
    }
  }

  // trial_until 우선 등장(userId 중복 제거는 findTrialReportTargets 가 먼저 등장 유지)
  for (const [userId, info] of trialByUser) {
    candidates.push({
      userId,
      email: null,
      hospitalName: null,
      expiresAt: info.trialUntil,
      source: 'trial_until',
      startedAt: info.startedAt,
    });
  }
  for (const r of planCandidates) {
    if (!trialStateByUser.has(r.id)) continue; // 체험 상태가 아니면(갱신형 구독) 제외
    candidates.push({
      userId: r.id,
      email: null,
      hospitalName: null,
      expiresAt: r.plan_expires_at,
      source: 'plan_expires_at',
      startedAt: trialStateByUser.get(r.id) ?? null,
    });
  }
  return candidates;
}

/** 대상 프로필 배치 조회 → 이메일·병원명·가입시각 채움. 쿼리 error 는 throw(중단). */
async function fetchProfiles(admin: Admin, userIds: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (userIds.length === 0) return map;
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, hospital_name, plan, plan_expires_at, created_at')
    .in('id', userIds);
  if (error) throw new Error(`profiles 배치 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as ProfileRow[]) map.set(r.id, r);
  return map;
}

/**
 * 사용자 1명의 성과 요약 재료 집계.
 * sinceIso(체험 시작 — 없으면 계정 생성 시각)로 스코프해 **체험 기간의 성과만** 집계한다
 * (과거 구독 이력이 있는 재가입 계정의 누적 전체가 섞이지 않게). 쿼리 error 는 throw
 * → 호출부가 해당 사용자만 failure 처리한다.
 */
async function aggregateUser(
  admin: Admin,
  userId: string,
  hospitalName: string | null,
  sinceIso: string | null,
): Promise<{ summary: TrialReportSummary; postsCreated: number }> {
  let createdQ = admin.from('saved_posts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (sinceIso) createdQ = createdQ.gte('created_at', sinceIso);
  const { count: postsCreated, error: createdErr } = await createdQ;
  if (createdErr) throw new Error(`saved_posts 집계 실패: ${createdErr.message}`);

  let publishedQ = admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'published');
  if (sinceIso) publishedQ = publishedQ.gte('created_at', sinceIso);
  const { count: postsPublished, error: publishedErr } = await publishedQ;
  if (publishedErr) throw new Error(`saved_posts(발행) 집계 실패: ${publishedErr.message}`);

  // 발행 글 본문 → GEO 준비도
  let pubQ = admin
    .from('saved_posts')
    .select('title, content')
    .eq('user_id', userId)
    .eq('status', 'published')
    .limit(MAX_POSTS);
  if (sinceIso) pubQ = pubQ.gte('created_at', sinceIso);
  const { data: pubPosts, error: pubErr } = await pubQ;
  if (pubErr) throw new Error(`saved_posts(본문) 조회 실패: ${pubErr.message}`);
  const geo = scoreGeoReadiness(
    ((pubPosts ?? []) as Array<{ title: string | null; content: string | null }>).map((p) => ({
      title: p.title ?? '',
      content: p.content ?? '',
    })),
  );

  // 순위 시계열 집계 (체험 기간의 측정만)
  // status 는 마이그 052 이후 컬럼 — 미적용 환경에서는 빼고 재조회한다.
  // ★ status='invalid'(2026-07 이전 고장난 파이프라인 산출물)은 리포트에서 제외한다.
  type TrialRankRow = {
    post_id: string | null;
    keyword: string;
    rank: number | null;
    checked_at: string;
    status?: string | null;
  };
  const buildRankQuery = (columns: string) => {
    let q = admin
      .from('post_rankings')
      .select(columns)
      .eq('user_id', userId)
      .order('checked_at', { ascending: true })
      .limit(MAX_RANKING_ROWS);
    if (sinceIso) q = q.gte('checked_at', sinceIso);
    return q;
  };
  let rankRows: TrialRankRow[];
  {
    const withStatus = await buildRankQuery('post_id, keyword, rank, checked_at, status');
    if (withStatus.error) {
      const legacy = await buildRankQuery('post_id, keyword, rank, checked_at');
      if (legacy.error) throw new Error(`post_rankings 조회 실패: ${legacy.error.message}`);
      rankRows = (legacy.data ?? []) as unknown as TrialRankRow[];
    } else {
      rankRows = (withStatus.data ?? []) as unknown as TrialRankRow[];
    }
  }
  const rankings = aggregateRankings(
    rankRows
      .filter((r) => r.status !== 'invalid')
      .map((r): RankingPointRow => ({ postId: r.post_id, keyword: r.keyword, rank: r.rank, checkedAt: r.checked_at })),
  );

  // AI 검색 인용 건수 (cited=true, 체험 기간 내 측정)
  let citedQ = admin
    .from('geo_citations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('cited', true);
  if (sinceIso) citedQ = citedQ.gte('checked_at', sinceIso);
  const { count: geoCitedCount, error: citedErr } = await citedQ;
  if (citedErr) throw new Error(`geo_citations 집계 실패: ${citedErr.message}`);

  const summary = buildTrialReportSummary({
    hospitalName,
    postsCreated: postsCreated ?? 0,
    postsPublished: postsPublished ?? 0,
    trackedKeywords: rankings.trackedKeywords,
    top10Count: rankings.top10Count,
    geoCitedCount: geoCitedCount ?? 0,
    geoReadiness: geo?.score ?? null,
    topKeyword: rankings.improved[0]?.keyword ?? null,
  });
  return { summary, postsCreated: postsCreated ?? 0 };
}

/**
 * 최근 발송 이력(trial_report 알림) 존재 여부 — 발송 직전 재확인용.
 * 발송 성공 시에만 기록되므로, true = 이미 성공 발송됨(중복 방지).
 * 조회 실패 시 안전측(true)으로 처리해 중복 발송을 막는다(다음날 재시도 여지는 유지).
 *
 * 수용된 한계 2가지:
 * - cron 이 동시 실행되면(재시도·수동 트리거 겹침) 재확인~기록 사이 초 단위 틈에서
 *   중복 발송 가능 — 일 1회 스케줄 특성상 수용(분산 락 과설계 금지).
 * - lookback(윈도우+1일) 내 재체험을 시작한 계정은 회차 리포트가 눌릴 수 있으나,
 *   30일 체험 구조상 4일 내 재체험은 비현실적 — 수용.
 */
async function alreadyNotified(admin: Admin, userId: string, now: Date): Promise<boolean> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (TRIAL_REPORT_WINDOW_DAYS + 1)); // 재시도 윈도우 전체를 덮는다
  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', 'trial_report')
    .gte('created_at', since.toISOString());
  if (error) {
    console.error('[trial-report] 발송 이력 조회 실패(안전측 skip):', userId, error.message);
    return true;
  }
  return (count ?? 0) > 0;
}

/** 제한 동시성 map — 순서 보존, 개별 실패는 fn 안에서 처리(여기선 throw 전파 안 함 전제 아님). */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

interface PerTargetOutcome {
  digestRow: AdminDigestRow | null;
  emailed: boolean;
  notifRecorded: boolean;
  failure: { userId: string; reason: string } | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const customerSend = isCustomerSendEnabled();

  let targetsCount = 0;
  let customerEmailed = 0;
  let notified = 0;
  const failures: Array<{ userId: string; reason: string }> = [];

  try {
    // createAdminClient 실패(env 미설정)도 구조화된 {ok:false} 로 응답하도록 try 안에서 생성
    const admin = createAdminClient();

    const candidates = await collectCandidates(admin, now);
    const allTargets = findTrialReportTargets(candidates, now); // 만료 임박순 정렬됨
    if (allTargets.length > MAX_TARGETS) {
      console.warn(
        `[trial-report] 대상 ${allTargets.length}건이 cap(${MAX_TARGETS}) 초과 — 만료 임박순 ${MAX_TARGETS}건만 처리, 잔여는 익일 재시도 윈도우에서 처리`,
      );
    }
    const targets = allTargets.slice(0, MAX_TARGETS);
    targetsCount = targets.length;

    const profiles = await fetchProfiles(
      admin,
      targets.map((t) => t.userId),
    );

    const outcomes = await mapWithConcurrency<TrialTarget, PerTargetOutcome>(
      targets,
      AGGREGATE_CONCURRENCY,
      async (target) => {
        const outcome: PerTargetOutcome = {
          digestRow: null,
          emailed: false,
          notifRecorded: false,
          failure: null,
        };
        try {
          const profile = profiles.get(target.userId);
          const hospitalName = profile?.hospital_name ?? null;
          const email = profile?.email ?? null;
          // 대표 다이제스트는 D-3 신규 대상만(재시도분 D-2·D-1 로 매일 중복 나열 방지)
          const isFreshD3 = target.daysLeft === TRIAL_REPORT_WINDOW_DAYS;
          const wantSend = customerSend && !!email;
          if (!isFreshD3 && !wantSend) return outcome; // 집계할 이유 없음

          // 성과 집계 스코프 = 체험 시작(billing_keys.created_at) → 없으면 계정 생성 시각
          const sinceIso = target.startedAt ?? profile?.created_at ?? null;
          const { summary, postsCreated } = await aggregateUser(
            admin,
            target.userId,
            hospitalName,
            sinceIso,
          );

          if (isFreshD3) {
            outcome.digestRow = { hospitalName, email, postsCreated, headline: summary.headline };
          }

          // 실고객 발송 — 게이트 ON 일 때만. 발송 직전 이력 재확인 → 성공 시에만 알림 기록.
          if (wantSend && email) {
            if (await alreadyNotified(admin, target.userId, now)) return outcome;
            const { subject, html } = buildTrialReportEmail(summary);
            const sent = await sendEmail({ to: email, subject, html, feature: 'trial-report' });
            if (!sent.success) {
              // 미기록으로 남긴다 → 다음날(D-2·D-1) 배치가 재시도
              outcome.failure = { userId: target.userId, reason: '리포트 이메일 발송 실패' };
              return outcome;
            }
            outcome.emailed = true;
            // 발송 성공 확인 후에만 기록 — 중복 발송 차단 + 실패분 재시도 허용의 기준점
            const { error: notifyErr } = await admin.from('notifications').insert({
              user_id: target.userId,
              type: 'trial_report',
              title: '체험 종료 3일 전 — 성과 리포트가 도착했어요',
              message: summary.headline,
              is_read: false,
            });
            if (notifyErr) {
              // 이메일은 나갔는데 기록 실패 → 다음날 중복 발송 가능성. 로그로 추적.
              console.error(
                '[trial-report] 발송 이력 기록 실패(익일 중복 발송 가능):',
                target.userId,
                notifyErr.message,
              );
            } else {
              outcome.notifRecorded = true;
            }
          }
          return outcome;
        } catch (e) {
          outcome.failure = {
            userId: target.userId,
            reason: e instanceof Error ? e.message : 'unknown',
          };
          return outcome;
        }
      },
    );

    const digestRows: AdminDigestRow[] = [];
    for (const o of outcomes) {
      if (o.digestRow) digestRows.push(o.digestRow);
      if (o.emailed) customerEmailed += 1;
      if (o.notifRecorded) notified += 1;
      if (o.failure) failures.push(o.failure);
    }

    // 대표 다이제스트 발송 (게이트 무관) — 단 수신 주소(env) 미설정이면 발송 없이 로그만
    const digestTo = adminEmail();
    let digestSent = false;
    if (digestTo) {
      const digest = buildTrialReportAdminDigest(digestRows);
      const sent = await sendEmail({ to: digestTo, subject: digest.subject, html: digest.html, feature: 'trial-digest' });
      digestSent = sent.success;
      if (!sent.success) console.error('[trial-report] 대표 다이제스트 발송 실패:', digestTo);
    } else {
      console.warn(
        `[trial-report] TRIAL_REPORT_ADMIN_EMAIL 미설정 — 다이제스트 발송 생략 (대상 ${digestRows.length}건)`,
      );
    }

    return NextResponse.json({
      ok: true,
      customerSendEnabled: customerSend,
      targets: targetsCount,
      customerEmailed,
      notified,
      digestSent,
      adminEmailConfigured: digestTo !== null,
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    console.error('[trial-report] 배치 중단:', message);
    return NextResponse.json(
      { ok: false, error: message, targets: targetsCount, customerEmailed, notified, failures },
      { status: 500 },
    );
  }
}

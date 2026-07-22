// 체험 종료 D-3 성과 리포트 — 일 1회 배치 (해지·이탈 방어).
//
// 배경: 체험 회원이 성과를 체감하기 전에 자동결제를 취소·이탈한다
//   (예: 바르다권치과 = 30일 체험 중 글 14개 생성했으나 종료 전 이탈).
// 체험/플랜 만료 정확히 3일 전(KST) 대상을 찾아 "당신이 만든 N개 글의 성과"를 요약한다.
//
// ⚠️ 실고객 발송 게이트: ENABLE_TRIAL_REPORT_SEND (기본 OFF).
//   - OFF(기본): 자동으로 실고객 메일함에 나가지 않는다. 리포트를 생성해 **대표에게만**
//     다이제스트 이메일(TRIAL_REPORT_ADMIN_EMAIL)로 전달 → 대표가 검토 후 직접 발송.
//   - ON: 각 실고객에게 리포트 이메일 + 인앱 알림(trial_report) 발송(+대표 다이제스트 사본).
//   실발송 배선은 만들되 기본 비활성 — 이 게이트를 넘기 전엔 실고객에게 아무것도 안 나간다.
//
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role 기록.
// 스케줄: vercel.json 일 1회. 첫 구현 = 대상 탐색 + 리포트 생성 + 대표 알림.

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
  type TrialCandidate,
  type AdminDigestRow,
} from '@/content/lib/trial-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_TARGETS = 200; // 1회 실행 대상 상한
const MAX_POSTS = 100; // GEO 준비도 산정용 발행 글 스캔 상한
const MAX_RANKING_ROWS = 3000;

/** 실고객 실발송 게이트 (기본 OFF — off 면 대표에게만). */
function isCustomerSendEnabled(): boolean {
  const v = (process.env.ENABLE_TRIAL_REPORT_SEND ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** 대표 다이제스트 수신 이메일 (기본 회사 대외 메일). */
function adminEmail(): string {
  return (process.env.TRIAL_REPORT_ADMIN_EMAIL ?? 'terro6936@naver.com').trim();
}

type Admin = ReturnType<typeof createAdminClient>;

interface ProfileRow {
  id: string;
  email: string | null;
  hospital_name: string | null;
  plan: string | null;
  plan_expires_at: string | null;
}

/** now 기준 [+2d, +4d] ISO 범위 — D-3 후보를 넉넉히 뽑고 이후 정확히 D-3로 좁힌다. */
function candidateRange(now: Date): { startIso: string; endIso: string } {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 2);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 4);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** 후보 수집 — billing_keys.trial_until(우선) + profiles.plan_expires_at. */
async function collectCandidates(admin: Admin, now: Date): Promise<TrialCandidate[]> {
  const { startIso, endIso } = candidateRange(now);
  const candidates: TrialCandidate[] = [];

  // ① billing_keys.trial_until (체험 종료일) — ACTIVE 만
  const { data: trialRows } = await admin
    .from('billing_keys')
    .select('user_id, trial_until')
    .eq('status', 'ACTIVE')
    .not('trial_until', 'is', null)
    .gte('trial_until', startIso)
    .lt('trial_until', endIso)
    .limit(MAX_TARGETS);

  const trialByUser = new Map<string, string>();
  for (const r of (trialRows ?? []) as Array<{ user_id: string | null; trial_until: string | null }>) {
    if (r.user_id && r.trial_until) trialByUser.set(r.user_id, r.trial_until);
  }

  // ② profiles.plan_expires_at (유료 플랜 만료일)
  const { data: planRows } = await admin
    .from('profiles')
    .select('id, plan_expires_at')
    .in('plan', PAID_PLAN_IDS)
    .not('plan_expires_at', 'is', null)
    .gte('plan_expires_at', startIso)
    .lt('plan_expires_at', endIso)
    .limit(MAX_TARGETS);

  // trial_until 우선 등장(중복 제거는 findTrialReportTargets 가 먼저 등장 유지)
  for (const [userId, trialUntil] of trialByUser) {
    candidates.push({ userId, email: null, hospitalName: null, expiresAt: trialUntil, source: 'trial_until' });
  }
  for (const r of (planRows ?? []) as Array<{ id: string; plan_expires_at: string | null }>) {
    if (r.id) {
      candidates.push({
        userId: r.id,
        email: null,
        hospitalName: null,
        expiresAt: r.plan_expires_at,
        source: 'plan_expires_at',
      });
    }
  }
  return candidates;
}

/** 대상 프로필 배치 조회 → 이메일·병원명 채움. */
async function fetchProfiles(admin: Admin, userIds: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (userIds.length === 0) return map;
  const { data } = await admin
    .from('profiles')
    .select('id, email, hospital_name, plan, plan_expires_at')
    .in('id', userIds);
  for (const r of (data ?? []) as ProfileRow[]) map.set(r.id, r);
  return map;
}

/** 사용자 1명의 성과 요약 재료 집계. */
async function aggregateUser(admin: Admin, userId: string, hospitalName: string | null) {
  const { count: postsCreated } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { count: postsPublished } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'published');

  // 발행 글 본문 → GEO 준비도
  const { data: pubPosts } = await admin
    .from('saved_posts')
    .select('title, content')
    .eq('user_id', userId)
    .eq('status', 'published')
    .limit(MAX_POSTS);
  const geo = scoreGeoReadiness(
    ((pubPosts ?? []) as Array<{ title: string | null; content: string | null }>).map((p) => ({
      title: p.title ?? '',
      content: p.content ?? '',
    })),
  );

  // 순위 시계열 집계
  const { data: rankRows } = await admin
    .from('post_rankings')
    .select('post_id, keyword, rank, checked_at')
    .eq('user_id', userId)
    .order('checked_at', { ascending: true })
    .limit(MAX_RANKING_ROWS);
  const rankings = aggregateRankings(
    ((rankRows ?? []) as Array<{ post_id: string | null; keyword: string; rank: number | null; checked_at: string }>).map(
      (r): RankingPointRow => ({ postId: r.post_id, keyword: r.keyword, rank: r.rank, checkedAt: r.checked_at }),
    ),
  );

  // AI 검색 인용 건수 (cited=true)
  const { count: geoCitedCount } = await admin
    .from('geo_citations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('cited', true);

  return buildTrialReportSummary({
    hospitalName,
    postsCreated: postsCreated ?? 0,
    postsPublished: postsPublished ?? 0,
    trackedKeywords: rankings.trackedKeywords,
    top10Count: rankings.top10Count,
    geoCitedCount: geoCitedCount ?? 0,
    geoReadiness: geo?.score ?? null,
    topKeyword: rankings.improved[0]?.keyword ?? null,
  });
}

/** 최근 2일 내 동일 사용자 trial_report 알림 존재 여부 (재실행 중복 발송 방지). */
async function alreadyNotified(admin: Admin, userId: string, now: Date): Promise<boolean> {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 2);
  const { count } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', 'trial_report')
    .gte('created_at', since.toISOString());
  return (count ?? 0) > 0;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const customerSend = isCustomerSendEnabled();
  const admin = createAdminClient();

  let targetsCount = 0;
  let customerEmailed = 0;
  let notified = 0;
  const digestRows: AdminDigestRow[] = [];
  const failures: Array<{ userId: string; reason: string }> = [];

  try {
    const candidates = await collectCandidates(admin, now);
    const targets = findTrialReportTargets(candidates, now).slice(0, MAX_TARGETS);
    targetsCount = targets.length;

    const profiles = await fetchProfiles(
      admin,
      targets.map((t) => t.userId),
    );

    for (const target of targets) {
      try {
        const profile = profiles.get(target.userId);
        const hospitalName = profile?.hospital_name ?? null;
        const email = profile?.email ?? null;

        const summary = await aggregateUser(admin, target.userId, hospitalName);

        // 대표 다이제스트 행 (항상 수집)
        const postsMatch = summary.headline.match(/(\d+)개/);
        digestRows.push({
          hospitalName,
          email,
          postsCreated: postsMatch ? Number(postsMatch[1]) : 0,
          headline: summary.headline,
        });

        // 실고객 발송 — 게이트 ON 일 때만
        if (customerSend && email) {
          if (await alreadyNotified(admin, target.userId, now)) continue;
          const { subject, html } = buildTrialReportEmail(summary);
          const sent = await sendEmail({ to: email, subject, html });
          if (sent.success) customerEmailed += 1;
          // 인앱 알림 (실패해도 무시 — 리포트 자체는 이메일로 전달됨)
          const { error: notifyErr } = await admin.from('notifications').insert({
            user_id: target.userId,
            type: 'trial_report',
            title: '체험 종료 3일 전 — 성과 리포트가 도착했어요',
            message: summary.headline,
            is_read: false,
          });
          if (!notifyErr) notified += 1;
        }
      } catch (e) {
        failures.push({ userId: target.userId, reason: e instanceof Error ? e.message : 'unknown' });
      }
    }

    // 대표 다이제스트 발송 (게이트 무관 — 대표는 항상 대상 목록을 받는다)
    const digest = buildTrialReportAdminDigest(digestRows);
    const digestSent = await sendEmail({ to: adminEmail(), subject: digest.subject, html: digest.html });

    return NextResponse.json({
      ok: true,
      customerSendEnabled: customerSend,
      targets: targetsCount,
      customerEmailed,
      notified,
      digestSent: digestSent.success,
      adminEmail: adminEmail(),
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, targets: targetsCount, customerEmailed, notified, failures },
      { status: 500 },
    );
  }
}

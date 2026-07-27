// 매월 1일 00:00 UTC(09:00 KST) 실행 — 지난달 월간 성과 리포트 자동 생성 (구독 해지 방어).
// 활성 사용자(유료 플랜 보유 또는 지난달 글 생성 이력자)별로 규칙 기반 집계(LLM 호출 없음)
// → monthly_reports upsert(멱등, 재실행 안전) → 신규 생성 시에만 인앱 알림 1건 + 요약 이메일(실패 무시).
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role로 기록(RLS 우회).
// 백필: ?period=YYYY-MM 쿼리로 대상 월 지정 가능 (인증 필수는 동일).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { PLANS, PAID_PLAN_IDS, isPaidPlanId } from '@/payment/lib/plans';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { sendEmail } from '@/payment/email/client';
import { monthlyReportEmail } from '@/payment/email/templates';
import {
  aggregateRankings,
  buildReportData,
  isValidPeriod,
  monthlyReportNotification,
  periodLabel,
  periodRangeKST,
  previousPeriodKST,
  type MonthlyImprovedPost,
  type MonthlyReportData,
  type RankingPointRow,
} from '@/content/lib/monthly-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// 부하 방어 상한
const MAX_USERS = 800;            // 1회 실행 사용자 상한
const PROFILE_PAGE_SIZE = 500;    // 프로필 페이지네이션 단위
const MAX_RANKING_ROWS = 3000;    // 사용자당 순위 시계열 상한
const MAX_LOG_ROWS = 10000;       // 활성 판정용 로그 스캔 상한
const IN_CHUNK = 100;             // .in() 쿼리 분할 단위

interface ProfileRow {
  id: string;
  email: string | null;
  hospital_name: string | null;
  plan: string | null;
  naver_blog_url: string | null;
}

interface UserResult {
  status: 'created' | 'updated';
  notified: boolean;
  emailed: boolean;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** 활성 사용자 id 수집 — ① 유료 플랜 보유자 ② 지난달 글 생성 이력자 (합집합) */
async function collectActiveUserIds(
  admin: ReturnType<typeof createAdminClient>,
  startIso: string,
  endIso: string,
): Promise<string[]> {
  const ids = new Set<string>();

  // ① 유료 플랜 보유자 (페이지네이션)
  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .in('plan', PAID_PLAN_IDS)
      .order('id', { ascending: true })
      .range(from, from + PROFILE_PAGE_SIZE - 1);
    if (error) throw new Error(`유료 플랜 사용자 조회 실패: ${error.message}`);
    for (const row of data ?? []) ids.add(row.id as string);
    if (!data || data.length < PROFILE_PAGE_SIZE) break;
    if (ids.size >= MAX_USERS) break;
  }

  // ② 지난달 글 생성 이력자 (usage_logs 정본 + saved_posts 보조)
  const { data: logRows } = await admin
    .from('usage_logs')
    .select('user_id')
    .eq('feature', 'generate-content')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(MAX_LOG_ROWS);
  for (const row of logRows ?? []) {
    if (row.user_id) ids.add(row.user_id as string);
  }

  const { data: postRows } = await admin
    .from('saved_posts')
    .select('user_id')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(MAX_LOG_ROWS);
  for (const row of postRows ?? []) {
    if (row.user_id) ids.add(row.user_id as string);
  }

  return Array.from(ids).slice(0, MAX_USERS);
}

/** 대상 사용자 프로필 배치 조회 (.in() 분할) */
async function fetchProfiles(
  admin: ReturnType<typeof createAdminClient>,
  userIds: readonly string[],
): Promise<ProfileRow[]> {
  const profiles: ProfileRow[] = [];
  for (const part of chunk(userIds, IN_CHUNK)) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, email, hospital_name, plan, naver_blog_url')
      .in('id', part);
    if (error) throw new Error(`프로필 조회 실패: ${error.message}`);
    profiles.push(...((data ?? []) as ProfileRow[]));
  }
  return profiles;
}

/** 사용자 1명의 지난달 리포트 데이터 집계 (전부 규칙 기반, LLM 호출 없음) */
async function aggregateUserReport(
  admin: ReturnType<typeof createAdminClient>,
  profile: ProfileRow,
  period: string,
  startIso: string,
  endIso: string,
): Promise<MonthlyReportData> {
  // 1) 지난달 생성(저장)한 글 수
  const { count: createdCount, error: createdErr } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (createdErr) throw new Error(`글 수 집계 실패: ${createdErr.message}`);

  // 2) 지난달 발행한 글 수 (published_at 미기록 글은 created_at 폴백 — 기존 추적 쿼리 패턴 동일)
  const { count: publishedCount, error: publishedErr } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('status', 'published')
    .or(
      `and(published_at.gte.${startIso},published_at.lt.${endIso}),and(published_at.is.null,created_at.gte.${startIso},created_at.lt.${endIso})`,
    );
  if (publishedErr) throw new Error(`발행 수 집계 실패: ${publishedErr.message}`);

  // 3) 의료광고법 검사 스냅샷 보유 글 수 (compliance_report 존재 = 검사 수행·증빙 보관)
  const { count: complianceCount, error: complianceErr } = await admin
    .from('saved_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .not('compliance_report', 'is', null)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (complianceErr) throw new Error(`검사 수 집계 실패: ${complianceErr.message}`);

  // 4) 지난달 순위 시계열 → 추적 키워드 수·상위 10위 진입·순위 상승 상위 5
  // status 는 마이그 052 이후 컬럼 — 미적용 환경(42703)에서는 빼고 재조회한다.
  // ★ status='invalid'(2026-07 이전 고장난 파이프라인 산출물)은 리포트에서 제외한다.
  type RankRow = {
    post_id: string | null;
    keyword: string;
    rank: number | null;
    checked_at: string;
    status?: string | null;
  };
  let rankRows: RankRow[];
  {
    const withStatus = await admin
      .from('post_rankings')
      .select('post_id, keyword, rank, checked_at, status')
      .eq('user_id', profile.id)
      .gte('checked_at', startIso)
      .lt('checked_at', endIso)
      .order('checked_at', { ascending: true })
      .limit(MAX_RANKING_ROWS);
    if (withStatus.error) {
      const legacy = await admin
        .from('post_rankings')
        .select('post_id, keyword, rank, checked_at')
        .eq('user_id', profile.id)
        .gte('checked_at', startIso)
        .lt('checked_at', endIso)
        .order('checked_at', { ascending: true })
        .limit(MAX_RANKING_ROWS);
      if (legacy.error) throw new Error(`순위 집계 실패: ${legacy.error.message}`);
      rankRows = (legacy.data ?? []) as RankRow[];
    } else {
      rankRows = (withStatus.data ?? []) as RankRow[];
    }
  }

  const rankings = aggregateRankings(
    rankRows.filter((r) => r.status !== 'invalid').map(
      (r): RankingPointRow => ({
        postId: r.post_id,
        keyword: r.keyword,
        rank: r.rank,
        checkedAt: r.checked_at,
      }),
    ),
  );

  // 4-1) 순위 상승 글 제목 조회 (상위 5건만 — 삭제된 글은 목록에서 제외)
  let improvedPosts: MonthlyImprovedPost[] = [];
  if (rankings.improved.length > 0) {
    const { data: titleRows } = await admin
      .from('saved_posts')
      .select('id, title')
      .in('id', rankings.improved.map((p) => p.postId));
    const titleById = new Map(
      ((titleRows ?? []) as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]),
    );
    improvedPosts = rankings.improved
      .filter((p) => titleById.has(p.postId))
      .map((p) => ({ ...p, title: titleById.get(p.postId) ?? '' }));
  }

  // 5) 지난달 AI 글 생성 횟수 (usage_logs 정본)
  const { count: generatedCount, error: usageErr } = await admin
    .from('usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('feature', 'generate-content')
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (usageErr) throw new Error(`사용량 집계 실패: ${usageErr.message}`);

  // 6) 플랜 정보 (-1 무제한 / 0 플랜 없음)
  const monthlyLimit = isPaidPlanId(profile.plan) ? PLANS[profile.plan].limits.blog : 0;
  const planName = isPaidPlanId(profile.plan) ? PLANS[profile.plan].name : null;

  return buildReportData({
    period,
    generatedAt: new Date().toISOString(),
    postsCreated: createdCount ?? 0,
    postsPublished: publishedCount ?? 0,
    complianceChecked: complianceCount ?? 0,
    rankings,
    improvedPosts,
    generated: generatedCount ?? 0,
    monthlyLimit,
    planName,
    blogConfigured: extractNaverBlogId(profile.naver_blog_url) !== null,
  });
}

/** 사용자 1명 처리 — upsert(멱등) + 신규 생성 시에만 알림·이메일 */
async function processUser(
  admin: ReturnType<typeof createAdminClient>,
  profile: ProfileRow,
  period: string,
  startIso: string,
  endIso: string,
): Promise<UserResult> {
  const data = await aggregateUserReport(admin, profile, period, startIso, endIso);

  // 기존 리포트 존재 여부 — 재실행 시 데이터만 갱신하고 알림·이메일은 중복 발송하지 않는다.
  const { data: existing, error: existErr } = await admin
    .from('monthly_reports')
    .select('id')
    .eq('user_id', profile.id)
    .eq('period', period)
    .maybeSingle();
  if (existErr) throw new Error(`기존 리포트 조회 실패: ${existErr.message}`);

  const { error: upsertErr } = await admin
    .from('monthly_reports')
    .upsert(
      { user_id: profile.id, period, data },
      { onConflict: 'user_id,period' },
    );
  if (upsertErr) throw new Error(`리포트 저장 실패: ${upsertErr.message}`);

  if (existing) {
    return { status: 'updated', notified: false, emailed: false };
  }

  // 인앱 알림 1건 (실패해도 리포트 자체는 저장됨 — 사용자 단위 실패로 승격하지 않음)
  let notified = false;
  const { title, message } = monthlyReportNotification(period, data);
  const { error: notifyErr } = await admin.from('notifications').insert({
    user_id: profile.id,
    type: 'monthly_report',
    title,
    message,
    is_read: false,
  });
  if (!notifyErr) notified = true;

  // 요약 이메일 (Resend — 미설정·실패 시 조용히 건너뜀, graceful)
  let emailed = false;
  if (profile.email) {
    const { subject, html } = monthlyReportEmail({
      periodText: periodLabel(period),
      period,
      hospitalName: profile.hospital_name,
      generated: data.usage.generated,
      published: data.posts.published,
      complianceChecked: data.compliance.checked,
      top10Count: data.rankings.top10Count,
    });
    const result = await sendEmail({ to: profile.email, subject, html, feature: 'monthly-report' });
    emailed = result.success;
  }

  return { status: 'created', notified, emailed };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 대상 월 — 기본 지난달(KST). ?period=YYYY-MM 으로 백필 가능.
  const periodParam = req.nextUrl.searchParams.get('period');
  const period = periodParam ?? previousPeriodKST(new Date());
  if (!isValidPeriod(period)) {
    return NextResponse.json(
      { ok: false, error: 'period 형식이 잘못되었습니다 (YYYY-MM).' },
      { status: 400 },
    );
  }
  const range = periodRangeKST(period);
  if (!range) {
    return NextResponse.json({ ok: false, error: 'period 범위 계산 실패' }, { status: 400 });
  }

  const admin = createAdminClient();
  let candidates = 0;
  let processed = 0;
  let created = 0;
  let updated = 0;
  let notifiedCount = 0;
  let emailedCount = 0;
  const failures: Array<{ userId: string; reason: string }> = [];

  try {
    const userIds = await collectActiveUserIds(admin, range.startIso, range.endIso);
    candidates = userIds.length;
    const profiles = await fetchProfiles(admin, userIds);

    // 개별 사용자 실패는 기록만 하고 계속 진행 (전체 실패 금지)
    for (const profile of profiles) {
      try {
        const result = await processUser(admin, profile, period, range.startIso, range.endIso);
        processed++;
        if (result.status === 'created') created++;
        else updated++;
        if (result.notified) notifiedCount++;
        if (result.emailed) emailedCount++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown';
        failures.push({ userId: profile.id, reason });
      }
    }

    return NextResponse.json({
      ok: true,
      period,
      candidates,
      processed,
      created,
      updated,
      notified: notifiedCount,
      emailed: emailedCount,
      failures,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        period,
        candidates,
        processed,
        created,
        updated,
        notified: notifiedCount,
        emailed: emailedCount,
        failures,
      },
      { status: 500 },
    );
  }
}

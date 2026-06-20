import { NextResponse } from 'next/server';
import { createAdminClient, createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { isAdmin } from '@/hr/lib/admin';
import { PLANS, isPaidPlanId } from '@/payment/lib/plans';
import type { MonthlyUsagePoint, UsageSummary } from '@/hr/lib/mypage-types';

interface UsageLogRow {
  feature: string;
  image_count: number | null;
  created_at: string;
}

const TREND_MONTHS = 6;
const IMAGE_FEATURES = new Set(['generate-images', 'regenerate-image']);

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 최근 N개월의 'YYYY-MM' 키 목록 (과거 → 현재) */
function buildMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return keys;
}

/**
 * 마이페이지 — 사용량 탭 (고객 친화 버전, 본인 데이터만).
 * 이번 달 글 생성 횟수는 profiles.usage_count(+usage_reset_at 월간 리셋)를 그대로 사용
 * (consume_usage RPC가 관리하는 정본 카운터). 추이·이미지 수는 usage_logs에서 집계.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('plan, usage_count, usage_reset_at')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: '프로필 정보를 불러올 수 없습니다.' }, { status: 403 });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 월간 리셋 반영: usage_reset_at이 이번 달 이전이면 이번 달 사용량은 0
    const resetAt = profile.usage_reset_at ? new Date(profile.usage_reset_at) : null;
    const usageCount =
      resetAt && resetAt >= monthStart ? (profile.usage_count ?? 0) : 0;

    let monthlyLimit = 0;
    if (isAdmin(user.email)) {
      monthlyLimit = -1;
    } else if (isPaidPlanId(profile.plan)) {
      monthlyLimit = PLANS[profile.plan].limits.blog;
    }

    const planName = isPaidPlanId(profile.plan) ? PLANS[profile.plan].name : null;

    // 최근 6개월 추이 (usage_logs — 본인 user_id 필터)
    const trendStart = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1), 1);
    const { data: logs, error: logsError } = await admin
      .from('usage_logs')
      .select('feature, image_count, created_at')
      .eq('user_id', user.id)
      .gte('created_at', trendStart.toISOString())
      .limit(5000);

    if (logsError) {
      return NextResponse.json({ error: '사용량 조회에 실패했습니다.' }, { status: 500 });
    }

    const monthKeys = buildMonthKeys(now, TREND_MONTHS);
    const baseMap: Record<string, { posts: number; images: number }> = Object.fromEntries(
      monthKeys.map((k) => [k, { posts: 0, images: 0 }]),
    );

    const aggregated = ((logs ?? []) as UsageLogRow[]).reduce((acc, row) => {
      const key = monthKey(new Date(row.created_at));
      const bucket = acc[key];
      if (!bucket) return acc;
      const isPost = row.feature === 'generate-content';
      const isImage = IMAGE_FEATURES.has(row.feature);
      return {
        ...acc,
        [key]: {
          posts: bucket.posts + (isPost ? 1 : 0),
          images: bucket.images + (isImage ? (row.image_count ?? 0) : 0),
        },
      };
    }, baseMap);

    const monthly: MonthlyUsagePoint[] = monthKeys.map((k) => ({
      month: k,
      posts: aggregated[k].posts,
      images: aggregated[k].images,
    }));

    const currentKey = monthKey(now);
    const imageCount = aggregated[currentKey]?.images ?? 0;

    const summary: UsageSummary = {
      planName,
      usageCount,
      monthlyLimit,
      imageCount,
      monthly,
    };

    return NextResponse.json({ usage: summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

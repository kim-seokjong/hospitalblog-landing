import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    // 인증 확인
    const userSupabase = await createServerSupabaseClient();
    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range') ?? 'today'; // today | yesterday | week

    const supabase = createAdminClient();

    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);

    function kstDateStr(d: Date): string {
      return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    let fromDate: string;
    let toDate: string;

    if (range === 'yesterday') {
      const yest = new Date(kstNow);
      yest.setDate(yest.getDate() - 1);
      fromDate = kstDateStr(yest);
      toDate = kstDateStr(yest);
    } else if (range === 'week') {
      const weekAgo = new Date(kstNow);
      weekAgo.setDate(weekAgo.getDate() - 6);
      fromDate = kstDateStr(weekAgo);
      toDate = kstDateStr(kstNow);
    } else {
      fromDate = kstDateStr(kstNow);
      toDate = kstDateStr(kstNow);
    }

    const { data, error } = await supabase
      .from('usage_logs')
      .select('feature, api_provider, input_tokens, output_tokens, image_count, cost_usd, created_at')
      .gte('created_at', `${fromDate}T00:00:00+09:00`)
      .lte('created_at', `${toDate}T23:59:59+09:00`)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // 기능별 집계
    const featureMap: Record<string, { count: number; input_tokens: number; output_tokens: number; image_count: number; cost_usd: number }> = {};
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalImages = 0;

    for (const row of rows) {
      const key = row.feature as string;
      if (!featureMap[key]) {
        featureMap[key] = { count: 0, input_tokens: 0, output_tokens: 0, image_count: 0, cost_usd: 0 };
      }
      featureMap[key].count += 1;
      featureMap[key].input_tokens += row.input_tokens ?? 0;
      featureMap[key].output_tokens += row.output_tokens ?? 0;
      featureMap[key].image_count += row.image_count ?? 0;
      featureMap[key].cost_usd += row.cost_usd ?? 0;
      totalCost += row.cost_usd ?? 0;
      totalInputTokens += row.input_tokens ?? 0;
      totalOutputTokens += row.output_tokens ?? 0;
      totalImages += row.image_count ?? 0;
    }

    // 일별 비용 집계 (week 범위용)
    const dailyMap: Record<string, number> = {};
    for (const row of rows) {
      const day = (row.created_at as string).slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + (row.cost_usd ?? 0);
    }
    const daily = Object.entries(dailyMap)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const features = Object.entries(featureMap).map(([feature, stats]) => ({
      feature,
      ...stats,
    }));

    return NextResponse.json({
      range,
      fromDate,
      toDate,
      summary: {
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalImages,
        totalCalls: rows.length,
      },
      features,
      daily,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

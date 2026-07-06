// 마이페이지 — 월간 성과 리포트 조회 (본인 것만, RLS select 정책 사용).
// GET                → 월 목록 (최신순, 요약 포함)
// GET ?period=YYYY-MM → 해당 월 리포트 전문 (인쇄 페이지용)

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { isValidPeriod, type MonthlyReportData } from '@/content/lib/monthly-report';

export const dynamic = 'force-dynamic';

const MAX_MONTHS = 24;

export interface MonthlyReportListItem {
  period: string;
  createdAt: string;
  summary: {
    generated: number;
    published: number;
    complianceChecked: number;
    top10Count: number;
  };
}

interface ReportRow {
  period: string;
  data: MonthlyReportData;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const period = req.nextUrl.searchParams.get('period');

    // 단건 조회 — 리포트 전문 (RLS로 본인 것만)
    if (period !== null) {
      if (!isValidPeriod(period)) {
        return NextResponse.json({ error: '잘못된 기간 형식입니다 (YYYY-MM).' }, { status: 400 });
      }
      const { data, error } = await supabase
        .from('monthly_reports')
        .select('period, data, created_at')
        .eq('period', period)
        .maybeSingle();
      if (error) {
        // 마이그 035(monthly_reports) 미적용 DB 폴백 — 테이블 없음(42P01)이면
        // 500 대신 "리포트 없음"으로 응답해 마이페이지 UX를 막지 않는다.
        if (error.code === '42P01') {
          return NextResponse.json({ error: '해당 월의 리포트가 없습니다.' }, { status: 404 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: '해당 월의 리포트가 없습니다.' }, { status: 404 });
      }
      const row = data as ReportRow;
      return NextResponse.json({
        report: { period: row.period, createdAt: row.created_at, data: row.data },
      });
    }

    // 목록 조회 — 최신순
    const { data, error } = await supabase
      .from('monthly_reports')
      .select('period, data, created_at')
      .order('period', { ascending: false })
      .limit(MAX_MONTHS);
    if (error) {
      // 마이그 035 미적용 DB 폴백 — 테이블 없음(42P01)이면 빈 목록 반환.
      if (error.code === '42P01') {
        return NextResponse.json({ items: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items: MonthlyReportListItem[] = ((data ?? []) as ReportRow[]).map((row) => ({
      period: row.period,
      createdAt: row.created_at,
      summary: {
        generated: row.data?.usage?.generated ?? 0,
        published: row.data?.posts?.published ?? 0,
        complianceChecked: row.data?.compliance?.checked ?? 0,
        top10Count: row.data?.rankings?.top10Count ?? 0,
      },
    }));

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

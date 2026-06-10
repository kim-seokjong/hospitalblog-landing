import { NextRequest, NextResponse } from 'next/server';
import { requirePaidPlan } from '@/payment/lib/usage-guard';

export async function POST(req: NextRequest) {
  const gate = await requirePaidPlan();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
  }

  try {
    const { keywords } = await req.json() as { keywords?: unknown };
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: '키워드를 입력해주세요.' }, { status: 400 });
    }

    const validKeywords = keywords.filter(
      (kw): kw is string => typeof kw === 'string' && kw.trim().length > 0
    );
    if (validKeywords.length === 0) {
      return NextResponse.json({ error: '유효한 키워드가 없습니다.' }, { status: 400 });
    }

    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: '네이버 API 키가 설정되지 않았습니다.' }, { status: 500 });
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 12);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const body = {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'month',
      keywordGroups: validKeywords.map((kw) => ({
        groupName: kw,
        keywords: [kw],
      })),
    };

    const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`네이버 DataLab 오류: ${err}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('트렌드 조회 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `트렌드 조회 실패: ${message}` }, { status: 500 });
  }
}

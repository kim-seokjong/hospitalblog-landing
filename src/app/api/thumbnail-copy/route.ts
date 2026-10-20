import { NextRequest, NextResponse } from 'next/server';
import { requirePaidPlan } from '@/payment/lib/usage-guard';
import { logUsage } from '@/dev/lib/usage-logger';
import { suggestThumbnailCopy } from '@/content/lib/thumbnail/copy-suggest';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/thumbnail-copy
 * body: { title, keyword?, hospitalType? }
 * 글 제목을 썸네일 카피 5패턴(최대 5안)으로 변환한다.
 * 응답: { suggestions: [{ pattern, patternLabel, klabel, line1, line2?, accentWord }] }
 */
export async function POST(req: NextRequest) {
  // 2026-10-20 W43 Codex 지적: 로그인만 보고 Claude 를 불러 무료·만료 계정이 무제한으로 썼다.
  // 다른 부속 기능과 같은 가드 + 사용 로그(FREE_TRIAL_ACCESSORY_FEATURES 가 센다)
  try {
    const gate = await requirePaidPlan();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.message, reason: gate.reason }, { status: gate.status });
    }

    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: '글 제목(title)이 필요합니다.' }, { status: 400 });
    }
    if ([...title].length > 120) {
      return NextResponse.json({ error: '제목이 너무 깁니다(최대 120자).' }, { status: 400 });
    }

    const keyword = typeof raw?.keyword === 'string' ? raw.keyword.trim().slice(0, 40) : undefined;
    const hospitalType =
      typeof raw?.hospitalType === 'string' ? raw.hospitalType.trim().slice(0, 20) : undefined;

    const suggestions = await suggestThumbnailCopy({ title, keyword, hospitalType }, (usage) =>
      logUsage({
        feature: 'thumbnail-copy',
        api_provider: 'anthropic',
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        user_id: gate.userId,
        user_agent: req.headers.get('user-agent') ?? null,
      }),
    );

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : '카피 생성에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

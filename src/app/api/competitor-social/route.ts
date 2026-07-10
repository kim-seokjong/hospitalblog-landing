import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';
import {
  fetchSocialMetric,
  MAX_SOCIAL_HANDLES,
  sanitizeHandle,
  type SocialHandleInput,
  type SocialMetric,
  type SocialPlatform,
} from '@/content/lib/scoreboard/social';

export const dynamic = 'force-dynamic';

/**
 * POST /api/competitor-social
 * body: { handles: [{ platform: 'instagram'|'threads', handle: string }] } (최대 5개)
 *
 * 경쟁 병원 인스타/쓰레드 공개 지표 (베스트에포트).
 * - 공개 프로필 메타에서 팔로워·게시물 수만 파싱. 로그인·비공식 API 금지.
 * - 실패 항목은 status:'unavailable' 로 반환 (페이지 안 깨짐).
 * - 핸들별 결과 6h 캐싱. SSRF 방어: 허용 호스트 고정 + 핸들 정규식 검증.
 */

interface RequestBody {
  handles?: Array<{ platform?: string; handle?: string }>;
}

const PLATFORMS: readonly SocialPlatform[] = ['instagram', 'threads'];

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = (await req.json()) as RequestBody;
    if (!Array.isArray(body.handles) || body.handles.length === 0) {
      return NextResponse.json({ error: '핸들을 1개 이상 입력해주세요.' }, { status: 400 });
    }
    if (body.handles.length > MAX_SOCIAL_HANDLES) {
      return NextResponse.json(
        { error: `핸들은 최대 ${MAX_SOCIAL_HANDLES}개까지 입력할 수 있습니다.` },
        { status: 400 }
      );
    }

    const inputs: SocialHandleInput[] = [];
    for (const raw of body.handles) {
      const platform = PLATFORMS.find((p) => p === raw.platform);
      const handle = typeof raw.handle === 'string' ? sanitizeHandle(raw.handle) : null;
      if (!platform || !handle) {
        return NextResponse.json(
          { error: '잘못된 핸들 형식입니다. (영문·숫자·밑줄·마침표, 30자 이하)' },
          { status: 400 }
        );
      }
      inputs.push({ platform, handle });
    }

    const results: SocialMetric[] = await Promise.all(
      inputs.map(async (input) => {
        const cacheKey = `social:${input.platform}:${input.handle.toLowerCase()}`;
        const cached = cacheGet<SocialMetric>(cacheKey);
        if (cached) return cached;

        const metric = await fetchSocialMetric(input);
        // 실패(unavailable)는 짧게 캐싱해 재시도 여지를 남긴다 (30분)
        cacheSet(cacheKey, metric, metric.status === 'ok' ? undefined : 30 * 60 * 1000);
        return metric;
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[competitor-social] 오류:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '소셜 지표를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { lookupClinics } from '@/content/lib/clinic-diagnosis/registry';
import {
  consumeLookupQuota,
  extractClientIp,
  limitMessage,
  lookupCacheKey,
  LOOKUP_CACHE_TTL_MS,
} from '@/content/lib/clinic-diagnosis/limits';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';
import type { ClinicLookupOutcome } from '@/content/lib/clinic-diagnosis/types';

export const dynamic = 'force-dynamic';
/** 행안부 조회 최대 4콜 × 8초. */
export const maxDuration = 40;

/**
 * POST /api/clinic-diagnosis/lookup — 병원명(+지역)으로 후보를 찾는다 (비회원 공개).
 * body: { name: string, region?: string }
 *
 * 이 라우트는 **아직 진단을 돌리지 않는다.** 병원 특정만 한다.
 * 이름만으로는 병원을 특정할 수 없어서(실측: "미소치과의원" LIKE 기준 1,230곳),
 * 후보가 여러 개면 주소를 붙여 사용자가 고르게 하고 그 다음에 진단으로 넘어간다.
 *
 * 가드:
 * - 입력 길이 제한, 캐시 1일(행안부 데이터는 일간 갱신), IP당 일 30회
 * - 캐시 히트는 캡을 소비하지 않는다
 *
 * 반환하는 것은 전부 **행안부가 공표한 공개 정보**다(상호·주소·대표번호·진료과목·영업상태).
 */
export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json().catch(() => null)) as { name?: unknown; region?: unknown } | null;
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    const region = typeof raw?.region === 'string' ? raw.region.trim() : '';

    if (name.length < 2 || name.length > 60) {
      return NextResponse.json({ error: '병원 이름을 2자 이상 60자 이하로 입력해 주세요.' }, { status: 400 });
    }
    if (region.length > 30) {
      return NextResponse.json({ error: '지역은 30자 이하로 입력해 주세요.' }, { status: 400 });
    }

    // 1) 캐시 히트 — 캡을 소비하지 않는다
    const key = lookupCacheKey(name, region);
    const cached = cacheGet<ClinicLookupOutcome>(key);
    if (cached) {
      return NextResponse.json({ outcome: cached, cached: true });
    }

    // 2) 실행 캡
    const decision = consumeLookupQuota(extractClientIp(req.headers));
    if (!decision.allowed) {
      return NextResponse.json({ error: limitMessage(decision.reason) }, { status: 429 });
    }

    const outcome = await lookupClinics(name, { region });

    if (outcome.kind === 'unavailable') {
      // ⚠️ 셋을 구분해서 알린다. "설정 문제"를 "그런 병원 없음"처럼 보이게 하면
      //    운영 중 키가 만료돼도 아무도 눈치채지 못한다(실제로 그랬다).
      const message =
        outcome.reason === 'not_configured'
          ? '병원 조회 서비스가 아직 연결되지 않았어요. 블로그 주소로 진단하는 방법을 이용해 주세요.'
          : outcome.reason === 'key_rejected'
            ? '병원 조회 서비스 연결에 문제가 생겼어요(담당자 확인 중). 병원이 없는 것이 아니니, 아래에서 블로그·홈페이지 주소로 진단해 주세요.'
            : '병원 정보를 조회하지 못했어요. 잠시 후 다시 시도해 주세요.';
      if (outcome.reason === 'key_rejected') {
        console.error('[clinic-diagnosis/lookup] 행안부 조회 키 거부 — 운영 확인 필요');
      }
      // 실패는 캐시하지 않는다 — 일시 장애를 하루 동안 굳히지 않기 위해.
      return NextResponse.json({ error: message, outcome }, { status: 503 });
    }

    cacheSet(key, outcome, LOOKUP_CACHE_TTL_MS);
    return NextResponse.json({ outcome, cached: false });
  } catch (err) {
    console.error('[clinic-diagnosis/lookup]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '병원을 찾는 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { searchNaverLocal } from '@/dev/lib/naver-search';
import { logUsage } from '@/dev/lib/usage-logger';
import {
  generateFreeSample,
  normalizeClinicKey,
  isFullSample,
} from '@/content/lib/free-sample';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * IP당 신규 생성(캐시 미스) 시간당 허용 횟수 — 남용 방어.
 * 전체 글은 티저보다 비싸므로 하향(과거 10 → 5).
 */
const MAX_NEW_GENERATIONS_PER_HOUR = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** 요청 IP 추출 (Vercel/프록시 환경: x-forwarded-for 우선). */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * POST /api/clinic/free-sample  (공개·비인증)
 *
 * 영업 콜드메일 CTA(/sample?clinic=병원명) 진입 시, 가입 없이 보여줄
 * "맞춤 블로그 전체 글 샘플"을 생성/반환한다.
 *
 * 비용·악용 방어:
 *  1) 캐시: 정규화 병원명당 1회만 Claude 생성, 이후 같은 병원은 DB 캐시 재사용.
 *     단, 과거 티저 모양 캐시(version 2 아님)는 전체 글로 재생성한다.
 *  2) 레이트리밋: 동일 IP가 1시간 내 신규 생성을 N회 초과하지 못하게 차단(429).
 * 공개 디렉터리 정보(병원명·유형·지역)만 사용하며 개인정보는 다루지 않는다.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { clinic?: unknown };
    const clinic = typeof body.clinic === 'string' ? body.clinic.trim() : '';

    if (!clinic) {
      return NextResponse.json({ error: '병원명을 입력해주세요.' }, { status: 400 });
    }
    if (clinic.length > 60) {
      return NextResponse.json({ error: '병원명이 너무 깁니다.' }, { status: 400 });
    }

    const clinicKey = normalizeClinicKey(clinic);
    if (!clinicKey) {
      return NextResponse.json({ error: '유효한 병원명을 입력해주세요.' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1) 캐시 조회 — 전체 글(version 2) 캐시만 즉시 반환.
    //    과거 티저 모양 캐시는 isFullSample=false → 무시하고 아래에서 전체 글로 재생성.
    const { data: cached } = await supabase
      .from('clinic_free_samples')
      .select('sample')
      .eq('clinic_key', clinicKey)
      .maybeSingle();

    if (cached?.sample && isFullSample(cached.sample)) {
      return NextResponse.json({ sample: cached.sample, cached: true });
    }

    // 2) 레이트리밋 — 동일 IP의 최근 1시간 신규 생성 횟수 집계
    const ip = getClientIp(req);
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await supabase
      .from('clinic_free_sample_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since);

    if ((count ?? 0) >= MAX_NEW_GENERATIONS_PER_HOUR) {
      return NextResponse.json(
        { error: '요청이 많아 잠시 후 다시 시도해주세요.' },
        { status: 429 },
      );
    }

    // 3) 공개 디렉터리 보강(유형·지역) — 실패해도 진행(graceful)
    let specialty = '';
    let region = '';
    try {
      const results = await searchNaverLocal(clinic, 5);
      const hit =
        results.find((r) => normalizeClinicKey(r.name) === clinicKey) ?? results[0];
      if (hit) {
        specialty = hit.specialty;
        region = hit.region;
      }
    } catch {
      // 디렉터리 조회 실패는 무시 — 병원명만으로 생성
    }

    // 4) 전체 글 생성(의료광고법 2차 필터 포함)
    const { sample, usage } = await generateFreeSample({ clinicName: clinic, specialty, region });

    // 5) 캐시 저장 + 생성 이벤트 기록(레이트리밋용). 저장 실패는 응답을 막지 않음.
    await supabase
      .from('clinic_free_samples')
      .upsert(
        { clinic_key: clinicKey, clinic_name: clinic, sample },
        { onConflict: 'clinic_key' },
      );
    await supabase
      .from('clinic_free_sample_events')
      .insert({ ip, clinic_key: clinicKey });

    logUsage({
      feature: 'free-sample',
      api_provider: 'anthropic',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      user_id: null,
      user_agent: req.headers.get('user-agent') ?? null,
    });

    return NextResponse.json({ sample, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `샘플 생성 실패: ${message}` }, { status: 500 });
  }
}

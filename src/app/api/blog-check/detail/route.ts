import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { parseBlogCheckInput } from '@/content/lib/blog-check-input';
import {
  consumeUserQuota,
  kstDayRangeUtc,
  readUserDailyLimit,
} from '@/content/lib/blog-check-limits';
import {
  runBlogCheck,
  buildQualityDiagnosis,
  blogCheckCacheKey,
  BLOG_CHECK_CACHE_TTL_MS,
  type BlogCheckReport,
} from '@/content/lib/blog-check';
import {
  AI_BLOCKED_CRAWLERS,
  NAVER_BLOG_ROBOTS_EXCERPT,
} from '@/content/lib/blog-check-score';
import { fetchGoldenKeywords, type GoldenKeywordResult } from '@/content/lib/golden-keywords';
import { fetchNaverBlogPosts } from '@/content/lib/naver-blog-fetch';
import { analyzeBlogSamples, parseVoiceDnaCard, type VoiceDnaCard } from '@/content/lib/voice-dna';
import { cacheGet, cacheSet } from '@/content/lib/scoreboard/cache';

export const dynamic = 'force-dynamic';
// 파이프라인(캐시 미스 시) + 황금 키워드 + 품질 LLM + VOICE-DNA 학습 여유치.
export const maxDuration = 120;

/**
 * POST /api/blog-check/detail — 무료진단 상세분석 (로그인 회원 전용).
 * body: { blog: string }
 *
 * 간단분석 리포트(7일 캐시 공유) 위에 상세 섹션을 얹는다:
 * - 키워드별 실측 전체 테이블 + 황금 키워드 제안 (golden-keywords 연결)
 * - GEO 상세: AI 크롤러 차단 근거(robots 발췌)·자체도메인 해법 안내
 * - 컴플라이언스 상세: 검출 문구 인용+근거 (검출·표시만, 자동치환 금지)
 * - 글 품질 진단: 제목 반복도 통계 + LLM 코멘트(폴백 룰)
 * - VOICE-DNA: 수집 본문으로 초기 문체 프로필 생성/갱신 (learned 카드는 보존)
 * - 이력 저장: blog_check_reports (테이블 미적용 시 저장만 스킵)
 *
 * 가드: 회원당 일일 상한(기본 5회, env BLOG_CHECK_USER_DAILY_LIMIT) —
 * blog_check_reports 의 오늘(KST) 카운트로 판정, 테이블 미적용 시 인메모리 폴백.
 *
 * 리드-회원 연결은 blog_check_reports(user_id+blog_id) 저장으로 충분하다.
 * blog_check_leads.user_id backfill 은 하지 않는다 — 임의 회원이 남의 병원
 * blogId 를 넣어 그 병원의 익명 리드를 자기 것으로 귀속시킬 수 있기 때문
 * (영업 측 조인은 blog_id 기준으로 가능. 리드는 익명 그대로 둔다).
 */

interface GeoDetail {
  score: number;
  reason: string;
  blockedCrawlers: readonly string[];
  robotsExcerpt: string;
  explanation: string;
  solution: string;
}

function buildGeoDetail(report: BlogCheckReport): GeoDetail {
  return {
    score: report.geo.score,
    reason: report.geo.reason,
    blockedCrawlers: AI_BLOCKED_CRAWLERS,
    robotsExcerpt: NAVER_BLOG_ROBOTS_EXCERPT,
    explanation:
      'blog.naver.com robots.txt는 위 AI 크롤러의 수집을 전면 차단합니다(2026-07 조사 시점). ' +
      'ChatGPT·Perplexity 등 AI 검색이 답변을 만들 때 네이버 블로그 글은 수집·인용 대상에서 제외되므로, ' +
      '네이버 블로그 단독 운영으로는 AI 검색 환자 유입 경로가 열리지 않습니다.',
    solution:
      'AI 크롤러를 허용하는 자체도메인 블로그를 병행 발행하면 같은 글로 AI 검색 인용 기회를 만들 수 있어요. ' +
      '닥터포스트는 네이버용 글과 자체도메인(GEO 최적화) 발행을 함께 지원합니다.',
  };
}

/** 테이블 미적용(마이그 045 전) 판정 — 42P01(undefined_table). */
function isMissingTable(error: { code?: string; message?: string } | null, table: string): boolean {
  if (!error) return false;
  return error.code === '42P01' || (error.message?.includes(table) ?? false);
}

interface VoiceDnaOutcome {
  updated: boolean;
  sampleCount: number;
  /** UI 안내 문구 — "기존 블로그 말투를 학습해 첫 글부터 반영". */
  message: string;
}

/**
 * VOICE-DNA 초기 프로필 생성/갱신. 편집 학습(learned) 카드는 덮지 않는다.
 * 모든 실패는 updated:false 로 강등 (상세분석 자체를 막지 않음).
 */
async function updateVoiceDna(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  blogId: string,
): Promise<VoiceDnaOutcome> {
  const skip = (message: string): VoiceDnaOutcome => ({ updated: false, sampleCount: 0, message });
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('voice_dna')
      .eq('id', userId)
      .single();
    const existing = parseVoiceDnaCard((profile as { voice_dna?: unknown } | null)?.voice_dna);
    if (existing && existing.source === 'learned') {
      return skip('이미 편집 학습으로 다듬어진 문체 프로필이 있어 그대로 유지했어요.');
    }

    const samples = await fetchNaverBlogPosts(blogId, 8);
    if (samples.length === 0) {
      return skip('블로그 본문을 수집하지 못해 문체 학습은 건너뛰었어요.');
    }

    const partial = await analyzeBlogSamples(samples);
    if (!partial) {
      return skip('문체 분석에 실패해 기존 설정을 유지했어요.');
    }

    const card: VoiceDnaCard = {
      tone: partial.tone ?? '따뜻하고 신뢰감 있는',
      patientTerm: partial.patientTerm ?? '환자분',
      narrator: partial.narrator ?? '원장',
      sentenceStyle: partial.sentenceStyle ?? '짧고 명확',
      signatures: partial.signatures ?? [],
      description: partial.description ?? '',
      source: 'pasted',
      sampleCount: samples.length,
    };
    const { error } = await supabase
      .from('profiles')
      .update({ voice_dna: card, voice_dna_updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) {
      return skip('문체 프로필 저장에 실패해 기존 설정을 유지했어요.');
    }
    return {
      updated: true,
      sampleCount: samples.length,
      message: `기존 블로그 글 ${samples.length}편의 말투를 학습했어요. 닥터포스트 첫 글부터 우리 병원 말투로 반영됩니다.`,
    };
  } catch (e) {
    console.error('[blog-check/detail] VOICE-DNA 실패(무시):', e instanceof Error ? e.message : e);
    return skip('문체 학습 중 오류가 있어 건너뛰었어요.');
  }
}

/** 회원당 일일 상한 인메모리 폴백 카운터 (테이블 미적용 환경 전용, dev HMR 생존). */
const USER_QUOTA_KEY = '__dp_blog_check_user_quota__';
function getUserQuotaStore(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[USER_QUOTA_KEY] instanceof Map)) {
    g[USER_QUOTA_KEY] = new Map<string, number>();
  }
  return g[USER_QUOTA_KEY] as Map<string, number>;
}

/**
 * 회원당 일일 상세분석 상한 판정.
 * 1순위: blog_check_reports 의 오늘(KST) 저장 건수 (인스턴스 무관, 정확).
 * 폴백: 테이블 미적용(42P01 등) 환경에서만 인메모리 카운터 소비.
 */
async function checkUserDailyLimit(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<{ over: boolean; limit: number }> {
  const limit = readUserDailyLimit();
  const range = kstDayRangeUtc();
  const { count, error } = await supabase
    .from('blog_check_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('run_at', range.startIso)
    .lt('run_at', range.endIso);

  if (!error) {
    return { over: (count ?? 0) >= limit, limit };
  }
  // 테이블 미적용 등 조회 실패 → 인메모리 폴백 (검사+소비)
  const decision = consumeUserQuota(getUserQuotaStore(), { userId, limit });
  return { over: !decision.allowed, limit };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const raw = (await req.json().catch(() => null)) as { blog?: unknown } | null;
    const blogId = parseBlogCheckInput(raw?.blog);
    if (!blogId) {
      return NextResponse.json(
        { error: '네이버 블로그 주소 또는 아이디를 확인해 주세요. 예: blog.naver.com/myclinic' },
        { status: 400 },
      );
    }

    // 0) 회원당 일일 상한 (기본 5회) — 비용 있는 파이프라인 전에 차단
    const quota = await checkUserDailyLimit(supabase, user.id);
    if (quota.over) {
      return NextResponse.json(
        { error: `상세분석은 하루 ${quota.limit}회까지 이용할 수 있어요. 내일 다시 시도해 주세요.` },
        { status: 429 },
      );
    }

    // 1) 리포트 — 간단분석과 7일 캐시 공유 (미스 시 재실행)
    let report = cacheGet<BlogCheckReport>(blogCheckCacheKey(blogId));
    if (!report) {
      const run = await runBlogCheck(blogId);
      if (!run.ok) {
        const message =
          run.reason === 'empty'
            ? '블로그에 발행된 글이 없어요. 글을 발행한 뒤 다시 진단해 주세요.'
            : '블로그를 찾을 수 없거나 RSS가 비공개예요. 주소를 확인해 주세요.';
        return NextResponse.json({ error: message }, { status: 422 });
      }
      report = run.report;
      cacheSet(blogCheckCacheKey(blogId), report, BLOG_CHECK_CACHE_TTL_MS);
    }

    // 2) 상세 섹션 — 진료과(specialty)는 프로필에서 (황금 키워드 필터용)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('hospital_type')
      .eq('id', user.id)
      .single();
    const specialty =
      typeof (profileRow as { hospital_type?: unknown } | null)?.hospital_type === 'string'
        ? ((profileRow as { hospital_type: string }).hospital_type)
        : '';

    let golden: GoldenKeywordResult = { available: false, docAvailable: false, items: [] };
    if (report.seedKeyword) {
      golden = await fetchGoldenKeywords(report.seedKeyword.base, {
        region: report.seedKeyword.region || undefined,
        specialty: specialty || undefined,
      });
    }

    const [quality, voiceDna] = await Promise.all([
      buildQualityDiagnosis(report.quality, report.titles),
      updateVoiceDna(supabase, user.id, blogId),
    ]);

    const detail = {
      report,
      golden,
      geoDetail: buildGeoDetail(report),
      compliancePosts: report.compliancePosts,
      quality: { stats: report.quality, comment: quality.comment, commentSource: quality.source },
      voiceDna,
    };

    // 3) 이력 저장 — blog_check_reports (마이그 045 미적용 시 저장만 스킵)
    let saved = true;
    const { error: insertError } = await supabase.from('blog_check_reports').insert({
      user_id: user.id,
      blog_id: blogId,
      run_at: report.runAt,
      results: detail,
    });
    if (insertError) {
      saved = false;
      if (!isMissingTable(insertError, 'blog_check_reports')) {
        console.error('[blog-check/detail] 이력 저장 실패(무시):', insertError.message);
      }
    }

    // 리드-회원 연결은 위 blog_check_reports 저장(user_id+blog_id)으로 갈음한다
    // (blog_check_leads.user_id backfill 금지 — 파일 상단 주석 참조).

    return NextResponse.json({ detail, saved });
  } catch (err) {
    console.error('[blog-check/detail]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: '상세분석 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    );
  }
}

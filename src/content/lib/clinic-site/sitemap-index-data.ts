/**
 * 사이트맵 인덱스 데이터 조회 (서버 전용).
 *
 * 1순위: 마이그 049 뷰(clinic_site_sitemap_index) — 병원별 발행글 수·최신 발행시각을
 *        DB 에서 집계한다. 병원이 수천으로 늘어도 쿼리 1회 + range 페이지네이션이면 된다.
 * 2순위(폴백): 뷰가 없는 환경(마이그 미적용)에서는 profiles 1페이지 + 해당 회원들의
 *        발행글을 앱에서 집계한다. 청크 안에서 range 로 끝까지 훑어 누락이 없게 한다.
 *
 * ★ 실패를 절대 "빈 목록"으로 위장하지 않는다.
 *   빈 사이트맵을 200 으로 응답하면 검색엔진이 "이 사이트에는 이제 아무것도 없다"로
 *   받아들여 색인이 통째로 빠질 수 있다. 조회에 실패하면 { ok:false } 를 돌려
 *   라우트가 5xx 를 내고, 검색엔진이 직전 성공본을 유지하게 한다.
 *
 * (@/ 별칭을 쓰는 서버 모듈이라 node 테스트 러너 대상이 아니다.
 *  순수 판정·XML 조립 로직은 sitemap-index.ts 에 있다.)
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import type { ClinicSitemapSource } from './sitemap-index';

/** 마이그 049 로 만들어지는 집계 뷰 이름. */
const SITEMAP_VIEW = 'clinic_site_sitemap_index';

/**
 * 폴백 경로의 user_id IN 절 청크 크기.
 * PostgREST select 는 GET 쿼리스트링이라 UUID 를 너무 많이 넣으면 URL 길이 한도에
 * 걸린다. 청크를 작게 잡고, 청크 안에서 다시 range 페이지네이션으로 전부 훑는다.
 */
const FALLBACK_IN_CHUNK = 50;

/** 폴백 경로에서 한 번에 가져올 행 수 (Supabase 기본 max-rows 1,000 과 동일). */
const FALLBACK_POST_PAGE = 1_000;

/**
 * 청크당 최대 페이지 수. 50명 × 최대 20,000행 = 회원당 평균 400편까지 커버한다.
 * 이 한도에 실제로 닿으면 데이터가 잘려 병원이 누락되므로 실패로 처리한다
 * (조용히 빠뜨리는 것보다 5xx 로 알리는 편이 안전하다).
 */
const FALLBACK_MAX_PAGES_PER_CHUNK = 20;

/** robots.txt 가 기다리는 count 조회의 상한 (초과 시 1페이지로 폴백). */
const COUNT_TIMEOUT_MS = 1_500;

/**
 * 폴백 전체 시간 예산. 뷰(마이그 049)가 없을 때만 타는 경로이고, 회원이 많으면
 * 청크를 수백 번 순차 요청하게 되어 응답 시간 제한을 넘긴다. 예산을 넘기면
 * 일부만 담긴 사이트맵을 200 으로 주는 대신 503 으로 명확히 실패한다.
 */
const FALLBACK_BUDGET_MS = 10_000;

/**
 * ⚠️ 부하 참고: 인덱스 1페이지는 최대 50,000개 항목을 담을 수 있고, 그 XML 은
 *    대략 6~8MB 수준이 된다(항목당 ~130바이트). 현재 규모에서는 문제가 없지만
 *    수만 병원에 도달하기 전에 실제 부하 시험이 필요하다 — 필요해지면 스트리밍
 *    응답이나 페이지 크기 축소(+robots.txt 페이지 노출)로 전환할 것.
 */

export type SitemapSourcesResult =
  | { ok: true; sources: ClinicSitemapSource[] }
  | { ok: false; reason: string };

interface ViewRow {
  site_slug: string | null;
  post_count: number | null;
  last_published_at: string | null;
}

interface ProfileRow {
  id: string;
  site_slug: string | null;
}

interface PostRow {
  user_id: string;
  site_published_at: string | null;
  published_at: string | null;
  created_at: string | null;
}

/** 뷰/컬럼/관계가 없는 환경인지 판정 (마이그 미적용 → 폴백). */
function isMissingSchemaError(code: string | undefined): boolean {
  // 42P01 undefined_table, 42703 undefined_column,
  // PGRST20x = PostgREST 스키마 캐시에서 대상을 못 찾음
  return code === '42P01' || code === '42703' || (typeof code === 'string' && code.startsWith('PGRST2'));
}

/**
 * 1순위 — 집계 뷰.
 *  null      = 뷰 없음(마이그 미적용) → 폴백으로 진행
 *  ok:false  = 뷰는 있으나 조회 실패 → 실패로 전파(빈 목록 위장 금지)
 */
async function fetchFromView(from: number, to: number): Promise<SitemapSourcesResult | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(SITEMAP_VIEW)
    .select('site_slug, post_count, last_published_at')
    .gt('post_count', 0)
    .order('site_slug', { ascending: true })
    .range(from, to);

  if (error) {
    if (isMissingSchemaError(error.code)) return null;
    console.error('[clinic-sitemap-index] 뷰 조회 오류:', error.message);
    return { ok: false, reason: `view query failed: ${error.code ?? 'unknown'}` };
  }

  const rows = (data ?? []) as ViewRow[];
  return {
    ok: true,
    sources: rows
      .filter((row): row is ViewRow & { site_slug: string } => typeof row.site_slug === 'string')
      .map((row) => ({
        slug: row.site_slug,
        postCount: typeof row.post_count === 'number' ? row.post_count : 0,
        lastPublishedAt: row.last_published_at,
      })),
  };
}

/** 한 청크(user_id 목록)의 발행글을 range 로 끝까지 훑는다. 진짜로 잘렸을 때만 실패. */
async function fetchPostsForChunk(
  admin: ReturnType<typeof createAdminClient>,
  chunk: readonly string[],
): Promise<{ ok: true; rows: PostRow[] } | { ok: false; reason: string }> {
  const rows: PostRow[] = [];

  const pageQuery = (from: number, to: number) =>
    admin
      .from('saved_posts')
      .select('user_id, site_published_at, published_at, created_at')
      .eq('published_to_site', true)
      .in('user_id', [...chunk])
      // 결정적 순서 — 페이지 경계에서 행이 중복·누락되지 않게 한다.
      .order('user_id', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

  for (let page = 0; page < FALLBACK_MAX_PAGES_PER_CHUNK; page++) {
    const from = page * FALLBACK_POST_PAGE;
    const { data, error } = await pageQuery(from, from + FALLBACK_POST_PAGE - 1);

    if (error) {
      console.error('[clinic-sitemap-index] 발행글 조회 오류:', error.message);
      return { ok: false, reason: `post query failed: ${error.code ?? 'unknown'}` };
    }

    const pageRows = (data ?? []) as PostRow[];
    rows.push(...pageRows);
    // 요청한 크기보다 적게 왔으면 마지막 페이지다.
    if (pageRows.length < FALLBACK_POST_PAGE) return { ok: true, rows };
  }

  // 마지막 페이지까지 정확히 가득 찼다 — "딱 맞게 끝난 것"과 "잘린 것"을 구분해야 한다.
  // 다음 1행을 탐침해 존재하지 않으면 정상 데이터다(20,000편 정확히인 경우 오탐 방지).
  const probeFrom = FALLBACK_MAX_PAGES_PER_CHUNK * FALLBACK_POST_PAGE;
  const probe = await pageQuery(probeFrom, probeFrom);
  if (probe.error) {
    console.error('[clinic-sitemap-index] 탐침 조회 오류:', probe.error.message);
    return { ok: false, reason: `probe query failed: ${probe.error.code ?? 'unknown'}` };
  }
  if ((probe.data ?? []).length === 0) return { ok: true, rows };

  // 진짜로 더 남아 있다 = 데이터가 잘렸다 → 누락 대신 실패로 알린다.
  return { ok: false, reason: 'fallback scan truncated' };
}

/** 2순위 — 뷰 미적용 환경 폴백. profiles 1페이지 + 발행글 전수 집계. */
async function fetchFromTables(from: number, to: number): Promise<SitemapSourcesResult> {
  const admin = createAdminClient();

  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('id, site_slug')
    .not('site_slug', 'is', null)
    .not('hospital_name', 'is', null)
    .order('site_slug', { ascending: true })
    .range(from, to);

  if (profileError) {
    console.error('[clinic-sitemap-index] 프로필 조회 오류:', profileError.message);
    return { ok: false, reason: `profile query failed: ${profileError.code ?? 'unknown'}` };
  }

  const profiles = ((profileData ?? []) as ProfileRow[]).filter(
    (row): row is ProfileRow & { site_slug: string } => typeof row.site_slug === 'string',
  );
  if (profiles.length === 0) return { ok: true, sources: [] };

  const slugByUserId = new Map(profiles.map((row) => [row.id, row.site_slug]));
  const userIds = [...slugByUserId.keys()];

  // 폴백은 청크를 순차 요청하므로 회원이 많으면 요청 시간 제한을 넘길 수 있다.
  // 시간 예산을 넘기면 "일부만 담긴 사이트맵"을 200 으로 주지 않고 명확히 실패한다.
  const startedAt = Date.now();
  const postRows: PostRow[] = [];
  for (let i = 0; i < userIds.length; i += FALLBACK_IN_CHUNK) {
    if (Date.now() - startedAt > FALLBACK_BUDGET_MS) {
      console.error('[clinic-sitemap-index] 폴백 시간 예산 초과 — 마이그 049(뷰) 적용 필요');
      return { ok: false, reason: 'fallback budget exceeded' };
    }
    const result = await fetchPostsForChunk(admin, userIds.slice(i, i + FALLBACK_IN_CHUNK));
    if (!result.ok) return result;
    postRows.push(...result.rows);
  }

  const aggregated = new Map<string, { postCount: number; lastPublishedAt: string | null }>();
  for (const row of postRows) {
    const slug = slugByUserId.get(row.user_id);
    if (!slug) continue;

    const publishedAt = row.site_published_at ?? row.published_at ?? row.created_at;
    const current = aggregated.get(slug);
    if (!current) {
      aggregated.set(slug, { postCount: 1, lastPublishedAt: publishedAt });
      continue;
    }
    const isNewer =
      publishedAt !== null &&
      (current.lastPublishedAt === null || publishedAt > current.lastPublishedAt);
    aggregated.set(slug, {
      postCount: current.postCount + 1,
      lastPublishedAt: isNewer ? publishedAt : current.lastPublishedAt,
    });
  }

  // profiles 정렬(site_slug 오름차순)을 그대로 유지한다.
  return {
    ok: true,
    sources: profiles.reduce<ClinicSitemapSource[]>((acc, profile) => {
      const agg = aggregated.get(profile.site_slug);
      if (!agg || agg.postCount === 0) return acc;
      return [
        ...acc,
        { slug: profile.site_slug, postCount: agg.postCount, lastPublishedAt: agg.lastPublishedAt },
      ];
    }, []),
  };
}

/**
 * 발행 글이 1편 이상인 병원의 site_slug 목록을 site_slug 오름차순 1페이지 조회한다.
 * 실패는 { ok:false } 로 전파한다 — 라우트가 5xx 를 내고 직전 사이트맵을 살려둔다.
 */
export async function fetchClinicSitemapSources(
  from: number,
  to: number,
): Promise<SitemapSourcesResult> {
  try {
    const viaView = await fetchFromView(from, to);
    if (viaView !== null) return viaView;
    return await fetchFromTables(from, to);
  } catch (err) {
    console.error('[clinic-sitemap-index] 조회 실패:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'unexpected error' };
  }
}

/**
 * 인덱스에 실릴 병원 총수 — robots.txt 가 몇 페이지를 노출할지 계산하는 데 쓴다.
 *
 * 뷰가 없거나 조회에 실패하면 null 을 돌려 호출부가 "1페이지만" 노출하게 한다.
 * 폴백 경로에서 profiles 수로 어림하면 발행 0편 병원까지 세어 빈 2페이지를
 * 광고하게 되고, 빈 사이트맵은 서치콘솔 오류로 쌓인다(마이그 적용 전 한시적 상태).
 */
export async function countClinicSitemapSources(): Promise<number | null> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from(SITEMAP_VIEW)
      .select('site_slug', { count: 'exact', head: true })
      .gt('post_count', 0)
      // ★ robots.txt 가 이 조회를 기다린다. robots.txt 가 느려지거나 5xx 가 되면
      //   구글이 크롤링을 일시 중단하므로 반드시 상한을 건다 — 초과 시 null(1페이지).
      .abortSignal(AbortSignal.timeout(COUNT_TIMEOUT_MS));

    if (error || typeof count !== 'number') return null;
    return count;
  } catch {
    return null;
  }
}

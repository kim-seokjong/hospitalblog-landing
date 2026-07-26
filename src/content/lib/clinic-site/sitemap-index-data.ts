/**
 * 사이트맵 인덱스 데이터 조회 (서버 전용).
 *
 * 1순위: 마이그 049 뷰(clinic_site_sitemap_index) — 병원별 발행글 수·최신 발행시각을
 *        DB 에서 집계한다. 병원이 수천으로 늘어도 쿼리 1회 + range 페이지네이션이면 된다.
 * 2순위(폴백): 뷰가 없는 환경(마이그 미적용)에서는 profiles 1페이지 + 해당 회원들의
 *        발행글을 앱에서 집계한다. 스캔 상한을 두어 폭주하지 않게 한다.
 *
 * 어떤 경우에도 예외를 던지지 않는다 — 사이트맵은 항상 200 으로 응답되어야 한다.
 * (@/ 별칭을 쓰는 서버 모듈이라 node 테스트 러너 대상이 아니다.
 *  순수 판정·XML 조립 로직은 sitemap-index.ts 에 있다.)
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import type { ClinicSitemapSource } from './sitemap-index';

/** 마이그 049 로 만들어지는 집계 뷰 이름. */
const SITEMAP_VIEW = 'clinic_site_sitemap_index';

/** 폴백 경로에서 한 청크당 스캔할 발행글 행 수 상한 (메모리·응답시간 방어). */
const FALLBACK_POST_SCAN_LIMIT = 5_000;

/**
 * 폴백 경로의 user_id IN 절 청크 크기.
 * PostgREST select 는 GET 쿼리스트링이라 UUID 수백 개를 한 번에 넣으면
 * URL 길이 한도에 걸린다 → 200개씩 나눠 조회한다.
 */
const FALLBACK_IN_CHUNK = 200;

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

/** 뷰/컬럼/관계가 없는 환경인지 판정 (마이그 미적용 → 폴백 or 빈 목록). */
function isMissingSchemaError(code: string | undefined): boolean {
  // 42P01 undefined_table, 42703 undefined_column,
  // PGRST20x = PostgREST 스키마 캐시에서 대상을 못 찾음
  return code === '42P01' || code === '42703' || (typeof code === 'string' && code.startsWith('PGRST2'));
}

/** 1순위 — 집계 뷰. 뷰가 없으면 null 을 돌려 폴백으로 넘긴다. */
async function fetchFromView(from: number, to: number): Promise<ClinicSitemapSource[] | null> {
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
    return null;
  }
  if (!data) return [];

  return (data as ViewRow[])
    .filter((row): row is ViewRow & { site_slug: string } => typeof row.site_slug === 'string')
    .map((row) => ({
      slug: row.site_slug,
      postCount: typeof row.post_count === 'number' ? row.post_count : 0,
      lastPublishedAt: row.last_published_at,
    }));
}

/** 2순위 — 뷰 미적용 환경 폴백. profiles 1페이지 + 발행글 집계. */
async function fetchFromTables(from: number, to: number): Promise<ClinicSitemapSource[]> {
  const admin = createAdminClient();

  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('id, site_slug')
    .not('site_slug', 'is', null)
    .not('hospital_name', 'is', null)
    .order('site_slug', { ascending: true })
    .range(from, to);

  if (profileError || !profileData) {
    if (profileError && !isMissingSchemaError(profileError.code)) {
      console.error('[clinic-sitemap-index] 프로필 조회 오류:', profileError.message);
    }
    return [];
  }

  const profiles = (profileData as ProfileRow[]).filter(
    (row): row is ProfileRow & { site_slug: string } => typeof row.site_slug === 'string',
  );
  if (profiles.length === 0) return [];

  const slugByUserId = new Map(profiles.map((row) => [row.id, row.site_slug]));

  const userIds = [...slugByUserId.keys()];
  const postRows: PostRow[] = [];
  for (let i = 0; i < userIds.length; i += FALLBACK_IN_CHUNK) {
    const chunk = userIds.slice(i, i + FALLBACK_IN_CHUNK);
    const { data: postData, error: postError } = await admin
      .from('saved_posts')
      .select('user_id, site_published_at, published_at, created_at')
      .eq('published_to_site', true)
      .in('user_id', chunk)
      .limit(FALLBACK_POST_SCAN_LIMIT);

    if (postError) {
      if (!isMissingSchemaError(postError.code)) {
        console.error('[clinic-sitemap-index] 발행글 조회 오류:', postError.message);
      }
      // 이 청크만 건너뛴다 — 나머지 병원은 정상적으로 인덱스에 들어간다.
      continue;
    }
    if (postData) postRows.push(...(postData as PostRow[]));
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
  return profiles.reduce<ClinicSitemapSource[]>((acc, profile) => {
    const agg = aggregated.get(profile.site_slug);
    if (!agg || agg.postCount === 0) return acc;
    return [...acc, { slug: profile.site_slug, postCount: agg.postCount, lastPublishedAt: agg.lastPublishedAt }];
  }, []);
}

/**
 * 발행 글이 1편 이상인 병원의 site_slug 목록을 site_slug 오름차순 1페이지 조회한다.
 * 실패해도 예외 대신 빈 배열 — 사이트맵은 항상 well-formed 하게 응답한다.
 */
export async function fetchClinicSitemapSources(
  from: number,
  to: number,
): Promise<ClinicSitemapSource[]> {
  try {
    const viaView = await fetchFromView(from, to);
    if (viaView !== null) return viaView;
    return await fetchFromTables(from, to);
  } catch (err) {
    console.error('[clinic-sitemap-index] 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

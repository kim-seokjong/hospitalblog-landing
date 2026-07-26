/**
 * 병원 서브도메인 블로그 — 공개 페이지 데이터 조회 (서버 전용).
 *
 * ⚠️ 보안 결정 (마이그 043 주석과 동일):
 *  - anon RLS 정책을 열지 않고 service role 로 "명시적 컬럼만" select 한다.
 *    profiles 행 전체(전화번호·알림설정 등)가 공개 페이지로 새는 것을 막는다.
 *  - saved_posts 는 published_to_site=true 필터가 필수 — 발행 확정본만 노출.
 *
 * 이 모듈은 @/ 별칭을 쓰는 서버 모듈이라 node 테스트 러너 대상이 아니다
 * (순수 판정 로직은 slug.ts / publish-gate.ts 에 있다).
 */

import { createAdminClient } from '@/dev/lib/supabase/server';

/** 공개 페이지에 노출 가능한 병원 공개 사실정보만 담는다. */
export interface ClinicSiteProfile {
  userId: string;
  siteSlug: string;
  hospitalName: string;
  /** 진료과 (profiles.hospital_type) */
  hospitalType: string | null;
  region: string | null;
  address: string | null;
  /** 저자 이름 (profiles.full_name) — 바이라인/E-E-A-T 파생용 */
  authorFullName: string | null;
  /** 저자 직책 (profiles.position — 원장/부원장/… ) — 임상 역할일 때만 개인 저자 */
  authorPosition: string | null;
}

export interface ClinicSitePost {
  id: string;
  title: string;
  content: string;
  publishedAt: string | null;
  /** 주제 기반 관련 글 랭킹용 (saved_posts.tags) — 없으면 빈 배열 */
  tags: string[];
  /** 주제 기반 관련 글 랭킹용 (saved_posts.keyword) — 없으면 null */
  keyword: string | null;
  /**
   * 본문 이미지 URL (saved_posts.image_urls) — 없거나 컬럼 미존재면 빈 배열.
   * 렌더 화이트리스트 판정은 clinic-site/post-images.ts 가 담당한다(원문 그대로 전달).
   */
  imageUrls: string[];
}

interface ProfileRow {
  id: string;
  site_slug: string;
  hospital_name: string | null;
  hospital_type: string | null;
  region: string | null;
  hospital_address: string | null;
  full_name: string | null;
  position: string | null;
}

interface PostRow {
  id: string;
  title: string;
  content: string;
  site_published_at: string | null;
  published_at: string | null;
  created_at: string | null;
  tags: string[] | null;
  keyword: string | null;
  image_urls?: string[] | null;
}

/**
 * 글 본문 페이지가 읽는 컬럼.
 *
 * image_urls 는 구 스키마(마이그 미적용) DB 에 없을 수 있다 — 컬럼 없음(42703)이면
 * 이 컬럼을 뺀 목록으로 한 번 재조회한다(기존 폴백 패턴: api/credentials·api/profile).
 * 이미지가 안 나올 뿐 글 자체는 그대로 보인다.
 */
const POST_COLUMNS =
  'id, title, content, site_published_at, published_at, created_at, tags, keyword, image_urls';
const POST_COLUMNS_LEGACY =
  'id, title, content, site_published_at, published_at, created_at, tags, keyword';

/** Postgres "column does not exist" — 마이그 미적용 환경 신호. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703';
}

/** 목록 페이지(사람이 보는 홈) 글 수 상한. */
export const CLINIC_SITE_POST_LIMIT = 50;

/**
 * 병원별 sitemap.xml 에 담는 글 수 상한.
 *
 * ★ 목록 페이지 상한(50)을 그대로 쓰면 51번째 글부터 사이트맵에서 사라진다
 *   ("모든 글 자동 발견" 목표와 정면 충돌). sitemaps.org 프로토콜 상한은
 *   사이트맵당 URL 50,000개이므로 현실적으로 닿지 않는 5,000편으로 둔다
 *   (하루 3편 자동발행 기준 약 4.5년치).
 */
export const CLINIC_SITE_SITEMAP_POST_LIMIT = 5_000;

/** Supabase 기본 max-rows(1,000)에 맞춘 페이지 크기. */
const SITEMAP_POST_PAGE = 1_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** 슬러그로 병원 공개 프로필을 조회한다. 없으면 null (404 처리용). */
export async function getClinicBySlug(slug: string): Promise<ClinicSiteProfile | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, site_slug, hospital_name, hospital_type, region, hospital_address, full_name, position')
      .eq('site_slug', slug)
      .single<ProfileRow>();

    if (error || !data || !data.hospital_name) return null;
    return {
      userId: data.id,
      siteSlug: data.site_slug,
      hospitalName: data.hospital_name,
      hospitalType: data.hospital_type,
      region: data.region,
      address: data.hospital_address,
      authorFullName: data.full_name,
      authorPosition: data.position,
    };
  } catch (err) {
    console.error('[clinic-site] 프로필 조회 오류:', err instanceof Error ? err.message : err);
    return null;
  }
}

function toPost(row: PostRow): ClinicSitePost {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    publishedAt: row.site_published_at ?? row.published_at ?? row.created_at,
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
    keyword: typeof row.keyword === 'string' ? row.keyword : null,
    imageUrls: Array.isArray(row.image_urls)
      ? row.image_urls.filter((u): u is string => typeof u === 'string')
      : [],
  };
}

/** 발행 확정(published_to_site=true) 글 목록 — 최신 발행순. */
export async function getPublishedPosts(userId: string): Promise<ClinicSitePost[]> {
  try {
    const admin = createAdminClient();
    const query = (columns: string) =>
      admin
        .from('saved_posts')
        .select(columns)
        .eq('user_id', userId)
        .eq('published_to_site', true)
        .order('site_published_at', { ascending: false, nullsFirst: false })
        .limit(CLINIC_SITE_POST_LIMIT);

    let { data, error } = await query(POST_COLUMNS);
    if (isMissingColumn(error)) {
      ({ data, error } = await query(POST_COLUMNS_LEGACY));
    }

    if (error || !data) return [];
    return (data as unknown as PostRow[]).map(toPost);
  } catch (err) {
    console.error('[clinic-site] 글 목록 조회 오류:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 슬러그가 실제 병원에 할당돼 있는지만 확인한다 (IndexNow 키 파일 게이트용).
 *  true  = 존재, false = 미할당, null = 조회 실패(호출부가 fail-open 판단)
 * 프로필 본문을 읽지 않아 getClinicBySlug 보다 가볍고, "없음"과 "장애"를 구분한다.
 */
export async function clinicSlugExists(slug: string): Promise<boolean | null> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('site_slug', slug);

    if (error) {
      console.error('[clinic-site] 슬러그 존재 확인 오류:', error.message);
      return null;
    }
    return typeof count === 'number' ? count > 0 : null;
  } catch (err) {
    console.error('[clinic-site] 슬러그 존재 확인 실패:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** sitemap.xml 용 최소 정보 — 본문·태그를 읽지 않아 응답이 가볍다. */
export interface ClinicSitePostRef {
  id: string;
  publishedAt: string | null;
}

interface PostRefRow {
  id: string;
  site_published_at: string | null;
  published_at: string | null;
  created_at: string | null;
}

/**
 * 병원 sitemap.xml 용 발행 글 전체 목록 (id + 발행시각만).
 *
 * 목록 페이지와 달리 50편으로 자르지 않는다 — 잘린 글은 검색엔진이 영영 찾지
 * 못한다. Supabase 기본 max-rows(1,000) 때문에 반드시 range 페이지네이션으로
 * 훑어야 한다(.limit(5000) 만으로는 1,000행에서 잘린다).
 *
 * 실패하면 빈 배열이 아니라 null 을 돌려 호출부가 200 대신 5xx 를 내게 한다
 * (빈 sitemap 을 200 으로 주면 검색엔진이 글이 사라진 것으로 받아들인다).
 */
export async function getPublishedPostRefs(userId: string): Promise<ClinicSitePostRef[] | null> {
  try {
    const admin = createAdminClient();
    const refs: ClinicSitePostRef[] = [];

    const maxPages = Math.ceil(CLINIC_SITE_SITEMAP_POST_LIMIT / SITEMAP_POST_PAGE);
    for (let page = 0; page < maxPages; page++) {
      const from = page * SITEMAP_POST_PAGE;
      const { data, error } = await admin
        .from('saved_posts')
        .select('id, site_published_at, published_at, created_at')
        .eq('user_id', userId)
        .eq('published_to_site', true)
        // 결정적 순서 — 페이지 경계에서 중복·누락이 없도록 id 로 tie-break 한다.
        .order('site_published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, from + SITEMAP_POST_PAGE - 1);

      if (error) {
        console.error('[clinic-site] sitemap 글 조회 오류:', error.message);
        return null;
      }

      const rows = (data ?? []) as PostRefRow[];
      refs.push(
        ...rows.map((row) => ({
          id: row.id,
          publishedAt: row.site_published_at ?? row.published_at ?? row.created_at,
        })),
      );
      if (rows.length < SITEMAP_POST_PAGE) break;
    }

    return refs;
  } catch (err) {
    console.error('[clinic-site] sitemap 글 조회 실패:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** 발행 확정 글 1편 — 미발행/타 병원 글이면 null (404 처리용). */
export async function getPublishedPost(
  userId: string,
  postId: string,
): Promise<ClinicSitePost | null> {
  if (!isUuid(postId)) return null;
  try {
    const admin = createAdminClient();
    const query = (columns: string) =>
      admin
        .from('saved_posts')
        .select(columns)
        .eq('id', postId)
        .eq('user_id', userId)
        .eq('published_to_site', true)
        .single<PostRow>();

    let { data, error } = await query(POST_COLUMNS);
    if (isMissingColumn(error)) {
      ({ data, error } = await query(POST_COLUMNS_LEGACY));
    }

    if (error || !data) return null;
    return toPost(data);
  } catch (err) {
    console.error('[clinic-site] 글 조회 오류:', err instanceof Error ? err.message : err);
    return null;
  }
}

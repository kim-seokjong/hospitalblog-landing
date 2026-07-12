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
}

export interface ClinicSitePost {
  id: string;
  title: string;
  content: string;
  publishedAt: string | null;
}

interface ProfileRow {
  id: string;
  site_slug: string;
  hospital_name: string | null;
  hospital_type: string | null;
  region: string | null;
  hospital_address: string | null;
}

interface PostRow {
  id: string;
  title: string;
  content: string;
  site_published_at: string | null;
  published_at: string | null;
  created_at: string | null;
}

/** 목록 페이지 글 수 상한. */
export const CLINIC_SITE_POST_LIMIT = 50;

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
      .select('id, site_slug, hospital_name, hospital_type, region, hospital_address')
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
  };
}

/** 발행 확정(published_to_site=true) 글 목록 — 최신 발행순. */
export async function getPublishedPosts(userId: string): Promise<ClinicSitePost[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('saved_posts')
      .select('id, title, content, site_published_at, published_at, created_at')
      .eq('user_id', userId)
      .eq('published_to_site', true)
      .order('site_published_at', { ascending: false, nullsFirst: false })
      .limit(CLINIC_SITE_POST_LIMIT);

    if (error || !data) return [];
    return (data as PostRow[]).map(toPost);
  } catch (err) {
    console.error('[clinic-site] 글 목록 조회 오류:', err instanceof Error ? err.message : err);
    return [];
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
    const { data, error } = await admin
      .from('saved_posts')
      .select('id, title, content, site_published_at, published_at, created_at')
      .eq('id', postId)
      .eq('user_id', userId)
      .eq('published_to_site', true)
      .single<PostRow>();

    if (error || !data) return null;
    return toPost(data);
  } catch (err) {
    console.error('[clinic-site] 글 조회 오류:', err instanceof Error ? err.message : err);
    return null;
  }
}

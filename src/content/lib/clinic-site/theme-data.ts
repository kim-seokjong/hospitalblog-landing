/**
 * 병원 서브도메인 블로그 — 브랜드킷 테마 데이터 조회 (서버 전용).
 *
 * data.ts 와 동일한 보안 결정:
 *  - anon RLS 를 열지 않고 service role 로 "명시적 컬럼만" select 한다.
 *  - 판정 로직(hex 검증·휘도·사진 동의 필터·URL 허용)은 전부 theme.ts 순수 함수 —
 *    이 모듈은 조회와 조립만 담당한다.
 *
 * graceful: 조회 실패·컬럼 미존재(마이그 024 미적용)·미등록 병원 전부
 * EMPTY_CLINIC_THEME 로 수렴 → 공개 페이지는 기본 디자인을 유지한다.
 */

import { createAdminClient } from '@/dev/lib/supabase/server';
import {
  buildClinicTheme,
  EMPTY_CLINIC_THEME,
  type ClinicTheme,
  type PublicClinicPhoto,
} from './theme';

interface ThemeProfileRow {
  clinic_logo_url: string | null;
  clinic_brand_color: string | null;
  clinic_doctor_photo_url: string | null;
  clinic_doctor_consent: boolean | null;
  hospital_desc: string | null;
}

interface ThemePhotoRow {
  category: string | null;
  url: string | null;
  consent: boolean | null;
}

/** 갤러리 상한(6장)보다 넉넉히 조회 — 필터 탈락분 대비. */
const PHOTO_QUERY_LIMIT = 30;

function toPublicPhotos(rows: readonly ThemePhotoRow[]): PublicClinicPhoto[] {
  const result: PublicClinicPhoto[] = [];
  for (const row of rows) {
    if (typeof row.category !== 'string' || typeof row.url !== 'string') continue;
    result.push({ category: row.category, url: row.url, consent: row.consent === true });
  }
  return result;
}

/**
 * 병원의 브랜드킷 테마를 조회한다. 어떤 실패에서도 EMPTY_CLINIC_THEME 을 돌려
 * 공개 페이지가 깨지지 않게 한다 (기본 디자인 유지).
 */
export async function getClinicTheme(userId: string): Promise<ClinicTheme> {
  try {
    const admin = createAdminClient();

    const [profileRes, photosRes] = await Promise.all([
      admin
        .from('profiles')
        .select(
          'clinic_logo_url, clinic_brand_color, clinic_doctor_photo_url, clinic_doctor_consent, hospital_desc',
        )
        .eq('id', userId)
        .single<ThemeProfileRow>(),
      admin
        .from('clinic_photos')
        .select('category, url, consent')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(PHOTO_QUERY_LIMIT),
    ]);

    // 프로필·사진 각각 독립적으로 graceful — 한쪽 실패가 다른 쪽을 막지 않는다.
    const profile: ThemeProfileRow | null =
      profileRes.error || !profileRes.data ? null : profileRes.data;
    const photoRows: ThemePhotoRow[] =
      photosRes.error || !photosRes.data ? [] : (photosRes.data as ThemePhotoRow[]);

    if (!profile && photoRows.length === 0) return EMPTY_CLINIC_THEME;

    return buildClinicTheme({
      brandColor: profile?.clinic_brand_color ?? null,
      logoUrl: profile?.clinic_logo_url ?? null,
      doctorPhotoUrl: profile?.clinic_doctor_photo_url ?? null,
      doctorConsent: profile?.clinic_doctor_consent === true,
      description: profile?.hospital_desc ?? null,
      photos: toPublicPhotos(photoRows),
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    });
  } catch (err) {
    console.error('[clinic-site] 테마 조회 오류:', err instanceof Error ? err.message : err);
    return EMPTY_CLINIC_THEME;
  }
}

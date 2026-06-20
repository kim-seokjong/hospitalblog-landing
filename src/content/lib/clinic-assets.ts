// ClinicFlix 브랜드킷/사진 보관함 — Supabase Storage 업로드 헬퍼 (브라우저 전용).
//
// 마이페이지 BrandKitTab / PhotoLibraryTab 에서 파일을 'clinic-assets' 버킷에 올리고
// public URL 을 돌려준다. 경로 규칙: {user_id}/{kind}/{uuid}.{ext}
// (Storage RLS 가 첫 폴더 세그먼트 = 본인 uid 인 경우에만 쓰기를 허용한다.)
//
// 검증: 이미지 <= 20MB, 영상 <= 200MB. 종류별 허용 MIME 을 클라이언트에서 1차 검증한다.

import { createClient } from '@/dev/lib/supabase/client'

const BUCKET = 'clinic-assets'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // 200MB

export type ClinicAssetKind = 'logo' | 'doctor' | 'photo'

function extOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop() : ''
  const ext = (fromName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (ext) return ext
  // 이름에 확장자가 없으면 MIME 에서 추론
  const sub = file.type.split('/')[1]
  return (sub || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function validate(file: File, kind: ClinicAssetKind): void {
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')

  if (kind === 'doctor') {
    // 원장 미디어는 사진(이미지) 또는 영상 둘 다 허용
    if (!isImage && !isVideo) {
      throw new Error('원장 사진은 이미지, 원장 영상은 동영상 파일만 업로드할 수 있습니다.')
    }
  } else {
    // logo / photo 는 이미지만
    if (!isImage) {
      throw new Error('이미지 파일(jpg, png 등)만 업로드할 수 있습니다.')
    }
  }

  const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (file.size > limit) {
    const mb = Math.round(limit / (1024 * 1024))
    throw new Error(`파일이 너무 큽니다. ${mb}MB 이하만 업로드할 수 있습니다.`)
  }
}

/**
 * 파일을 'clinic-assets' 버킷에 업로드하고 public URL 을 반환한다.
 * 현재 로그인 사용자의 세션에서 user.id 를 읽어 폴더 경로를 구성한다.
 */
export async function uploadClinicAsset(
  file: File,
  kind: ClinicAssetKind,
): Promise<{ url: string }> {
  validate(file, kind)

  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.')
  }

  const ext = extOf(file)
  const path = `${user.id}/${kind}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
  if (uploadError) {
    throw new Error(`업로드에 실패했습니다: ${uploadError.message}`)
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) {
    throw new Error('업로드 후 공개 URL 을 가져오지 못했습니다.')
  }

  return { url: data.publicUrl }
}

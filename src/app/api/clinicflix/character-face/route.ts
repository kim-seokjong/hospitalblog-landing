// 전속 캐릭터 전용 얼굴 1회 생성·영구 고정 API.
//
// 흐름: 인증 → 저장된 캐릭터와 일치 확인 → 이미 얼굴 있으면 그대로 반환(멱등·중복 비용 방지)
//      → ClinicFlix /character-face (persona_en 정면 초상 1장, 서비스 GuardedEngine 원가 가드)
//      → clinic-assets 영구 복사 → profiles.clinicflix_character(jsonb) 에 face_url 병합 저장.
//
// 비용: gpt-image 1장(약 ₩90) — 병원당 1회. 이후 렌더는 이 얼굴을 진행자 레퍼런스(ref2v)로
// 재사용해 영상 간 얼굴 변동이 사라진다. (확정 가상 진행자가 있으면 그쪽이 여전히 우선.)

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import {
  clinicflixCharacterFace,
  ClinicflixUnavailableError,
} from '@/content/lib/clinicflix'
import {
  isCharacterPresetId,
  parseCharacterSelection,
  parseCharacterFaceUrl,
} from '@/content/lib/clinicflix-characters'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'clinic-assets'

// SSRF 방지: 생성 결과 CDN(fal) / Supabase Storage 만 서버 fetch 허용 (presenter 라우트와 동일 정책)
const ALLOWED_FETCH_SUFFIXES = ['.fal.media', 'fal.media', '.supabase.co']

function isAllowedAssetUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === 'https:' &&
      ALLOWED_FETCH_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(s))
    )
  } catch {
    return false
  }
}

function extFromUrl(url: string, contentType: string | null): string {
  const clean = url.split('?')[0]
  const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/)
  if (m) return m[1].toLowerCase()
  const sub = (contentType ?? '').split('/')[1]
  return (sub || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 생성 결과 URL → clinic-assets/{userId}/character/{uuid}.{ext} 영구 복사, public url 반환. */
async function copyToStorage(
  admin: ReturnType<typeof createAdminClient>,
  url: string,
  userId: string,
): Promise<string> {
  if (!isAllowedAssetUrl(url)) throw new Error('허용되지 않은 이미지 호스트')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`)
  const contentType = res.headers.get('content-type')
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromUrl(url, contentType)
  const path = `${userId}/character/${crypto.randomUUID()}.${ext}`
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: contentType ?? undefined,
    upsert: true,
  })
  if (error) throw new Error(error.message)
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('public URL 생성 실패')
  return data.publicUrl
}

/**
 * POST /api/clinicflix/character-face
 * body: { preset_id: string } — 저장된 전속 캐릭터의 전용 얼굴을 1회 생성해 영구 고정한다.
 * 응답: { face_url } (이미 고정돼 있으면 기존 것 그대로 — 멱등)
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const presetId = body.preset_id
    if (!isCharacterPresetId(presetId)) {
      return NextResponse.json({ error: '전속 캐릭터 값이 올바르지 않습니다.' }, { status: 400 })
    }

    // 저장된 선택과 일치 확인 — 전용 얼굴은 "저장된" 캐릭터에만 고정한다 (선택-저장 불일치 방어)
    const { data: profileRow, error: profileErr } = await supabase
      .from('profiles')
      .select('clinicflix_character')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr) {
      // 마이그레이션 036 미적용(42703) 등 — 캐릭터 기능 자체가 꺼진 상태
      return NextResponse.json(
        { error: '캐릭터 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 },
      )
    }
    const savedRaw = (profileRow ?? {}) as Record<string, unknown>
    const savedPresetId = parseCharacterSelection(savedRaw.clinicflix_character)
    if (savedPresetId !== presetId) {
      return NextResponse.json(
        { error: '먼저 전속 캐릭터를 저장한 뒤 얼굴을 생성할 수 있어요.' },
        { status: 409 },
      )
    }
    // 이미 고정된 얼굴이 있으면 재생성하지 않는다 (멱등 — 병원당 1회 비용 보장)
    const existingFace = parseCharacterFaceUrl(savedRaw.clinicflix_character)
    if (existingFace) {
      return NextResponse.json({ face_url: existingFace })
    }

    // 1장 생성 (서비스가 GuardedEngine 원가 미터·순화 재시도로 가드)
    let generatedUrl: string
    try {
      const out = await clinicflixCharacterFace(presetId)
      generatedUrl = out.face_url
      if (typeof generatedUrl !== 'string' || !generatedUrl.trim()) {
        throw new Error('생성 결과 URL 이 비어 있습니다')
      }
    } catch (e) {
      if (e instanceof ClinicflixUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: 503 })
      }
      const msg = e instanceof Error ? e.message : '캐릭터 얼굴 생성에 실패했습니다'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // 영구 보관(clinic-assets 복사). 복사 실패 시 생성 원본(fal) URL 로 폴백 —
    // 이미 생성 비용을 쓴 얼굴을 버리지 않는다 (원본 만료 전 재저장 기회는 유지).
    const admin = createAdminClient()
    let faceUrl: string
    try {
      faceUrl = await copyToStorage(admin, generatedUrl, user.id)
    } catch {
      if (!isAllowedAssetUrl(generatedUrl)) {
        return NextResponse.json({ error: '얼굴 이미지 저장에 실패했습니다' }, { status: 500 })
      }
      faceUrl = generatedUrl
    }

    // jsonb 병합 저장 — preset_id/selected_at 은 보존하고 face_url 만 더한다 (불변 갱신)
    const savedCharacter =
      savedRaw.clinicflix_character !== null &&
      typeof savedRaw.clinicflix_character === 'object'
        ? (savedRaw.clinicflix_character as Record<string, unknown>)
        : {}
    const nextCharacter = {
      ...savedCharacter,
      preset_id: presetId,
      face_url: faceUrl,
      face_generated_at: new Date().toISOString(),
    }
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ clinicflix_character: nextCharacter, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (updateErr) {
      return NextResponse.json({ error: '캐릭터 얼굴 저장에 실패했습니다' }, { status: 500 })
    }

    return NextResponse.json({ face_url: faceUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

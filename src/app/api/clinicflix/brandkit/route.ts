import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import {
  isCharacterPresetId,
  parseCharacterSelection,
  parseCharacterFaceUrl,
} from '@/content/lib/clinicflix-characters'

export const dynamic = 'force-dynamic'

// ── 기본값 (마이그레이션 #024 신규 컬럼은 nullable → 미설정 시 폴백) ──
const DEFAULTS = {
  brand_color: '#ff4628',
  voice_gender: 'female',
  threads_tone: 'haeyo',
  cardnews_style: 2,
  shorts_concept: '정보형',
} as const

const VOICE_GENDERS = ['male', 'female'] as const
const THREADS_TONES = ['banmal', 'haeyo', 'hamnida'] as const
const SHORTS_CONCEPTS = ['정보형', '후킹형', '친근형'] as const
const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface BrandKitResponse {
  logo_url: string | null
  brand_color: string
  hashtags: string[]
  voice_gender: string
  threads_tone: string
  cardnews_style: number
  shorts_concept: string
  doctor_photo_url: string | null
  doctor_video_url: string | null
  doctor_consent: boolean
  /** 전속 AI 캐릭터 프리셋 id (null = 미선택 → 자동 배정). 마이그레이션 036. */
  character_preset_id: string | null
  /** 캐릭터 전용 얼굴 URL (1회 생성·영구 고정, /api/clinicflix/character-face). null = 미고정 */
  character_face_url: string | null
}

/**
 * GET /api/clinicflix/brandkit
 * 인증 사용자의 브랜드킷(clinic_* 컬럼)을 폴백 적용해 반환한다.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const LEGACY_COLS =
      'clinic_logo_url, clinic_brand_color, clinic_hashtags, clinic_voice_gender, clinic_threads_tone, clinic_cardnews_style, clinic_shorts_concept, clinic_doctor_photo_url, clinic_doctor_video_url, clinic_doctor_consent'
    let { data, error } = await supabase
      .from('profiles')
      .select(`${LEGACY_COLS}, clinicflix_character`)
      .eq('id', user.id)
      .single()

    // 마이그레이션 036(clinicflix_character) 미적용 DB 방어 — 컬럼 없음(42703)이면
    // 기존 컬럼만으로 재조회해 탭 전체가 죽지 않게 한다 (캐릭터만 미선택으로 표시).
    if (error && error.code === '42703') {
      ;({ data, error } = await supabase
        .from('profiles')
        .select(LEGACY_COLS)
        .eq('id', user.id)
        .single())
    }

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: '브랜드킷 조회 실패' }, { status: 500 })
    }

    const row = (data ?? {}) as Record<string, unknown>
    const body: BrandKitResponse = {
      logo_url: (row.clinic_logo_url as string | null) ?? null,
      brand_color: (row.clinic_brand_color as string | null) ?? DEFAULTS.brand_color,
      hashtags: Array.isArray(row.clinic_hashtags) ? (row.clinic_hashtags as string[]) : [],
      voice_gender: (row.clinic_voice_gender as string | null) ?? DEFAULTS.voice_gender,
      threads_tone: (row.clinic_threads_tone as string | null) ?? DEFAULTS.threads_tone,
      cardnews_style:
        typeof row.clinic_cardnews_style === 'number'
          ? (row.clinic_cardnews_style as number)
          : DEFAULTS.cardnews_style,
      shorts_concept: (row.clinic_shorts_concept as string | null) ?? DEFAULTS.shorts_concept,
      doctor_photo_url: (row.clinic_doctor_photo_url as string | null) ?? null,
      doctor_video_url: (row.clinic_doctor_video_url as string | null) ?? null,
      doctor_consent: (row.clinic_doctor_consent as boolean | null) ?? false,
      character_preset_id: parseCharacterSelection(row.clinicflix_character),
      character_face_url: parseCharacterFaceUrl(row.clinicflix_character),
    }
    return NextResponse.json(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

type ValidationResult =
  | { ok: true; updates: Record<string, unknown> }
  | { ok: false; error: string }

/** 외부 입력(client)을 신뢰하지 않고 화이트리스트 검증. 통과한 값만 clinic_* 컬럼으로 매핑. */
function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '요청 본문이 올바르지 않습니다.' }
  }
  const b = raw as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  // brand_color (hex)
  if ('brand_color' in b) {
    const v = b.brand_color
    if (typeof v !== 'string' || !HEX_RE.test(v)) {
      return { ok: false, error: '브랜드 색상은 #RRGGBB 형식이어야 합니다.' }
    }
    updates.clinic_brand_color = v
  }

  // voice_gender
  if ('voice_gender' in b) {
    const v = b.voice_gender
    if (typeof v !== 'string' || !(VOICE_GENDERS as readonly string[]).includes(v)) {
      return { ok: false, error: '음성 성별 값이 올바르지 않습니다.' }
    }
    updates.clinic_voice_gender = v
  }

  // threads_tone
  if ('threads_tone' in b) {
    const v = b.threads_tone
    if (typeof v !== 'string' || !(THREADS_TONES as readonly string[]).includes(v)) {
      return { ok: false, error: '쓰레드 톤 값이 올바르지 않습니다.' }
    }
    updates.clinic_threads_tone = v
  }

  // cardnews_style (1..4)
  if ('cardnews_style' in b) {
    const v = b.cardnews_style
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 4) {
      return { ok: false, error: '카드뉴스 스타일 값이 올바르지 않습니다.' }
    }
    updates.clinic_cardnews_style = v
  }

  // shorts_concept
  if ('shorts_concept' in b) {
    const v = b.shorts_concept
    if (typeof v !== 'string' || !(SHORTS_CONCEPTS as readonly string[]).includes(v)) {
      return { ok: false, error: '쇼츠 콘셉트 값이 올바르지 않습니다.' }
    }
    updates.clinic_shorts_concept = v
  }

  // character_preset_id (전속 AI 캐릭터 — 프리셋 id 화이트리스트 | null=해제)
  if ('character_preset_id' in b) {
    const v = b.character_preset_id
    if (v === null) {
      updates.clinicflix_character = null
    } else if (isCharacterPresetId(v)) {
      updates.clinicflix_character = { preset_id: v, selected_at: new Date().toISOString() }
    } else {
      return { ok: false, error: '전속 캐릭터 값이 올바르지 않습니다.' }
    }
  }

  // doctor_consent (boolean)
  if ('doctor_consent' in b) {
    const v = b.doctor_consent
    if (typeof v !== 'boolean') return { ok: false, error: '동의 값이 올바르지 않습니다.' }
    updates.clinic_doctor_consent = v
  }

  // hashtags (string[] max 10)
  if ('hashtags' in b) {
    const v = b.hashtags
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      return { ok: false, error: '해시태그 형식이 올바르지 않습니다.' }
    }
    if (v.length > 10) {
      return { ok: false, error: '해시태그는 최대 10개까지 등록할 수 있습니다.' }
    }
    updates.clinic_hashtags = (v as string[]).map((s) => s.trim()).filter(Boolean)
  }

  // url fields (string | null)
  const urlFields: { key: string; col: string }[] = [
    { key: 'logo_url', col: 'clinic_logo_url' },
    { key: 'doctor_photo_url', col: 'clinic_doctor_photo_url' },
    { key: 'doctor_video_url', col: 'clinic_doctor_video_url' },
  ]
  for (const { key, col } of urlFields) {
    if (key in b) {
      const v = b[key]
      if (v !== null && typeof v !== 'string') {
        return { ok: false, error: `${key} 값이 올바르지 않습니다.` }
      }
      updates[col] = v === '' ? null : v
    }
  }

  return { ok: true, updates }
}

/**
 * PUT /api/clinicflix/brandkit
 * 인증 사용자 본인 행의 clinic_* 컬럼만 갱신한다.
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const raw = await req.json().catch(() => null)
    const result = validateBody(raw)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    let updates: Record<string, unknown> = {
      ...result.updates,
      updated_at: new Date().toISOString(),
    }

    // 같은 프리셋 재저장이면 기존 전용 얼굴(face_url, 1회 생성·영구 고정)을 보존한다.
    // 다른 프리셋으로 바꾸면 초기화 — 새 캐릭터의 얼굴은 다시 1회 생성한다.
    const nextCharacter = updates['clinicflix_character'] as
      | { preset_id: string; selected_at: string }
      | null
      | undefined
    if (nextCharacter && typeof nextCharacter === 'object') {
      try {
        const { data: cur } = await supabase
          .from('profiles')
          .select('clinicflix_character')
          .eq('id', user.id)
          .maybeSingle()
        const curRaw = (cur as Record<string, unknown> | null)?.clinicflix_character
        const curPresetId = parseCharacterSelection(curRaw)
        const curFaceUrl = parseCharacterFaceUrl(curRaw)
        if (curPresetId === nextCharacter.preset_id && curFaceUrl) {
          const curGeneratedAt =
            curRaw !== null && typeof curRaw === 'object'
              ? (curRaw as Record<string, unknown>).face_generated_at
              : undefined
          updates = {
            ...updates,
            clinicflix_character: {
              ...nextCharacter,
              face_url: curFaceUrl,
              ...(typeof curGeneratedAt === 'string'
                ? { face_generated_at: curGeneratedAt }
                : {}),
            },
          }
        }
      } catch {
        // 조회 실패(마이그 036 미적용 등) — 보존 없이 진행 (저장 자체를 막지 않음)
      }
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (error) {
      return NextResponse.json({ error: '브랜드킷 저장 실패' }, { status: 500 })
    }

    // 저장 후 최신값을 다시 읽어 반환 (GET 과 동일 형태)
    return GET()
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// 일부 클라이언트가 POST 로 보낼 수 있으므로 동일 핸들러를 노출한다.
export const POST = PUT

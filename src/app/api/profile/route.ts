import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { validateSlug } from '@/content/lib/clinic-site/slug'
import { isValidCadence } from '@/content/lib/clinic-site/auto-publish'

interface ProfileUpdateBody {
  full_name?: string
  phone?: string
  hospital_name?: string
  hospital_address?: string
  position?: string
  specialty?: string
  specialty_detail?: string
  hospital_desc?: string
  hospital_keywords?: string[]
  region?: string
  sms_enabled?: boolean
  sms_phone?: string
  notify_expiry?: boolean
  notify_usage?: boolean
  naver_blog_url?: string
  instagram_handle?: string
  threads_handle?: string
  youtube_channel_id?: string
  site_slug?: string
  site_publish_cadence?: string
}

// 마이그레이션이 아직 적용 안 된 환경에서도 안 깨지게 컬럼 셋을 단계적으로 축소한다.
//  - +SCHED: base + naver(028) + 자사 채널(042) + site_slug(043) + site_publish_cadence(044)
//  - +SITE : base + naver(028) + 자사 채널(042) + site_slug(043)
//  - FULL : base + naver_blog_url(028) + 자사 채널(042)
//  - +NAVER: base + naver_blog_url (042 미적용)
//  - BASE : 코어 컬럼만 (028·042 모두 미적용)
const PROFILE_COLS_BASE =
  'full_name, phone, hospital_name, hospital_address, position, specialty, specialty_detail, hospital_desc, hospital_keywords, region, sms_enabled, sms_phone, notify_expiry, notify_usage'
const PROFILE_COLS_WITH_NAVER = `${PROFILE_COLS_BASE}, naver_blog_url`
const PROFILE_COLS_FULL = `${PROFILE_COLS_WITH_NAVER}, instagram_handle, threads_handle, youtube_channel_id`
const PROFILE_COLS_WITH_SITE = `${PROFILE_COLS_FULL}, site_slug`
const PROFILE_COLS_WITH_SCHEDULE = `${PROFILE_COLS_WITH_SITE}, site_publish_cadence`

// 넓은 것 → 좁은 것 순. 42703(컬럼 없음)이면 다음 후보로 재시도한다.
const SELECT_CANDIDATES: readonly string[] = [
  PROFILE_COLS_WITH_SCHEDULE,
  PROFILE_COLS_WITH_SITE,
  PROFILE_COLS_FULL,
  PROFILE_COLS_WITH_NAVER,
  PROFILE_COLS_BASE,
]

// 저장 시 빈 문자열 → null 로 정규화하는 선택 입력 컬럼.
const NULLABLE_TEXT_COLS: readonly (keyof ProfileUpdateBody)[] = [
  'naver_blog_url',
  'instagram_handle',
  'threads_handle',
  'youtube_channel_id',
  'site_slug',
]

// 042(자사 채널) 컬럼 — 미적용 환경에서 제거 후 재시도할 대상.
const CHANNEL_COLS: readonly string[] = [
  'instagram_handle',
  'threads_handle',
  'youtube_channel_id',
]

function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === '42703'
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    // 존재하는 컬럼 셋을 단계적으로 시도 (마이그 028/042 미적용 환경 방어).
    for (const cols of SELECT_CANDIDATES) {
      const { data, error } = await supabase
        .from('profiles')
        .select(cols)
        .eq('id', user.id)
        .single()

      if (isMissingColumnError(error)) continue
      if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: '프로필 조회 실패' }, { status: 500 })
      }
      return NextResponse.json({ profile: data ?? {} })
    }

    // 모든 후보가 컬럼 없음 — 코어 컬럼도 없다면 빈 프로필 반환.
    return NextResponse.json({ profile: {} })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const body = await req.json() as ProfileUpdateBody

    const allowed: (keyof ProfileUpdateBody)[] = [
      'full_name', 'phone', 'hospital_name', 'hospital_address', 'position',
      'specialty', 'specialty_detail', 'hospital_desc', 'hospital_keywords',
      'region', 'sms_enabled', 'sms_phone', 'notify_expiry', 'notify_usage',
      'naver_blog_url', 'instagram_handle', 'threads_handle', 'youtube_channel_id',
      'site_slug', 'site_publish_cadence',
    ]

    const nullableSet = new Set<string>(NULLABLE_TEXT_COLS as readonly string[])

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (!(key in body)) continue
      if (nullableSet.has(key)) {
        // 빈 문자열은 null 로 저장 (미설정 의미 명확화)
        const raw = body[key]
        const v = typeof raw === 'string' ? raw.trim() : ''
        updates[key] = v === '' ? null : v
      } else {
        updates[key] = body[key]
      }
    }

    // site_slug — 형식·예약어 검증 후 정규화(소문자) 저장. 빈 값은 null(주소 해제).
    if (typeof updates.site_slug === 'string') {
      const validated = validateSlug(updates.site_slug)
      if (!validated.ok) {
        return NextResponse.json({ error: validated.reason }, { status: 400 })
      }
      updates.site_slug = validated.slug
    }

    // site_publish_cadence — 허용값(off/weekly/biweekly)만. NOT NULL 컬럼이라 빈 값/미허용값은 거부.
    if ('site_publish_cadence' in updates) {
      if (!isValidCadence(updates.site_publish_cadence)) {
        return NextResponse.json({ error: '자동발행 주기 값이 올바르지 않습니다.' }, { status: 400 })
      }
    }

    // 넓은 update → 컬럼 없음(42703)이면 최신 마이그 컬럼부터 제거하며 재시도한다.
    // 순서: 044(site_publish_cadence) → 043(site_slug) → 042(채널 3종) → 028(naver)
    const runUpdate = (payload: Record<string, unknown>) =>
      supabase.from('profiles').update(payload).eq('id', user.id)

    const PEEL_GROUPS_NEWEST_FIRST: readonly (readonly string[])[] = [
      ['site_publish_cadence'],
      ['site_slug'],
      CHANNEL_COLS,
      ['naver_blog_url'],
    ]

    let payload = updates
    let { error } = await runUpdate(payload)
    for (const group of PEEL_GROUPS_NEWEST_FIRST) {
      if (!isMissingColumnError(error)) break
      payload = { ...payload }
      for (const col of group) delete payload[col]
      ;({ error } = await runUpdate(payload))
    }

    if (error) {
      // 23505 = unique 위반 — profiles 의 사용자 편집 unique 컬럼은 site_slug 뿐
      if (error.code === '23505') {
        return NextResponse.json({ error: '이미 사용 중인 주소입니다. 다른 주소를 입력해주세요.' }, { status: 409 })
      }
      return NextResponse.json({ error: '프로필 저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

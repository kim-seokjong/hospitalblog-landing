import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/dev/lib/supabase/server'
import { validateSlug } from '@/content/lib/clinic-site/slug'
import { isValidCadence } from '@/content/lib/clinic-site/auto-publish'
import { validateClinicHoursInput } from '@/content/lib/clinic-site/hours'
import { checkCompliance } from '@/content/lib/medical-compliance'

interface ProfileUpdateBody {
  full_name?: string
  phone?: string
  hospital_name?: string
  hospital_address?: string
  /** 병원 대표번호(공개) — 담당자 개인 연락처(phone)와 다른 컬럼이다. */
  hospital_phone?: string
  /** 진료과 — 서브도메인 블로그·JSON-LD 가 표시하는 값(가입 후 수정 가능해야 한다). */
  hospital_type?: string
  /** 진료시간(공개) — 검증·정규화는 clinic-site/hours.ts 가 담당한다. */
  hospital_hours?: unknown
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
//  - +PHONE: +SCHED + hospital_phone(052)
//  - +SCHED: base + naver(028) + 자사 채널(042) + site_slug(043) + site_publish_cadence(044)
//  - +SITE : base + naver(028) + 자사 채널(042) + site_slug(043)
//  - FULL : base + naver_blog_url(028) + 자사 채널(042)
//  - +NAVER: base + naver_blog_url (042 미적용)
//  - BASE : 코어 컬럼만 (028·042 모두 미적용)
const PROFILE_COLS_BASE =
  'full_name, phone, hospital_name, hospital_address, hospital_type, position, specialty, specialty_detail, hospital_desc, hospital_keywords, region, sms_enabled, sms_phone, notify_expiry, notify_usage'
const PROFILE_COLS_WITH_NAVER = `${PROFILE_COLS_BASE}, naver_blog_url`
const PROFILE_COLS_FULL = `${PROFILE_COLS_WITH_NAVER}, instagram_handle, threads_handle, youtube_channel_id`
const PROFILE_COLS_WITH_SITE = `${PROFILE_COLS_FULL}, site_slug`
const PROFILE_COLS_WITH_SCHEDULE = `${PROFILE_COLS_WITH_SITE}, site_publish_cadence`
const PROFILE_COLS_WITH_PHONE = `${PROFILE_COLS_WITH_SCHEDULE}, hospital_phone`
const PROFILE_COLS_WITH_HOURS = `${PROFILE_COLS_WITH_PHONE}, hospital_hours`

// 넓은 것 → 좁은 것 순. 42703(컬럼 없음)이면 다음 후보로 재시도한다.
const SELECT_CANDIDATES: readonly string[] = [
  PROFILE_COLS_WITH_HOURS,
  PROFILE_COLS_WITH_PHONE,
  PROFILE_COLS_WITH_SCHEDULE,
  PROFILE_COLS_WITH_SITE,
  PROFILE_COLS_FULL,
  PROFILE_COLS_WITH_NAVER,
  PROFILE_COLS_BASE,
]

// 저장 시 빈 문자열 → null 로 정규화하는 선택 입력 컬럼.
// ⚠️ hospital_type 은 NOT NULL DEFAULT ''(마이그 014/015)이라 여기에 넣으면 안 된다.
const NULLABLE_TEXT_COLS: readonly (keyof ProfileUpdateBody)[] = [
  'naver_blog_url',
  'instagram_handle',
  'threads_handle',
  'youtube_channel_id',
  'site_slug',
  'hospital_phone',
]

/**
 * 병원 대표번호 형식 — 숫자·하이픈·공백·괄호·+ 만 허용, 숫자 6~15자리.
 * 공개 페이지의 tel: 링크와 JSON-LD telephone 으로 나가는 값이라
 * 임의 문자열이 들어가지 않게 경계에서 막는다.
 */
const HOSPITAL_PHONE_RE = /^[0-9+\-()\s]{6,25}$/

function isValidHospitalPhone(value: string): boolean {
  if (!HOSPITAL_PHONE_RE.test(value)) return false
  const digits = value.replace(/\D/g, '')
  return digits.length >= 6 && digits.length <= 15
}

/** 진료과 표시값 상한 — 화면·스키마에 그대로 나가므로 길이를 제한한다. */
const HOSPITAL_TYPE_MAX_LENGTH = 30

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
      'full_name', 'phone', 'hospital_name', 'hospital_address', 'hospital_phone',
      'hospital_type', 'position',
      'specialty', 'specialty_detail', 'hospital_desc', 'hospital_keywords',
      'region', 'sms_enabled', 'sms_phone', 'notify_expiry', 'notify_usage',
      'naver_blog_url', 'instagram_handle', 'threads_handle', 'youtube_channel_id',
      'site_slug', 'site_publish_cadence', 'hospital_hours',
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

    // hospital_phone — 공개 페이지 tel: 링크·JSON-LD telephone 으로 나가므로 형식 검증.
    if (typeof updates.hospital_phone === 'string' && !isValidHospitalPhone(updates.hospital_phone)) {
      return NextResponse.json(
        { error: '병원 대표번호 형식이 올바르지 않습니다. 예: 02-123-4567' },
        { status: 400 },
      )
    }

    // hospital_type — NOT NULL DEFAULT ''(마이그 014/015). 빈 값은 ''(미설정)으로 저장한다.
    if ('hospital_type' in updates) {
      const raw = updates.hospital_type
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (value.length > HOSPITAL_TYPE_MAX_LENGTH) {
        return NextResponse.json({ error: '진료과는 30자 이하로 입력해주세요.' }, { status: 400 })
      }
      updates.hospital_type = value
    }

    // hospital_hours — 공개 페이지·JSON-LD 로 나가므로 검증된 형태만 저장한다.
    // 형식이 깨진 값은 조용히 버리지 않고 400 으로 돌려준다("저장했는데 사라졌다" 방지).
    if ('hospital_hours' in updates) {
      const validated = validateClinicHoursInput(updates.hospital_hours)
      if (!validated.ok) {
        return NextResponse.json({ error: validated.reason }, { status: 400 })
      }
      updates.hospital_hours = validated.hours
    }

    // hospital_desc — 공개 블로그(홈 · 병원 소개 페이지)에 그대로 나가는 자유 입력이다.
    // 글은 3층 검수를 거치는데 이 문구만 무검수로 공개되면 의료광고법 우회 통로가 된다.
    // 발행 게이트와 같은 선(HIGH/CRITICAL)에서 저장 자체를 막고 사유를 돌려준다.
    if (typeof updates.hospital_desc === 'string' && updates.hospital_desc.trim() !== '') {
      const { violations } = checkCompliance(updates.hospital_desc)
      const blocking = violations.filter(
        (v) => v.severity === 'HIGH' || v.severity === 'CRITICAL',
      )
      if (blocking.length > 0) {
        const words = [...new Set(blocking.map((v) => v.word))].slice(0, 5).join(', ')
        return NextResponse.json(
          {
            error: `병원 소개에 의료광고법 위반 소지 표현이 있습니다: ${words}. 표현을 수정한 뒤 저장해주세요.`,
          },
          { status: 400 },
        )
      }
    }

    // site_publish_cadence — 허용값(off/auto/weekly/biweekly)만. NOT NULL 컬럼이라 빈 값/미허용값은 거부.
    if ('site_publish_cadence' in updates) {
      if (!isValidCadence(updates.site_publish_cadence)) {
        return NextResponse.json({ error: '자동발행 주기 값이 올바르지 않습니다.' }, { status: 400 })
      }
    }

    // ★ 자동발행 'auto' 전환은 기준 시각과 함께 **한 UPDATE 로** 처리한다.
    //
    //   자동발행은 site_auto_publish_since 이후에 만들어진 글만 대상으로 한다
    //   (보관함의 과거 글이 한꺼번에 공개되는 것을 막는 유일한 기준).
    //   두 값을 따로 쓰면 그 사이에 다른 요청이 끼어들어 "cadence 는 auto 인데
    //   기준 시각은 예전 값"인 상태가 만들어진다 — 껐던 기간에 쌓인 글이 전부 공개된다.
    //
    //   조건 `현재 cadence != 'auto'` 가 "새로 켜는 전환"만 골라낸다:
    //    · 전환이면 두 값이 원자적으로 함께 기록된다.
    //    · 이미 auto 면 0행 — 기준 시각을 앞으로 밀지 않는다(그 사이 쓴 글이
    //      제외되면 안 된다. 마이페이지 저장 때마다 전체 프로필이 전송된다).
    //
    //   처리 후에는 cadence 를 아래 메인 update 페이로드에서 제거한다. 남겨 두면
    //   메인 update 가 cadence 만 다시 auto 로 써서, 그 사이 다른 요청이 off 로
    //   바꿔 둔 경우 기준 시각 없이 auto 가 되살아난다.
    if (updates.site_publish_cadence === 'auto') {
      const { error: autoError } = await supabase
        .from('profiles')
        .update({
          site_publish_cadence: 'auto',
          site_auto_publish_since: new Date().toISOString(),
        })
        .eq('id', user.id)
        .neq('site_publish_cadence', 'auto')

      // 가드 컬럼이 없으면(마이그 052 미적용) 자동발행을 켜지 않는다 —
      // 기준 시각 없이 켜면 cron 의 소급 차단 필터가 통째로 꺼져 과거 글이 공개된다.
      // (이 UPDATE 의 컬럼은 둘뿐이라 42703 의 원인이 모호하지 않다.)
      if (isMissingColumnError(autoError)) {
        return NextResponse.json(
          { error: '바로 발행 옵션이 아직 활성화되지 않았습니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 }
        )
      }
      // 23514 = 마이그 048(cadence 'auto' 허용) 미적용
      if (autoError?.code === '23514') {
        return NextResponse.json(
          { error: '바로 발행 옵션이 아직 활성화되지 않았습니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 }
        )
      }
      if (autoError) {
        console.error('[profile] 자동발행 전환 실패:', autoError.message)
        return NextResponse.json(
          { error: '바로 발행 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' },
          { status: 500 }
        )
      }
      delete updates.site_publish_cadence
    }

    // 넓은 update → 컬럼 없음(42703)이면 최신 마이그 컬럼부터 제거하며 재시도한다.
    // 순서: 044(site_publish_cadence) → 043(site_slug) → 042(채널 3종) → 028(naver)
    const runUpdate = (payload: Record<string, unknown>) =>
      supabase.from('profiles').update(payload).eq('id', user.id)

    const PEEL_GROUPS_NEWEST_FIRST: readonly (readonly string[])[] = [
      ['hospital_hours'],
      ['hospital_phone'],
      ['site_publish_cadence'],
      ['site_slug'],
      CHANNEL_COLS,
      ['naver_blog_url'],
    ]

    // 사용자가 실제로 값을 넣어 보낸 신규 공개 컬럼 — 마이그 미적용으로 이 값이
    // 조용히 버려지면 "저장했는데 다시 보니 사라졌다"가 된다(원인을 알 수 없는 실패).
    const droppedRequestedCols: string[] = []

    let payload = updates
    let { error } = await runUpdate(payload)
    for (const group of PEEL_GROUPS_NEWEST_FIRST) {
      if (!isMissingColumnError(error)) break
      payload = { ...payload }
      for (const col of group) {
        if (col in payload && payload[col] !== null && payload[col] !== '') {
          droppedRequestedCols.push(col)
        }
        delete payload[col]
      }
      ;({ error } = await runUpdate(payload))
    }

    if (error) {
      // 23505 = unique 위반 — profiles 의 사용자 편집 unique 컬럼은 site_slug 뿐
      if (error.code === '23505') {
        return NextResponse.json({ error: '이미 사용 중인 주소입니다. 다른 주소를 입력해주세요.' }, { status: 409 })
      }
      // 23514 = check 제약 위반. 마이그 048(cadence 'auto' 허용) 미적용 환경에서
      // 'auto' 를 저장하면 여기로 온다 — 배포가 깨지지 않게 안내 메시지로 폴백한다.
      if (error.code === '23514' && updates.site_publish_cadence === 'auto') {
        return NextResponse.json(
          { error: '바로 발행 옵션이 아직 활성화되지 않았습니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: '프로필 저장 실패' }, { status: 500 })
    }

    // 나머지 필드는 저장됐지만 신규 공개 컬럼이 마이그 미적용으로 버려졌다면
    // 성공이라고만 답하지 않는다 — 화면이 "저장됨"을 띄우면 사용자는 값이 사라진
    // 이유를 영원히 알 수 없다. 저장된 것은 저장된 대로 두고 사실을 함께 알린다.
    if (droppedRequestedCols.length > 0) {
      const LABELS: Record<string, string> = {
        hospital_phone: '병원 대표번호',
        hospital_hours: '진료시간',
        site_publish_cadence: '자동발행 주기',
        site_slug: '블로그 주소',
      }
      const names = droppedRequestedCols.map((col) => LABELS[col] ?? col).join(' · ')
      return NextResponse.json({
        success: true,
        warning: `${names} 항목은 아직 저장할 수 없습니다(기능 준비 중). 나머지 정보는 저장되었습니다.`,
      })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

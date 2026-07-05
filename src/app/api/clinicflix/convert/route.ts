import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { getProfile } from '@/payment/lib/repository'
import { PLANS } from '@/payment/lib/plans'
import type { PlanId } from '@/payment/lib/plans'
import {
  clinicflixConvert,
  ClinicflixUnavailableError,
} from '@/content/lib/clinicflix'
import {
  currentUsageMonth,
  getMonthlyUsage,
  checkQuota,
  recordConversion,
  getRecentConversionTopics,
} from '@/content/lib/clinicflix-usage'
import {
  parseCharacterSelection,
  buildSeriesContext,
} from '@/content/lib/clinicflix-characters'
import { isAdmin } from '@/hr/lib/admin'

export const dynamic = 'force-dynamic'

function getSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
}

const BRAND_COLOR_DEFAULT = '#ff4628'
const MAX_BLOG_TEXT = 20_000

// 서비스가 받는 채널 식별자. shorts = 영상, 나머지 4개 = 멀티채널 세트.
const ALL_CHANNELS = ['shorts', 'cardnews', 'threads', 'feed', 'story'] as const
const NON_VIDEO_CHANNELS = ['cardnews', 'threads', 'feed', 'story'] as const

/**
 * POST /api/clinicflix/convert
 * body: { blog_text: string, channels?: string[] }
 *
 * 흐름: 인증 → 프로필+플랜 로드 → 영상 쿼터 없으면 403(upgrade_required)
 *      → 월간 쿼터 검사 → brand 구성 → ClinicFlix /convert → 매핑 저장 → { job_id, conversion_id }
 *
 * 사용량 "차감"은 여기서 하지 않는다(렌더 미확정). approve 시점에 멱등 차감한다.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const blogText = typeof body?.blog_text === 'string' ? body.blog_text.trim() : ''
    if (!blogText) {
      return NextResponse.json({ error: '변환할 블로그 본문이 없습니다' }, { status: 400 })
    }
    if (blogText.length > MAX_BLOG_TEXT) {
      return NextResponse.json({ error: '본문이 너무 깁니다' }, { status: 400 })
    }
    // 키워드 진입(#2): 선택값. 있으면 서비스 키워드 생성에 사용한다(mode=keyword).
    // blog_text 는 그대로 필수 유지(키워드 단독 진입은 프런트가 keyword 텍스트를 blog_text 로도 보낸다).
    const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
    // 선택된 채널. 누락/빈 배열이면 전체 5개로 취급한다.
    const rawChannels: string[] = Array.isArray(body?.channels)
      ? body.channels.filter((c: unknown): c is string => typeof c === 'string')
      : []
    const requested = rawChannels.filter((c) => (ALL_CHANNELS as readonly string[]).includes(c))
    const channels: string[] = requested.length > 0 ? requested : [...ALL_CHANNELS]

    // 차감 대상 도출: shorts → 영상 1, 비영상 채널 1개 이상 → 멀티채널 세트 1
    const needVideo = channels.includes('shorts')
    const needChannel = channels.some((c) => (NON_VIDEO_CHANNELS as readonly string[]).includes(c))
    if (!needVideo && !needChannel) {
      return NextResponse.json(
        { error: '생성할 채널을 1개 이상 선택해 주세요' },
        { status: 400 },
      )
    }

    const userIsAdmin = isAdmin(user.email)
    const profile = await getProfile(user.id)
    const planId = profile?.plan as PlanId | undefined
    const usageMonth = currentUsageMonth()

    // 관리자는 플랜·쿼터 무관하게 전부 사용 가능(무제한). 그 외에만 플랜/한도 검사.
    if (!userIsAdmin) {
      if (!planId || !PLANS[planId]) {
        return NextResponse.json(
          { error: '구독 플랜을 확인할 수 없습니다' },
          { status: 400 },
        )
      }
      const usage = await getMonthlyUsage(user.id, usageMonth)
      const quota = checkQuota(planId, usage, { needVideo, needChannel })
      if (!quota.ok) {
        // 블로그 전용 플랜 → 업그레이드 유도(403)
        if (quota.reason === 'upgrade_required') {
          return NextResponse.json({ error: 'upgrade_required', message: quota.message }, { status: 403 })
        }
        // 월간 한도 소진 → 429
        return NextResponse.json({ error: quota.reason, message: quota.message }, { status: 429 })
      }
    }

    // 매핑/기록용 플랜값 (관리자가 플랜 없을 수 있으므로 폴백)
    const effectivePlan: PlanId = planId && PLANS[planId] ? planId : 'pro12_pro'

    // ── brand 구성 (프로필 브랜드킷 clinic_* + 사진 보관함 기반) ──
    const clinic = (profile ?? {}) as unknown as {
      hospital_name?: string | null
      clinic_logo_url?: string | null
      clinic_brand_color?: string | null
      clinic_hashtags?: string[] | null
      clinic_voice_gender?: string | null
      clinic_threads_tone?: string | null
      clinic_cardnews_style?: number | null
      clinic_shorts_concept?: string | null
      clinic_doctor_photo_url?: string | null
      clinic_doctor_video_url?: string | null
      clinic_doctor_consent?: boolean | null
      clinic_virtual_presenter_urls?: unknown
      clinicflix_character?: unknown
    }
    const hospitalName = clinic.hospital_name?.trim() || '우리 병원'
    // AI 가상 진행자: 저장된 동일 인물 이미지(들) → 영상 진행자 컷에 재사용(일관성).
    const virtualPresenterUrls = Array.isArray(clinic.clinic_virtual_presenter_urls)
      ? (clinic.clinic_virtual_presenter_urls as unknown[]).filter(
          (u): u is string => typeof u === 'string',
        )
      : []

    // 사진 보관함 로드 (소유자 본인 행). 실패해도 변환은 진행(사진 없이) — 막다른 길 방지.
    let clinicPhotos: { category: string; url: string; consent: boolean; note: string | null }[] = []
    try {
      const { data: photoRows } = await supabase
        .from('clinic_photos')
        .select('category, url, consent, note')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (Array.isArray(photoRows)) {
        clinicPhotos = photoRows as { category: string; url: string; consent: boolean; note: string | null }[]
      }
    } catch {
      clinicPhotos = []
    }

    const concept = clinic.clinic_shorts_concept || '정보형'

    // ── 전속 AI 캐릭터 (선택) — 미선택이면 두 필드 모두 미전송 → 서비스 기존 동작 불변 ──
    // 시리즈 연속성: 최근 변환 3건의 주제를 함께 보내 반복 방지 + 가벼운 콜백을 유도한다.
    const characterPresetId = parseCharacterSelection(clinic.clinicflix_character)
    let seriesContext: string[] = []
    if (characterPresetId) {
      seriesContext = buildSeriesContext(await getRecentConversionTopics(user.id, 3))
    }

    const conversionId = randomUUID()

    let convertRes
    try {
      convertRes = await clinicflixConvert({
        conversion_id: conversionId,
        blog_text: blogText,
        brand: {
          hospital_name: hospitalName,
          brand_color: clinic.clinic_brand_color || BRAND_COLOR_DEFAULT,
          logo_url: clinic.clinic_logo_url || null,
          fixed_hashtags: Array.isArray(clinic.clinic_hashtags) ? clinic.clinic_hashtags : [],
          voice_gender: clinic.clinic_voice_gender || 'female',
          threads_tone: clinic.clinic_threads_tone || 'haeyo',
          cardnews_style:
            typeof clinic.clinic_cardnews_style === 'number' ? clinic.clinic_cardnews_style : 2,
          // 영상 진행자 = AI 가상 진행자(저장본). 실존 원장 사진/영상은 영상 진행자로 미사용.
          virtual_presenter_urls: virtualPresenterUrls,
          // [레거시] 원장 미디어는 카드뉴스 실사용으로만 동의 시 전송 (영상 진행자로는 미사용)
          doctor_photo_url:
            clinic.clinic_doctor_consent === true ? clinic.clinic_doctor_photo_url || null : null,
          doctor_video_url:
            clinic.clinic_doctor_consent === true ? clinic.clinic_doctor_video_url || null : null,
          // 의료진(staff) 사진은 동의된 것만 전송 (외관·장비 등 비-의료진 사진은 동의 불필요)
          photos: clinicPhotos
            .filter((p) => p.category !== 'staff' || p.consent)
            .map((p) => ({
              category: p.category,
              url: p.url,
              consent: p.consent,
              note: p.note,
            })),
        },
        channels,
        concept,
        mode: 'keyword',
        ...(keyword ? { keyword } : {}),
        options: { video_engine: 'veo_fast' },
        // 쇼츠 제작법 v2(사건→궁금증 시퀀스+네이티브 대사, 2026-07-04)가 기본.
        // 문제 시 env CLINICFLIX_RECIPE=v1 으로 즉시 롤백 가능(서비스 v1 경로 보존됨).
        recipe: process.env.CLINICFLIX_RECIPE === 'v1' ? 'v1' : 'v2',
        // 전속 캐릭터 미선택 시 두 필드 모두 미전송 (파이프라인 하위 호환과 맞물림)
        ...(characterPresetId ? { character: { preset_id: characterPresetId } } : {}),
        ...(characterPresetId && seriesContext.length > 0
          ? { series_context: seriesContext }
          : {}),
      })
    } catch (e) {
      if (e instanceof ClinicflixUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: 503 })
      }
      const msg = e instanceof Error ? e.message : '멀티채널 변환 요청에 실패했습니다'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // 매핑 저장 (소유자 검증 + approve 멱등 차감용). 저장 실패하면 approve(승인)가 불가하므로
    // 조용히 진행하지 않고 즉시 명확히 실패시킨다(막다른 길 방지). 보통 마이그레이션 미적용이 원인.
    try {
      await recordConversion({
        conversionId,
        userId: user.id,
        jobId: convertRes.job_id,
        plan: effectivePlan,
        usageMonth,
        status: convertRes.status,
        consumeVideo: needVideo,
        consumeChannel: needChannel,
        // 에피소드 주제 1차 기록 (키워드) — approve 시 기획 topic 으로 갱신된다 (best-effort)
        topic: keyword || null,
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : '변환 기록 저장 실패'
      return NextResponse.json(
        { error: `변환 준비에 실패했습니다. 잠시 후 다시 시도해 주세요. (${detail})` },
        { status: 500 },
      )
    }

    return NextResponse.json({
      job_id: convertRes.job_id,
      conversion_id: conversionId,
      status: convertRes.status,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

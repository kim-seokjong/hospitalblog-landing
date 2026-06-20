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
} from '@/content/lib/clinicflix-usage'
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

    // ── brand 구성 (프로필 기반, MVP: 사진/로고/원장 미디어는 비움) ──
    const hospitalName =
      (profile as unknown as { hospital_name?: string | null })?.hospital_name?.trim() || '우리 병원'

    const conversionId = randomUUID()

    let convertRes
    try {
      convertRes = await clinicflixConvert({
        conversion_id: conversionId,
        blog_text: blogText,
        brand: {
          hospital_name: hospitalName,
          brand_color: BRAND_COLOR_DEFAULT,
          logo_url: null,
          doctor_photo_url: null,
          doctor_video_url: null,
          photos: [],
        },
        channels,
        concept: '정보형',
        mode: 'keyword',
        options: { video_engine: 'veo_fast' },
      })
    } catch (e) {
      if (e instanceof ClinicflixUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: 503 })
      }
      const msg = e instanceof Error ? e.message : '멀티채널 변환 요청에 실패했습니다'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // 매핑 저장 (소유자 검증 + approve 멱등 차감용). 실패해도 변환 자체는 진행됐으므로 로그성 처리.
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
      })
    } catch {
      // 매핑 저장 실패 시에도 job_id 는 반환한다(폴링은 가능). 차감은 매핑이 없으면 막힌다(안전).
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

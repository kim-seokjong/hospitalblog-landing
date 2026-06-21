// ClinicFlix 멀티채널 변환 — 사용량/쿼터 가드 (서버 전용).
//
// 한도 단일 소스 = src/payment/lib/plans.ts (limits.video / limits.channels / fairUseCap).
// 이 모듈은 plans.ts 를 읽기만 한다 (수정 금지).
//
// 사용량 카운터는 supabase clinicflix_usage 테이블(월간) 에 보관한다.
// 차감(증가)은 approve 시점에 RPC(clinicflix_commit_usage)로 멱등 처리한다.

import { createClient } from '@supabase/supabase-js'
import { PLANS } from '@/payment/lib/plans'
import type { PlanId } from '@/payment/lib/plans'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

/** KST(UTC+9) 기준 현재 월 'YYYY-MM'. 결제/사용량 리셋과 동일하게 월 단위. */
export function currentUsageMonth(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export interface UsageRow {
  video_used: number
  channel_used: number
}

/** 해당 월의 사용량 (행 없으면 0). */
export async function getMonthlyUsage(
  userId: string,
  usageMonth: string,
): Promise<UsageRow> {
  const { data } = await admin()
    .from('clinicflix_usage')
    .select('video_used, channel_used')
    .eq('user_id', userId)
    .eq('usage_month', usageMonth)
    .maybeSingle()
  return {
    video_used: data?.video_used ?? 0,
    channel_used: data?.channel_used ?? 0,
  }
}

export type QuotaCheck =
  | { ok: true }
  | { ok: false; reason: 'upgrade_required' | 'video_limit' | 'channel_limit'; message: string }

/** checkQuota 옵션: 이번 변환에서 어떤 쿼터를 실제로 차감하는지. 기본값 둘 다 true(하위호환). */
export interface QuotaNeed {
  needVideo?: boolean
  needChannel?: boolean
}

/**
 * 변환 가능 여부 판정.
 *  - limits.video <= 0 (블로그 전용 플랜) → 영상·멀티채널 둘 다 미포함 → upgrade_required
 *    (needVideo 또는 needChannel 중 하나라도 요청했는데 플랜이 영상/채널 자체를 미포함하면 업그레이드 유도)
 *  - needVideo 일 때만 영상 한도(video_used >= limits.video, 무제한 -1 제외)를 video_limit 으로 판정
 *  - needChannel 일 때만 채널 한도(-1 이면 fairUseCap 소프트캡, 아니면 limits.channels 하드캡)를 channel_limit 으로 판정
 *
 * 즉, 영상을 만들지 않으면 영상 쿼터로 막지 않고, 비영상 채널을 만들지 않으면 채널 쿼터로 막지 않는다.
 */
export function checkQuota(planId: PlanId, usage: UsageRow, opts: QuotaNeed = {}): QuotaCheck {
  const needVideo = opts.needVideo ?? true
  const needChannel = opts.needChannel ?? true

  const plan = PLANS[planId]
  if (!plan) {
    return { ok: false, reason: 'upgrade_required', message: '플랜 정보를 확인할 수 없습니다.' }
  }

  const videoLimit = plan.limits.video

  // 블로그 전용 플랜(limits.video <= 0)은 영상도 멀티채널도 없다 → 무엇을 요청하든 업그레이드 유도.
  if ((needVideo || needChannel) && videoLimit <= 0) {
    return {
      ok: false,
      reason: 'upgrade_required',
      message: '올인원 플랜으로 업그레이드하면 영상·멀티채널을 만들 수 있어요.',
    }
  }

  // 영상 한도 (-1 = 무제한). 영상을 만들 때만 검사.
  if (needVideo && videoLimit !== -1 && usage.video_used >= videoLimit) {
    return {
      ok: false,
      reason: 'video_limit',
      message: `이번 달 영상 생성 한도(${videoLimit}건)를 모두 사용했습니다. 다음 달에 초기화됩니다.`,
    }
  }

  // 채널 한도: -1 이면 fairUseCap(공정사용 소프트캡), 아니면 limits.channels 하드캡. 비영상 채널을 만들 때만 검사.
  if (needChannel) {
    const channelLimit = plan.limits.channels
    const effectiveChannelCap =
      channelLimit === -1 ? (plan.fairUseCap ?? Number.POSITIVE_INFINITY) : channelLimit
    if (usage.channel_used >= effectiveChannelCap) {
      return {
        ok: false,
        reason: 'channel_limit',
        message:
          channelLimit === -1
            ? `이번 달 공정사용 한도(${plan.fairUseCap}세트)에 도달했습니다. 다음 달에 초기화됩니다.`
            : `이번 달 멀티채널 세트 한도(${channelLimit}세트)를 모두 사용했습니다. 다음 달에 초기화됩니다.`,
      }
    }
  }

  return { ok: true }
}

/** UI 표시용 남은 쿼터 요약. -1 = 무제한. */
export function remainingSummary(planId: PlanId, usage: UsageRow) {
  const plan = PLANS[planId]
  const videoLimit = plan?.limits.video ?? 0
  const channelLimit = plan?.limits.channels ?? 0
  const channelCap = channelLimit === -1 ? (plan?.fairUseCap ?? -1) : channelLimit
  return {
    video: {
      used: usage.video_used,
      limit: videoLimit, // -1 = 무제한
    },
    channel: {
      used: usage.channel_used,
      limit: channelLimit, // -1 = 무제한
      softCap: channelLimit === -1 ? (plan?.fairUseCap ?? null) : null,
      cap: channelCap, // 실효 상한 (소프트캡 포함). -1 = 진짜 무제한(soft cap 없음)
    },
  }
}

/**
 * conversion_id ↔ user 매핑 생성.
 * consumeVideo / consumeChannel 은 이 변환이 approve 시 어떤 쿼터를 차감할지 결정한다(RPC 가 읽음).
 */
export async function recordConversion(params: {
  conversionId: string
  userId: string
  jobId: string
  plan: PlanId
  usageMonth: string
  status: string
  consumeVideo: boolean
  consumeChannel: boolean
}): Promise<void> {
  const { error } = await admin()
    .from('clinicflix_conversions')
    .insert({
      conversion_id: params.conversionId,
      user_id: params.userId,
      job_id: params.jobId,
      plan: params.plan,
      usage_month: params.usageMonth,
      status: params.status,
      consume_video: params.consumeVideo,
      consume_channel: params.consumeChannel,
    })
  if (error) throw new Error(`변환 기록 저장 실패: ${error.message}`)
}

/** job_id 로 변환 소유자 검증용 조회. */
export async function getConversionByJobId(jobId: string): Promise<{
  conversion_id: string
  user_id: string
} | null> {
  const { data } = await admin()
    .from('clinicflix_conversions')
    .select('conversion_id, user_id')
    .eq('job_id', jobId)
    .maybeSingle()
  return data ?? null
}

/** approve 시점 멱등 사용량 차감 (RPC 위임). */
export async function commitUsage(
  conversionId: string,
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await admin().rpc('clinicflix_commit_usage', {
    p_conversion_id: conversionId,
    p_user_id: userId,
  })
  if (error) throw new Error(`사용량 차감 실패: ${error.message}`)
  const result = data as { ok: boolean; reason?: string } | null
  return result ?? { ok: false, reason: 'unknown' }
}

export interface ResultAssets {
  video_url?: string | null
  cardnews_urls?: string[]
  story_urls?: string[]
  threads?: unknown
  feed?: unknown
}

export interface ConversionRow {
  conversion_id: string
  job_id: string | null
  plan: string
  usage_month: string
  status: string | null
  consume_video: boolean
  consume_channel: boolean
  usage_committed: boolean
  created_at: string
  result_assets: ResultAssets | null
  result_saved_at: string | null
}

/** 회원의 최근 변환 기록 (최신순). */
export async function getConversionsByUser(userId: string, limit = 50): Promise<ConversionRow[]> {
  const { data } = await admin()
    .from('clinicflix_conversions')
    .select('conversion_id, job_id, plan, usage_month, status, consume_video, consume_channel, usage_committed, created_at, result_assets, result_saved_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as ConversionRow[]
}

/** 결과 저장 대상 조회 (소유자·멱등 판정용). */
export async function getConversionSaveTarget(
  jobId: string,
): Promise<{ conversion_id: string; user_id: string; result_saved_at: string | null } | null> {
  const { data } = await admin()
    .from('clinicflix_conversions')
    .select('conversion_id, user_id, result_saved_at')
    .eq('job_id', jobId)
    .maybeSingle()
  return data ?? null
}

/** 영구 저장 결과(jsonb) 기록 + result_saved_at 설정. */
export async function saveConversionResult(
  conversionId: string,
  resultAssets: ResultAssets,
): Promise<void> {
  const { error } = await admin()
    .from('clinicflix_conversions')
    .update({
      result_assets: resultAssets,
      result_saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('conversion_id', conversionId)
  if (error) throw new Error(`결과 저장 실패: ${error.message}`)
}

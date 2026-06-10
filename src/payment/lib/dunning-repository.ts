// Cron 일괄 처리 전용 빌링키 조회/업데이트 헬퍼

import { createClient } from '@supabase/supabase-js'
import type { BillingKey } from './types'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export interface BillingKeyWithDunning extends BillingKey {
  last_charge_attempt_at: string | null
  last_charge_status: 'SUCCESS' | 'FAILED' | null
  failure_count: number
  notify_sent_at: string | null
}

// 결제 7일 후 예정인 ACTIVE 빌링키 (오늘 사전고지 발송 대상)
// notify_sent_at 이 next_billing_at 7일 전 이후로 비어있는 것만
export async function findKeysForBillingNotify(now: Date): Promise<BillingKeyWithDunning[]> {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() + 7)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('status', 'ACTIVE')
    .gte('next_billing_at', start.toISOString())
    .lt('next_billing_at', end.toISOString())
    .or(`notify_sent_at.is.null,notify_sent_at.lt.${start.toISOString()}`)
  if (error) throw new Error(`조회 실패(notify): ${error.message}`)
  return (data ?? []) as BillingKeyWithDunning[]
}

// 오늘이 결제일인 ACTIVE 빌링키 + 아직 시도 안 했거나 마지막 시도가 어제 이전
export async function findKeysForCharge(now: Date): Promise<BillingKeyWithDunning[]> {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('status', 'ACTIVE')
    .gte('next_billing_at', start.toISOString())
    .lt('next_billing_at', end.toISOString())
    .or(`last_charge_attempt_at.is.null,last_charge_attempt_at.lt.${start.toISOString()}`)
  if (error) throw new Error(`조회 실패(charge): ${error.message}`)
  return (data ?? []) as BillingKeyWithDunning[]
}

// 1차 결제 실패 후 3일 경과 + failure_count 1 + 오늘 재시도 안 한 ACTIVE 빌링키
export async function findKeysForRetry(now: Date): Promise<BillingKeyWithDunning[]> {
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const threeDaysAgo = new Date(todayStart)
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 2) // 마지막 시도가 3일 전(오늘 -2일 23:59 이전)이면 재시도
  const retryCutoff = new Date(todayStart)
  retryCutoff.setUTCDate(retryCutoff.getUTCDate() - 3)

  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('status', 'ACTIVE')
    .eq('last_charge_status', 'FAILED')
    .eq('failure_count', 1)
    .lt('last_charge_attempt_at', retryCutoff.toISOString())
  if (error) throw new Error(`조회 실패(retry): ${error.message}`)
  return (data ?? []) as BillingKeyWithDunning[]
}

// 재시도(failure_count=2) 후 7일 경과한 ACTIVE 빌링키 → 자동 해지
export async function findKeysForCancel(now: Date): Promise<BillingKeyWithDunning[]> {
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const cancelCutoff = new Date(todayStart)
  cancelCutoff.setUTCDate(cancelCutoff.getUTCDate() - 7)

  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('status', 'ACTIVE')
    .eq('last_charge_status', 'FAILED')
    .gte('failure_count', 2)
    .lt('last_charge_attempt_at', cancelCutoff.toISOString())
  if (error) throw new Error(`조회 실패(cancel): ${error.message}`)
  return (data ?? []) as BillingKeyWithDunning[]
}

export async function markNotifySent(billingKeyId: string, sentAt: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ notify_sent_at: sentAt, updated_at: new Date().toISOString() })
    .eq('id', billingKeyId)
}

export async function recordChargeAttempt(params: {
  billingKeyId: string
  status: 'SUCCESS' | 'FAILED'
  attemptedAt: string
  resetFailureCount?: boolean // true면 0으로, false면 +1
  nextBillingAt?: string // SUCCESS 시 다음달로
}): Promise<void> {
  const update: Record<string, unknown> = {
    last_charge_attempt_at: params.attemptedAt,
    last_charge_status: params.status,
    updated_at: new Date().toISOString(),
  }
  if (params.resetFailureCount) {
    update.failure_count = 0
  }
  if (params.nextBillingAt) {
    update.next_billing_at = params.nextBillingAt
    update.notify_sent_at = null // 다음 사이클 사전고지 재발송 가능하도록
  }

  await getAdmin().from('billing_keys').update(update).eq('id', params.billingKeyId)

  // failure_count는 원자적 RPC로 별도 증가 (race condition 방지)
  if (params.status === 'FAILED' && !params.resetFailureCount) {
    await getAdmin().rpc('increment_billing_failure_count', { p_key_id: params.billingKeyId })
  }
}

export async function cancelBillingKey(billingKeyId: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', billingKeyId)
}

import { createClient } from '@supabase/supabase-js'
import type { Payment, PaymentStatus, Profile, BillingKey } from './types'
import type { PlanId } from './plans'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function createPendingPayment(params: {
  id: string
  userId: string
  plan: PlanId
  amount: number
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .insert({
      id: params.id,
      user_id: params.userId,
      plan: params.plan,
      amount: params.amount,
      status: 'PENDING',
    })
  if (error) throw new Error(`결제 레코드 생성 실패: ${error.message}`)
}

export async function findPaymentById(paymentId: string): Promise<Payment | null> {
  const { data, error } = await getAdmin()
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .single()
  if (error) return null
  return data as Payment
}

export async function markPaymentPaid(params: {
  paymentId: string
  pgTxId: string
  pgProvider: string
  paymentMethod: string
  cardName: string | null
  receiptUrl: string | null
  paidAt: string
  rawResponse: unknown
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .update({
      status: 'PAID',
      pg_tx_id: params.pgTxId,
      pg_provider: params.pgProvider,
      payment_method: params.paymentMethod,
      card_name: params.cardName,
      receipt_url: params.receiptUrl,
      paid_at: params.paidAt,
      raw_response: params.rawResponse,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
  if (error) throw new Error(`결제 PAID 업데이트 실패: ${error.message}`)
}

export async function markPaymentFailed(paymentId: string, reason: string): Promise<void> {
  await getAdmin()
    .from('payments')
    .update({ status: 'FAILED', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', paymentId)
}

export async function markPaymentCancelled(params: {
  paymentId: string
  cancellationId: string | null
  cancelledAt: string
  reason: string | null
}): Promise<void> {
  const { error } = await getAdmin()
    .from('payments')
    .update({
      status: 'CANCELLED',
      cancellation_id: params.cancellationId,
      cancelled_at: params.cancelledAt,
      cancel_reason: params.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId)
  if (error) throw new Error(`결제 CANCELLED 업데이트 실패: ${error.message}`)
}

export async function expireUserPlan(userId: string): Promise<void> {
  const { error } = await getAdmin()
    .from('profiles')
    .update({
      plan_expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(`플랜 만료 처리 실패: ${error.message}`)
}

export async function cancelActiveBillingKeys(userId: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
}

export async function activateUserPlan(params: {
  userId: string
  plan: PlanId
  expiresAt: string
}): Promise<void> {
  const { error } = await getAdmin()
    .from('profiles')
    .upsert({
      id: params.userId,
      plan: params.plan,
      plan_started_at: new Date().toISOString(),
      plan_expires_at: params.expiresAt,
      usage_count: 0,
      usage_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(`플랜 활성화 실패: ${error.message}`)
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getAdmin()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data as Profile
}

export async function incrementUsage(userId: string): Promise<void> {
  const { error } = await getAdmin().rpc('increment_usage', { user_id: userId })
  if (error) {
    // fallback: 직접 업데이트
    await getAdmin()
      .from('profiles')
      .update({ usage_count: getAdmin().rpc('coalesce_usage', {}) })
      .eq('id', userId)
  }
}

export async function getUserPayments(userId: string): Promise<Payment[]> {
  const { data, error } = await getAdmin()
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data as Payment[]
}

// ── 빌링키 ──────────────────────────────────────────────

export async function createBillingKey(params: {
  userId: string
  billingKey: string
  plan: PlanId
  cardName: string | null
  cardLast4: string | null
  nextBillingAt: string
}): Promise<void> {
  // 기존 활성 빌링키 비활성화
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .eq('status', 'ACTIVE')

  const { error } = await getAdmin()
    .from('billing_keys')
    .insert({
      user_id: params.userId,
      billing_key: params.billingKey,
      plan: params.plan,
      card_name: params.cardName,
      card_last4: params.cardLast4,
      status: 'ACTIVE',
      next_billing_at: params.nextBillingAt,
    })
  if (error) throw new Error(`빌링키 저장 실패: ${error.message}`)
}

export async function getActiveBillingKey(userId: string): Promise<BillingKey | null> {
  const { data, error } = await getAdmin()
    .from('billing_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error) return null
  return data as BillingKey
}

export async function cancelBillingKeyById(billingKeyId: string): Promise<void> {
  await getAdmin()
    .from('billing_keys')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', billingKeyId)
}

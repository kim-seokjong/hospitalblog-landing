import type { PlanId } from './plans'

export type BillingKeyStatus = 'ACTIVE' | 'CANCELLED'

export interface BillingKey {
  id: string
  user_id: string
  billing_key: string
  plan: PlanId
  card_name: string | null
  card_last4: string | null
  status: BillingKeyStatus
  next_billing_at: string | null
  created_at: string
  updated_at: string
}

export interface BillingConfirmResponse {
  success: boolean
  plan: PlanId
  expiresAt: string
  billingKey: string
  receiptUrl: string | null
}

export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'VIRTUAL_ACCOUNT_ISSUED'

export interface Payment {
  id: string
  user_id: string
  plan: PlanId
  amount: number
  currency: string
  status: PaymentStatus
  pg_provider: string | null
  pg_tx_id: string | null
  payment_method: string | null
  card_name: string | null
  receipt_url: string | null
  failure_reason: string | null
  paid_at: string | null
  cancellation_id: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  email: string | null
  plan: PlanId
  plan_started_at: string | null
  plan_expires_at: string | null
  usage_count: number
  usage_reset_at: string | null
}

// 포트원 V2 REST API 결제 조회 응답 (필요 필드만)
export interface PortOnePayment {
  id: string
  transactionId: string
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'PARTIAL_CANCELLED' | 'VIRTUAL_ACCOUNT_ISSUED'
  amount: { total: number; currency: string }
  method?: {
    type: string
    card?: { name: string; number: string }
  }
  pgProvider: string
  receiptUrl?: string
  paidAt?: string
  failedAt?: string
  cancelledAt?: string
  customData?: string
}

export interface PrepareResponse {
  paymentId: string
  amount: number
  orderName: string
  channelKey: string
  customer: { email: string }
}

export interface ConfirmResponse {
  success: boolean
  plan: PlanId
  expiresAt: string
  receiptUrl: string | null
}

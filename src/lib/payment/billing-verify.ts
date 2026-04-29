import { getPayment } from './portone-client'
import {
  findPaymentById,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
  createBillingKey,
} from './repository'
import { PLANS } from './plans'
import type { PlanId } from './plans'
import type { BillingConfirmResponse } from './types'

export async function verifyBillingAndActivate(params: {
  paymentId: string
  billingKey: string
  cardName?: string | null
  cardLast4?: string | null
}): Promise<BillingConfirmResponse> {
  const dbPayment = await findPaymentById(params.paymentId)
  if (!dbPayment) throw new Error('결제 레코드를 찾을 수 없습니다')

  // 이미 처리된 결제 — 멱등 반환
  if (dbPayment.status === 'PAID') {
    const expiresAt = addOneMonth(dbPayment.paid_at ?? new Date().toISOString())
    return {
      success: true,
      plan: dbPayment.plan,
      expiresAt,
      billingKey: params.billingKey,
      receiptUrl: dbPayment.receipt_url,
    }
  }

  const pgPayment = await getPayment(params.paymentId)

  if (pgPayment.status !== 'PAID') {
    await markPaymentFailed(params.paymentId, `포트원 상태: ${pgPayment.status}`)
    throw new Error(`결제가 완료되지 않았습니다 (상태: ${pgPayment.status})`)
  }

  const expectedAmount = PLANS[dbPayment.plan as PlanId].price
  const actualAmount = pgPayment.amount.total
  if (actualAmount !== expectedAmount) {
    await markPaymentFailed(
      params.paymentId,
      `금액 불일치: 예상 ${expectedAmount}, 실제 ${actualAmount}`,
    )
    throw new Error('결제 금액이 일치하지 않습니다')
  }

  const paidAt = pgPayment.paidAt ?? new Date().toISOString()
  const expiresAt = addOneMonth(paidAt)

  await markPaymentPaid({
    paymentId: params.paymentId,
    pgTxId: pgPayment.transactionId,
    pgProvider: pgPayment.pgProvider,
    paymentMethod: pgPayment.method?.type ?? 'CARD',
    cardName: pgPayment.method?.card?.name ?? params.cardName ?? null,
    receiptUrl: pgPayment.receiptUrl ?? null,
    paidAt,
    rawResponse: {
      id: pgPayment.id,
      status: pgPayment.status,
      pgProvider: pgPayment.pgProvider,
      amount: pgPayment.amount,
      paidAt: pgPayment.paidAt,
    },
  })

  await activateUserPlan({
    userId: dbPayment.user_id,
    plan: dbPayment.plan,
    expiresAt,
  })

  await createBillingKey({
    userId: dbPayment.user_id,
    billingKey: params.billingKey,
    plan: dbPayment.plan,
    cardName: pgPayment.method?.card?.name ?? params.cardName ?? null,
    cardLast4: params.cardLast4 ?? null,
    nextBillingAt: expiresAt,
  })

  return {
    success: true,
    plan: dbPayment.plan,
    expiresAt,
    billingKey: params.billingKey,
    receiptUrl: pgPayment.receiptUrl ?? null,
  }
}

function addOneMonth(isoDate: string): string {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

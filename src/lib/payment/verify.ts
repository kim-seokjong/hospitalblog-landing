import { getPayment } from './portone-client'
import {
  findPaymentById,
  markPaymentPaid,
  markPaymentFailed,
  activateUserPlan,
} from './repository'
import { PLANS } from './plans'
import type { PlanId } from './plans'
import type { ConfirmResponse } from './types'

// 결제 검증 후 플랜 활성화 (멱등: 이미 PAID면 즉시 반환)
export async function verifyAndActivate(paymentId: string): Promise<ConfirmResponse> {
  const dbPayment = await findPaymentById(paymentId)
  if (!dbPayment) throw new Error('결제 레코드를 찾을 수 없습니다')

  // 이미 처리된 결제 — 멱등 반환
  if (dbPayment.status === 'PAID') {
    const expiresAt = addOneMonth(dbPayment.paid_at ?? new Date().toISOString())
    return {
      success: true,
      plan: dbPayment.plan,
      expiresAt,
      receiptUrl: dbPayment.receipt_url,
    }
  }

  // 포트원에서 실제 결제 상태 조회
  const pgPayment = await getPayment(paymentId)

  if (pgPayment.status !== 'PAID') {
    await markPaymentFailed(paymentId, `포트원 상태: ${pgPayment.status}`)
    throw new Error(`결제가 완료되지 않았습니다 (상태: ${pgPayment.status})`)
  }

  // 금액 검증 — 서버 DB 기준 금액과 포트원 응답 금액 일치 확인
  const expectedAmount = PLANS[dbPayment.plan as PlanId].price
  const actualAmount = pgPayment.amount.total
  if (actualAmount !== expectedAmount) {
    await markPaymentFailed(paymentId, `금액 불일치: 예상 ${expectedAmount}, 실제 ${actualAmount}`)
    throw new Error('결제 금액이 일치하지 않습니다')
  }

  const paidAt = pgPayment.paidAt ?? new Date().toISOString()
  const expiresAt = addOneMonth(paidAt)

  await markPaymentPaid({
    paymentId,
    pgTxId: pgPayment.transactionId,
    pgProvider: pgPayment.pgProvider,
    paymentMethod: pgPayment.method?.type ?? 'CARD',
    cardName: pgPayment.method?.card?.name ?? null,
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

  return {
    success: true,
    plan: dbPayment.plan,
    expiresAt,
    receiptUrl: pgPayment.receiptUrl ?? null,
  }
}

function addOneMonth(isoDate: string): string {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

const PORTONE_API_BASE = 'https://api.portone.io'

function getSecret(): string {
  const secret = process.env.PORTONE_API_SECRET
  if (!secret) throw new Error('PORTONE_API_SECRET 환경변수가 설정되지 않았습니다')
  return secret
}

function getStoreId(): string {
  const id = process.env.NEXT_PUBLIC_PORTONE_STORE_ID
  if (!id) throw new Error('NEXT_PUBLIC_PORTONE_STORE_ID 환경변수가 설정되지 않았습니다')
  return id
}

export interface ChargeResult {
  status: string
  transactionId: string
  pgProvider: string
  receiptUrl: string | null
  paidAt: string | null
  cardName: string | null
}

export async function chargeWithBillingKey(params: {
  paymentId: string
  billingKey: string
  orderName: string
  amount: number
  customerId: string
  customerEmail: string
  customerPhone?: string
}): Promise<ChargeResult> {
  const customer: Record<string, unknown> = {
    id: params.customerId,
    email: params.customerEmail,
  }
  if (params.customerPhone) {
    customer.phoneNumber = params.customerPhone
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(params.paymentId)}/billing-key`,
    {
      method: 'POST',
      headers: {
        Authorization: `PortOne ${getSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storeId: getStoreId(),
        billingKey: params.billingKey,
        orderName: params.orderName,
        amount: { total: params.amount },
        currency: 'KRW',
        customer,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`포트원 빌링키 결제 실패 [${res.status}]: ${body}`)
  }
  const data = await res.json()
  const payment = (data?.payment ?? data) as Record<string, unknown>
  const method = payment.method as { card?: { name?: string } } | undefined
  const channel = payment.channel as { pgProvider?: string } | undefined
  return {
    status: (payment.status as string) ?? 'PAID',
    transactionId: (payment.transactionId as string) ?? (payment.pgTxId as string) ?? params.paymentId,
    pgProvider: channel?.pgProvider ?? (payment.pgProvider as string) ?? 'KPN',
    receiptUrl: (payment.receiptUrl as string) ?? null,
    paidAt: (payment.paidAt as string) ?? new Date().toISOString(),
    cardName: method?.card?.name ?? null,
  }
}

export async function deleteBillingKey(billingKey: string): Promise<void> {
  const res = await fetch(
    `${PORTONE_API_BASE}/billing-keys/${encodeURIComponent(billingKey)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `PortOne ${getSecret()}` },
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`포트원 빌링키 삭제 실패 [${res.status}]: ${body}`)
  }
}

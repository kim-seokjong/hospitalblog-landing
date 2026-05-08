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
  customerEmail: string
}): Promise<ChargeResult> {
  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(params.paymentId)}/instant`,
    {
      method: 'POST',
      headers: {
        Authorization: `PortOne ${getSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        storeId: getStoreId(),
        orderName: params.orderName,
        amount: { total: params.amount },
        currency: 'KRW',
        customer: { email: params.customerEmail },
        method: {
          card: {
            credential: {
              billingKey: params.billingKey,
            },
          },
        },
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`포트원 빌링키 결제 실패 [${res.status}]: ${body}`)
  }
  const data = await res.json()
  return {
    status: data.status,
    transactionId: data.transactionId ?? data.pgTxId ?? params.paymentId,
    pgProvider: data.pgProvider ?? 'UNKNOWN',
    receiptUrl: data.receiptUrl ?? null,
    paidAt: data.paidAt ?? null,
    cardName: data.method?.card?.name ?? null,
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

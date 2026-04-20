import type { PortOnePayment } from './types'

const PORTONE_API_BASE = 'https://api.portone.io'

function getSecret(): string {
  const secret = process.env.PORTONE_API_SECRET
  if (!secret) throw new Error('PORTONE_API_SECRET 환경변수가 설정되지 않았습니다')
  return secret
}

export async function getPayment(paymentId: string): Promise<PortOnePayment> {
  const res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `PortOne ${getSecret()}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`포트원 결제 조회 실패 [${res.status}]: ${body}`)
  }
  return res.json()
}

export async function cancelPayment(
  paymentId: string,
  reason: string,
  amount?: number,
): Promise<void> {
  const body: Record<string, unknown> = { reason }
  if (amount !== undefined) body.amount = amount

  const res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `PortOne ${getSecret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`포트원 결제 취소 실패 [${res.status}]: ${text}`)
  }
}

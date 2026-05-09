// 포트원 Standard Webhooks 서명 검증 (HMAC-SHA256)
export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
): Promise<boolean> {
  const secret = process.env.PORTONE_WEBHOOK_SECRET
  if (!secret) return false

  const webhookId        = headers.get('webhook-id') ?? ''
  const webhookTimestamp = headers.get('webhook-timestamp') ?? ''
  const webhookSignature = headers.get('webhook-signature') ?? ''

  if (!webhookId || !webhookTimestamp || !webhookSignature) return false

  // 타임스탬프 5분 이내만 허용
  const ts = parseInt(webhookTimestamp, 10)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 300) return false

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`

  // 'whsec_' 접두사 제거 후 base64 디코딩 (Standard Webhooks 스펙)
  const base64Secret = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let rawSecret: Uint8Array
  try {
    rawSecret = Uint8Array.from(atob(base64Secret), (c) => c.charCodeAt(0))
  } catch {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw',
    rawSecret.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)))

  // webhook-signature 헤더에 "v1,<base64>" 형식으로 복수 포함 가능
  const signatures = webhookSignature.split(' ')
  return signatures.some((s) => {
    const [, value] = s.split(',')
    return value === computed
  })
}

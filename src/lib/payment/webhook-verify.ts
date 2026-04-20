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
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
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

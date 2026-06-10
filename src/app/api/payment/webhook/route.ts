export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyWebhookSignature } from '@/payment/lib/webhook-verify'
import { verifyAndActivate, cancelAndDeactivate } from '@/payment/lib/verify'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // 서명 검증
  const valid = await verifyWebhookSignature(rawBody, req.headers)
  if (!valid) {
    return NextResponse.json({ error: '서명 검증 실패' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 })
  }

  const eventType = payload.type as string
  const paymentId = (payload.data as Record<string, unknown>)?.paymentId as string | undefined
  const signature = req.headers.get('webhook-signature') ?? ''

  // 멱등 처리 — 동일 이벤트 중복 수신 차단
  const admin = getAdmin()
  const { data: upsertData, error: upsertError } = await admin.from('webhook_events').upsert(
    {
      provider: 'portone',
      event_type: eventType,
      payment_id: paymentId ?? null,
      signature,
      payload,
      processed: false,
    },
    { onConflict: 'provider,event_type,payment_id,signature', ignoreDuplicates: true },
  ).select('id')

  if (upsertError && upsertError.code !== '23505') {
    console.error('webhook_events upsert error:', upsertError)
  }

  // BUG-03: ignoreDuplicates=true 에서 중복이면 data가 빈 배열 → 이미 처리됐으므로 재처리 방지
  if (!upsertError && (!upsertData || upsertData.length === 0)) {
    return NextResponse.json({ ok: true })
  }

  // Transaction.Paid — 결제 활성화
  if (eventType === 'Transaction.Paid' && paymentId) {
    try {
      await verifyAndActivate(paymentId)
      await admin
        .from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .match({ provider: 'portone', event_type: eventType, payment_id: paymentId, signature })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await admin
        .from('webhook_events')
        .update({ error: msg })
        .match({ provider: 'portone', event_type: eventType, payment_id: paymentId, signature })
      console.error('webhook verifyAndActivate error:', msg)
    }
  }

  // Transaction.Cancelled / PartialCancelled — 결제 취소·환불 처리
  // 포트원 V2 웹훅: data.cancellationId 포함 (PartialCancelled도 동일 경로로 처리해
  // 사용자 플랜은 즉시 만료시킨다. SaaS 단건 구독 모델에서는 부분 환불도 사실상
  // 서비스 종료로 간주한다.)
  if (
    (eventType === 'Transaction.Cancelled' || eventType === 'Transaction.PartialCancelled') &&
    paymentId
  ) {
    try {
      const data = (payload.data ?? {}) as Record<string, unknown>
      const cancellationId =
        typeof data.cancellationId === 'string' ? data.cancellationId : null
      await cancelAndDeactivate(paymentId, { cancellationId })
      await admin
        .from('webhook_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .match({ provider: 'portone', event_type: eventType, payment_id: paymentId, signature })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await admin
        .from('webhook_events')
        .update({ error: msg })
        .match({ provider: 'portone', event_type: eventType, payment_id: paymentId, signature })
      console.error('webhook cancelAndDeactivate error:', msg)
    }
  }

  // 포트원은 5초 이내 200 응답 필요
  return NextResponse.json({ ok: true })
}

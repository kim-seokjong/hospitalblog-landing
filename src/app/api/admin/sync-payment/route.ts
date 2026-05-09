import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { cancelAndDeactivate } from '@/lib/payment/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SyncRequest {
  paymentId?: string
  reason?: string
}

/**
 * 관리자 전용: 포트원에서 이미 취소된 결제를 우리 DB에 동기화한다.
 *
 * Why: 포트원 V2 웹훅 누락·과거 취소 등으로 사용자가 만료일까지 글 생성을
 * 계속할 수 있는 케이스를 수동으로 정리하기 위함.
 *
 * 호출 예 (PowerShell):
 *   curl -X POST https://hospitalblog.kr/api/admin/sync-payment \
 *     -H "Content-Type: application/json" \
 *     --cookie "..." \
 *     -d '{"paymentId":"<paymentId>","reason":"테스트 결제 취소 정리"}'
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email || !isAdmin(user.email)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  let body: SyncRequest
  try {
    body = (await req.json()) as SyncRequest
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문' }, { status: 400 })
  }

  const paymentId = body.paymentId?.trim()
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId가 필요합니다.' }, { status: 400 })
  }

  try {
    const result = await cancelAndDeactivate(paymentId, {
      reason: body.reason ?? '관리자 수동 동기화',
    })
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

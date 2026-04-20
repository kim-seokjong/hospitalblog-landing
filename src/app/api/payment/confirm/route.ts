import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { verifyAndActivate } from '@/lib/payment/verify'

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const { paymentId } = await req.json()
    if (!paymentId || typeof paymentId !== 'string') {
      return NextResponse.json({ error: 'paymentId가 필요합니다' }, { status: 400 })
    }

    const result = await verifyAndActivate(paymentId)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '결제 검증 실패'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

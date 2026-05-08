import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getActiveBillingKey, cancelBillingKeyById } from '@/lib/payment/repository'

export const dynamic = 'force-dynamic'

export async function POST() {
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

    const billingKey = await getActiveBillingKey(user.id)
    if (!billingKey) {
      return NextResponse.json({ error: '활성 구독이 없습니다' }, { status: 404 })
    }

    await cancelBillingKeyById(billingKey.id)

    const usableUntil = billingKey.next_billing_at
      ? new Date(billingKey.next_billing_at).toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null

    return NextResponse.json({ success: true, usableUntil })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

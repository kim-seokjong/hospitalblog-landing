import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { getActiveBillingKey, cancelBillingKeyById } from '@/payment/lib/repository'
import { deleteBillingKey } from '@/payment/lib/billing-client'

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

    const isInTrial =
      !!billingKey.trial_until && new Date(billingKey.trial_until) > new Date()

    await cancelBillingKeyById(billingKey.id)
    // PG에서도 빌링키 삭제 (실패해도 DB 취소는 이미 완료됐으므로 무시)
    deleteBillingKey(billingKey.billing_key).catch(err =>
      console.error('[cancel] PG 빌링키 삭제 실패 (무시):', err)
    )

    // 무료 체험 중 해지: 플랜 즉시 만료 (청구 없음)
    if (isInTrial) {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      )
      await admin
        .from('profiles')
        .update({
          plan_expires_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

      return NextResponse.json({
        success: true,
        trialCancelled: true,
        usableUntil: null,
      })
    }

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

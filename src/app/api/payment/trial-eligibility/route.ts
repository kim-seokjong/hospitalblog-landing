import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { hasAnyBillingKeyHistory } from '@/payment/lib/repository'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    const { data: { user } } = await supabase.auth.getUser()

    // 미로그인: 가입 전이므로 신규로 간주 (랜딩에서 "첫 달 0원" 안내 유지)
    if (!user) {
      return NextResponse.json({ eligible: true, loggedIn: false })
    }

    const hasHistory = await hasAnyBillingKeyHistory(user.id)
    return NextResponse.json({ eligible: !hasHistory, loggedIn: true })
  } catch {
    // 안전 기본값: 신규로 간주 (랜딩 노출 우선)
    return NextResponse.json({ eligible: true, loggedIn: false })
  }
}

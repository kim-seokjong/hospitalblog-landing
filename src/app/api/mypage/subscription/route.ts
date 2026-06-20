import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { getProfile, getActiveBillingKey } from '@/payment/lib/repository';
import { PLANS, isPaidPlanId, isActivePlan } from '@/payment/lib/plans';
import type { SubscriptionInfo } from '@/hr/lib/mypage-types';

/**
 * 마이페이지 — 구독·결제 탭 요약 정보 (본인 데이터만).
 * billing_keys의 billing_key 원문은 절대 노출하지 않는다 (카드사·끝 4자리만).
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const [profile, billingKey] = await Promise.all([
      getProfile(user.id),
      getActiveBillingKey(user.id),
    ]);

    const plan = profile?.plan ?? null;
    const planInfo = isPaidPlanId(plan) ? PLANS[plan] : null;
    const autoRenew = billingKey?.status === 'ACTIVE';
    const isTrial =
      !!billingKey?.trial_until && new Date(billingKey.trial_until) > new Date();

    const subscription: SubscriptionInfo = {
      plan: planInfo ? planInfo.id : null,
      planName: planInfo ? planInfo.name : null,
      price: planInfo ? planInfo.price : null,
      usageLimit: planInfo ? planInfo.limits.blog : null, // 블로그 월 한도
      planExpiresAt: profile?.plan_expires_at ?? null,
      isActive: isActivePlan(plan, profile?.plan_expires_at ?? null),
      autoRenew,
      isTrial,
      trialUntil: billingKey?.trial_until ?? null,
      nextBillingAt: billingKey?.next_billing_at ?? null,
      cardName: billingKey?.card_name ?? null,
      cardLast4: billingKey?.card_last4 ?? null,
    };

    return NextResponse.json({ subscription });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

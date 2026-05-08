import type { SupabaseClient } from '@supabase/supabase-js';
import { PLANS, isPaidPlanId } from '@/lib/payment/plans';

export async function checkAndCreateUsageWarning(
  userId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('usage_count, plan, usage_reset_at')
    .eq('id', userId)
    .single();

  if (profileError || !profile) return;

  // 유료 플랜만 사용량 경고 대상 (free/null은 가드에서 0건 차단)
  if (!isPaidPlanId(profile.plan)) return;

  const plan = PLANS[profile.plan];
  if (!plan) return;

  // pro 플랜(-1)은 무제한이므로 알림 없음
  if (plan.usageLimit === -1) return;

  const limit = plan.usageLimit;
  const usageCount: number = profile.usage_count ?? 0;
  const usagePercent = usageCount / limit;

  if (usagePercent < 0.8) return;

  // 같은 달에 이미 usage_warning 알림이 있으면 중복 생성 안 함
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'usage_warning')
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)
    .limit(1);

  if (existing && existing.length > 0) return;

  const remaining = Math.max(0, limit - usageCount);
  const percentUsed = Math.round(usagePercent * 100);

  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'usage_warning',
    title: '사용량 임박 알림',
    message: `이번 달 AI 생성 횟수의 ${percentUsed}%를 사용했습니다. 남은 횟수: ${remaining}회. 플랜 업그레이드를 고려해보세요.`,
    is_read: false,
  });
}

export async function createPaymentSuccessNotification(
  userId: string,
  planName: string,
  supabase: SupabaseClient
): Promise<void> {
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'payment_success',
    title: '결제 완료',
    message: `${planName} 플랜이 성공적으로 활성화되었습니다. 이번 달 AI 생성 서비스를 마음껏 이용하세요!`,
    is_read: false,
  });
}

-- 원자적 사용량 체크+증가 RPC
-- p_monthly_limit: -1 = 무제한, 0 이상 = 한도
-- 반환: jsonb
--   성공: { ok: true, new_count, monthly_limit }
--   실패: { ok: false, reason: 'no_profile' | 'limit_exceeded', new_count?, monthly_limit? }

create or replace function public.consume_usage(
  p_user_id uuid,
  p_monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_current_month_start timestamptz := date_trunc('month', v_now);
  v_usage_count integer;
  v_usage_reset_at timestamptz;
  v_count integer;
begin
  -- 행 잠금 (race condition 방지)
  select usage_count, usage_reset_at
    into v_usage_count, v_usage_reset_at
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  -- 월간 리셋: usage_reset_at이 이번 달 시작 전이면 0으로 초기화
  if v_usage_reset_at is null
     or v_usage_reset_at < v_current_month_start then
    v_count := 0;
  else
    v_count := coalesce(v_usage_count, 0);
  end if;

  -- 무제한(-1)이 아니고 한도 도달 시 거부
  if p_monthly_limit >= 0 and v_count >= p_monthly_limit then
    -- 리셋이 발생했어도 여기서 0이면 계속 진행 가능 (위에서 처리됨)
    -- 한도 초과만 막음
    update public.profiles
       set usage_count = v_count,
           usage_reset_at = case
             when v_usage_reset_at is null or v_usage_reset_at < v_current_month_start
             then v_now
             else v_usage_reset_at
           end,
           updated_at = v_now
     where id = p_user_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'limit_exceeded',
      'new_count', v_count,
      'monthly_limit', p_monthly_limit
    );
  end if;

  -- 1 증가
  update public.profiles
     set usage_count = v_count + 1,
         usage_reset_at = case
           when v_usage_reset_at is null or v_usage_reset_at < v_current_month_start
           then v_now
           else v_usage_reset_at
         end,
         updated_at = v_now
   where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'new_count', v_count + 1,
    'monthly_limit', p_monthly_limit
  );
end;
$$;

-- 본문 생성 실패 시 롤백용
create or replace function public.decrement_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set usage_count = greatest(0, coalesce(usage_count, 0) - 1),
         updated_at = now()
   where id = p_user_id;
end;
$$;

grant execute on function public.consume_usage(uuid, integer) to authenticated, anon, service_role;
grant execute on function public.decrement_usage(uuid) to authenticated, anon, service_role;

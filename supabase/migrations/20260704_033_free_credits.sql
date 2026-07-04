-- 033: 가입 시 무료 생성 2회 (2026-07-04 정책)
-- 배경: 한 달 무료체험은 "몇 번 쓰고 이탈" 문제로 폐지(7/2 프로모션 전면 종료).
--       횟수 기반(2회)은 소진 즉시 결제 결정으로 이어지는 구조.
-- 기존 회원(미결제 포함)에게도 2회 부여 — 미전환 리드 재활성화 목적.

alter table public.profiles
  add column if not exists free_credits int not null default 2;

comment on column public.profiles.free_credits is
  '가입 무료 생성 잔여 횟수(기본 2). 유료 플랜과 무관하게 계정당 평생 2회. 2026-07-04';

-- 원자적 차감: 잔여 > 0 일 때만 1 감소 (동시 요청 이중차감 방지)
create or replace function public.consume_free_credit(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  update public.profiles
     set free_credits = free_credits - 1
   where id = p_user_id
     and free_credits > 0
  returning free_credits into v_remaining;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;

  return jsonb_build_object('ok', true, 'remaining', v_remaining);
end;
$$;

-- 생성 실패 롤백: 상한(2)을 넘지 않게 1 복구
create or replace function public.refund_free_credit(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set free_credits = least(free_credits + 1, 2)
   where id = p_user_id;
$$;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
revoke all on function public.refund_free_credit(uuid) from public, anon, authenticated;

-- 062: 가입 무료 2회에 유효기간 부여 — 가입 후 7일 (2026-08-06 대표 결정)
--
-- 배경
--   033 에서 가입 무료 2회를 줬는데 **만료가 없었다.** 그래서 "무료 2회가 곧 끝난다"고
--   안내할 근거가 없었고, 실제로 8/6 회원 안내 메일을 쓰다가 이 구멍이 드러났다.
--   횟수만 있고 기한이 없으면 "언제든 쓸 수 있다"가 되어 소진 즉시 결제로 이어지는
--   033 의 설계 의도(몇 번 쓰고 이탈 방지)가 반쯤 무너진다.
--
-- 정책
--   · 신규 가입   : 가입 시각 + 7일
--   · 기존 회원   : **소급하지 않는다(NULL = 무기한).**
--     지금 7일을 소급하면 기존 회원 전원이 즉시 만료다. 이미 준 것을 말없이 뺏는 것이라
--     하지 않는다. 기한 정책은 앞으로 가입하는 계정부터 적용한다.
--   · 예외 1건    : 밝은안과 → 2026-08-31.
--     8/6 안내 메일에서 "무료 2회가 그대로 있으니 8월 안에 써보시라"고 이미 말씀드렸다.
--     말한 것을 데이터로 만들어 둔다. 말과 시스템이 다르면 그게 거짓말이 된다.
--
-- 주의
--   NULL 은 "무기한"이다. "만료됨"이 아니다. 조회 조건을 뒤집지 말 것.

alter table public.profiles
  add column if not exists free_credits_expires_at timestamptz;

comment on column public.profiles.free_credits_expires_at is
  '가입 무료 크레딧 사용 기한. NULL=무기한(기존 회원). 신규는 가입+7일. 2026-08-06';

-- 신규 가입분에만 기한을 건다. created_at 을 참조해야 해서 DEFAULT 로는 불가능 → 트리거.
create or replace function public.set_free_credits_expiry()
returns trigger
language plpgsql
as $$
begin
  -- 이미 값이 지정돼 들어오면 존중한다(운영자가 개별 연장한 경우).
  if new.free_credits_expires_at is null then
    new.free_credits_expires_at := coalesce(new.created_at, now()) + interval '7 days';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_free_credits_expiry on public.profiles;
create trigger trg_free_credits_expiry
  before insert on public.profiles
  for each row execute function public.set_free_credits_expiry();

-- 예외 1건 — 이미 안내한 약속을 데이터로 확정
update public.profiles
   set free_credits_expires_at = timestamptz '2026-08-31 23:59:59+09',
       updated_at = now()
 where hospital_name = '밝은안과'
   and free_credits_expires_at is null;

-- 차감 함수 — 만료를 소진과 **다른 사유로** 돌려준다.
-- 둘을 뭉뚱그리면 "2회 다 쓰셨어요"라는 틀린 안내가 나간다(실제로는 한 번도 안 썼는데).
create or replace function public.consume_free_credit(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
  v_credits   int;
  v_expires   timestamptz;
begin
  select free_credits, free_credits_expires_at
    into v_credits, v_expires
    from public.profiles
   where id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  if v_credits <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;

  if v_expires is not null and v_expires <= now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'expired',
      'remaining', v_credits,
      'expired_at', v_expires
    );
  end if;

  -- 원자적 차감 — 조건을 여기서도 다시 건다(위 조회와 이 사이의 동시 요청 방지)
  update public.profiles
     set free_credits = free_credits - 1
   where id = p_user_id
     and free_credits > 0
     and (free_credits_expires_at is null or free_credits_expires_at > now())
  returning free_credits into v_remaining;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;

  return jsonb_build_object('ok', true, 'remaining', v_remaining);
end;
$$;

revoke all on function public.consume_free_credit(uuid) from public, anon, authenticated;
revoke all on function public.set_free_credits_expiry() from public, anon, authenticated;

-- 2026-06 ClinicFlix 멀티채널 변환 사용량 + 변환 매핑
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--    (#019 / #021 과 동일한 수동 적용 정책)
--
-- 목적:
--   1) clinicflix_usage   : 회원별 "월간" 영상/채널 사용량 카운터 (멱등 증가용 unique 키 포함)
--   2) clinicflix_conversions : conversion_id ↔ user_id 매핑 + 변환 1건당 1회만 사용량을 차감하기
--      위한 멱등 플래그(usage_committed) 저장
--
-- 기존 데이터 정합성:
--   - profiles / payments 등 기존 테이블을 변경하지 않는다 (신규 테이블만 추가).
--   - 전부 idempotent (create table if not exists / create index if not exists)로 작성한다.
--   - 영상/채널 한도 정의 자체는 src/payment/lib/plans.ts 의 limits.video / limits.channels
--     / fairUseCap 를 단일 소스로 사용한다. 이 마이그레이션은 "사용량 카운터"만 보관한다.

-- ── 1) 월간 사용량 카운터 ────────────────────────────────────────────────
create table if not exists public.clinicflix_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  usage_month  text not null,                  -- 'YYYY-MM' (KST 기준은 앱에서 계산)
  video_used   integer not null default 0,
  channel_used integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, usage_month)
);

alter table public.clinicflix_usage enable row level security;

-- 본인 행만 조회 (증가는 서비스 롤 키로만 수행 → insert/update 정책은 두지 않는다)
drop policy if exists "clinicflix_usage_select_own" on public.clinicflix_usage;
create policy "clinicflix_usage_select_own"
  on public.clinicflix_usage for select
  using (auth.uid() = user_id);

-- ── 2) 변환 매핑 (conversion_id ↔ user) + 멱등 사용량 차감 플래그 ──────────
create table if not exists public.clinicflix_conversions (
  conversion_id   text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  job_id          text,
  plan            text not null,
  usage_month     text not null,               -- 변환 생성 시점의 월 (차감도 동일 월에 기록)
  usage_committed boolean not null default false, -- approve 시 사용량 차감 완료 여부 (멱등 가드)
  status          text,                          -- 마지막으로 확인된 ClinicFlix job status (참고용)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists clinicflix_conversions_user_idx
  on public.clinicflix_conversions (user_id);
create index if not exists clinicflix_conversions_job_idx
  on public.clinicflix_conversions (job_id);

alter table public.clinicflix_conversions enable row level security;

drop policy if exists "clinicflix_conversions_select_own" on public.clinicflix_conversions;
create policy "clinicflix_conversions_select_own"
  on public.clinicflix_conversions for select
  using (auth.uid() = user_id);

-- ── 3) 멱등 사용량 차감 RPC ───────────────────────────────────────────────
-- approve(렌더 확정) 시점에 호출한다.
-- conversion_id 단위로 단 한 번만 video_used / channel_used 를 +1 한다.
-- 이미 차감된 변환(usage_committed = true)이면 아무 것도 하지 않고 ok:true 를 돌려준다(멱등).
--
-- 반환 jsonb:
--   { ok: true, already: boolean, video_used, channel_used, usage_month }
--   { ok: false, reason: 'no_conversion' | 'forbidden' }
create or replace function public.clinicflix_commit_usage(
  p_conversion_id text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_month        text;
  v_committed    boolean;
  v_video        integer;
  v_channel      integer;
begin
  -- 변환 행 잠금
  select user_id, usage_month, usage_committed
    into v_user_id, v_month, v_committed
    from public.clinicflix_conversions
   where conversion_id = p_conversion_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_conversion');
  end if;

  -- 소유자 검증 (다른 회원의 변환을 차감하지 못하게)
  if v_user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- 이미 차감된 변환이면 멱등 반환
  if v_committed then
    select video_used, channel_used
      into v_video, v_channel
      from public.clinicflix_usage
     where user_id = p_user_id and usage_month = v_month;
    return jsonb_build_object(
      'ok', true, 'already', true,
      'video_used', coalesce(v_video, 0),
      'channel_used', coalesce(v_channel, 0),
      'usage_month', v_month
    );
  end if;

  -- 월간 카운터 upsert (+1 video, +1 channel)
  insert into public.clinicflix_usage (user_id, usage_month, video_used, channel_used)
  values (p_user_id, v_month, 1, 1)
  on conflict (user_id, usage_month) do update
    set video_used   = public.clinicflix_usage.video_used + 1,
        channel_used = public.clinicflix_usage.channel_used + 1,
        updated_at   = now()
  returning video_used, channel_used into v_video, v_channel;

  -- 멱등 플래그 set
  update public.clinicflix_conversions
     set usage_committed = true,
         updated_at = now()
   where conversion_id = p_conversion_id;

  return jsonb_build_object(
    'ok', true, 'already', false,
    'video_used', v_video,
    'channel_used', v_channel,
    'usage_month', v_month
  );
end;
$$;

grant execute on function public.clinicflix_commit_usage(text, uuid)
  to authenticated, anon, service_role;

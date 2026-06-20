-- 2026-06 ClinicFlix 채널별 생성 선택 — 변환별 차감 플래그(consume_video / consume_channel)
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--    (#019 / #021 / #022 와 동일한 수동 적용 정책)
--
-- 목적:
--   사용자가 "어떤 채널을 생성할지" 직접 고르므로, 변환 1건이 항상 영상+1 / 채널+1 을
--   차감하던 정책을 변환별로 분리한다.
--     - shorts(영상) 선택 → consume_video = true  → 차감 시 video_used +1
--     - cardnews/threads/feed/story 중 하나라도 선택 → consume_channel = true → channel_used +1
--   (4개 비영상 채널은 몇 개를 골라도 "세트 1건" = channel +1)
--
-- 기존 데이터 정합성:
--   - 신규 컬럼은 DEFAULT true → 기존 clinicflix_conversions 행은 그대로 영상+1/채널+1 동작을 유지한다.
--   - 전부 idempotent (add column if not exists / create or replace function).
--   - 한도 정의 자체는 src/payment/lib/plans.ts (limits.video / limits.channels / fairUseCap)가 단일 소스.

-- ── 1) 변환별 차감 플래그 컬럼 ───────────────────────────────────────────────
alter table public.clinicflix_conversions
  add column if not exists consume_video boolean not null default true;
alter table public.clinicflix_conversions
  add column if not exists consume_channel boolean not null default true;

-- ── 2) 멱등 사용량 차감 RPC (플래그 기반 증가로 갱신) ─────────────────────────
-- approve(렌더 확정) 시점에 호출한다.
-- conversion_id 단위로 단 한 번만, 그 변환 행의 consume_video / consume_channel 에 따라
--   video_used / channel_used 를 선택적으로 +1 한다 (차감 안 하는 카운터는 +0).
-- 이미 차감된 변환(usage_committed = true)이면 아무 것도 하지 않고 ok:true 를 돌려준다(멱등).
--
-- 반환 jsonb (#022 와 동일한 형태 유지):
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
  v_consume_v    boolean;
  v_consume_c    boolean;
  v_inc_v        integer;
  v_inc_c        integer;
  v_video        integer;
  v_channel      integer;
begin
  -- 변환 행 잠금 (+ 차감 플래그 읽기)
  select user_id, usage_month, usage_committed, consume_video, consume_channel
    into v_user_id, v_month, v_committed, v_consume_v, v_consume_c
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

  -- 플래그 기반 증가량 (차감 안 하는 카운터는 +0)
  v_inc_v := case when v_consume_v then 1 else 0 end;
  v_inc_c := case when v_consume_c then 1 else 0 end;

  -- 월간 카운터 upsert (+inc_v video, +inc_c channel)
  insert into public.clinicflix_usage (user_id, usage_month, video_used, channel_used)
  values (p_user_id, v_month, v_inc_v, v_inc_c)
  on conflict (user_id, usage_month) do update
    set video_used   = public.clinicflix_usage.video_used + v_inc_v,
        channel_used = public.clinicflix_usage.channel_used + v_inc_c,
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

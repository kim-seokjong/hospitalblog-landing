-- 050 — 자동발행 원자성 + 순회 커서
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경 (Codex 교차검증 지적):
--  1) 하루 3편 상한이 "조회 → 판단 → update" 3단계라 두 실행이 같은 카운트를 읽고
--     서로 다른 글을 선점하면 하루 4편 이상이 나갔다. published_to_site=false 조건은
--     "같은 글"의 이중 선점만 막지 일일 총량 경쟁은 못 막는다.
--     → 카운트와 선점을 한 트랜잭션 + advisory lock 안에서 처리하는 RPC 로 옮긴다.
--  2) weekly/biweekly 도 isDue 가 앱 판정이라 동시 실행 시 각각 1편씩 발행됐다.
--     → 주기 실행권을 profiles 행에서 조건부 update 로 선점하는 RPC 를 둔다.
--  3) 순회가 항상 id 오름차순이라 전체 발행 상한(100편)을 앞쪽 회원이 소진하면
--     뒤쪽 회원은 검사조차 되지 않았다. → 다음 시작 위치를 영속 커서로 남긴다.
--
-- 마이그 미적용 상태에서도 코드는 죽지 않는다:
--   RPC/테이블이 없으면(42883·42P01·PGRST2xx) 앱이 기존 경로로 폴백한다
--   (원자성은 약해지지만 동작은 유지 — src/app/api/cron/site-auto-publish/route.ts).

-- ---------------------------------------------------------------------------
-- 1) 순회 커서 — 다음 실행이 어디서부터 볼지 (단일 행 테이블)
-- ---------------------------------------------------------------------------

create table if not exists public.clinic_auto_publish_state (
  id              boolean primary key default true check (id),
  last_profile_id uuid,
  updated_at      timestamptz not null default now()
);

insert into public.clinic_auto_publish_state (id)
values (true)
on conflict (id) do nothing;

comment on table public.clinic_auto_publish_state is
  '내 블로그 자동발행 cron 의 순회 커서(단일 행). last_profile_id 다음 회원부터 이어서 검사한다. 전체 발행 상한으로 중간에 끊겨도 다음 실행이 이어받아 모든 회원이 유한 시간 안에 반드시 검사된다.';

alter table public.clinic_auto_publish_state enable row level security;
-- 정책 없음 = service_role(cron)만 접근. 회원에게 노출할 데이터가 아니다.
revoke all on public.clinic_auto_publish_state from anon;
revoke all on public.clinic_auto_publish_state from authenticated;

-- ---------------------------------------------------------------------------
-- 2) 일일 상한 원자 강제 + 글 선점 (auto 주기)
-- ---------------------------------------------------------------------------
--
-- "오늘 몇 편 남았는지 계산 → 그만큼만 선점 → 선점된 글 id 반환"을 한 번에 한다.
-- pg_advisory_xact_lock 으로 같은 회원에 대한 동시 실행을 직렬화하므로,
-- 두 번째 실행은 첫 번째가 반영한 카운트를 보고 몫이 0 이 된다.
--
-- p_post_ids: 앱이 검수 게이트(의료광고법)를 통과시킨 후보 id 목록.
--             게이트 판정은 앱 로직이라 DB 로 내리지 않고, 후보 범위만 넘긴다.

create or replace function public.claim_auto_publish_posts(
  p_user_id   uuid,
  p_daily_cap integer,
  p_day_start timestamptz,
  p_post_ids  uuid[]
)
returns table (claimed_id uuid, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used  integer;
  v_quota integer;
begin
  if p_daily_cap is null or p_daily_cap <= 0 then
    return;
  end if;
  if p_post_ids is null or array_length(p_post_ids, 1) is null then
    return;
  end if;

  -- 같은 회원에 대한 동시 실행 직렬화 (트랜잭션 종료 시 자동 해제)
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*)
    into v_used
    from public.saved_posts
   where user_id = p_user_id
     and published_to_site = true
     and site_published_at >= p_day_start;

  v_quota := greatest(0, p_daily_cap - v_used);
  if v_quota = 0 then
    return;
  end if;

  return query
  update public.saved_posts sp
     set published_to_site = true,
         site_published_at = now()
   where sp.id in (
           select s.id
             from public.saved_posts s
            where s.user_id = p_user_id
              and s.published_to_site = false
              and s.id = any(p_post_ids)
            order by s.created_at asc, s.id asc
            limit v_quota
            for update skip locked
         )
  returning sp.id, sp.site_published_at;
end;
$$;

comment on function public.claim_auto_publish_posts(uuid, integer, timestamptz, uuid[]) is
  '자동발행 auto 주기의 일일 상한을 원자적으로 강제하고 글을 선점한다. advisory lock + 단일 트랜잭션이라 cron 중복 전달·재시도·수동 재실행이 겹쳐도 하루 상한을 넘지 않는다. 반환 = 실제로 선점된 글 id.';

revoke all on function public.claim_auto_publish_posts(uuid, integer, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_auto_publish_posts(uuid, integer, timestamptz, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3) 주기 실행권 선점 (weekly / biweekly)
-- ---------------------------------------------------------------------------
--
-- isDue 는 앱 판정이라 두 실행이 같은 오래된 last_run 을 읽으면 각각 1편씩 발행된다.
-- 조건부 update 로 last_run 을 "먼저" 갱신하고, 실제로 1행이 바뀐 실행만 진행한다.
--
-- 반환: 선점 성공 시 (이전 last_run, 이번에 찍은 last_run) 1행. 실패 시 0행.
--  - previous_last_run: 발행에 결국 실패하면 이 값으로 되돌려 주기를 낭비하지 않는다.
--  - claimed_at: ★ 되돌릴 때 compare-and-set 조건으로 쓴다. 내가 찍은 값일 때만
--    되돌려야, 그 사이 다른 실행이 갱신한 더 최신 값을 과거로 밀어버리지 않는다.
--
-- UPDATE ... RETURNING 은 "갱신 후" 값을 돌려주므로, 이전 값은 행을 잠근 뒤 미리 읽는다.

-- 반환 타입이 바뀌었으므로 create or replace 로는 교체되지 않는다(먼저 제거).
drop function if exists public.claim_auto_publish_cycle(uuid, timestamptz);

create or replace function public.claim_auto_publish_cycle(
  p_user_id   uuid,
  p_threshold timestamptz
)
returns table (previous_last_run timestamptz, claimed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev timestamptz;
  v_now  timestamptz := now();
  v_hit  integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));

  select p.site_publish_last_run
    into v_prev
    from public.profiles p
   where p.id = p_user_id
   for update;

  if not found then
    return;
  end if;

  if v_prev is not null and v_prev > p_threshold then
    return; -- 아직 주기가 안 됐다(다른 실행이 방금 선점한 경우 포함)
  end if;

  update public.profiles
     set site_publish_last_run = v_now
   where id = p_user_id;

  get diagnostics v_hit = row_count;
  if v_hit = 0 then
    return;
  end if;

  return query select v_prev, v_now;
end;
$$;

comment on function public.claim_auto_publish_cycle(uuid, timestamptz) is
  'weekly/biweekly 주기 실행권을 원자적으로 선점한다(행 잠금 + last_run 선갱신). 1행 반환 시에만 발행을 진행하고, 반환값은 갱신 전 last_run 이라 발행 실패 시 되돌릴 수 있다.';

revoke all on function public.claim_auto_publish_cycle(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_auto_publish_cycle(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4) 오늘 발행 수 집계용 인덱스 (일일 상한 카운트 가속)
-- ---------------------------------------------------------------------------

create index if not exists idx_saved_posts_site_published_at
  on public.saved_posts (user_id, site_published_at)
  where published_to_site;

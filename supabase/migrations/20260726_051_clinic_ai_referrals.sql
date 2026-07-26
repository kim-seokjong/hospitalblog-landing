-- 051 — AI 검색 유입 집계 (병원 서브도메인 블로그 실측 방문)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   마이그 037(geo_citations)은 "AI가 우리 병원을 언급했는가"(인용 여부)만 본다.
--   인용이 실제 방문으로 이어졌는지는 별개 문제다 — 해외 실측에서 4.8만 인용 대비
--   실유입 14명(CTR 0.03%) 사례가 보고됐다. 원장에게 "AI에 인용됩니다"만 말하면
--   "그래서 사람이 왔냐"는 질문에 답할 수 없다.
--   병원 서브도메인({slug}.hospitalblog.kr)은 우리 서버가 통제하므로, AI 서비스에서
--   넘어온 방문을 비용 0원으로 직접 셀 수 있다. 이것이 유일한 실제 성과 지표다.
--
-- ★★ 개인정보 최소화 — 이 테이블의 존재 이유이자 제1 제약:
--   저장하는 것: 병원(user_id) · AI 출처 · 글 id · 방문 일자(KST) · 그 날의 방문 수.
--   저장하지 않는 것: **IP 주소, User-Agent, 쿠키, 세션/방문자 식별자, 리퍼러 원문,
--   그리고 시·분·초 단위의 어떤 시각도**.
--   - 원본 이벤트를 쌓지 않고 처음부터 **일자별 카운터**로 적재한다. 개인 단위
--     타임라인이 물리적으로 만들어지지 않으므로 재식별 위험이 구조적으로 없고,
--     행 수도 (병원 × 출처 × 글 × 일) 로 묶여 용량이 작다.
--   - ⚠️ 이 테이블에는 timestamptz 컬럼이 하나도 없다. created_at/updated_at 조차
--     두지 않는다: 하루 동안 (병원·출처·글) 조합의 방문이 1건뿐이면 그 타임스탬프가
--     곧 그 개인의 방문 시각(시·분·초)이 되기 때문이다. 조회 API가 돌려주지 않아도
--     DB와 백업에는 남으므로, 애초에 컬럼을 만들지 않는다.
--     (스키마 개인정보 고정 테스트가 timestamptz 컬럼 부재를 강제한다.)
--   - 글 id 를 grain 에 포함한 이유: "어떤 글이 실제로 AI 유입을 만드는가"가 원장이
--     행동으로 옮길 수 있는 유일한 정보이기 때문이다. 글 id 는 **우리 콘텐츠**
--     식별자이지 방문자 식별자가 아니므로 개인정보 위험을 늘리지 않는다.
--   - 봇/크롤러 제외 판정에 User-Agent 를 쓰지만, 판정 직후 버린다(앱 레벨).
--
-- 쓰기 경로: 공개 비콘(/api/clinic-site/ai-referral) → service role → record RPC.
--            비콘은 **서버가 그 페이지를 실제로 렌더했다는 HMAC 서명 토큰**을 함께
--            보내야 한다(앱 레벨 검증). 남의 병원 slug 로는 토큰을 만들 수 없다.
-- 읽기 경로: 마이페이지 → summary RPC (SECURITY INVOKER → RLS 그대로 적용).

create table if not exists public.clinic_ai_referrals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  source     text not null,
  post_id    uuid references public.saved_posts(id) on delete cascade,
  visit_date date not null,
  visits     bigint not null default 0
);

-- 초안(리뷰 전) 버전을 이미 적용해 둔 환경 정리용 — created_at/updated_at 은
-- 개인 방문 시각이 될 수 있어 제거한다. 없으면 아무 일도 하지 않는다.
alter table public.clinic_ai_referrals drop column if exists created_at;
alter table public.clinic_ai_referrals drop column if exists updated_at;
-- 초안이 integer 였다면 bigint 로 승격 (무손실, 장기 남용 overflow 방지).
alter table public.clinic_ai_referrals alter column visits type bigint;

-- source 형식 제약 — 앱 화이트리스트와 별개로 쓰레기 값 유입을 막는다.
-- 목록 자체를 DB에 박지 않는 이유: 새 AI 서비스 추가에 마이그레이션이 필요해지면
-- "상수 파일 하나만 고치면 되게" 라는 설계 의도가 깨진다.
do $$
begin
  alter table public.clinic_ai_referrals
    add constraint clinic_ai_referrals_source_format
    check (source ~ '^[a-z0-9_]{1,32}$');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.clinic_ai_referrals
    add constraint clinic_ai_referrals_visits_nonneg
    check (visits >= 0);
exception
  when duplicate_object then null;
end $$;

comment on table public.clinic_ai_referrals is
  'AI 검색(ChatGPT·Perplexity 등)에서 병원 서브도메인 블로그로 넘어온 방문의 일자별 집계. '
  'IP·User-Agent·쿠키·세션 식별자를 저장하지 않으며, 시·분·초 단위 시각 컬럼이 하나도 없다(개인 식별 불가 설계). '
  '쓰기는 service role → record_clinic_ai_referral() 전용.';
comment on column public.clinic_ai_referrals.source is
  'AI 출처 토큰(chatgpt·perplexity 등). 판정 근거와 목록은 src/content/lib/ai-referral/sources.ts 에 데이터로 정의.';
comment on column public.clinic_ai_referrals.post_id is
  '방문한 글(우리 콘텐츠 식별자). null = 블로그 홈 유입. 방문자 식별자가 아니다.';
comment on column public.clinic_ai_referrals.visit_date is
  'KST 기준 방문 일자. 이 테이블의 유일한 시간 정보이며 일(day)보다 세밀하지 않다.';
comment on column public.clinic_ai_referrals.visits is
  '해당 (병원·출처·글·일자) 조합의 누적 방문 수.';

-- 집계 grain 유일성. post_id 가 nullable 이라 부분 인덱스 2개로 나눈다
-- (Postgres 에서 NULL 은 서로 같지 않아 단일 unique 인덱스로는 홈 유입이 중복된다).
create unique index if not exists uq_clinic_ai_referrals_post
  on public.clinic_ai_referrals (user_id, source, visit_date, post_id)
  where post_id is not null;

create unique index if not exists uq_clinic_ai_referrals_home
  on public.clinic_ai_referrals (user_id, source, visit_date)
  where post_id is null;

-- 마이페이지 조회용 (본인 + 최근 기간)
create index if not exists idx_clinic_ai_referrals_user_date
  on public.clinic_ai_referrals (user_id, visit_date desc);

-- RLS — 본인 row만 select (geo_citations·post_rankings 패턴 동일).
-- insert/update/delete 정책은 두지 않는다 → 쓰기는 service role(RLS 우회)로만.
alter table public.clinic_ai_referrals enable row level security;

drop policy if exists "병원은 자신의 AI 유입 집계만 조회" on public.clinic_ai_referrals;
create policy "병원은 자신의 AI 유입 집계만 조회"
  on public.clinic_ai_referrals for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 쓰기 — 비콘 1건을 원자적으로 반영한다.
--
-- 왜 함수인가:
--   1) PostgREST 의 upsert 는 "치환"이라 visits = visits + 1 증가를 표현할 수 없다.
--   2) slug → user_id 해석, 글 소유·발행 검증, 증가를 **왕복 1회**로 끝낸다.
--   3) 공개 비콘이 넘긴 값(slug·post_id)의 소유권 검증을 DB 안에서 마무리한다.
--      (요청자가 그 페이지를 실제로 렌더받았는지는 앱 레벨 HMAC 토큰이 검증한다.)
--
-- search_path 를 빈 값으로 고정하고 모든 이름을 스키마 수식한다 — SECURITY DEFINER
-- 함수에서 검색 경로를 이용한 이름 가로채기를 원천 차단한다.
-- ---------------------------------------------------------------------------
create or replace function public.record_clinic_ai_referral(
  p_slug       text,
  p_source     text,
  p_post_id    uuid,
  p_visit_date date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_post_id uuid := null;
begin
  if p_slug is null or p_source is null or p_visit_date is null then
    return;
  end if;
  if p_source !~ '^[a-z0-9_]{1,32}$' then
    return;
  end if;
  -- 미래 날짜·과도한 과거는 거부 (KST/UTC 차이로 하루는 허용)
  if p_visit_date > (current_date + 1) or p_visit_date < (current_date - 7) then
    return;
  end if;

  select p.id into v_user_id
    from public.profiles p
   where p.site_slug = p_slug
   limit 1;
  if v_user_id is null then
    return;
  end if;

  -- 글 지정 시: 그 병원 소유 + 블로그 발행 확정 글일 때만 인정. 아니면 홈(null)이
  -- 아니라 아예 기록하지 않는다 — 오귀속보다 미기록이 낫다.
  if p_post_id is not null then
    select sp.id into v_post_id
      from public.saved_posts sp
     where sp.id = p_post_id
       and sp.user_id = v_user_id
       and sp.published_to_site = true;
    if v_post_id is null then
      return;
    end if;
  end if;

  -- 표준 upsert 루프: update 우선, 없으면 insert, 동시 삽입 충돌 시 재시도.
  -- ⚠️ 여기서 어떤 타임스탬프도 갱신하지 않는다 (개인 방문 시각 생성 금지).
  loop
    update public.clinic_ai_referrals
       set visits = visits + 1
     where user_id = v_user_id
       and source = p_source
       and visit_date = p_visit_date
       and post_id is not distinct from v_post_id;
    exit when found;

    begin
      insert into public.clinic_ai_referrals (user_id, source, post_id, visit_date, visits)
      values (v_user_id, p_source, v_post_id, p_visit_date, 1);
      exit;
    exception
      when unique_violation then
        -- 동시 요청이 먼저 만들었다 → 루프 처음으로 돌아가 update 로 증가
        null;
    end;
  end loop;
end;
$$;

comment on function public.record_clinic_ai_referral(text, text, uuid, date) is
  'AI 유입 비콘 1건을 일자별 집계에 원자적으로 반영. slug→병원, 글 소유·발행 검증을 내부에서 수행. '
  '개인 식별 정보를 인자로 받지 않고 어떤 타임스탬프도 남기지 않는다. service role 전용.';

revoke all on function public.record_clinic_ai_referral(text, text, uuid, date) from public;
grant execute on function public.record_clinic_ai_referral(text, text, uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 읽기 — 기간 요약을 **DB에서 집계해** 고정 크기 jsonb 로 돌려준다.
--
-- 왜 함수인가: 원시 행을 앱으로 끌어와 합산하면 행 수 상한(LIMIT)에 걸리는 순간
-- 통계가 조용히 잘린다. grain 이 (출처 × 글 × 일) 이라 글 50편·출처 10종·30일이면
-- 이론상 1.5만 행까지 늘 수 있고, 남용으로 인위적으로 늘리는 것도 가능하다.
-- 여기서 집계하면 응답 크기가 원본 행 수와 무관하게 (출처 수 + 일수 + top N) 으로 고정된다.
--
-- SECURITY INVOKER(기본)이라 호출자 권한으로 실행된다 → RLS 가 그대로 적용되어
-- 본인 병원 데이터만 집계된다. 별도 소유권 검증이 필요 없다.
-- ---------------------------------------------------------------------------
create or replace function public.clinic_ai_referral_summary(
  p_start      date,
  p_end        date,
  p_top_posts  integer default 5
) returns jsonb
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_top_posts, 5), 1), 50) as top_n
  ),
  base as (
    select r.visit_date, r.source, r.post_id, r.visits
      from public.clinic_ai_referrals r
     where r.visit_date >= p_start
       and r.visit_date <= p_end
  )
  select jsonb_build_object(
    'total_visits', coalesce((select sum(b.visits) from base b), 0),
    'home_visits',  coalesce((select sum(b.visits) from base b where b.post_id is null), 0),
    'post_visits',  coalesce((select sum(b.visits) from base b where b.post_id is not null), 0),
    'post_count',   coalesce((select count(distinct b.post_id) from base b where b.post_id is not null), 0),
    'by_source', coalesce((
      select jsonb_agg(
               jsonb_build_object('source', s.source, 'visits', s.visits)
               order by s.visits desc, s.source
             )
        from (
          select b.source, sum(b.visits) as visits
            from base b
           group by b.source
        ) s
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(
               jsonb_build_object('date', to_char(d.visit_date, 'YYYY-MM-DD'), 'visits', d.visits)
               order by d.visit_date
             )
        from (
          select b.visit_date, sum(b.visits) as visits
            from base b
           group by b.visit_date
        ) d
    ), '[]'::jsonb),
    'top_posts', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'post_id', t.post_id,
                 'title', coalesce(sp.title, ''),
                 'visits', t.visits
               )
               order by t.visits desc, t.post_id
             )
        from (
          select b.post_id, sum(b.visits) as visits
            from base b
           where b.post_id is not null
           group by b.post_id
           order by sum(b.visits) desc, b.post_id
           limit (select bo.top_n from bounds bo)
        ) t
        left join public.saved_posts sp on sp.id = t.post_id
    ), '[]'::jsonb)
  );
$$;

comment on function public.clinic_ai_referral_summary(date, date, integer) is
  'AI 유입 기간 요약을 DB에서 집계해 고정 크기 jsonb 로 반환. SECURITY INVOKER 라 RLS 로 본인 데이터만 집계된다. '
  '앱이 원시 행을 끌어오지 않으므로 행 수 상한에 의한 통계 잘림이 발생하지 않는다.';

revoke all on function public.clinic_ai_referral_summary(date, date, integer) from public;
grant execute on function public.clinic_ai_referral_summary(date, date, integer) to authenticated;
grant execute on function public.clinic_ai_referral_summary(date, date, integer) to service_role;

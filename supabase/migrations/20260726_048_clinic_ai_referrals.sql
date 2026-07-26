-- 048 — AI 검색 유입 집계 (병원 서브도메인 블로그 실측 방문)
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
--   방문 시각(시·분·초)**. 어떤 컬럼도 개인을 지목할 수 없다.
--   - 원본 이벤트를 쌓지 않고 처음부터 **일자별 카운터**로 적재한다. 개인 단위
--     타임라인이 물리적으로 만들어지지 않으므로 재식별 위험이 구조적으로 없고,
--     행 수도 (병원 × 출처 × 글 × 일) 로 묶여 용량이 작다.
--   - 글 id 를 grain 에 포함한 이유: "어떤 글이 실제로 AI 유입을 만드는가"가 원장이
--     행동으로 옮길 수 있는 유일한 정보이기 때문이다. 글 id 는 **우리 콘텐츠**
--     식별자이지 방문자 식별자가 아니므로 개인정보 위험을 늘리지 않는다.
--   - 봇/크롤러 제외 판정에 User-Agent 를 쓰지만, 판정 직후 버린다(앱 레벨).
--
-- 쓰기 경로: 공개 비콘(/api/clinic-site/ai-referral) → service role → 아래 RPC.
--            클라이언트가 테이블에 직접 쓸 수 없다(RLS 에 insert 정책 없음).

create table if not exists public.clinic_ai_referrals (
  id         uuid primary key default gen_random_uuid(),
  /** 귀속 병원. 회원 탈퇴 시 집계도 함께 삭제된다. */
  user_id    uuid not null references public.profiles(id) on delete cascade,
  /** AI 출처 토큰 (chatgpt·perplexity·… ). 목록은 src/content/lib/ai-referral/sources.ts. */
  source     text not null,
  /** 방문한 글. null = 블로그 홈 유입. 글 삭제 시 해당 집계 행도 삭제된다. */
  post_id    uuid references public.saved_posts(id) on delete cascade,
  /** 방문 일자 (KST 기준 yyyy-mm-dd). 시각은 저장하지 않는다 — 개인 타임라인 방지. */
  visit_date date not null,
  /** 해당 (병원·출처·글·일자) 조합의 누적 방문 수. */
  visits     integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  'IP·User-Agent·쿠키·세션 식별자·방문 시각을 저장하지 않는다(개인 식별 불가 설계). '
  '쓰기는 service role → record_clinic_ai_referral() 전용.';
comment on column public.clinic_ai_referrals.source is
  'AI 출처 토큰. 판정 근거와 목록은 src/content/lib/ai-referral/sources.ts 에 데이터로 정의.';
comment on column public.clinic_ai_referrals.post_id is
  '방문한 글(우리 콘텐츠 식별자). null = 블로그 홈. 방문자 식별자가 아니다.';
comment on column public.clinic_ai_referrals.visit_date is
  'KST 기준 방문 일자. 시·분·초를 저장하지 않아 개인 단위 타임라인이 만들어지지 않는다.';

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
-- 증가 함수 — 비콘 1건을 원자적으로 반영한다.
--
-- 왜 함수인가:
--   1) PostgREST 의 upsert 는 "치환"이라 visits = visits + 1 증가를 표현할 수 없다.
--   2) slug → user_id 해석, 글 소유·발행 검증, 증가를 **왕복 1회**로 끝낸다
--      (비콘은 방문자 렌더 경로 밖이지만, 왕복이 적을수록 실패 지점이 적다).
--   3) 공개 비콘이 넘긴 값(slug·post_id)의 소유권 검증을 DB 안에서 마무리한다 —
--      남의 병원 슬러그로 남의 글에 카운트를 붙이는 위조를 구조적으로 막는다.
--
-- 반환값을 두지 않는 이유: 호출부는 성공/실패로 분기하지 않는다(계측은 실패해도
-- 조용히 넘어간다). 존재하지 않는 slug·글이면 아무 일도 하지 않고 끝난다.
-- ---------------------------------------------------------------------------
create or replace function public.record_clinic_ai_referral(
  p_slug       text,
  p_source     text,
  p_post_id    uuid,
  p_visit_date date
) returns void
language plpgsql
security definer
set search_path = public
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
  -- 미래 날짜·과도한 과거는 거부 (시계 오차 하루는 허용)
  if p_visit_date > (current_date + 1) or p_visit_date < (current_date - 7) then
    return;
  end if;

  select id into v_user_id
    from public.profiles
   where site_slug = p_slug
   limit 1;
  if v_user_id is null then
    return;
  end if;

  -- 글 지정 시: 그 병원 소유 + 블로그 발행 확정 글일 때만 인정. 아니면 홈(null)이
  -- 아니라 아예 기록하지 않는다 — 오귀속보다 미기록이 낫다.
  if p_post_id is not null then
    select id into v_post_id
      from public.saved_posts
     where id = p_post_id
       and user_id = v_user_id
       and published_to_site = true;
    if v_post_id is null then
      return;
    end if;
  end if;

  -- 표준 upsert 루프: update 우선, 없으면 insert, 동시 삽입 충돌 시 재시도.
  loop
    update public.clinic_ai_referrals
       set visits = visits + 1,
           updated_at = now()
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
  '개인 식별 정보는 인자로도 받지 않는다. service role 전용.';

-- 공개 롤(anon/authenticated 는 PUBLIC 상속)에서 실행 권한 회수 — service role 만 호출.
revoke all on function public.record_clinic_ai_referral(text, text, uuid, date) from public;
grant execute on function public.record_clinic_ai_referral(text, text, uuid, date) to service_role;

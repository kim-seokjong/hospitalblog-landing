-- 046 — 자체 퍼널 이벤트 적재 (획득 퍼널 계측)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   웹 애널리틱스가 전무(Meta 픽셀만)해 방문→가입→활성화→유료 전환을 측정할 수 없었다.
--   Vercel Web Analytics(트래픽)와 별개로, 우리가 직접 쿼리·profiles 조인 가능한
--   자체 퍼널 이벤트를 적재한다. Meta 픽셀(광고 최적화)과 병행 — 목적이 다르다.
--
--   이벤트 종류(화이트리스트, src/content/lib/funnel-events.ts 와 동기화):
--     landing_view / signup_start / signup_complete / first_post_generated / payment_success
--
--   식별:
--     user_id  — 로그인 사용자 이벤트(서버 세션에서 귀속). 익명 이벤트는 null.
--     anon_id  — 비로그인 방문자 쿠키 식별자(32 hex). 로그인 이벤트는 null 가능.
--   meta(jsonb) — 이벤트별 부가 속성(플랜·소스 등). 1단 원시값 맵으로 새니타이즈 후 적재.

create table if not exists public.funnel_events (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  /** 로그인 사용자 이벤트의 귀속 회원. 익명 방문자 이벤트는 null. */
  user_id    uuid references public.profiles(id) on delete set null,
  /** 비로그인 방문자 쿠키 식별자(32 hex). 로그인 이벤트에선 null 일 수 있다. */
  anon_id    text,
  meta       jsonb,
  created_at timestamptz not null default now()
);

comment on table public.funnel_events is
  '자체 획득 퍼널 이벤트(landing_view·signup_start·signup_complete·first_post_generated·payment_success). Meta 픽셀과 병행하는 우리 소유 데이터. 쓰기는 service role(/api/funnel-event·서버 라우트) 전용. PII 미저장(IP는 적재 안 함).';
comment on column public.funnel_events.anon_id is
  '비로그인 방문자 쿠키 식별자(dp_anon_id, 32 hex). 가입 전환 분석 시 signup_complete 이벤트의 user_id 와 이어 붙인다.';

create index if not exists idx_funnel_events_event      on public.funnel_events(event, created_at desc);
create index if not exists idx_funnel_events_user_id    on public.funnel_events(user_id);
create index if not exists idx_funnel_events_anon_id    on public.funnel_events(anon_id);
create index if not exists idx_funnel_events_created_at on public.funnel_events(created_at desc);

-- RLS: 정책 없이 활성화만 → anon/authenticated 직접 접근 전면 차단, service role 만 사용.
-- (클라이언트가 임의 이벤트를 직접 insert 하지 못하도록 — 반드시 /api/funnel-event 경유)
alter table public.funnel_events enable row level security;

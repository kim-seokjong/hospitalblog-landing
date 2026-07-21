-- 045 — 네이버 블로그 무료진단 (리드 마그넷)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   랜딩 /blog-check 에서 비회원이 네이버 블로그 주소를 넣으면 실측 기반
--   간단분석(SEO·GEO·컴플라이언스·꾸준함)을 보여주고, 상세분석은 회원 전용.
--   A) blog_check_leads    — 비회원 간단분석 실행 시 영업 리드 적재
--                            (blog_id·블로그명=병원명 추정·IP는 저장하지 않음)
--   B) blog_check_reports  — 회원 상세분석 결과 이력 (BlogCheckReport JSON)
--
-- 기존 blog_audits(마이그 034)를 재사용하지 않는 이유:
--   blog_audits.results 는 컴플라이언스 소급진단(BlogAuditResults) 전용 스키마이고
--   /app 진단 카드가 그 형태를 그대로 읽는다. 무료진단 리포트(BlogCheckReport)는
--   SEO/GEO/키워드 실측을 포함한 다른 형태라 섞으면 기존 UI가 깨진다 → 분리.

-- 1) blog_check_leads — 비회원 리드 (쓰기·조회 모두 service role 전용)
create table if not exists public.blog_check_leads (
  id          uuid primary key default gen_random_uuid(),
  blog_id     text not null,
  /** 블로그명(RSS 채널 title) — 병원명 추정치. */
  blog_title  text not null default '',
  source      text not null default 'blog-check',
  /** 가입 전환 시 연결되는 회원. 미가입 리드는 null. */
  user_id     uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.blog_check_leads is
  '네이버 블로그 무료진단(비회원) 리드. blog_id+블로그명(병원명 추정)+실행 시각. 가입 전환 시 user_id 연결(상세분석 라우트에서 blog_id 매칭 backfill). PII(IP·이메일) 저장 안 함.';
comment on column public.blog_check_leads.blog_title is
  'RSS 채널 title — 병원명 추정치(영업 후속용 표시 이름).';

create index if not exists idx_blog_check_leads_blog_id    on public.blog_check_leads(blog_id);
create index if not exists idx_blog_check_leads_created_at on public.blog_check_leads(created_at desc);

-- RLS: 정책 없이 활성화만 → anon/authenticated 접근 전면 차단, service role 만 사용.
alter table public.blog_check_leads enable row level security;

-- 2) blog_check_reports — 회원 상세분석 이력 + 일일 상한의 원자 예약(pending) 행
--
-- 회원당 일일 상한(기본 5회)은 이 테이블로 원자 판정한다 (크로스 인스턴스 안전):
--   ① 예약 행 INSERT(status='pending', results NULL)
--   ② 오늘(KST) 본인 행 수 COUNT — pending·done·failed 전부 포함
--      (실패한 분석도 쿼터를 소비한다 = 남용 방어 목적의 안전측 정책)
--   ③ 한도 초과면 자기 예약 행을 'failed' 로 갱신하고 429
--   insert-then-count 순서라 동시 N요청도 "한도+ε" 로 바운드된다
--   (ε = 거의 동시에 INSERT 한 트랜잭션들의 가시성 지연분).
--   ④ 파이프라인 성공 시 결과 UPDATE(status='done'), 실패 시 'failed'.
create table if not exists public.blog_check_reports (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles(id) on delete cascade,
  blog_id  text not null,
  run_at   timestamptz not null default now(),
  /** pending=예약(실행 중) / done=완료 / failed=실패·한도초과. */
  status   text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  /** 상세분석 결과 JSON. 예약(pending)·실패(failed) 행은 NULL. */
  results  jsonb
);

-- 완전 멱등 가드 — 미래에 이 파일의 "부분 적용된 과거 버전"(status 없던 초기안 등)
-- 위에서 재실행해도 안전하다. 신규 환경에서는 전부 no-op.
alter table public.blog_check_reports
  add column if not exists status text not null default 'pending';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'blog_check_reports_status_check'
      and conrelid = 'public.blog_check_reports'::regclass
  ) then
    alter table public.blog_check_reports
      add constraint blog_check_reports_status_check
      check (status in ('pending', 'done', 'failed'));
  end if;
end $$;
-- 이미 nullable 이어도 no-op (Postgres DROP NOT NULL 은 멱등)
alter table public.blog_check_reports alter column results drop not null;
-- status 없던 초기안 위에 재실행된 경우: 결과가 있는 기존 행은 완료로 백필
-- (ADD COLUMN 기본값 'pending'이 과거 완료 행을 예약으로 오표기하는 것 방지)
update public.blog_check_reports
  set status = 'done'
  where results is not null and status = 'pending';

comment on table public.blog_check_reports is
  '네이버 블로그 무료진단 상세분석 이력 + 일일 상한 원자 예약 행. 라이프사이클: pending(예약) → done(결과 저장)/failed(실패·한도초과). 일일 카운트는 status 무관 전부 포함(실패도 소비=안전측). blog_audits(컴플라이언스 소급진단)와 별도 스키마 — 혼용 금지.';
comment on column public.blog_check_reports.status is
  '예약 라이프사이클 — pending(INSERT 직후)·done(결과 UPDATE)·failed(파이프라인 실패 또는 한도 초과 판정).';
comment on column public.blog_check_reports.results is
  '진단 결과 JSON — version/blogId/점수(SEO·GEO)/키워드 실측/컴플라이언스 검출/제목 반복도/장단점. pending/failed 는 NULL.';

create index if not exists idx_blog_check_reports_user_id on public.blog_check_reports(user_id);
create index if not exists idx_blog_check_reports_run_at  on public.blog_check_reports(run_at desc);

-- RLS — 조회는 본인만(이력 화면용), **쓰기는 전부 service role 전용**.
--
-- insert/update 정책을 두지 않는 이유(캡 우회 차단):
--   본인 update 정책이 있으면 클라이언트가 anon 키로 자기 행의
--   run_at/status/results 를 직접 조작해 일일 상한 카운트를 우회할 수 있다.
--   예약 북키핑(INSERT·COUNT·상태 전이)은 detail 라우트가 service role 로만
--   수행한다 — user_id 는 항상 서버 세션에서 오므로 귀속 조작 여지 없음.
alter table public.blog_check_reports enable row level security;

drop policy if exists "사용자는 자신의 무료진단만 조회" on public.blog_check_reports;
create policy "사용자는 자신의 무료진단만 조회"
  on public.blog_check_reports for select
  using (auth.uid() = user_id);

-- 과거 초기안으로 부분 적용된 환경 대비 — 쓰기 정책이 있으면 제거(멱등)
drop policy if exists "사용자는 자신의 무료진단만 생성" on public.blog_check_reports;
drop policy if exists "사용자는 자신의 무료진단만 갱신" on public.blog_check_reports;

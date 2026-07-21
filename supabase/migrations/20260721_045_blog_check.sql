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

-- 2) blog_check_reports — 회원 상세분석 이력 (본인 것만, append-only)
create table if not exists public.blog_check_reports (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles(id) on delete cascade,
  blog_id  text not null,
  run_at   timestamptz not null default now(),
  results  jsonb not null
);

comment on table public.blog_check_reports is
  '네이버 블로그 무료진단 상세분석 결과(BlogCheckReport JSON + 상세 부가 섹션). blog_audits(컴플라이언스 소급진단)와 별도 스키마 — 혼용 금지.';
comment on column public.blog_check_reports.results is
  '진단 결과 JSON — version/blogId/점수(SEO·GEO)/키워드 실측/컴플라이언스 검출/제목 반복도/장단점.';

create index if not exists idx_blog_check_reports_user_id on public.blog_check_reports(user_id);
create index if not exists idx_blog_check_reports_run_at  on public.blog_check_reports(run_at desc);

-- RLS — 본인 row만 조회·생성 (blog_audits 패턴 동일, update/delete 정책 없음=불변 이력)
alter table public.blog_check_reports enable row level security;

drop policy if exists "사용자는 자신의 무료진단만 조회" on public.blog_check_reports;
create policy "사용자는 자신의 무료진단만 조회"
  on public.blog_check_reports for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 무료진단만 생성" on public.blog_check_reports;
create policy "사용자는 자신의 무료진단만 생성"
  on public.blog_check_reports for insert
  with check (auth.uid() = user_id);

-- 037 — AI 검색 인용 추적 (GEO 트래킹)
-- 환자들이 ChatGPT류 AI에게 "○○지역 △△과 어디가 좋아?"를 묻는 시대,
-- 우리 병원/블로그가 AI 답변에 인용되는지를 주기적으로 샘플링해 기록한다.
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).

create table if not exists public.geo_citations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  checked_at    timestamptz not null default now(),
  question      text not null,           -- AI에게 던진 샘플 질문
  engine        text not null,           -- 질의 엔진 ('openai' 등)
  cited         boolean not null,        -- 병원명 또는 블로그 URL 인용 여부
  citation_type text,                    -- 'hospital_name' | 'blog_url' | 'none'
  evidence      text,                    -- 인용 근거 발췌 (길이 제한·이스케이프된 최소 보관)
  raw           jsonb                    -- 출처 URL 목록 등 최소 메타 (전체 응답 원문은 저장하지 않음)
);

comment on table public.geo_citations is
  'AI 검색(GEO) 인용 추적 시계열. 주간 cron이 service role로 insert. 샘플링 결과라 실제 노출과 다를 수 있음.';
comment on column public.geo_citations.citation_type is
  '인용 유형: hospital_name(병원명 언급) / blog_url(블로그 URL 인용) / none(미인용)';
comment on column public.geo_citations.raw is
  '최소 메타(출처 URL·제목 상위 몇 건, 응답 발췌). 개인정보·전체 원문은 저장하지 않는다.';

create index if not exists idx_geo_citations_user_id    on public.geo_citations(user_id);
create index if not exists idx_geo_citations_checked_at on public.geo_citations(checked_at desc);

-- RLS — 본인 row만 select (post_rankings 패턴 동일)
-- insert/update/delete 정책은 두지 않는다 → cron은 service role(RLS 우회)로만 기록.
alter table public.geo_citations enable row level security;

drop policy if exists "사용자는 자신의 AI 검색 인용 기록만 조회" on public.geo_citations;
create policy "사용자는 자신의 AI 검색 인용 기록만 조회"
  on public.geo_citations for select
  using (auth.uid() = user_id);

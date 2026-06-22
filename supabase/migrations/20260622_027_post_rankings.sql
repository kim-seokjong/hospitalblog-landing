-- 027 — 발행글 네이버 검색순위 자동추적 (성과 리포트 탭)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).

-- 1) 발행 URL 캡처 컬럼 (nullable)
--    발행 성공 시 외부 발행서버가 반환한 글 URL을 보관 → 순위 매칭 정확도 향상
alter table public.saved_posts
  add column if not exists published_url text;

comment on column public.saved_posts.published_url is
  '발행된 글의 URL. null = 미발행 또는 URL 미수집(블로그ID 매칭으로 폴백)';

-- 2) 순위 추적 시계열 테이블
create table if not exists public.post_rankings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  post_id     uuid references public.saved_posts(id) on delete cascade,
  keyword     text not null,
  target_site text,
  rank        int,            -- null = 미발견(100위 밖) / 추정 순위(네이버 블로그 검색 관련도 기준)
  checked_at  timestamptz not null default now()
);

comment on table public.post_rankings is
  '발행글의 네이버 블로그 검색 추정 순위(관련도 sort=sim 기준) 시계열. cron이 service role로 insert.';
comment on column public.post_rankings.rank is
  '추정 순위(1-base). null = 100위 내 미발견. 정확한 웹 SERP 순위가 아니라 블로그 검색 관련도 기준 추정치.';

create index if not exists idx_post_rankings_user_id   on public.post_rankings(user_id);
create index if not exists idx_post_rankings_post_id   on public.post_rankings(post_id);
create index if not exists idx_post_rankings_checked_at on public.post_rankings(checked_at desc);

-- 3) RLS — 본인 row만 select (다른 마이페이지 테이블 RLS 패턴 동일)
--    insert/update/delete 정책은 두지 않는다 → cron은 service role(RLS 우회)로만 기록.
alter table public.post_rankings enable row level security;

drop policy if exists "사용자는 자신의 순위만 조회" on public.post_rankings;
create policy "사용자는 자신의 순위만 조회"
  on public.post_rankings for select
  using (auth.uid() = user_id);

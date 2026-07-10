-- 041 — 경쟁 병원 플레이스 스냅샷 (경쟁 종합 비교 · 추이 축적용)
-- /monitor 종합 비교에서 플레이스 상위노출·리뷰 수 조회 성공 시 스냅샷을 남겨,
-- 같은 회원·같은 검색어로 2회 이상 조회되면 리뷰 증가 추이(↑N)를 보여준다.
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).

create table if not exists public.competitor_place_snapshots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  search_query    text not null,            -- 예: "수성구 피부과" (추이 비교 키)
  hospital_name   text not null,            -- 플레이스 노출 병원명
  rank            integer,                  -- 검색 결과 내 노출 순위 (1부터, 확인 불가 시 null)
  visitor_reviews integer,                  -- 방문자 리뷰 수 (확인 불가 시 null)
  blog_reviews    integer,                  -- 블로그 리뷰 수 (확인 불가 시 null)
  searched_at     timestamptz not null default now()
);

comment on table public.competitor_place_snapshots is
  '경쟁 병원 플레이스 노출 순위·리뷰 수 스냅샷 시계열. 공개 검색 결과의 사실 수치만 보관(평가·추정치 없음).';
comment on column public.competitor_place_snapshots.search_query is
  '추이 비교 키. 같은 회원이 같은 검색어로 조회한 스냅샷끼리만 비교한다.';
comment on column public.competitor_place_snapshots.rank is
  '조회 시점의 검색 노출 순위. 상세 조회 실패 시 null (1차 지역검색 결과만 있을 때).';

create index if not exists idx_cps_user_query
  on public.competitor_place_snapshots(user_id, search_query, searched_at desc);
create index if not exists idx_cps_user_hospital
  on public.competitor_place_snapshots(user_id, hospital_name);

-- RLS — 본인 row만 조회/기록 (API route가 로그인 사용자 권한으로 insert)
alter table public.competitor_place_snapshots enable row level security;

drop policy if exists "사용자는 자신의 플레이스 스냅샷만 조회" on public.competitor_place_snapshots;
create policy "사용자는 자신의 플레이스 스냅샷만 조회"
  on public.competitor_place_snapshots for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 플레이스 스냅샷만 기록" on public.competitor_place_snapshots;
create policy "사용자는 자신의 플레이스 스냅샷만 기록"
  on public.competitor_place_snapshots for insert
  with check (auth.uid() = user_id);

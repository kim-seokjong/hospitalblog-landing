-- 043 — 병원 서브도메인 블로그 (clinic site MVP)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 회원 병원마다 {slug}.hospitalblog.kr 공개 블로그를 제공한다.
--       네이버 블로그 글은 ChatGPT(Bing)·Gemini(구글)에 인용되지 않으므로,
--       검수(의료광고법) 통과 글만 자체 도메인에 서버렌더 HTML+JSON-LD로
--       발행해 AI 검색 크롤링·인용 대상을 확보한다.
--
-- 1) profiles.site_slug — 서브도메인 주소 (소문자 영숫자+하이픈 3~30자, 전역 유일)
--    형식은 DB check 제약 + 앱 레벨(validateSlug) 이중 검증.
--    예약어(www/app/api/admin 등) 차단은 앱 레벨에서 수행한다
--    (src/content/lib/clinic-site/slug.ts — RESERVED_SLUGS).

alter table public.profiles
  add column if not exists site_slug text;

-- 형식 제약: 소문자 영숫자로 시작·끝, 중간은 소문자 영숫자+하이픈, 총 3~30자.
-- (null 은 제약을 통과한다 — 미설정 상태)
do $$
begin
  alter table public.profiles
    add constraint profiles_site_slug_format
    check (site_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');
exception
  when duplicate_object then null;
end $$;

-- 전역 유일 (null 은 중복 허용 — 미설정 회원 다수)
create unique index if not exists profiles_site_slug_key
  on public.profiles (site_slug);

comment on column public.profiles.site_slug is
  '병원 공개 블로그 서브도메인({slug}.hospitalblog.kr). 소문자 영숫자+하이픈 3~30자, 전역 유일. 예약어 차단은 앱 레벨(clinic-site/slug.ts).';

-- 2) saved_posts — 내 블로그 발행 상태

alter table public.saved_posts
  add column if not exists published_to_site boolean not null default false;

alter table public.saved_posts
  add column if not exists site_published_at timestamptz;

comment on column public.saved_posts.published_to_site is
  '병원 서브도메인 블로그 공개 여부. 검수(compliance_report) 통과 글만 true 가능 — 게이트는 /api/mypage/site-publish (geo-export와 동일 기준).';
comment on column public.saved_posts.site_published_at is
  '서브도메인 블로그 발행 시각. 발행 시 갱신, 발행 취소 시 null.';

-- 공개 페이지 조회용 부분 인덱스 (user_id + 발행글만)
create index if not exists idx_saved_posts_site_published
  on public.saved_posts (user_id, site_published_at desc)
  where published_to_site;

-- 3) RLS — 정책 추가하지 않음 (의도된 결정)
--    공개 페이지(/clinic-site/[slug])는 서버 컴포넌트에서 service role 로
--    "명시적 컬럼만" select 한다. anon select 정책을 열면 profiles 행 전체
--    (전화번호·알림설정 등 비공개 정보)가 노출될 수 있어 정책을 만들지 않는다.
--    기존 본인-소유 RLS(마이그 001/004/006)는 그대로 유효하다.

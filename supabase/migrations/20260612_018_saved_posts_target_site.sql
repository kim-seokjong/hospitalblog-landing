-- 콘텐츠 보관함: 게시 사이트(네이버/구글) 컬럼 추가
-- 기존 행은 null (게시 사이트 선택 기능 도입 전 = 네이버로 간주)
-- 적용 방법: Supabase SQL Editor에서 수동 실행

alter table public.saved_posts
  add column if not exists target_site text
  check (target_site is null or target_site in ('naver', 'google'));

comment on column public.saved_posts.target_site is
  '게시 사이트 (naver | google). null = 기능 도입 전 저장된 글 (네이버 간주)';

-- 028 — 프로필에 순위추적용 공개 네이버 블로그 주소 컬럼 추가
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 네이버 자동발행(쿠키 자동화)이 막혀 대부분 회원은 생성글을 복붙해
--       직접 발행한다. 순위 추적은 네이버 공개 검색이라 로그인/쿠키가 전혀
--       불필요하고 공개 블로그 ID만 있으면 된다. 그 ID를 자동발행 연동
--       (naver_credentials)과 분리해 프로필에서 별도로 입력받는다.

alter table public.profiles
  add column if not exists naver_blog_url text;

comment on column public.profiles.naver_blog_url is
  '순위추적용 공개 네이버 블로그 주소(로그인/쿠키 불필요). 자동발행 연동과 무관. 예: blog.naver.com/myclinic';

-- RLS: profiles 의 본인 update 정책(마이그 004 "사용자는 자신의 프로필만 수정")이
--      이미 모든 컬럼을 커버하므로 별도 정책 추가 불필요.

-- 042 — 프로필에 자사 채널 핸들 컬럼 추가 (내 채널 통합 뷰 · My Channels)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 경쟁사 종합 비교(스코어보드) 수집기를 "자사 채널"에도 재사용해,
--       회원이 자기 인스타·쓰레드·유튜브 공개 지표를 한눈에 보게 한다.
--       수집은 전부 공개 페이지/공식 API 기반이라 로그인·쿠키가 불필요하며,
--       프로필에 저장하는 값은 핸들·채널ID 문자열뿐이다(비밀정보 아님).
--       순위추적용 naver_blog_url(마이그 028)은 이미 있으므로 재사용한다(건드리지 않음).

alter table public.profiles
  add column if not exists instagram_handle text;

alter table public.profiles
  add column if not exists threads_handle text;

alter table public.profiles
  add column if not exists youtube_channel_id text;

comment on column public.profiles.instagram_handle is
  '자사 인스타그램 핸들(@ 제외). 공개 프로필 지표 조회용. SSRF 방어를 위해 읽기 시점에 정규식 재검증한다.';
comment on column public.profiles.threads_handle is
  '자사 쓰레드 핸들(@ 제외). 공개 프로필 지표 조회용.';
comment on column public.profiles.youtube_channel_id is
  '자사 유튜브 채널 ID(UC로 시작하는 24자). YouTube Data API v3 통계 조회용.';

-- RLS: profiles 의 본인 update 정책(마이그 004 "사용자는 자신의 프로필만 수정")이
--      이미 모든 컬럼을 커버하므로 별도 정책 추가 불필요.

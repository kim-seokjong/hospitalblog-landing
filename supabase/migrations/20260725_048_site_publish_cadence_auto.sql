-- 048 — 내 블로그 자동발행 주기에 'auto'(검수 통과 시 바로 발행) 추가
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 기존 주기는 weekly(주1회)/biweekly(격주)뿐이고 회당 1편만 발행해서,
--       AI 검색(ChatGPT·Gemini)이 인용할 만한 콘텐츠 밀도가 쌓이는 속도가 너무 느렸다.
--       'auto' 는 검수를 통과한 미발행 글이 있으면 기다리지 않고 발행한다.
--
-- 안전장치:
--  - 기본값은 그대로 'off'. 기존 회원의 값도 건드리지 않는다
--    (예고 없이 자동발행이 켜지면 안 된다).
--  - weekly/biweekly 의 동작(회당 1편)은 변경되지 않는다.
--  - 회당 상한은 앱 레벨에서 강제한다: auto = 하루 최대 3편
--    (cron 이 하루 1회 실행 → 실질 상한 3편/일).
--    근거는 src/content/lib/clinic-site/auto-publish.ts 의 CADENCE_MAX_POSTS_PER_RUN 주석.
--
-- 마이그 미적용 상태에서도 코드는 죽지 않는다:
--  - 'auto' 저장 시 23514(check 위반) → /api/profile 이 503 + 안내 메시지로 폴백.
--  - cron 은 DB 에 'auto' 행이 없으므로 기존과 동일하게 동작한다.

-- 기존 제약을 교체한다 (044 에서 만든 이름과 동일).
alter table public.profiles
  drop constraint if exists profiles_site_publish_cadence_check;

alter table public.profiles
  add constraint profiles_site_publish_cadence_check
  check (site_publish_cadence in ('off', 'auto', 'weekly', 'biweekly'));

comment on column public.profiles.site_publish_cadence is
  '내 블로그 정기 자동발행 주기. off(사용 안 함, 기본)/auto(검수 통과 시 바로, 하루 최대 3편)/weekly(주 1회 1편)/biweekly(격주 1편). 검수 통과·미발행 글만 대상. 게이트는 /api/cron/site-auto-publish (site-publish와 동일 기준).';

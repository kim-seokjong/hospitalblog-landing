-- 044 — 내 블로그(서브도메인) 정기 자동발행 스케줄
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 검수(의료광고법)를 이미 통과했지만 아직 서브도메인에 발행되지 않은 글을
--       회원이 설정한 주기로 하나씩 자동 발행해 "꾸준한 발행" 신선도 신호를
--       자동으로 만든다. 새 글을 생성하지 않으며(발행만 스케줄), 검수 통과 글만
--       대상이다. 실제 주기 판정·게이트 재검증은 앱 레벨에서 수행한다
--       (src/content/lib/clinic-site/auto-publish.ts + /api/cron/site-auto-publish).
--
-- 1) profiles.site_publish_cadence — 자동발행 주기
--    'off'(기본, 사용 안 함) | 'weekly'(주 1회) | 'biweekly'(격주)
--    회원이 명시적으로 켜야만(opt-in) 동작한다.

alter table public.profiles
  add column if not exists site_publish_cadence text not null default 'off';

-- 허용값 제약 (off/weekly/biweekly 만)
do $$
begin
  alter table public.profiles
    add constraint profiles_site_publish_cadence_check
    check (site_publish_cadence in ('off', 'weekly', 'biweekly'));
exception
  when duplicate_object then null;
end $$;

comment on column public.profiles.site_publish_cadence is
  '내 블로그 정기 자동발행 주기. off(사용 안 함)/weekly(주 1회)/biweekly(격주). 검수 통과·미발행 글만 대상, 주기당 1편. 게이트는 /api/cron/site-auto-publish (site-publish와 동일 기준).';

-- 2) profiles.site_publish_last_run — 마지막 자동발행 시각 (주기 경과 계산용)
--    실제로 1편이 발행된 시각만 기록한다(발행 대상이 없어 건너뛴 실행은 기록하지 않음).

alter table public.profiles
  add column if not exists site_publish_last_run timestamptz;

comment on column public.profiles.site_publish_last_run is
  '내 블로그 자동발행이 마지막으로 1편을 발행한 시각. isDue(주기 경과) 판정 기준. 발행 대상이 없어 건너뛴 실행은 갱신하지 않는다(대상이 생기는 즉시 발행).';

-- 3) RLS — 정책 추가하지 않음 (의도된 결정)
--    profiles 의 본인 update 정책(마이그 004 "사용자는 자신의 프로필만 수정")이
--    이미 모든 컬럼을 커버하므로 site_publish_cadence 저장에 별도 정책이 불필요하다.
--    자동발행 cron 은 service role 로 site_publish_last_run 을 갱신한다(RLS 우회).

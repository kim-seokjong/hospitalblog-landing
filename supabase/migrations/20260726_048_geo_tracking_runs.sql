-- 048 — GEO 인용 추적 cron 주차 실행 잠금
--
-- 문제: geo-tracking cron 이 동시에 두 번 호출되면 두 인스턴스가 모두
--       "이번 주 기록 없음"으로 판정해(TOCTOU) 외부 AI 검색 API 비용이 이중 발생하고
--       같은 주차 데이터가 중복 삽입되어 인용률 집계가 왜곡된다.
--       선조회 방식은 순차 재실행만 막을 뿐 동시 실행을 막지 못한다.
--
-- 해법: week_start(그 주 월요일, UTC)를 기본키로 둔 실행 레코드.
--       cron 은 **외부 API 를 호출하기 전에** insert 를 시도하고,
--       고유키 충돌(23505)이 나면 이미 실행 중/완료로 보고 즉시 종료한다.
--       insert 는 단일 SQL 문이라 원자적이므로 동시 실행에서도 정확히 하나만 통과한다.
--
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
-- ※ 미적용 상태에서도 코드는 죽지 않는다(42P01 폴백). 단 그때는 잠금이 없으므로
--   cron 응답의 lock.mode 가 'unavailable' 로 내려간다.

create table if not exists public.geo_tracking_runs (
  week_start   date primary key,          -- 그 주 월요일(UTC). 주 1회 cron의 실행 단위
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',  -- 'running' | 'done'
  users        integer,                   -- 저장 완료 회원 수 (관측용)
  inserted     integer,                   -- 삽입 행 수 (관측용)
  http_attempts integer                   -- 재시도 포함 실제 외부 HTTP 요청 수 (비용 관측)
);

comment on table public.geo_tracking_runs is
  'GEO 인용 추적 cron 의 주차 단위 실행 잠금 + 실행 기록. week_start 고유키 insert 로 동시 실행을 원자적으로 차단한다.';
comment on column public.geo_tracking_runs.status is
  'running = 실행 중(또는 비정상 종료). done = 정상 완료. running 이 오래 남아 있으면 cron 이 stale 판정 후 인계한다.';
comment on column public.geo_tracking_runs.http_attempts is
  '재시도를 포함한 실제 외부 API 요청 수. 비용 상한(MAX_HTTP_ATTEMPTS_PER_RUN) 대비 실사용 관측용.';

create index if not exists idx_geo_tracking_runs_started_at
  on public.geo_tracking_runs(started_at desc);

-- RLS — 운영 관측용 내부 테이블. 일반 사용자는 접근하지 않는다.
-- select 정책을 두지 않으므로 anon/authenticated 는 아무 행도 읽지 못하고,
-- cron 은 service role(RLS 우회)로만 읽고 쓴다. (geo_citations 와 동일한 운영 원칙)
alter table public.geo_tracking_runs enable row level security;

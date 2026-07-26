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

-- ★ status 가 'done' 이면 그 주는 영구히 잠긴다. 그래서 **완전 성공에만** done 을 찍고,
--   저장 실패·마감 중단·일부 회원 누락이 있으면 'failed' 로 마감해 재실행을 허용한다.
--   done 으로 찍어 버리면 앞쪽 청크만 저장된 반쪽 데이터가 그 주의 최종 결과로 확정된다
--   (돈은 다 쓰고 데이터는 반만 남는 상태를 복구할 수 없다).
--   재실행이 중복을 만들지 않는 것은 회원 단위 중복 조회(이미 저장된 회원 skip)가 보장한다.

create table if not exists public.geo_tracking_runs (
  week_start   date primary key,          -- 그 주 월요일(UTC). 주 1회 cron의 실행 단위
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',  -- 'running' | 'done' | 'failed'
  users        integer,                   -- 저장 완료 회원 수 (관측용)
  inserted     integer,                   -- 삽입 행 수 (관측용)
  http_attempts integer,                  -- 재시도 포함 실제 외부 HTTP 요청 수 (비용 관측)
  note         text                       -- 실패·중단 사유 (재실행 판단용)
);

-- 이미 적용한 DB 를 위한 컬럼 보강 (idempotent)
alter table public.geo_tracking_runs add column if not exists note text;

comment on table public.geo_tracking_runs is
  'GEO 인용 추적 cron 의 주차 단위 실행 잠금 + 실행 기록. week_start 고유키 insert 로 동시 실행을 원자적으로 차단한다.';
comment on column public.geo_tracking_runs.status is
  'running = 실행 중(또는 비정상 종료) / done = 완전 성공, 그 주 재실행 불가 / failed = 부분 실패, 재실행 허용. '
  'cron 은 failed 이거나 오래된 running 을 인계해 남은 회원만 이어서 처리한다.';
comment on column public.geo_tracking_runs.http_attempts is
  '재시도를 포함한 실제 외부 API 요청 수. 비용 상한(MAX_HTTP_ATTEMPTS_PER_RUN) 대비 실사용 관측용.';
comment on column public.geo_tracking_runs.note is
  'failed 로 마감된 사유. 대표가 수동 재실행 여부를 판단할 때 본다.';

create index if not exists idx_geo_tracking_runs_started_at
  on public.geo_tracking_runs(started_at desc);

-- RLS — 운영 관측용 내부 테이블. 일반 사용자는 접근하지 않는다.
-- select 정책을 두지 않으므로 anon/authenticated 는 아무 행도 읽지 못하고,
-- cron 은 service role(RLS 우회)로만 읽고 쓴다. (geo_citations 와 동일한 운영 원칙)
alter table public.geo_tracking_runs enable row level security;

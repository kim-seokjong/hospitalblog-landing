-- 035 — 월간 자동 성과 리포트 (구독 해지 방어)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   매월 1일 cron(/api/cron/monthly-report)이 활성 사용자(유료 플랜 보유 또는
--   지난달 글 생성 이력자)별로 지난달(YYYY-MM) 성과를 규칙 기반으로 집계해
--   monthly_reports 에 upsert(멱등)하고, 인앱 알림('monthly_report' 타입) 1건과
--   요약 이메일(Resend, 실패 무시)을 보낸다. LLM 호출 없음(비용 0).

-- 1) 월간 리포트 테이블
create table if not exists public.monthly_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  period     text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  data       jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, period)
);

comment on table public.monthly_reports is
  '월간 자동 성과 리포트(MonthlyReportData JSON). 매월 1일 cron이 service role로 upsert. (user_id, period) 유니크 → 재실행 안전.';
comment on column public.monthly_reports.period is
  '리포트 대상 월(KST 기준), 형식 YYYY-MM. 예: 2026-06';
comment on column public.monthly_reports.data is
  '규칙 기반 집계 스냅샷 — version/generatedAt/posts(생성·발행)/compliance(검사 건수)/rankings(추적 키워드·상위10 진입·순위 상승 상위5)/usage(생성 횟수·한도)/actions(다음 달 추천 액션 1~3개).';

create index if not exists idx_monthly_reports_user_id on public.monthly_reports(user_id);
create index if not exists idx_monthly_reports_period  on public.monthly_reports(period);

-- 2) RLS — 본인 row만 select (post_rankings 등 기존 테이블 RLS 패턴 동일)
--    insert/update/delete 정책은 두지 않는다 → cron은 service role(RLS 우회)로만 기록.
alter table public.monthly_reports enable row level security;

drop policy if exists "사용자는 자신의 월간 리포트만 조회" on public.monthly_reports;
create policy "사용자는 자신의 월간 리포트만 조회"
  on public.monthly_reports for select
  using (auth.uid() = user_id);

-- 3) notifications.type CHECK 제약에 'monthly_report' 추가 (021 admin_notice 패턴 동일)
--    기존 행은 그대로 유효하다 (기존 타입은 모두 새 제약에도 포함됨).
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'usage_warning',
    'plan_expiry_7d',
    'plan_expiry_1d',
    'payment_success',
    'plan_upgraded',
    'admin_notice',
    'monthly_report'
  ));

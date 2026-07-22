-- 047 — 이탈 사유 수집 + 체험 D-3 리포트 알림 타입
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   ① churn_reasons — 자동결제 취소·체험 만료 시 간단 사유 1문항 수집(수집 경로).
--      과설계 금지: 사유 코드(화이트리스트)+선택 자유서술만. 쓰기는 service role 전용.
--   ② notifications.type 에 'trial_report' 추가 — 체험 종료 D-3 성과 리포트를
--      인앱 알림으로 전달할 때 사용(035 monthly_report 패턴 동일). 실발송 게이트는
--      코드(ENABLE_TRIAL_REPORT_SEND)에서 관리 — 기본 OFF.

-- 1) churn_reasons — 이탈 사유
create table if not exists public.churn_reasons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  /** 화이트리스트 코드 — src/content/lib/churn-reasons.ts CHURN_REASON_CODES 와 동기화. */
  reason     text not null,
  /** 선택 자유서술 (정규화·길이 제한된 텍스트, 없으면 null). */
  detail     text,
  /** 수집 맥락(예: auto_cancel / trial_expired / mypage). */
  source     text not null default 'mypage',
  created_at timestamptz not null default now()
);

comment on table public.churn_reasons is
  '이탈 사유 수집(자동결제 취소·체험 만료). reason=화이트리스트 코드, detail=선택 자유서술. 쓰기는 service role(/api/churn-reason) 전용. 과설계 금지 — 수집 경로만.';

create index if not exists idx_churn_reasons_user_id    on public.churn_reasons(user_id);
create index if not exists idx_churn_reasons_created_at on public.churn_reasons(created_at desc);

-- RLS: 정책 없이 활성화만 → 클라 직접 접근 차단, service role(엔드포인트)만 사용.
alter table public.churn_reasons enable row level security;

-- 2) notifications.type CHECK 제약에 'trial_report' 추가 (035 패턴 동일, 멱등).
--    기존 타입은 모두 새 제약에도 포함된다.
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
    'monthly_report',
    'trial_report'
  ));

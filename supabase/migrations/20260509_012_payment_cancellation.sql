-- 결제 취소(환불) 관련 컬럼 추가
-- 포트원 Transaction.Cancelled 웹훅 수신 시 채워진다.
alter table public.payments
  add column if not exists cancellation_id text,
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancel_reason   text;

create index if not exists payments_cancelled_at_idx
  on public.payments(cancelled_at desc)
  where status = 'CANCELLED';

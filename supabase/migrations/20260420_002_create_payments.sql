-- payments 테이블: 결제 내역 (포트원 paymentId = PK)
create table if not exists public.payments (
  id              text primary key,           -- 포트원 paymentId (서버 발급 UUID)
  user_id         uuid not null references auth.users(id) on delete restrict,
  plan            text not null check (plan in ('basic','standard','pro')),
  amount          integer not null,            -- KRW 정수
  currency        text not null default 'KRW',
  status          text not null default 'PENDING'
                  check (status in ('PENDING','PAID','FAILED','CANCELLED','VIRTUAL_ACCOUNT_ISSUED')),
  pg_provider     text,
  pg_tx_id        text,
  payment_method  text,
  card_name       text,
  receipt_url     text,
  raw_response    jsonb,
  failure_reason  text,
  paid_at         timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists payments_user_id_idx on public.payments(user_id, created_at desc);
create index if not exists payments_status_idx  on public.payments(status);
create index if not exists payments_pg_tx_id_idx on public.payments(pg_tx_id);

alter table public.payments enable row level security;

create policy "사용자는 자신의 결제 내역만 조회"
  on public.payments for select
  using (auth.uid() = user_id);

-- webhook_events: 포트원 웹훅 멱등 처리용
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'portone',
  event_type   text not null,
  payment_id   text,
  signature    text,
  payload      jsonb not null,
  processed    boolean not null default false,
  processed_at timestamptz,
  error        text,
  received_at  timestamptz default now(),

  unique (provider, event_type, payment_id, signature)
);

alter table public.webhook_events enable row level security;
-- 웹훅 이벤트는 서버(service_role)만 접근

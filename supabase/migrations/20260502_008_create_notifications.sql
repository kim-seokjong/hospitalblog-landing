-- 알림 테이블 (사용량 임박, 플랜 만료)
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null
    check (type in ('usage_warning','plan_expiry_7d','plan_expiry_1d','payment_success','plan_upgraded')),
  title      text not null,
  message    text not null,
  is_read    boolean not null default false,
  sent_sms   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "사용자는 자신의 알림만 조회"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 알림만 수정"
  on public.notifications for update
  using (auth.uid() = user_id);

create index idx_notifications_user_id on public.notifications(user_id);
create index idx_notifications_is_read on public.notifications(user_id, is_read);

-- profiles 테이블: auth.users의 플랜/사용량 정보
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  plan            text not null default 'free'
                  check (plan in ('free','basic','standard','pro')),
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  usage_count     integer not null default 0,
  usage_reset_at  timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "사용자는 자신의 프로필만 조회"
  on public.profiles for select
  using (auth.uid() = id);

-- 신규 가입 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

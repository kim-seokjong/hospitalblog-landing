-- 팀 계정 (멤버 초대 / 공유 계정)
create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  member_id   uuid references public.profiles(id) on delete set null,
  email       text not null,
  role        text not null default 'member'
    check (role in ('owner','admin','member')),
  status      text not null default 'pending'
    check (status in ('pending','active','removed')),
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz
);

alter table public.team_members enable row level security;

create policy "팀 오너는 멤버 조회 가능"
  on public.team_members for select
  using (auth.uid() = owner_id or auth.uid() = member_id);

create policy "팀 오너만 초대 가능"
  on public.team_members for insert
  with check (auth.uid() = owner_id);

create policy "팀 오너만 멤버 수정 가능"
  on public.team_members for update
  using (auth.uid() = owner_id);

create unique index idx_team_members_owner_email on public.team_members(owner_id, email);

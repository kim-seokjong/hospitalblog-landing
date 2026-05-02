-- 콘텐츠 저장함
create table if not exists public.saved_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  content       text not null,
  keyword       text,
  tags          text[],
  specialty     text,
  seo_score     int,
  image_urls    text[],
  sns_copy      text,
  sms_copy      text,
  status        text not null default 'draft'
    check (status in ('draft','scheduled','published')),
  scheduled_at  timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.saved_posts enable row level security;

create policy "사용자는 자신의 저장글만 조회"
  on public.saved_posts for select
  using (auth.uid() = user_id);

create policy "사용자는 자신의 저장글만 생성"
  on public.saved_posts for insert
  with check (auth.uid() = user_id);

create policy "사용자는 자신의 저장글만 수정"
  on public.saved_posts for update
  using (auth.uid() = user_id);

create policy "사용자는 자신의 저장글만 삭제"
  on public.saved_posts for delete
  using (auth.uid() = user_id);

create index idx_saved_posts_user_id on public.saved_posts(user_id);
create index idx_saved_posts_created_at on public.saved_posts(created_at desc);

create or replace function update_saved_posts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_saved_posts_updated_at
  before update on public.saved_posts
  for each row execute function update_saved_posts_updated_at();

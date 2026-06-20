-- 2026-06 ClinicFlix 고객정보 수집 — 브랜드킷(원장 미디어 포함) + 사진 보관함 + Storage
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--    (#019 / #021 / #022 / #023 과 동일한 수동 적용 정책)
--
-- 목적:
--   마이페이지에서 병원의 브랜드킷(로고/색상/고정 해시태그/음성·톤/카드뉴스 스타일/쇼츠 콘셉트/
--   원장 사진·영상)과 실제 병원 사진(외관/내부/장비/의료진/기타)을 수집해, 변환(/convert) 시
--   brand 페이로드로 ClinicFlix 서비스에 전달한다.
--
-- 정합성:
--   - 전부 idempotent (add column if not exists / create table if not exists /
--     drop policy if exists 후 create / on conflict do nothing).
--   - 신규 컬럼은 전부 nullable → 기존 profiles 행에 영향 없음(변환 시 코드에서 기본값 폴백).

-- ── 1) profiles 브랜드킷 컬럼 ───────────────────────────────────────────────
alter table public.profiles add column if not exists clinic_logo_url text;
alter table public.profiles add column if not exists clinic_brand_color text;
alter table public.profiles add column if not exists clinic_hashtags text[];
alter table public.profiles add column if not exists clinic_voice_gender text;
alter table public.profiles add column if not exists clinic_threads_tone text;
alter table public.profiles add column if not exists clinic_cardnews_style int;
alter table public.profiles add column if not exists clinic_shorts_concept text;
alter table public.profiles add column if not exists clinic_doctor_photo_url text;
alter table public.profiles add column if not exists clinic_doctor_video_url text;

-- ── 2) 사진 보관함 테이블 ───────────────────────────────────────────────────
create table if not exists public.clinic_photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null,
  url        text not null,
  consent    boolean not null default false,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists clinic_photos_user_id_idx on public.clinic_photos(user_id);

alter table public.clinic_photos enable row level security;

-- 소유자(auth.uid() = user_id)만 select/insert/delete 가능
drop policy if exists "clinic_photos_select_own" on public.clinic_photos;
create policy "clinic_photos_select_own" on public.clinic_photos
  for select using (auth.uid() = user_id);

drop policy if exists "clinic_photos_insert_own" on public.clinic_photos;
create policy "clinic_photos_insert_own" on public.clinic_photos
  for insert with check (auth.uid() = user_id);

drop policy if exists "clinic_photos_delete_own" on public.clinic_photos;
create policy "clinic_photos_delete_own" on public.clinic_photos
  for delete using (auth.uid() = user_id);

-- ── 3) Storage 버킷 (public 읽기, CDN) ──────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('clinic-assets', 'clinic-assets', true)
on conflict (id) do nothing;

-- ── 4) Storage RLS — 본인 폴더(${auth.uid()}/...)에만 쓰기/수정/삭제 ─────────
-- 경로 규칙: {user_id}/{kind}/{uuid}.{ext} → 첫 폴더 세그먼트가 본인 uid 이어야 한다.
-- public 버킷이라 읽기(SELECT)는 CDN 으로 공개되므로 별도 정책 불필요.
drop policy if exists "clinic_assets_insert_own" on storage.objects;
create policy "clinic_assets_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'clinic-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "clinic_assets_update_own" on storage.objects;
create policy "clinic_assets_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'clinic-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'clinic-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "clinic_assets_delete_own" on storage.objects;
create policy "clinic_assets_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'clinic-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 적용: Supabase Dashboard → SQL Editor에 붙여넣고 Run
-- ─────────────────────────────────────────────────────────────────────────────

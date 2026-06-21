-- 025 — 원장님 미디어 AI 생성·발행 동의 플래그
-- 적용: Supabase SQL Editor 수동 실행 (idempotent)
alter table public.profiles
  add column if not exists clinic_doctor_consent boolean not null default false;

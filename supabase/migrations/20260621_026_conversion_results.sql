-- 026 — 멀티채널 변환 결과 영구 저장 컬럼 (Supabase SQL Editor 수동 적용, idempotent)
alter table public.clinicflix_conversions
  add column if not exists result_assets jsonb,
  add column if not exists result_saved_at timestamptz;

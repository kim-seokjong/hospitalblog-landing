-- 2026-06 플랜 개편: ClinicFlix 번들 플랜(growth8_standard / pro12_pro) 추가
--
-- profiles.plan / payments.plan 의 CHECK 제약을 확장해 신규 번들 플랜 ID를 허용한다.
-- 기존 'free' / 'basic'(레거시) / 'standard' / 'pro' 행은 그대로 유효해야 한다.
-- billing_keys.plan 은 CHECK 제약이 없으므로 변경 불필요.
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--    'basic' 은 신규 판매를 중단했으나(공개 비노출) 기존 구독자 enforce 를 위해
--    제약 집합에 그대로 유지한다. 절대 제거하지 말 것.

-- ── profiles.plan CHECK 확장 ──────────────────────────────────────────────
-- 기존 제약명은 테이블 생성 시 자동 부여된 'profiles_plan_check' 이다.
-- 환경에 따라 제약명이 다를 수 있으므로 IF EXISTS 로 안전하게 제거 후 재생성한다.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free','basic','standard','pro','growth8_standard','pro12_pro'));

-- ── payments.plan CHECK 확장 ──────────────────────────────────────────────
-- 기존: check (plan in ('basic','standard','pro')) — 'free' 는 결제 대상이 아님.
-- 레거시 basic 결제 내역 보존 + 신규 번들 플랜 결제 허용.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_plan_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_plan_check
  CHECK (plan IN ('basic','standard','pro','growth8_standard','pro12_pro'));

-- 참고: 영상/채널 사용량 enforce(plan.limits.video / limits.channels / fairUseCap)는
-- ClinicFlix 생성 파이프라인 연동 시 별도 카운터/ RPC 로 추가 예정.
-- TODO(clinicflix-integration): consume_video_usage / consume_channel_usage RPC + 컬럼 추가.

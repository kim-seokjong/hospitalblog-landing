-- 2026-07-31 플랜 개편: 발행 대행 "케어" 플랜 2종 추가 (standard_care / growth_care)
--
-- profiles.plan / payments.plan 의 CHECK 제약을 확장해 신규 케어 플랜 ID를 허용한다.
-- pro / pro12_pro 는 2026-07-31부로 신규 판매를 중단했지만(공개 비노출)
-- 기존 구독자 행이 유효해야 하므로 제약 집합에 그대로 유지한다. 절대 제거하지 말 것.
-- billing_keys.plan 은 CHECK 제약이 없으므로 변경 불필요 (019 와 동일).
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
-- ⚠️ 적용 전까지 케어 플랜 결제는 DB insert 단계에서 거부된다 — 배포 후 즉시 적용 필요.

-- ── profiles.plan CHECK 확장 ──────────────────────────────────────────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free','basic','standard','standard_care','pro','growth8_standard','growth_care','pro12_pro'));

-- ── payments.plan CHECK 확장 ──────────────────────────────────────────────
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_plan_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_plan_check
  CHECK (plan IN ('basic','standard','standard_care','pro','growth8_standard','growth_care','pro12_pro'));

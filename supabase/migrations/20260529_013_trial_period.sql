-- 1개월 무료 체험: 신규 가입자에게 첫 달 0원 혜택
-- trial_until > now() 인 동안은 무료 체험 중, 이후 정상 자동결제

ALTER TABLE billing_keys
  ADD COLUMN IF NOT EXISTS trial_until timestamptz;

COMMENT ON COLUMN billing_keys.trial_until IS '무료 체험 종료 시각 (NULL = 무료 체험 없음, > now() = 체험 중)';

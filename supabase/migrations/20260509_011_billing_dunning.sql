-- billing_keys: Dunning(자동 재시도/해지) 추적 컬럼 추가
-- 방통위 자동갱신 컴플라이언스 + Cron 멱등 처리용

ALTER TABLE billing_keys
  ADD COLUMN IF NOT EXISTS last_charge_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_charge_status text,            -- SUCCESS | FAILED
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notify_sent_at timestamptz;         -- 결제 7일 전 사전고지 발송 시각

-- 결제 예정일 인덱스 (cron 일괄 조회 성능)
CREATE INDEX IF NOT EXISTS billing_keys_next_billing_at_idx
  ON billing_keys(next_billing_at)
  WHERE status = 'ACTIVE';

-- last_charge_attempt_at 인덱스 (재시도/해지 cron 조회용)
CREATE INDEX IF NOT EXISTS billing_keys_last_attempt_status_idx
  ON billing_keys(last_charge_attempt_at, last_charge_status)
  WHERE status = 'ACTIVE';

COMMENT ON COLUMN billing_keys.last_charge_attempt_at IS '마지막 자동결제 시도 시각 (성공/실패 무관)';
COMMENT ON COLUMN billing_keys.last_charge_status IS '마지막 시도 결과: SUCCESS | FAILED';
COMMENT ON COLUMN billing_keys.failure_count IS '연속 결제 실패 횟수 (성공 시 0으로 리셋)';
COMMENT ON COLUMN billing_keys.notify_sent_at IS '결제 7일 전 사전고지 메일 발송 시각 (멱등 처리용)';

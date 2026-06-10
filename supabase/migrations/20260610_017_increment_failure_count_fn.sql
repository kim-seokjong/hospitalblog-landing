-- billing_keys.failure_count 원자적 증가 함수
-- fetch-then-update 패턴의 race condition 제거용
CREATE OR REPLACE FUNCTION increment_billing_failure_count(p_key_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE billing_keys
  SET failure_count = failure_count + 1,
      updated_at    = NOW()
  WHERE id = p_key_id;
$$;

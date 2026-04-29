-- billing_keys: 정기결제 빌링키 저장
CREATE TABLE IF NOT EXISTS billing_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  billing_key     text        NOT NULL,
  plan            text        NOT NULL,
  card_name       text,
  card_last4      text,
  status          text        NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | CANCELLED
  next_billing_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_keys_user_id_status_idx
  ON billing_keys(user_id, status);

ALTER TABLE billing_keys ENABLE ROW LEVEL SECURITY;

-- 서비스 롤만 접근 (클라이언트 직접 접근 차단)
CREATE POLICY "서비스 롤 전용" ON billing_keys
  AS RESTRICTIVE
  USING (false)
  WITH CHECK (false);

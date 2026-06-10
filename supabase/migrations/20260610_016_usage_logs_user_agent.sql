-- usage_logs에 user_agent 컬럼 추가
-- user_id는 테이블 생성 시 이미 존재하나 값이 저장되지 않았으므로 함께 활성화
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

COMMENT ON COLUMN usage_logs.user_agent IS 'HTTP User-Agent 헤더 (PC/모바일 구분용)';
COMMENT ON COLUMN usage_logs.user_id   IS '요청한 사용자 UUID (auth.users.id)';

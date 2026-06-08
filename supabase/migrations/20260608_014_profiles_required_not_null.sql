-- ============================================================================
-- 회원가입 필수 프로필 필드 NOT NULL 제약 (3중 검증의 DB 계층)
-- 대상 컬럼: full_name(성함), phone(연락처), hospital_name(병원명),
--            position(직책), hospital_type(병원유형)
--   ※ hospital_address(병원주소)는 선택 항목이므로 NOT NULL 제외
--
-- ⚠️ 실행 전 반드시 확인하세요 ⚠️
--   기존에 위 컬럼이 NULL인 행이 하나라도 있으면 ALTER ... SET NOT NULL 이 실패합니다.
--   (유령 계정 / 자동 트리거로 생성됐으나 프로필 미완성인 행 등)
--   아래 조회 쿼리로 NULL 행을 먼저 확인하고, 정리(또는 채움) 후 SET NOT NULL 을 실행하세요.
--   NULL 행 "삭제"는 결제/사용량 데이터 손실 위험이 있으니 수동 판단으로 신중히 처리하세요.
--
--   [NULL 행 확인 쿼리 — SET NOT NULL 실행 전에 먼저 돌려보세요]
--   select id, email, full_name, phone, hospital_name, "position", hospital_type, created_at
--     from public.profiles
--    where full_name     is null
--       or phone         is null
--       or hospital_name is null
--       or "position"    is null
--       or hospital_type is null;
--
-- 멱등성: NOT NULL 에는 IF NOT EXISTS 구문이 없으나, 이미 NOT NULL 인 컬럼에
--         다시 SET NOT NULL 을 적용해도 에러 없이 무해하게 통과합니다(재실행 안전).
-- ============================================================================

-- hospital_type 컬럼은 별도 create/alter 마이그레이션 없이 운영 DB에 추가되어 있을 수 있어,
-- NOT NULL 적용 전에 컬럼 존재를 안전하게 보장한다(이미 있으면 무시됨).
alter table public.profiles
  add column if not exists hospital_type text;

-- 필수 컬럼 NOT NULL 제약 추가
-- position 은 SQL 예약어이므로 큰따옴표로 식별자 인용
alter table public.profiles alter column full_name     set not null;
alter table public.profiles alter column phone         set not null;
alter table public.profiles alter column hospital_name set not null;
alter table public.profiles alter column "position"    set not null;
alter table public.profiles alter column hospital_type set not null;

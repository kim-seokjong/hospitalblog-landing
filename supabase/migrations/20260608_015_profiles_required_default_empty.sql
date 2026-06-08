-- ============================================================================
-- 014(필수 컬럼 NOT NULL)와 가입 트리거(handle_new_user)의 충돌 해소
--
-- 문제: 20260420_001 의 handle_new_user() 트리거는 auth.users 생성 시
--       profiles 에 (id, email) 만 insert 한다. 014 에서 full_name/phone/
--       hospital_name/position/hospital_type 에 NOT NULL 을 걸면서, 트리거의
--       bare insert 가 NOT NULL 위반으로 실패 → auth.users insert 롤백 →
--       회원가입(auth.signUp) 자체가 전부 실패하는 회귀 발생.
--
-- 해결: 위 5개 컬럼에 DEFAULT '' 를 부여. 트리거의 bare insert 는 빈 문자열로
--       채워져 NOT NULL 을 통과하고, 실제 값은 /api/auth/register 의 upsert 가
--       채운다. 빈 프로필(빈 문자열)은 클라이언트/서버 검증 + 진입 게이팅
--       (app/page.tsx)이 차단하므로 "필수항목 미입력 가입 차단" 목표는 유지된다.
--       (DB NOT NULL 은 literal NULL 방어, 빈값 방어는 앱 계층이 담당)
--
-- 멱등성: SET DEFAULT 는 재실행 안전.
-- ============================================================================

alter table public.profiles alter column full_name     set default '';
alter table public.profiles alter column phone         set default '';
alter table public.profiles alter column hospital_name set default '';
alter table public.profiles alter column "position"    set default '';
alter table public.profiles alter column hospital_type set default '';

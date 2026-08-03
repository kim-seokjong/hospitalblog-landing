-- 2026-08-03 주간점검 교차검증(Codex 6라운드) 후속 — 케어 위임 보유기간 + 결제 무결성
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--    ([[project_doctorpost_supabase_migration_manual]])
--
-- ⚠️ 코드는 이 컬럼들이 **아직 없어도 동작**한다(없으면 기존 동작으로 떨어진다).
--    다만 적용 전까지는 아래 방어들이 꺼져 있다.
--
-- ⚠️⚠️ **하나뿐인 순서 제약**: `CARE_CREDENTIALS_KEY_V2` 이상(새 키)을 환경변수에
--    넣기 **전에** 이 마이그레이션을 먼저 적용할 것. key_version 컬럼이 없는 상태에서
--    새 키로 암호화하면 어느 키로 잠갔는지 남길 곳이 없어 복호화 불가가 된다.
--    (코드가 이 경우 v1 로 되돌려 암호화하도록 막아 두긴 했지만, 순서를 지키면
--     그 폴백 자체가 필요 없다. 지금은 새 키가 없으므로 당장은 해당 없음.)
--
-- 배경: 케어 플랜은 병원의 네이버 계정 비밀번호를 위탁받는다. 임시 방어(열람 시
--       구독 재확인, 일 1회 파기 스윕)로는 못 닫는 구멍이 남아 있었다.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 자격증명 암호화 키 버전
--
-- 문제: 암호문에 키 버전이 없어 `CARE_CREDENTIALS_KEY` 를 교체하는 순간 **기존
--       자격증명 전량이 복호화 불가**가 된다. 키 유출처럼 즉시 갈아야 하는 상황에서
--       "먼저 재암호화 스크립트를 돌리세요" 는 답이 아니다.
-- 해법: 행마다 어느 키로 잠겼는지 남긴다. 앱은 새 키로 암호화하고, 복호화는
--       행에 적힌 버전의 키로 한다(구키를 env 에 남겨두면 무중단 순환).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.care_onboarding
  ADD COLUMN IF NOT EXISTS key_version smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.care_onboarding.key_version IS
  '자격증명 암호화에 쓴 CARE_CREDENTIALS_KEY 버전. 1=CARE_CREDENTIALS_KEY, N=CARE_CREDENTIALS_KEY_V{N}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 계약 인스턴스 + 파기 기록
--
-- 문제 (a): 자격증명이 **어느 계약의 위임인지** 알 수 없다. 구독이 만료되고 파기
--          스윕(일 1회)이 돌기 전에 재구독하면, 지난 계약에서 받은 비밀번호가
--          재제출·재동의 없이 되살아난다. 위임 동의는 그 계약의 동의였다.
--          → 제출 시점의 **활성 빌링키 id** 를 계약 식별자로 쓴다. 갱신은 같은
--            빌링키 행을 쓰고, 재구독은 새 행을 만들므로 이 값이 계약을 정확히 가른다
--            (`plan_started_at` 은 갱신마다 갱신돼서 못 쓴다).
--
-- 문제 (b): 파기 사유를 둘 자리가 없어 고객 요청사항(`note`)을 덮어썼다.
--          기록을 남기려고 행을 보존하면서 그 기록을 지우는 자기모순이었다.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.care_onboarding
  ADD COLUMN IF NOT EXISTS billing_key_id uuid,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

COMMENT ON COLUMN public.care_onboarding.billing_key_id IS
  '위임을 받은 시점의 활성 빌링키 id = 계약 인스턴스. 현재 활성 빌링키와 다르면 지난 계약의 위임이다';
COMMENT ON COLUMN public.care_onboarding.revoked_at IS '위임 철회·자동 파기 시각';
COMMENT ON COLUMN public.care_onboarding.revocation_reason IS '철회·파기 사유 (note 를 덮어쓰지 않는다)';

-- ★ 기존 행 백필 — 이게 없으면 **이미 제출된 위임은 계약 방어가 영구히 꺼진다.**
--
-- ⚠️ 다만 **무조건 현재 키를 박으면 안 된다.** "만료 → 파기 스윕 전에 재구독 → 그
--    상태에서 이 마이그레이션 적용" 이면, 지난 계약의 자격증명에 **새 계약의 키가
--    찍혀** 정확히 이 기능이 막으려던 열람이 허용된다.
--
--    그래서 **제출이 그 빌링키보다 나중일 때만** 백필한다
--    (`care_onboarding.updated_at >= billing_keys.created_at`).
--    그 조건을 못 채운 행은 제출 시점 계약을 사후에 복원할 방법이 없으므로 NULL 로
--    남기고, 앱은 NULL 을 **열람 거부**로 처리한다 — 고객에게 다시 받으면 된다.
--    민감 자격증명에서 "아마 맞을 것" 으로 문을 열어주는 것보다 낫다.
UPDATE public.care_onboarding co
   SET billing_key_id = bk.id
  FROM (
    SELECT DISTINCT ON (user_id) user_id, id, created_at
      FROM public.billing_keys
     WHERE status = 'ACTIVE'
     ORDER BY user_id, created_at DESC
  ) bk
 WHERE co.user_id = bk.user_id
   AND co.billing_key_id IS NULL
   AND co.status <> 'revoked'
   AND co.updated_at >= bk.created_at;

-- 파기 스윕이 커서로 훑을 때 쓰는 정렬 인덱스 (updated_at, user_id 복합 = 유일 정렬)
CREATE INDEX IF NOT EXISTS care_onboarding_sweep_idx
  ON public.care_onboarding (updated_at, user_id)
  WHERE status <> 'revoked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 업그레이드 결제의 "후처리 완료" 상태
--
-- 문제: 차액이 승인(PAID)된 뒤 플랜 반영이 실패하면, 결제는 성공인데 플랜은 그대로다.
--       이 상태를 표시할 곳이 없어서 "최근 N시간 안의 PAID 결제" 라는 시간 추정으로
--       복구했다. 창을 넘기면(고객이 다음 날 다시 눌렀다면) 같은 차액이 또 청구된다.
-- 해법: 후처리가 끝난 시각을 남긴다. 미완료 PAID 는 시간 제한 없이 안전하게 찾는다.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS post_processed_at timestamptz;

COMMENT ON COLUMN public.payments.post_processed_at IS
  '결제 이후 플랜 반영까지 끝난 시각. PAID 인데 이 값이 비어 있으면 후처리 미완료 = 복구 대상';

-- 미완료 PAID 를 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS payments_unapplied_paid_idx
  ON public.payments (user_id, plan)
  WHERE status = 'PAID' AND post_processed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 플랜 변경 원자적 claim (동시 요청 TOCTOU 차단)
--
-- 문제: "현재 플랜 읽기 → 차액 계산 → 카드 승인" 이 잠금 없이 돈다. 더블클릭·탭
--       두 개·네트워크 재시도로 두 요청이 겹치면 **둘 다 검사를 통과해 같은 차액이
--       두 번 승인**된다. 조회 기반 방어(최근 PENDING 확인)는 두 요청이 동시에
--       조회하면 둘 다 "없음" 을 보므로 원리적으로 못 막는다.
-- 해법: user_id 를 기본키로 둔 claim 행. INSERT 가 성공한 요청만 진행한다 —
--       판정을 DB 의 유니크 제약에 맡기므로 경쟁이 존재할 수 없다.
--       회원당 동시 진행 중인 플랜 변경은 하나뿐이어야 하므로 PK 는 user_id 단독이다.
--
-- 죽은 claim(프로세스가 중간에 죽어 DELETE 를 못 한 경우)은 claimed_at 기준으로
-- 앱이 조건부 UPDATE 로 인수한다 — 영구 잠금이 되지 않게.
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ `owner_token` 이 필요한 이유: TTL 인수가 일어난 뒤, **늦게 끝난 이전 요청**이
--    finally 에서 claim 을 지우면 새 소유자의 잠금까지 날아간다. 그러면 세 번째
--    요청이 잠금을 새로 잡아 두 요청이 동시에 카드를 긁을 수 있다.
--    해제는 "내가 잡은 그 claim" 일 때만 해야 한다.
CREATE TABLE IF NOT EXISTS public.plan_change_claims (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan        text NOT NULL,
  owner_token uuid NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_change_claims IS
  '플랜 변경 동시 실행 방지용 원자적 claim. 진행 중인 요청 1건만 행을 갖는다(완료 시 삭제)';

-- RLS: 정책 없이 활성화 = 클라이언트 접근 전면 차단. 서버(service role) 전용.
ALTER TABLE public.plan_change_claims ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 적용 후 확인 (선택)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'care_onboarding'
--      AND column_name IN ('key_version','billing_key_id','revoked_at','revocation_reason');
--   -- 4행이 나와야 한다
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'payments' AND column_name = 'post_processed_at';
--   -- 1행
--
--   SELECT to_regclass('public.plan_change_claims');
--   -- plan_change_claims
-- ─────────────────────────────────────────────────────────────────────────────

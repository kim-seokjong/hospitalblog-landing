-- 2026-07-31 케어 플랜 온라인 온보딩: 계정 위임 정보 저장 테이블
--
-- 케어 플랜(standard_care / growth_care) 구독자가 마이페이지에서 제출하는
-- 발행 대행용 채널 계정 정보. 비밀번호는 앱 레이어에서 AES-256-GCM 으로
-- 암호화된 문자열(*_pw_enc)만 저장한다 — 평문 저장 절대 금지.
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.

CREATE TABLE IF NOT EXISTS public.care_onboarding (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  blog_id      text NOT NULL,
  blog_pw_enc  text,             -- 암호화된 네이버 비밀번호. 위임 철회 시 NULL(파기)
  insta_id     text,             -- 올인원 케어만 해당 (선택)
  insta_pw_enc text,
  publish_mode text NOT NULL DEFAULT 'approve_each'
    CHECK (publish_mode IN ('approve_each', 'auto')),
  note         text,             -- 고객 요청사항 (발행 시간대 등)
  status       text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'active', 'revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS: 정책 없이 활성화 = 클라이언트(anon/authenticated) 접근 전면 차단.
-- 모든 읽기/쓰기는 서버 API(service role)를 통해서만 이뤄진다.
-- (비밀번호 컬럼이 있는 테이블이라 행 단위 정책으로도 부족 — 컬럼 노출 자체를 막는다)
ALTER TABLE public.care_onboarding ENABLE ROW LEVEL SECURITY;

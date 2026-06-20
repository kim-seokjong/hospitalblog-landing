-- ============================================================================
-- 휴대폰 본인인증(PortOne V2 Identity Verification) — DI/CI 컬럼 추가
--
-- 목적:
--   회원가입 시 본인인증을 의무화하고, DI(중복가입확인정보)로 중복가입을 차단한다.
--   - di : 동일 서비스 내 동일인 식별값 → UNIQUE 제약으로 1인 1계정 보장
--   - ci : 서비스 간 연계 정보(선택 보관, 향후 본인확인 연동용)
--
-- ⚠️ 이 마이그레이션은 자동 적용되지 않는다. Supabase SQL Editor 에서 수동 실행할 것.
--
-- ── 기존 사용자(grandfathering) ─────────────────────────────────────────────
--   기존 가입자는 di 값이 없다(NULL). di 를 NOT NULL 로 만들지 않고 nullable 로 둔다.
--   PostgreSQL 의 UNIQUE 제약은 NULL 을 서로 "다른 값"으로 취급하므로,
--   di 가 NULL 인 기존 행은 여러 개여도 UNIQUE 위반이 발생하지 않는다(grandfather 됨).
--   → 본인인증 의무화는 "신규 가입"에만 적용되며, 기존 사용자의 로그인/이용/
--     enforce/마이페이지/관리자 집계는 전혀 영향받지 않는다.
--
-- 멱등성: add column if not exists / 제약은 DO 블록으로 존재 시 건너뛰어 재실행 안전.
-- ============================================================================

-- DI / CI 컬럼 추가 (둘 다 nullable — 기존 행은 NULL 로 grandfather)
alter table public.profiles add column if not exists di text;
alter table public.profiles add column if not exists ci text;

-- di UNIQUE 제약 추가 (NULL 다중 허용 → 기존 사용자 grandfather, 신규는 1인 1계정)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_di_key'
  ) then
    alter table public.profiles
      add constraint profiles_di_key unique (di);
  end if;
end $$;

comment on column public.profiles.di is '중복가입확인정보(DI) — 본인인증 동일인 식별. UNIQUE. 기존 사용자는 NULL(grandfather).';
comment on column public.profiles.ci is '연계정보(CI) — 본인인증 서비스 간 식별값(선택 보관).';

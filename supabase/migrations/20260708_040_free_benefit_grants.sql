-- 040 — 재가입 무료혜택 악용 방지 원장(ledger)
-- 배경: 가입 시 무료 크레딧 2회(033)는 계정당 1회여야 한다. 그러나 계정을 지우고
--       새 이메일로 재가입하면 매번 2회를 다시 받는 악용이 가능하다.
-- 정책(2026-07-08): 한 번이라도 무료혜택을 받은 "신원"(전화번호/이메일)은 재가입 시
--       무료 크레딧에서 제외한다. 식별키 = 정규화 전화번호 해시 OR 이메일 해시.
--
-- 핵심 설계:
--   * auth.users 로 FK 를 걸지 않는다 → 계정이 삭제돼도 원장 기록은 남아야 재가입을 식별.
--   * 개인정보(PII) 원문 저장 금지 → 전화/이메일은 앱에서 SHA-256 해시로만 저장.
--   * service_role 전용(RLS 켜고 정책 없음 = 기본 거부). 클라이언트 직접 접근 차단.
--
-- 적용: Supabase SQL Editor 에서 수동 실행(idempotent). 코드/배포와 분리.

create table if not exists public.free_benefit_grants (
  id            bigserial   primary key,
  phone_hash    text,                       -- SHA-256(정규화 전화번호). 없으면 NULL.
  email_hash    text,                       -- SHA-256(정규화 이메일).   없으면 NULL.
  first_user_id uuid,                        -- 최초 부여 계정(참고용, FK 없음 — 삭제돼도 유지)
  granted_at    timestamptz not null default now()
);

comment on table public.free_benefit_grants is
  '한 번이라도 가입 무료혜택(free_credits)을 받은 신원 원장. 전화/이메일 해시 기준. 계정 삭제 후 재가입 악용 차단용(2026-07-08).';

-- 재가입 조회 성능(전화/이메일 해시 각각 조회).
create index if not exists idx_fbg_phone_hash
  on public.free_benefit_grants(phone_hash) where phone_hash is not null;
create index if not exists idx_fbg_email_hash
  on public.free_benefit_grants(email_hash) where email_hash is not null;

alter table public.free_benefit_grants enable row level security;
-- anon/authenticated 정책 없음 → API 의 service_role 키로만 읽기/쓰기.

-- 064 — 무료혜택 원장: 원자적 판정 + 비밀키 해시(v2)
-- 배경(2026-10-06 Codex 지적):
--   ① 040 원장은 「조회 → 삽입」이 따로라, 같은 전화번호·다른 이메일로 거의 동시에 가입하면
--      둘 다 신규로 판정돼 무료 2편을 두 번 받는다. 해시에 유일 제약도 없었다.
--   ② 040 해시는 소스에 박힌 고정 솔트의 SHA-256 이라, DB 가 새면 전화번호를 사전 대입으로 역산할 수 있다.
-- 해법:
--   * 신원 해시 하나당 한 행(기본키)인 새 원장 free_benefit_identities. 앱은 서버 비밀키 HMAC(v2)만 넣는다.
--   * 판정·기록·회수를 claim_free_benefit() 한 트랜잭션에서 한다. 기본키 충돌이 곧 「이미 받은 신원」이다.
--   * 040 원장(v1)은 지우지 않는다 — 기존 회원의 재가입을 막는 근거라 조회만 계속한다.
--
-- 적용: Supabase SQL Editor 에서 수동 실행(idempotent). 앱은 함수가 없으면 040 경로로 동작한다.
--       ⚠️코드 배포가 끝난 뒤에 적용한다. 구버전 인스턴스가 아직 040 에 쓰는 몇 초 사이의 동시 가입만은
--       원자성이 보장되지 않는다(배포 완료 후 적용하면 그 창이 없다).

create table if not exists public.free_benefit_identities (
  identity_hash text        primary key,                        -- HMAC-SHA256(v2). 원문 저장 금지
  kind          text        not null check (kind in ('phone', 'email')),
  key_version   smallint    not null default 2,               -- 해시 키 버전. 키를 바꾸면 3 으로 쓰고 구·신 둘 다 조회
  first_user_id uuid,                                           -- 참고용, FK 없음(계정 삭제 후에도 유지)
  granted_at    timestamptz not null default now()
);

comment on table public.free_benefit_identities is
  '가입 무료혜택을 받은 신원(전화/이메일) — 해시 하나당 한 행. 서버 비밀키 HMAC(v2). 064(2026-10-06).';

alter table public.free_benefit_identities enable row level security;
-- anon/authenticated 정책 없음 → service_role 만.

create or replace function public.claim_free_benefit(
  p_user_id uuid,
  p_hashes  jsonb,     -- [{"h": "<v2 hash>", "kind": "phone"|"email"}, ...]
  p_legacy  text[]     -- 040 원장과 대조할 v1 해시들
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_returning boolean := false;
  v_row       record;
  v_n         integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id 가 비었습니다';
  end if;

  -- 040(v1) 원장에 있으면 이미 받은 신원이다.
  if coalesce(array_length(p_legacy, 1), 0) > 0 and exists (
       select 1 from public.free_benefit_grants
        where phone_hash = any(p_legacy) or email_hash = any(p_legacy)) then
    v_returning := true;
  end if;

  -- v2 원장: 해시 순서대로 넣어 교착을 피한다. 충돌(0행) = 다른 계정이 이미 받은 신원.
  for v_row in
    select x.h, x.kind
      from jsonb_to_recordset(coalesce(p_hashes, '[]'::jsonb)) as x(h text, kind text)
     where x.h is not null and x.h <> ''
     order by x.h
  loop
    insert into public.free_benefit_identities (identity_hash, kind, first_user_id)
    values (v_row.h, v_row.kind, p_user_id)
    on conflict (identity_hash) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 and not exists (
         select 1 from public.free_benefit_identities
          where identity_hash = v_row.h and first_user_id = p_user_id) then
      v_returning := true;
    end if;
  end loop;

  if v_returning then
    update public.profiles
       set free_credits = 0, updated_at = now()
     where id = p_user_id;
  end if;

  return v_returning;
end;
$$;

revoke all on function public.claim_free_benefit(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.claim_free_benefit(uuid, jsonb, text[]) to service_role;

-- PostgREST 가 새 함수를 바로 보게 한다.
notify pgrst, 'reload schema';

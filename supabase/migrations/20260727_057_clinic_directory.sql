-- 057 — 병원 조회 폴백 디렉터리 + 행안부 조회 상태 감시
-- 적용 방법: Supabase SQL Editor에서 이 파일 하나를 그대로 실행 (idempotent)
-- DB 적용은 대표가 직접 수행한다 (코드/배포와 분리).
--
-- ★ 왜 만드나 (2026-07-27 장애).
--   홈페이지 첫 화면이 "병원 이름만 넣으면 온라인 노출 성적을 알려드려요"인데,
--   그 첫 관문인 병원 조회가 **행정안전부 '건강_의원 조회서비스' 하나**에만 걸려 있었다.
--   09:10~09:25Z 사이 행안부가 HTTP 200 + 정상 엔벨로프에 **0건**을 실어 보냈고,
--   그동안 실존 병원 12곳이 전부 "그런 병원 없음"으로 표시됐다.
--   외부 API 하나가 첫 화면 전체의 단일 장애점이면 그 API가 죽는 날 서비스가 죽는다.
--
--   A) clinic_directory        — 심평원 공개자료 기반 병원 디렉터리 (행안부 폴백)
--   B) clinic_registry_health  — 행안부 조회 카나리 점검 이력 (조기 경보)
--
-- 개인정보:
--   저장하는 것은 **공표된 의료기관 정보**뿐이다(요양기관명·주소·대표번호·진료과목·개설일자).
--   원본의 암호화요양기호는 저장하지 않고 **해시만** 식별자로 쓴다.

-- LIKE '%이름%' 검색을 인덱스로 태우기 위해 필요하다.
create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────
-- A) clinic_directory — 행안부가 죽었을 때 쓰는 폴백 병원 명부
-- ─────────────────────────────────────────────────────────────
--
-- 식별자 설계가 이 테이블의 핵심이다.
--   행안부 관리번호(MNG_NO)가 진단 리드의 병원 식별 정본이고, 클라이언트는 그 값을
--   그대로 되돌려 보낸다(POST /api/clinic-diagnosis 의 mngNo). 폴백에서 찾은 병원도
--   **같은 자리에 넣을 수 있는 키**가 있어야 흐름이 이어진다.
--   그래서 폴백 식별자는 'hira:' 접두사를 붙여 **행안부 관리번호와 절대 겹치지 않게** 만든다.
--   서버는 접두사만 보고 어느 원천으로 재검증할지 정한다(조작된 mngNo 로 진단이 만들어지지 않음).
--
--   값 = 'hira:' + sha256(암호화요양기호) 앞 16자리 hex (총 21자).
--   · 원본 요양기호는 80자라 API 입력 상한(60자)을 넘고, 그대로 노출할 이유도 없다.
--   · 해시는 결정적이라 자료를 다시 올려도 **같은 병원은 같은 식별자**를 유지한다
--     (재적재로 기존 리드·리포트의 mng_no 가 고아가 되지 않는다).
create table if not exists public.clinic_directory (
  /** 'hira:<16hex>' — 폴백 병원 식별 정본. 행안부 MNG_NO 와 키 공간이 분리된다. */
  mng_no           text primary key,
  name             text not null,
  /** 공백 제거 + 소문자 — LIKE 검색의 정본.
      등록 상호에 공백이 끼어 있어("플로르 성형외과 의원") 붙여 쓴 입력이 0건이 되던
      행안부의 고질적 문제를 여기서는 구조적으로 없앤다. */
  name_norm        text not null,
  road_address     text not null default '',
  /** 시·도 (예: '대구광역시'). */
  province         text not null default '',
  /** 구·군 (예: '수성구'). */
  region           text not null default '',
  /** 종별 (의원 / 치과의원 / 한의원 / 병원 …). */
  institution_type text not null default '',
  /** 대표 진료과 — 전문의 수가 많은 과목 우선. */
  specialty        text not null default '',
  /** 진료과목 전체 (전문의 수 내림차순). */
  subjects         text[] not null default '{}',
  phone            text not null default '',
  opened_on        date,
  /** 자료 출처 표기 — 화면에 "심평원 공개자료" 라고 밝히는 근거. */
  source           text not null default 'hira',
  /** 자료 기준 시점 (예: '2026Q1'). 오래된 명부로 안내하지 않기 위해 반드시 남긴다. */
  source_version   text not null default '',
  updated_at       timestamptz not null default now()
);

comment on table public.clinic_directory is
  '행안부 조회 폴백용 병원 명부(심평원 공개자료 기반). 공표된 의료기관 정보만 저장하며 암호화요양기호는 해시로만 보관한다.';
comment on column public.clinic_directory.mng_no is
  '폴백 병원 식별자. ''hira:'' 접두사로 행안부 MNG_NO 와 구분되며, 서버는 접두사로 재검증 경로를 고른다.';

-- 이름 부분일치(LIKE '%x%') 를 인덱스로 태운다. 이게 없으면 8만 행 순차 스캔이다.
create index if not exists idx_clinic_directory_name_trgm
  on public.clinic_directory using gin (name_norm gin_trgm_ops);
-- 지역 필터(주소 부분일치)도 같은 이유로 trgm.
create index if not exists idx_clinic_directory_addr_trgm
  on public.clinic_directory using gin (road_address gin_trgm_ops);
create index if not exists idx_clinic_directory_region
  on public.clinic_directory(province, region);

-- RLS: 정책 없이 활성화만 → anon/authenticated 직접 접근 전면 차단, service role 라우트로만 읽는다.
alter table public.clinic_directory enable row level security;

-- ─────────────────────────────────────────────────────────────
-- B) clinic_registry_health — 행안부 조회 카나리 점검 이력
-- ─────────────────────────────────────────────────────────────
--
-- ★ 이번 장애는 **사람이 12건을 직접 쏴 보고 나서야** 알았다. 그 사이 첫 화면에 들어온
--   원장들은 전부 "그런 병원 없음"을 보고 떠났다. 전국에 수백~수천 곳 있는 이름을
--   주기적으로 조회해서 0건이면 그 자체가 장애 신호다 — 사람의 제보를 기다리지 않는다.
create table if not exists public.clinic_registry_health (
  id         bigserial primary key,
  checked_at timestamptz not null default now(),
  /** ok=정상 · degraded=일부 카나리 0건 · down=전 카나리 0건/실패 */
  status     text not null check (status in ('ok', 'degraded', 'down')),
  /** 카나리별 원자료 [{name, kind, totalCount, items, failure}] — 사후 판정의 근거. */
  probes     jsonb not null default '[]'::jsonb,
  note       text not null default '',
  /** 이번 판정으로 실제 알림을 보냈는가 (연속 장애 중 반복 발송 방지 판단에 쓴다). */
  alerted    boolean not null default false
);

comment on table public.clinic_registry_health is
  '행안부 병원 조회 카나리 점검 이력. 전국에 흔한 상호를 주기적으로 조회해 0건이면 장애로 판정한다.';

create index if not exists idx_clinic_registry_health_checked_at
  on public.clinic_registry_health(checked_at desc);

alter table public.clinic_registry_health enable row level security;

-- ─────────────────────────────────────────────────────────────
-- C) 오래된 점검 이력 정리 (선택 — 손으로 돌려도 된다)
-- ─────────────────────────────────────────────────────────────
create or replace function public.purge_old_clinic_registry_health(keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.clinic_registry_health
   where checked_at < now() - make_interval(days => greatest(1, keep_days));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_old_clinic_registry_health(integer) is
  '보관 기간이 지난 행안부 조회 점검 이력을 삭제한다. 반환값=삭제 건수.';

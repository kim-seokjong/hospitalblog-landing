-- 055 — 병원명 무료진단 (영업 관문)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   /clinic-check 에서 비회원이 **병원 이름만** 넣으면 행안부 '건강_의원 조회서비스'로
--   병원을 특정하고, 네 축(네이버 블로그·홈페이지·AI 인용·의료광고법)을 진단한다.
--   영업 흐름: 문제점을 먼저 무료로 알려주고 → 그 문제를 닥터포스트로 해결한다.
--
--   A) clinic_diagnosis_leads   — 비회원 진단 실행 시 영업 리드 적재
--   B) clinic_diagnosis_reports — 진단 리포트 + 공유 토큰 (전화·메일 후속용)
--
-- 045(blog_check_*)를 재사용하지 않는 이유:
--   blog_check_reports.results 는 BlogCheckReport(블로그 단일 축) 스키마이고
--   /blog-check 화면이 그 형태를 그대로 읽는다. DiagnosisReport 는 병원 특정 정보 +
--   네 축을 담는 다른 형태라 섞으면 기존 UI 가 깨진다 → 분리.
--
-- 개인정보:
--   저장하는 것은 **공개된 병원 정보**뿐이다(행안부 공표 상호·주소·대표번호·진료과목).
--   방문자 IP·이메일·이름 등 진단 요청자의 PII 는 저장하지 않는다.

-- 1) clinic_diagnosis_leads — 비회원 리드 (쓰기·조회 모두 service role 전용)
create table if not exists public.clinic_diagnosis_leads (
  id            uuid primary key default gen_random_uuid(),
  /** 행안부 관리번호(MNG_NO) — 병원 식별 정본. */
  mng_no        text not null,
  clinic_name   text not null default '',
  /** 시·도 + 구·군 (예: '대구광역시 수성구'). 영업 배정용. */
  region        text not null default '',
  specialty     text not null default '',
  /** 행안부 대표번호. 네이버 지역검색 telephone 은 항상 빈 값이라 쓰지 않는다. */
  phone         text not null default '',
  /** 자동 탐색으로 확정된 병원 블로그 ID. 못 찾았으면 null. */
  blog_id       text,
  /** 자동 탐색으로 확인된 홈페이지 주소. 못 찾았으면 null. */
  site_url      text,
  source        text not null default 'clinic-check',
  /** 가입 전환 시 연결되는 회원. 미가입 리드는 null. */
  user_id       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.clinic_diagnosis_leads is
  '병원명 무료진단(비회원) 리드. 행안부 공표 병원정보(상호·지역·진료과·대표번호)만 저장하며 요청자 PII(IP·이메일)는 저장하지 않는다.';

create index if not exists idx_clinic_dx_leads_mng_no     on public.clinic_diagnosis_leads(mng_no);
create index if not exists idx_clinic_dx_leads_created_at on public.clinic_diagnosis_leads(created_at desc);
create index if not exists idx_clinic_dx_leads_region     on public.clinic_diagnosis_leads(region);

-- RLS: 정책 없이 활성화만 → anon/authenticated 접근 전면 차단, service role 만 사용.
alter table public.clinic_diagnosis_leads enable row level security;

-- 2) clinic_diagnosis_reports — 리포트 본문 + 공유 토큰
--
-- 공유 토큰(share_token)은 대표가 전화·메일 후속에 붙여 보내는 읽기 전용 링크의 키다.
-- 추측 불가능한 난수(서버에서 crypto.randomUUID 기반 32자 이상)로만 발급하며,
-- 만료(expires_at)가 지나면 조회 라우트가 거부한다.
create table if not exists public.clinic_diagnosis_reports (
  id           uuid primary key default gen_random_uuid(),
  mng_no       text not null,
  clinic_name  text not null default '',
  /** 공유 링크 키 — URL 안전 난수. 유니크. */
  share_token  text not null unique,
  /** DiagnosisReport JSON 전문. */
  results      jsonb not null,
  /** 링크 만료 시각. 지나면 조회 거부. */
  expires_at   timestamptz not null default (now() + interval '30 days'),
  /** 조회 수 (영업 반응 확인용). */
  view_count   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.clinic_diagnosis_reports is
  '병원명 무료진단 리포트 + 공유 링크. share_token 은 추측 불가 난수이며 expires_at 이후 조회 거부. 저장 내용은 공개 병원정보 기반 진단 결과뿐.';
comment on column public.clinic_diagnosis_reports.share_token is
  '읽기 전용 공유 링크 키. 영업 후속(전화·메일)에서 원장에게 그대로 보낸다.';

create index if not exists idx_clinic_dx_reports_mng_no     on public.clinic_diagnosis_reports(mng_no);
create index if not exists idx_clinic_dx_reports_created_at on public.clinic_diagnosis_reports(created_at desc);
create index if not exists idx_clinic_dx_reports_expires_at on public.clinic_diagnosis_reports(expires_at);

-- RLS: 정책 없이 활성화만 → 공유 링크 조회도 **service role 라우트를 통해서만** 나간다.
-- anon 키로 테이블을 직접 훑어 토큰 목록을 수집하는 경로를 원천 차단한다.
alter table public.clinic_diagnosis_reports enable row level security;

-- 3) 만료 리포트 정리 함수 (선택 — cron 에서 호출)
create or replace function public.purge_expired_clinic_diagnosis_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.clinic_diagnosis_reports where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_expired_clinic_diagnosis_reports() is
  '만료된 무료진단 공유 리포트를 삭제한다. 반환값=삭제 건수.';

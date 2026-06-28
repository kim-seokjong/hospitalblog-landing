-- 030 — 가입 전 무료 맞춤 샘플(/sample) 캐시 + IP 레이트리밋
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 영업 콜드메일 CTA(/sample?clinic=병원명) 진입 시 회원가입 없이 그 병원
--       이름으로 만든 블로그 "티저 샘플"을 즉시 보여준다. Claude 생성 비용과
--       악용(무한 신규 생성)을 막기 위해:
--         1) clinic_free_samples  — 정규화한 병원명 기준 생성결과 캐시(병원당 1회 생성)
--         2) clinic_free_sample_events — IP별 신규 생성 이벤트 로그(시간당 N회 제한용)
--
--       공개(비인증) 엔드포인트가 service_role 로 접근하므로 RLS는 켜되 anon 정책은
--       추가하지 않는다(기본 거부). 저장 데이터는 공개 디렉터리 정보(병원명·유형·지역)
--       에서 생성한 마케팅 샘플뿐이며 개인정보(PII)는 담지 않는다.

-- ── 1) 생성결과 캐시 ────────────────────────────────────────────────
create table if not exists public.clinic_free_samples (
  clinic_key  text primary key,            -- 정규화 병원명(소문자·공백/괄호 제거)
  clinic_name text not null,               -- 원본 병원명(표시용)
  sample      jsonb not null,              -- { title, intro, subheadings[], sampleSection{heading,body}, specialty, region }
  created_at  timestamptz not null default now()
);

comment on table public.clinic_free_samples is
  '가입 전 무료 맞춤 샘플(/sample) 캐시. 정규화 병원명당 1회만 생성하고 이후 재사용(비용/악용 방어).';

alter table public.clinic_free_samples enable row level security;
-- anon/authenticated 정책 없음 → API의 service_role 키로만 읽기/쓰기.

-- ── 2) IP별 신규 생성 이벤트(레이트리밋) ────────────────────────────
create table if not exists public.clinic_free_sample_events (
  id         bigserial primary key,
  ip         text not null,
  clinic_key text not null,
  created_at timestamptz not null default now()
);

comment on table public.clinic_free_sample_events is
  '/sample 신규 생성(캐시 미스) 이벤트 로그. IP별 최근 1시간 생성 횟수 집계로 남용 차단.';

create index if not exists idx_cfs_events_ip_created
  on public.clinic_free_sample_events (ip, created_at);

alter table public.clinic_free_sample_events enable row level security;
-- anon/authenticated 정책 없음 → API의 service_role 키로만 접근.

-- 063: 진단 리드에 내부 트래픽 표시 (2026-08-06)
--
-- 배경
--   funnel_events 는 `dp_internal` 쿠키로 우리 트래픽을 걸러내는데,
--   clinic_diagnosis_leads 는 안 걸러서 그대로 쌓인다.
--   8/6 실측: 진단 7건 중 **6건이 우리**였다(대표 2 · 작업용 브라우저 4).
--   외부 진단은 성누가병원 1건뿐인데 집계는 7건으로 나온다.
--
-- 왜 건수보다 심각한가
--   `harvest_diagnosed.py` 가 진단된 병원을 영업DB로 끌어올린다.
--   우리가 테스트로 조회한 병원(바르다권치과·엣지성형외과)이 신규 리드가 되어
--   콜드메일 대상에 들어간다. 이미 고객인 병원에 신규 영업이 나갈 수 있다.
--
-- 주의
--   과거 행은 되살릴 수 없다(당시 내부 여부를 저장하지 않았다).
--   아래 백필은 **오늘 확인된 두 anon_id 만** 표시한다. 그 이전 기록은 모른다.

alter table public.clinic_diagnosis_leads
  add column if not exists is_internal boolean not null default false;

comment on column public.clinic_diagnosis_leads.is_internal is
  '내부 트래픽(dp_internal 쿠키) 여부. 집계·영업DB 승격에서 제외. 2026-08-06';

-- 집계 쿼리가 매번 훑는 컬럼이라 부분 인덱스로 외부 건만 빠르게 센다
create index if not exists clinic_diagnosis_leads_external_idx
  on public.clinic_diagnosis_leads (created_at desc)
  where is_internal = false and is_bot = false;

-- 백필 — 8/6 실측으로 신원이 확인된 두 브라우저만.
--   c583b1e5… = 대표 본인(엣지성형외과 조회)
--   3b4838c9… = 작업용 자동화 브라우저(바르다권치과 조회)
update public.clinic_diagnosis_leads
   set is_internal = true
 where is_internal = false
   and (anon_id::text like 'c583b1e5%' or anon_id::text like '3b4838c9%');

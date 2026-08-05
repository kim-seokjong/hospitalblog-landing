-- 061 — 무료진단 리드에 요청자 귀속 정보 추가
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경 (2026-08-05):
--   7월 28일 15:37~15:47, **10분 사이에 대구 지역 병원 19곳**이 연속으로 진단됐다.
--   30~45초 간격(진단 1건 소요시간과 일치)의 규칙적인 패턴이라 사람이 손으로 친
--   것으로 보기 어려웠다. 그런데 그게 우리 쪽 검증인지, 외부의 누군가가 우리 도구로
--   병원들을 훑은 것인지 **사후에 확인할 방법이 없었다.**
--
--   진단은 우리 서비스의 핵심 리드 경로다. 누가 얼마나 쓰는지 모르면
--   ① 내부 트래픽이 지표를 오염시키고 (funnel_events 는 이미 걸러내는데 여기만 못 걸렀다)
--   ② 한 사람이 수십 곳을 훑는 대량 사용을 발견하지 못하며
--   ③ "이 병원은 누가 조회했나"에 답할 수 없다.
--
-- 055 의 "요청자 PII 를 저장하지 않는다"는 약속을 어떻게 지키는가:
--   원본 IP 는 여전히 저장하지 않는다. 저장하는 것은
--     · ip_hash  — 솔트를 넣은 SHA-256 앞 32자 (email_leads 와 같은 방식·같은 솔트)
--     · anon_id  — 우리가 발급한 익명 쿠키 값 (funnel_events 와 같은 식별자라 방문 흐름과 이어진다)
--     · is_bot   — 봇 User-Agent 판정 결과 (UA 원문은 저장하지 않는다)
--   셋 다 그 자체로 개인을 특정하지 못한다. 목적은 부정·대량 사용 탐지와 지표 정합성이며,
--   광고성 정보 발송의 근거로 쓰지 않는다.

-- is_bot 은 **nullable** 이다. not null default false 로 두면 061 이전 행과 폴백으로
-- 저장된 행(판별한 적이 없는 행)까지 "사람"으로 읽혀, 정작 이 컬럼을 만든 목적인
-- 봇 제외 집계가 오염된다. null = 판별 안 함, false = 사람, true = 봇.
alter table public.clinic_diagnosis_leads
  add column if not exists anon_id text,
  add column if not exists ip_hash text,
  add column if not exists is_bot  boolean;

comment on column public.clinic_diagnosis_leads.anon_id is
  '익명 방문자 쿠키(dp_anon_id) 값. funnel_events 와 같은 식별자라 방문→진단 흐름을 이을 수 있다. 쿠키 삭제·다중 브라우저로 갈릴 수 있는 best-effort 값이다.';
comment on column public.clinic_diagnosis_leads.ip_hash is
  '솔트 적용 IP 해시(SHA-256 앞 32자). 원본 IP 는 저장하지 않는다. ★솔트가 설정돼 있지 않으면 아예 저장하지 않는다(null) — 솔트 없는 IP 해시는 IPv4 전수 대입으로 되돌릴 수 있어 익명화가 아니다. 용도는 대량·반복 조회 탐지뿐이다.';
comment on column public.clinic_diagnosis_leads.is_bot is
  '봇 User-Agent 판정 결과. null = 판별하지 않음(061 이전 행·폴백 저장분), false = 사람, true = 봇.';

-- 같은 사람이 짧은 시간에 여러 병원을 훑는 패턴을 찾을 때 쓰는 축.
-- 값이 없는 행(과거 행·쿠키 없는 요청)은 조회 대상이 아니므로 부분 인덱스로 만든다.
create index if not exists clinic_diagnosis_leads_ip_hash_created_idx
  on public.clinic_diagnosis_leads (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists clinic_diagnosis_leads_anon_created_idx
  on public.clinic_diagnosis_leads (anon_id, created_at desc)
  where anon_id is not null;

-- 테이블 주석 갱신 — 055 의 "요청자 정보 미저장" 문구가 더는 정확하지 않다.
comment on table public.clinic_diagnosis_leads is
  '무료진단 실행 1건 = 1행. 병원 정보는 전부 공개 자료(행안부·심평원)이고, 요청자 쪽은 원본 IP·UA 를 저장하지 않고 해시·익명 ID·봇 여부만 남긴다(061).';

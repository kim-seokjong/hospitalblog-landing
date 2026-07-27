-- 056 — 무료진단 결과 메일 리드 (연락처 확보)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   /clinic-check 진단은 병원의 문제를 잘 짚어주는데 그다음이 없었다. 원장이 성적표만
--   보고 닫으면 우리는 무료 봉사를 한 것이다. 그렇다고 가입을 목표로 잡으면 또 0이다
--   (7/26 실측: 회원 3명·랜딩 37건에 가입 0). 처음 온 원장은 가입을 안 누른다.
--
--   그래서 1순위 목표는 **이메일**이다. 자기 성적표를 메일로 받는 건 거절할 이유가
--   없고, 그 순간 연락처와 **그 병원의 구체적 문제 목록**이 함께 들어온다.
--   전화 영업 290콜이 상대 사정을 모른 채 걸어서 실패했는데, 진단 메일을 받은
--   병원에는 "보내드린 진단에서 208일 멈춘 부분 있으시죠"로 시작할 수 있다.
--
-- 055(clinic_diagnosis_leads)를 확장하지 않고 분리하는 이유:
--   055 는 "진단 실행 1건 = 리드 1행"이고, 테이블 주석에 **요청자 PII 를 저장하지
--   않는다**고 명시돼 있다(anon 진단은 이메일을 받지 않으므로 그 약속이 유효하다).
--   이메일은 사용자가 "보내달라"고 직접 요청했을 때만 들어오는 별개 사건이고
--   수집 목적·보관 근거가 다르다. 같은 테이블에 섞으면 055 의 PII 미저장 약속이
--   깨지고, "이메일 없는 진단 리드"와 "이메일 있는 리드"를 구분해 쿼리하기도 어렵다.

create table if not exists public.clinic_diagnosis_email_leads (
  id            uuid primary key default gen_random_uuid(),
  /**
   * 수신 이메일 (소문자 정규화). 사용자가 결과 화면에서 직접 입력·요청한 값이다.
   * 수집 목적: 진단 결과 발송 및 그 결과에 대한 안내. 광고성 정보 발송 동의가 아니다.
   */
  email         text not null,
  /** 행안부 관리번호(MNG_NO) — 병원 식별 정본. */
  mng_no        text not null,
  clinic_name   text not null default '',
  /** 시·도 + 구·군 (예: '대구광역시 수성구'). 영업 배정용. */
  region        text not null default '',
  specialty     text not null default '',
  /** 행안부 대표번호 — 후속 통화용. */
  phone         text not null default '',
  /** 이 리드가 가리키는 공유 리포트 토큰 (clinic_diagnosis_reports.share_token). */
  share_token   text,
  /** 메일에 실어 보낸 결과 주소 (경로). */
  share_url     text,
  /**
   * 진단 요약(DiagnosisLeadSummary) — **통화 첫 문장의 재료**.
   * 지금 고쳐야 할 것 건수·항목 이름, 마지막 발행 경과일, 표현 검출 건수,
   * 키워드 상위권 수, AI 추천 등장 수 등. 확인하지 못한 값은 null 로 남는다.
   */
  summary       jsonb,
  /** 진단 실행 시각 (리포트의 run_at). */
  diagnosed_at  timestamptz,
  /** 메일이 실제로 발송됐는가. false 면 대표가 수동 발송한다. */
  sent          boolean not null default false,
  /** 발송 실패 사유 (있을 때만). */
  send_error    text,
  /**
   * 요청 IP 의 해시(sha256 앞 32자, 서버 솔트 DIAGNOSIS_EMAIL_IP_SALT).
   * **원본 IP 는 저장하지 않는다.** 용도는 발송 한도 집계(하루 N회)뿐이며
   * 개인 식별·추적 목적 조회를 금지한다.
   *
   * 왜 필요한가: 이 엔드포인트는 비회원이 우리 도메인 발신 메일을 임의 주소로
   * 쏘는 통로다. 한도를 인메모리로 세면 서버리스 인스턴스마다 따로 돌아 캡이
   * 인스턴스 수만큼 곱해진다 — 그래서 이 테이블로 센다.
   */
  ip_hash       text,
  source        text not null default 'clinic-check',
  /** 가입 전환 시 연결되는 회원. 미가입 리드는 null. */
  user_id       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.clinic_diagnosis_email_leads is
  '무료진단 결과 메일 요청 리드. 사용자가 결과 화면에서 직접 입력한 이메일과 그 시점의 진단 요약을 저장한다. 수집 목적=진단 결과 발송 및 결과 안내(광고성 정보 수신 동의 아님). 쓰기·조회 모두 service role 전용.';
comment on column public.clinic_diagnosis_email_leads.email is
  '사용자가 결과 화면에서 직접 입력·요청한 수신 주소(소문자 정규화). 목적 외 사용 금지.';
comment on column public.clinic_diagnosis_email_leads.summary is
  '진단 요약(DiagnosisLeadSummary JSON). 전화·메일 후속에서 그대로 읽는 값 — 추정값 없이 진단이 실제로 확인한 값만 담는다.';

-- 이미 이 파일을 한 번 적용한 환경을 위한 보정(컬럼만 뒤에 추가됨).
-- ★ 이 파일 하나만 실행하면 되도록 유지한다 — 056 을 쪼개지 않는다.
alter table public.clinic_diagnosis_email_leads add column if not exists ip_hash text;

comment on column public.clinic_diagnosis_email_leads.ip_hash is
  '요청 IP 해시(원본 미저장). 발송 한도 집계 전용 — 개인 식별·추적 목적 조회 금지.';

-- 인덱스: 앞의 4개는 조회·영업 배정용, 뒤의 3개는 **발송 한도 집계 전용**이다.
-- 한도는 전부 "오늘(KST) 이후 created_at" 범위 조회라 (키, created_at desc) 복합이 필요하다.
create index if not exists idx_clinic_dx_email_leads_mng_no     on public.clinic_diagnosis_email_leads(mng_no);
create index if not exists idx_clinic_dx_email_leads_created_at on public.clinic_diagnosis_email_leads(created_at desc);
create index if not exists idx_clinic_dx_email_leads_region     on public.clinic_diagnosis_email_leads(region);
create index if not exists idx_clinic_dx_email_leads_sent       on public.clinic_diagnosis_email_leads(sent, created_at desc);

-- 한도 집계용 (수신주소 일 N회 / IP 일 N회 / 토큰 일 N회·토큰당 주소 수)
create index if not exists idx_clinic_dx_email_leads_email_created   on public.clinic_diagnosis_email_leads(email, created_at desc);
create index if not exists idx_clinic_dx_email_leads_ip_created      on public.clinic_diagnosis_email_leads(ip_hash, created_at desc);
create index if not exists idx_clinic_dx_email_leads_token_created   on public.clinic_diagnosis_email_leads(share_token, created_at desc);

-- RLS: 정책 없이 활성화만 → anon/authenticated 접근 전면 차단, service role 만 사용.
-- (이메일이 들어 있는 테이블이라 055 보다 더 엄격하게 다뤄야 한다.)
alter table public.clinic_diagnosis_email_leads enable row level security;

-- 병원 프로필 확장 (진료과목, 소개, 키워드, 알림 설정)
alter table public.profiles
  add column if not exists specialty        text,
  add column if not exists specialty_detail text,
  add column if not exists hospital_desc    text,
  add column if not exists hospital_keywords text[],
  add column if not exists region           text,
  add column if not exists sms_enabled      boolean default false,
  add column if not exists sms_phone        text,
  add column if not exists notify_expiry    boolean default true,
  add column if not exists notify_usage     boolean default true;

comment on column public.profiles.specialty        is '진료과목 (피부과/정형외과/치과 등)';
comment on column public.profiles.specialty_detail is '세부 진료과목';
comment on column public.profiles.hospital_desc    is '병원 소개 (글 생성 시 자동 반영)';
comment on column public.profiles.hospital_keywords is '병원 고유 키워드 배열';
comment on column public.profiles.region           is '지역 (강남구/서초구 등)';
comment on column public.profiles.sms_enabled      is '문자 알림 수신 여부';
comment on column public.profiles.sms_phone        is '문자 수신 번호';
comment on column public.profiles.notify_expiry    is '플랜 만료 알림 여부';
comment on column public.profiles.notify_usage     is '사용량 임박 알림 여부';

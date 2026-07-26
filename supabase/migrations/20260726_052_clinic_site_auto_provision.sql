-- 052 — 유료 결제 시 병원 블로그 자동 개설 + 병원 대표번호
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--  ① 지금까지 site_slug 는 회원이 마이페이지에서 직접 입력해야만 생겼다.
--     대부분의 병원은 그 화면까지 오지 않아 자체 블로그가 만들어지지 않았다.
--     → 유료 결제(플랜 활성화) 시점에 병원명에서 슬러그를 만들어 자동 개설한다.
--     가입 시점이 아닌 이유: 무료 2편만 쓰고 이탈하는 계정의 빈 블로그가
--     사이트맵에 쌓이면 색인 품질이 떨어진다.
--  ② 자동발행이 기본값이 되면서 "언제부터의 글을 자동 발행할지" 기준이 필요해졌다.
--     기준이 없으면 자동발행이 켜지는 순간 보관함의 과거 글이 한꺼번에 공개된다.
--  ③ 서브블로그에 병원 대표번호를 표시하려면 컬럼이 필요하다
--     (profiles.phone 은 담당자 개인 연락처라 공개 대상이 아니다 — 절대 재사용 금지).
--
-- 코드는 이 마이그레이션 미적용 상태에서도 죽지 않는다:
--  - provision.ts        : 42703 이면 마커 컬럼을 빼고 "site_slug 가 비었을 때만" 1회 동작
--  - cron/site-auto-publish : 컬럼 존재를 먼저 확인(probe)하고 없으면 소급 필터 없이 기존 동작
--  - /api/profile        : 컬럼 없음이면 해당 필드를 제거하고 재시도(peel)
--  - clinic-site/data.ts : hospital_phone 없이 재조회 → 전화 블록만 렌더되지 않음

-- ---------------------------------------------------------------------------
-- 1) profiles.hospital_phone — 병원 대표번호 (공개)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists hospital_phone text;

comment on column public.profiles.hospital_phone is
  '병원 대표 전화번호(공개). 서브도메인 블로그 병원 정보 블록과 MedicalClinic JSON-LD(telephone)에 노출된다. profiles.phone(담당자 개인 연락처, 비공개)과 반드시 구분할 것.';

-- ---------------------------------------------------------------------------
-- 2) profiles.site_provisioned_at — 결제 자동 개설을 1회만 수행하기 위한 마커
-- ---------------------------------------------------------------------------
-- 값이 있으면 provisionClinicSite 는 아무것도 하지 않는다.
-- 마커가 없으면 정기결제(갱신)마다 다시 돌아 고객이 꺼둔 자동발행을 매달 되살린다.
alter table public.profiles
  add column if not exists site_provisioned_at timestamptz;

comment on column public.profiles.site_provisioned_at is
  '유료 결제 시 병원 블로그 자동 개설(슬러그 생성 + 자동발행 켜기)을 수행한 시각. 회원당 1회만 수행하기 위한 멱등 마커 — 값이 있으면 이후 결제/갱신에서 건드리지 않는다.';

-- ---------------------------------------------------------------------------
-- 3) profiles.site_auto_publish_since — 소급 발행 차단 기준 시각
-- ---------------------------------------------------------------------------
-- cadence 가 'auto' 로 "처음 전환된" 시각. 자동발행은 이 시각 이후에 생성된 글만
-- 대상으로 한다(saved_posts.created_at >= site_auto_publish_since).
alter table public.profiles
  add column if not exists site_auto_publish_since timestamptz;

comment on column public.profiles.site_auto_publish_since is
  '내 블로그 자동발행(auto)이 켜진 시각. 자동발행 대상은 이 시각 이후에 생성된 글로 한정한다(과거 글 대량 공개 방지). 한 번 기록되면 앞당기지 않는다.';

-- ★ 기존 'auto' 회원 백필 — 지금 시각으로 고정한다.
--   이미 auto 를 켜 둔 회원의 보관함 과거 글이 이번 배포로 갑자기 쏟아지지 않게 한다
--   (백필하지 않으면 null 이 되어 필터가 없는 것과 같아진다).
update public.profiles
   set site_auto_publish_since = now()
 where site_publish_cadence = 'auto'
   and site_auto_publish_since is null;

-- 자동발행 대상 후보 조회(user_id + 미발행 + 생성순) 인덱스.
create index if not exists idx_saved_posts_auto_publish_candidates
  on public.saved_posts (user_id, created_at)
  where published_to_site = false;

-- ---------------------------------------------------------------------------
-- 4) RLS — 정책 추가하지 않음 (의도된 결정)
--    profiles 의 본인 update 정책(마이그 004)이 hospital_phone 을 이미 커버한다.
--    site_provisioned_at / site_auto_publish_since 는 service role 만 기록한다.
--    공개 페이지는 service role 로 "명시적 컬럼만" 읽는다(마이그 043 주석 참조).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- (선택) 기존 유료 회원에게 자동발행을 켜고 싶지 않다면, 아래를 함께 실행해
--        "이미 개설 완료" 로 표시해 두면 다음 결제에서 건드리지 않는다.
--
--   update public.profiles
--      set site_provisioned_at = now()
--    where site_slug is not null
--      and site_provisioned_at is null;
--
-- 기본(미실행) 동작: 다음 결제·갱신 때 cadence 가 'off' 인 회원만 'auto' 로 켜지고,
-- 그 시점 이후에 새로 쓰는 글부터 자동 발행된다(과거 글은 영구 제외).
-- ---------------------------------------------------------------------------

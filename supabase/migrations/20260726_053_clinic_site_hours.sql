-- 053 — 병원 진료시간 (서브도메인 블로그 "병원 소개" 페이지용)
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 052 로 병원명·주소·대표번호가 공개 블로그에 표시되기 시작했다.
--       "지금 문 열었나 / 토요일도 하나"는 환자가 가장 많이 확인하는 정보이고,
--       AI 검색·지도 검색이 실제로 읽는 구조화 데이터(OpeningHoursSpecification)다.
--       자유 텍스트로 받으면 구조화가 불가능하므로 검증된 JSON 으로 저장한다.
--
-- 저장 형태 (검증은 앱에서 — src/content/lib/clinic-site/hours.ts):
--   {
--     "weekday":  { "open": "09:00", "close": "18:00" } | "closed" | null,
--     "saturday": { "open": "09:00", "close": "13:00" } | "closed" | null,
--     "sunday":   "closed" | null,
--     "holiday":  "closed" | null,
--     "lunch":    { "open": "13:00", "close": "14:00" } | null,
--     "note":     "전화 예약 후 방문 부탁드립니다"
--   }
--   null = 미설정(화면에서 그 줄이 사라짐), "closed" = 휴진(화면에 "휴진" 표시)
--
-- 코드는 이 마이그레이션 미적용 상태에서도 죽지 않는다:
--  - clinic-site/data.ts : 컬럼 없음(42703)이면 좁은 컬럼 셋으로 재조회
--    → 진료시간 블록만 렌더되지 않고 나머지 소개 정보는 그대로 나온다.
--  - /api/profile        : hospital_hours 를 제거하고 재시도(peel)

alter table public.profiles
  add column if not exists hospital_hours jsonb;

comment on column public.profiles.hospital_hours is
  '병원 진료시간(공개). 형태: {weekday|saturday|sunday|holiday: {open,close}|"closed"|null, lunch: {open,close}|null, note: text}. 검증·정규화는 앱(src/content/lib/clinic-site/hours.ts)에서 수행하며, 서브도메인 블로그 "병원 소개" 페이지와 MedicalClinic JSON-LD(openingHoursSpecification)에 노출된다.';

-- RLS — 정책 추가하지 않음 (의도된 결정)
--   profiles 의 본인 update 정책(마이그 004)이 이 컬럼을 이미 커버한다.
--   공개 페이지는 service role 로 "명시적 컬럼만" 읽는다(마이그 043 주석 참조).

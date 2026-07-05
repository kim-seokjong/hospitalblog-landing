-- 036 — 클리닉픽스 병원 전속 AI 캐릭터 유니버스 (Supabase SQL Editor 수동 적용, idempotent)
--
-- 목적 = 각인: 병원마다 고정 캐릭터가 시리즈물처럼 등장해 "그 병원 그 캐릭터"로 기억되게 한다.
--
-- 1) profiles.clinicflix_character (jsonb, nullable)
--    선택한 전속 캐릭터. 형태: {"preset_id": "calm_male_doctor", "selected_at": "2026-07-05T00:00:00Z"}
--    null = 미선택 → 기존 동작(voice_gender 기반 자동 배정) 그대로 (하위 호환).
--    프리셋 목록의 단일 소스 = clinicflix_pipeline/clinicflix/characters.py
--    (웹 표시 상수 = src/content/lib/clinicflix-characters.ts, 동기화 필수)
--
-- 2) clinicflix_conversions.topic (text, nullable)
--    변환 에피소드의 주제. convert 시 키워드로 1차 기록, approve 시 기획(plan)의 topic 으로
--    갱신(best-effort). 최근 3건의 topic 이 다음 변환의 series_context(시리즈 연속성 —
--    반복 방지 + 가벼운 콜백)로 파이프라인에 전달된다. null 이어도 동작 불변.

alter table public.profiles
  add column if not exists clinicflix_character jsonb;

comment on column public.profiles.clinicflix_character is
  '클리닉픽스 전속 AI 캐릭터 선택 {"preset_id": string, "selected_at": ISO8601} — null=미선택(자동 배정)';

alter table public.clinicflix_conversions
  add column if not exists topic text;

comment on column public.clinicflix_conversions.topic is
  '변환 에피소드 주제 — 최근 3건이 다음 변환의 series_context(캐릭터 시리즈 연속성)로 사용됨';

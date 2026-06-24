-- 029 — VOICE-DNA: 병원별 고유 문체 학습 컬럼 추가
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: AI가 생성한 글을 사용자가 ContentPreview에서 직접 고친 {원본, 수정본}
--       쌍을 누적해, 그 병원이 우리 글을 어느 방향으로 교정하는지(호칭/톤/문장
--       길이/표현)를 분석하고 문체 카드(voice_dna)로 정리한다. 본문 생성 시
--       이 카드를 프롬프트에 주입해 점점 그 병원 말투로 수렴시킨다.
--
-- 컬럼:
--   profiles.voice_dna             — 문체 카드(VoiceDnaCard) JSON. null = 아직 없음.
--   profiles.voice_dna_updated_at  — 카드 마지막 갱신 시각.
--   saved_posts.original_content   — AI 생성 직후 원본 본문 스냅샷(불변).
--                                    수정본은 기존 content 컬럼이 보관한다.

alter table public.profiles
  add column if not exists voice_dna jsonb;

comment on column public.profiles.voice_dna is
  'VOICE-DNA 문체 카드(VoiceDnaCard JSON). tone/patientTerm/narrator/sentenceStyle/signatures/description/source/sampleCount. null=미생성. 본문 생성 시 프롬프트에 주입.';

alter table public.profiles
  add column if not exists voice_dna_updated_at timestamptz;

comment on column public.profiles.voice_dna_updated_at is
  'VOICE-DNA 문체 카드 마지막 갱신 시각. null=미생성.';

alter table public.saved_posts
  add column if not exists original_content text;

comment on column public.saved_posts.original_content is
  'AI 생성 직후 원본 본문 스냅샷(불변, 최초 1회만 기록). 사용자가 편집한 발행본은 content 컬럼이 보관. {original_content, content} 쌍으로 VOICE-DNA 편집 학습.';

-- RLS: profiles / saved_posts 의 본인 select·update 정책이 이미 모든 컬럼을
--      커버하므로 별도 정책 추가 불필요.

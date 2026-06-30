-- 032: 클리닉픽스 AI 가상 진행자 (영상 진행자 = 실존 원장 대신 가상 진행자로 일원화)
--
-- 병원당 1회 생성·확정한 가상 진행자 이미지를 영구 저장하고, 이후 모든 영상의
-- 진행자 컷에 동일 이미지를 재사용한다(Seedance reference-to-video) → 얼굴 일관성.
-- 실존 원장 사진/영상은 더 이상 영상 진행자로 사용하지 않는다(레거시 컬럼은 보존).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS clinic_virtual_presenter_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS clinic_presenter_gender text,
  ADD COLUMN IF NOT EXISTS clinic_presenter_age text,
  ADD COLUMN IF NOT EXISTS clinic_presenter_vibe text,
  ADD COLUMN IF NOT EXISTS clinic_presenter_attire text,
  ADD COLUMN IF NOT EXISTS clinic_presenter_extra text;

COMMENT ON COLUMN profiles.clinic_virtual_presenter_urls IS
  'AI 가상 진행자 확정 이미지 URL 배열(clinic-assets 영구 저장). 모든 영상 진행자 컷에 동일 재사용 → 일관성.';

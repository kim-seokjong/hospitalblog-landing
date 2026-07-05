-- 038 — 변환 이력에 원본 글 연결 (Supabase SQL Editor 수동 적용, idempotent)
--
-- 배경: clinicflix_conversions 에 원본 블로그 글 연결이 없어 크로스 콘텐츠 추천
-- (src/content/lib/cross-content.ts)이 result_assets 텍스트 토큰 매칭으로만 중복을
-- 판정했다 — 이미 영상화한 글이 재추천될 수 있는 구조적 한계.
--
-- 1) clinicflix_conversions.source_post_id (uuid, nullable)
--    블로그 글 진입(#1) 변환의 원본 saved_posts.id. 글 삭제 시 null 로만 풀리고
--    변환 이력은 보존한다(on delete set null). null = 키워드/붙여넣기 진입 또는 과거 변환.
--
-- 2) clinicflix_conversions.source_keyword (text, nullable)
--    키워드 진입(#2) 변환의 입력 키워드. 크로스 추천의 중복 판정·주제 특정 1순위로 쓰인다.
--    (source 가 둘 다 없는 과거 변환만 기존 토큰 매칭으로 폴백 판정.)

alter table public.clinicflix_conversions
  add column if not exists source_post_id uuid
    references public.saved_posts(id) on delete set null;

comment on column public.clinicflix_conversions.source_post_id is
  '원본 블로그 글(saved_posts.id) — 블로그 진입 변환만. 크로스 추천 중복 판정 1순위';

alter table public.clinicflix_conversions
  add column if not exists source_keyword text;

comment on column public.clinicflix_conversions.source_keyword is
  '키워드 진입 변환의 입력 키워드 — 크로스 추천 중복 판정·주제 특정 1순위';

-- 글 → 변환 역참조 조회용 (null 이 대부분이라 partial index)
create index if not exists idx_clinicflix_conversions_source_post
  on public.clinicflix_conversions(source_post_id)
  where source_post_id is not null;

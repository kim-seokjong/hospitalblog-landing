-- 034 — 컴플라이언스 증빙 리포트 + 기존 블로그 소급 진단
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경:
--   A) 글 생성 시 수행되는 의료광고법 검사(A층 키워드/상품명 + B층 LLM 심의관)
--      결과가 지금까지 응답에만 담기고 버려졌다 → 글별 증빙 스냅샷으로 저장해
--      /app/report/[postId] 리포트 페이지에서 재사용한다.
--   B) 회원의 기존 네이버 블로그 글을 소급 진단(RSS 수집 → A층 전건 + B층 상위
--      5편)한 결과를 blog_audits 에 보관한다(재실행 쿨다운 24시간 판정용).

-- 1) saved_posts.compliance_report — 글별 검사 스냅샷 (ComplianceReportSnapshot JSON)
alter table public.saved_posts
  add column if not exists compliance_report jsonb;

comment on column public.saved_posts.compliance_report is
  '의료광고법 검사 증빙 스냅샷(ComplianceReportSnapshot JSON). version/engine/checkedAt/grade/needsManualReview/keyword(A층 위반·경고)/aiReview(B층 지적). null=구버전 글(리포트 페이지에서 즉석 재검사 후 채움).';

-- 2) blog_audits — 기존 블로그 소급 진단 결과
create table if not exists public.blog_audits (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles(id) on delete cascade,
  blog_id  text not null,
  run_at   timestamptz not null default now(),
  results  jsonb not null
);

comment on table public.blog_audits is
  '기존 네이버 블로그 소급 진단 결과(BlogAuditResults JSON). 최근 20편 A층 전건 검사 + A층 위험점수 상위 5편 B층 LLM 심의. 재실행 쿨다운 24시간(run_at 기준, admin 예외).';
comment on column public.blog_audits.blog_id is
  '진단한 네이버 블로그 ID(parseNaverBlogId 정규화 값). admin은 임의 주소 진단 가능(영업 시연용).';
comment on column public.blog_audits.results is
  '진단 결과 JSON — version/engine/blogId/totalPosts/riskyPosts/posts[](제목·링크·위험등급·발췌·근거조항·B층 코멘트).';

create index if not exists idx_blog_audits_user_id on public.blog_audits(user_id);
create index if not exists idx_blog_audits_run_at  on public.blog_audits(run_at desc);

-- 3) RLS — 본인 row만 조회·생성 (saved_posts 등 기존 테이블 RLS 패턴 동일)
--    update/delete 정책은 두지 않는다 → 진단 결과는 불변 이력(append-only).
alter table public.blog_audits enable row level security;

drop policy if exists "사용자는 자신의 진단만 조회" on public.blog_audits;
create policy "사용자는 자신의 진단만 조회"
  on public.blog_audits for select
  using (auth.uid() = user_id);

drop policy if exists "사용자는 자신의 진단만 생성" on public.blog_audits;
create policy "사용자는 자신의 진단만 생성"
  on public.blog_audits for insert
  with check (auth.uid() = user_id);

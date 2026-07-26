-- 049 — 고객 병원 서브 블로그 사이트맵 인덱스용 집계 뷰
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 메인 도메인의 /sitemap-clinics.xml 이 "발행 글이 1편 이상인 병원"의
--       {slug}.hospitalblog.kr/sitemap.xml 만 나열한다. 서치콘솔에 이 인덱스
--       하나만 제출하면 새 병원이 첫 글을 발행하는 순간 자동 편입된다.
--       병원이 수천으로 늘어도 쿼리 1회 + range 페이지네이션으로 처리되도록
--       집계를 DB 로 내린다.
--
-- ⚠️ 보안: 이 뷰는 "어떤 병원이 우리 고객인지"를 드러낸다. 고객 목록을 공개
--    나열하지 않는다는 방침에 따라 anon·authenticated 권한을 명시적으로 회수하고
--    service_role 만 읽는다(라우트는 createAdminClient 로 조회).
--
-- 마이그 미적용 상태에서도 코드는 죽지 않는다:
--   뷰가 없으면(42P01 / PGRST2xx) 앱이 profiles + saved_posts 폴백 집계로 전환한다
--   (src/content/lib/clinic-site/sitemap-index-data.ts).

-- security_invoker = on : 호출 롤의 권한·RLS 로 평가한다(PG15+).
-- service_role 은 bypassrls 라 조회에 영향이 없고, 뷰 소유자 권한으로 우회 조회되는
-- 사고를 막는다.
create or replace view public.clinic_site_sitemap_index
with (security_invoker = on) as
select
  p.site_slug                              as site_slug,
  count(sp.id)                             as post_count,
  max(coalesce(sp.site_published_at, sp.published_at, sp.created_at)) as last_published_at
from public.profiles p
join public.saved_posts sp
  on sp.user_id = p.id
 and sp.published_to_site = true
where p.site_slug is not null
  and p.hospital_name is not null   -- 병원명이 없으면 공개 블로그가 404 다
group by p.site_slug;

comment on view public.clinic_site_sitemap_index is
  '메인 도메인 /sitemap-clinics.xml 용 집계. 발행 글(published_to_site=true) 1편 이상인 병원의 site_slug·글 수·최신 발행시각. service_role 전용(고객 병원 목록 비공개).';

-- 고객 목록 노출 방지 — 공개 롤 권한 회수
revoke all on public.clinic_site_sitemap_index from anon;
revoke all on public.clinic_site_sitemap_index from authenticated;
grant select on public.clinic_site_sitemap_index to service_role;

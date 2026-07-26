-- 052 — post_rankings 무결성 복구
-- 적용 방법: Supabase SQL Editor 에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경 (2026-07-26 조사):
--   post_rankings 351행 전부 rank IS NULL 이었다. 원인은 세 가지가 겹친 것이다.
--     ① 콤마 다중 키워드("조원동치과, , 사랑니")를 분리 없이 한 질의로 보냄 → 사실상 항상 미발견
--     ② 네이버 API 실패·키 없음이 빈 배열로 뭉개져 rank=null 로 저장 → "100위 밖"과 구분 불가
--     ③ 발행 URL 미수집 + blogId 단독 매칭 → 같은 키워드 글끼리 구분 불가
--   그 사이 실제로는 회사 블로그 글이 "의료광고심의위원회" 검색 5위였다.
--
-- 이 마이그레이션이 하는 일:
--   1) 측정 상태(status)·스캔 깊이(scanned_depth)·실패 사유(error_code) 컬럼 신설
--      → "측정 실패" 와 "N위 밖" 을 DB 레벨에서 구분한다
--   2) 기존 351행을 status='invalid' 로 표시 (삭제하지 않는다)
--      → 고장난 파이프라인이 만든 값이라 "100위 밖"으로 해석하면 거짓말이 된다.
--        읽기 경로는 invalid 를 제외하고, 실제 삭제는 아래 §6 을 대표가 판단해 별도 실행한다.
--   3) (post_id, keyword, target_site, checked_on) 1일 1행 UPSERT 를 위한 유니크 인덱스
--      → 매일 무한 누적되던 행 증가를 멈춘다 (15편 × 23일 = 351행이 그 결과였다)

-- ★ 전체를 한 트랜잭션으로 실행한다. 중간에 실패하면 통째로 되돌아가
--   "제약은 지웠는데 인덱스는 안 만들어진" 부분 적용 상태가 남지 않는다.
begin;

-- ─────────────────────────────────────────────────────────────
-- 1) 컬럼 신설
-- ─────────────────────────────────────────────────────────────
alter table public.post_rankings
  add column if not exists status        text,
  add column if not exists scanned_depth int,
  add column if not exists error_code    text,
  add column if not exists checked_on    date;

comment on column public.post_rankings.status is
  'ok=순위 확정 / not_found=정상 측정했으나 scanned_depth 위까지 없음 / failed=측정 실패(키 없음·쿼터·네트워크) / ambiguous=내 글 여럿이 잡혀 특정 불가 / invalid=구 파이프라인(2026-07 이전) 산출물, 신뢰 불가';
comment on column public.post_rankings.scanned_depth is
  '이번 측정에서 실제로 훑어본 깊이(위). not_found 를 "몇 위 밖"으로 정직하게 표시하기 위해 저장.';
comment on column public.post_rankings.error_code is
  'status=failed 일 때의 사유 (no_credentials / rate_limited / network_error / budget_exhausted 등).';
comment on column public.post_rankings.checked_on is
  'KST 측정일자. (post_id, keyword, target_site, checked_on) 이 1일 1행 UPSERT 키.';

-- rank 컬럼 의미 갱신 — 이제 null 이라고 해서 "100위 밖"이 아니다
comment on column public.post_rankings.rank is
  '추정 순위(1-base). ★ status=ok 일 때만 값이 있다. null 은 status 를 함께 봐야 해석된다(not_found/failed/ambiguous). 네이버 검색 API(sort=sim) 기준 추정치이며 실제 검색 화면 순위가 아니다.';

-- ─────────────────────────────────────────────────────────────
-- 2) 백필 — 기존 행 정리
-- ─────────────────────────────────────────────────────────────
update public.post_rankings
   set checked_on = (checked_at at time zone 'Asia/Seoul')::date
 where checked_on is null;

update public.post_rankings
   set target_site = 'naver'
 where target_site is null or btrim(target_site) = '';

-- ★ 기존 행은 전부 고장난 파이프라인의 산출물이다. not_found 로 승격시키지 않는다.
update public.post_rankings
   set status = 'invalid'
 where status is null;

update public.post_rankings
   set scanned_depth = 0
 where scanned_depth is null;

-- 재실행 안전장치 — 이 마이그레이션의 이전 버전을 이미 적용한 DB 라면
-- status='ok' 인데 rank 가 없는 행이 남아 있을 수 있다. 아래 CHECK 가 그 행 때문에
-- 실패해 트랜잭션 전체가 롤백되므로, 먼저 실패(측정 불가)로 정정한다.
update public.post_rankings
   set status = 'failed',
       error_code = coalesce(error_code, 'legacy_ok_without_rank')
 where status = 'ok' and rank is null;

-- ─────────────────────────────────────────────────────────────
-- 3) 제약 — 유니크 인덱스가 동작하려면 키 컬럼에 NULL 이 없어야 한다
--    (NULL 은 서로 충돌하지 않아 UPSERT 가 조용히 중복을 만든다)
-- ─────────────────────────────────────────────────────────────
alter table public.post_rankings
  alter column target_site set default 'naver',
  alter column checked_on  set default (now() at time zone 'Asia/Seoul')::date,
  alter column status      set default 'ok';

alter table public.post_rankings
  alter column target_site set not null,
  alter column checked_on  set not null,
  alter column status      set not null;

alter table public.post_rankings
  drop constraint if exists post_rankings_status_check;
alter table public.post_rankings
  add constraint post_rankings_status_check
  check (status in ('ok', 'not_found', 'failed', 'ambiguous', 'invalid'));

-- ★ rank 와 status 는 완전히 동기여야 한다 (양방향).
--   ok  → rank 반드시 있음   (rank 없는 'ok' = "측정은 됐는데 순위가 없다" 는 거짓말)
--   그 외 → rank 반드시 없음 (실패가 순위로 둔갑하는 것을 DB 가 막는다)
--   invalid(구 데이터)만 예외로 둔다.
--
--   이 제약은 안전장치이기도 하다: 마이그 적용 직후 PostgREST 스키마 캐시가 잠깐
--   낡아 코드가 구 스키마 폴백(status 미지정 → default 'ok')으로 빠지더라도,
--   rank 가 null 인 행은 여기서 막혀 "측정 실패인데 ok 로 저장" 되지 않는다.
alter table public.post_rankings
  drop constraint if exists post_rankings_rank_status_check;
alter table public.post_rankings
  add constraint post_rankings_rank_status_check
  check (
    case
      when status = 'invalid' then true
      when status = 'ok'      then rank is not null
      else rank is null
    end
  );

-- ─────────────────────────────────────────────────────────────
-- 4) 중복 제거 → 1일 1행 유니크 인덱스
--    같은 (post_id, keyword, target_site, checked_on) 은 가장 최근 1행만 남긴다.
-- ─────────────────────────────────────────────────────────────
delete from public.post_rankings a
 using public.post_rankings b
 where a.post_id is not null
   and a.post_id     = b.post_id
   and a.keyword     = b.keyword
   and a.target_site = b.target_site
   and a.checked_on  = b.checked_on
   and (a.checked_at < b.checked_at
        or (a.checked_at = b.checked_at and a.id < b.id));

-- post_id 가 NULL 인 행은 유니크 인덱스에서 서로 충돌하지 않지만, cron 은 항상
-- post_id 를 채우므로 실사용에 영향이 없다. 운영 데이터를 지우지 않기 위해
-- NOT NULL 강제·일괄 삭제는 하지 않는다 (필요하면 §6 에서 함께 판단).

-- ★ `if not exists` 만 쓰면 같은 이름의 "다른 정의" 인덱스가 이미 있을 때 조용히 건너뛴다.
--   그러면 마이그레이션은 성공처럼 보이는데 UPSERT 는 계속 42P10 으로 실패한다.
--   반드시 지우고 다시 만든다(정의가 코드의 onConflict 와 일치함을 보장).
drop index if exists public.uq_post_rankings_daily;
create unique index uq_post_rankings_daily
  on public.post_rankings (post_id, keyword, target_site, checked_on);

-- 최신 상태 조회용 (마이페이지 성과 리포트)
create index if not exists idx_post_rankings_post_keyword
  on public.post_rankings (post_id, keyword, checked_on desc);

-- ★ PostgREST 스키마 캐시 갱신 — 이걸 안 하면 적용 직후 몇 초간 신규 컬럼이
--   "없는 것"으로 보여(PGRST204) 코드가 구 스키마 폴백으로 빠진다.
notify pgrst, 'reload schema';

commit;

-- ─────────────────────────────────────────────────────────────
-- 5) 확인 쿼리 (적용 후 눈으로 검증 — 위 트랜잭션과 별도로 실행)
-- ─────────────────────────────────────────────────────────────
-- select status, count(*) from public.post_rankings group by status order by 2 desc;
--
-- 유니크 인덱스가 코드의 onConflict 와 정확히 같은 컬럼 구성인지 확인:
-- select indexdef from pg_indexes
--  where schemaname='public' and indexname='uq_post_rankings_daily';
--   기대: UNIQUE INDEX ... (post_id, keyword, target_site, checked_on)

-- ─────────────────────────────────────────────────────────────
-- 6) ★ 선택 — 고장난 구 데이터 완전 삭제 (대표 판단 후 별도 실행)
--    status='invalid' 행은 읽기 경로에서 이미 제외된다. 차트에서 완전히 지우고
--    싶을 때만 아래를 실행한다. 되돌릴 수 없다.
-- ─────────────────────────────────────────────────────────────
-- delete from public.post_rankings where status = 'invalid';

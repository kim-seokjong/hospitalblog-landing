-- 031 — 상위노출 역분석 벤치마크 캐시
-- 적용 방법: Supabase SQL Editor에서 수동 실행 (idempotent)
-- DB 적용은 사용자가 직접 수행한다 (코드/배포와 분리).
--
-- 배경: 키워드 상위 글 역분석(SerpBenchmark = 목표 글자수/소제목/이미지/하위주제 등)은
--       네이버 검색 + 본문 fetch + Claude 분석이 필요해 매 생성마다 반복하면 느리고 비싸다.
--       SerpBenchmark 는 사용자 무관·비민감(공개 SERP 분석)한 키워드 단위 전역 자원이므로
--       (keyword, target_site) 키로 캐시하고 TTL(코드 상수 7일) 만료 시 재계산한다.
--
-- 컬럼:
--   keyword      — 정규화된 캐시 키(코드에서 NFC·trim·연속공백 1칸·소문자 후 저장)
--   target_site  — 'naver' | 'google' (프롬프트/길이 기준이 사이트별로 달라 분리)
--   benchmark    — SerpBenchmark JSON
--   expires_at   — 만료 시각(코드에서 now + TTL 로 기록)
--   created_at   — 저장 시각

create table if not exists public.serp_benchmark_cache (
  keyword      text not null,
  target_site  text not null default 'naver',
  benchmark    jsonb not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  primary key (keyword, target_site)
);

comment on table public.serp_benchmark_cache is
  '상위노출 역분석 벤치마크(SerpBenchmark) 캐시. (keyword,target_site) 단위 전역 캐시. service role(createAdminClient)로만 접근, TTL 만료 시 재계산.';

create index if not exists idx_serp_benchmark_cache_expires
  on public.serp_benchmark_cache(expires_at);

-- RLS — 전역 비민감 캐시지만 일반 사용자 직접 접근은 막는다.
--       정책을 두지 않음 → service role(RLS 우회)로만 read/write (post_rankings 동일 패턴).
alter table public.serp_benchmark_cache enable row level security;

-- 039: 전자책 무료 요약판 리드 수집 (랜딩 리드마그넷)
-- 병원명+이메일을 남기면 요약판 PDF 다운로드 — 인바운드 리드 자산.
-- service role 로만 쓰기/읽기 (공개 정책 없음). API 라우트에서 admin client 로 insert.

create table if not exists public.ebook_leads (
  id uuid primary key default gen_random_uuid(),
  hospital_name text not null,
  email text not null,
  source text not null default 'landing',
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ebook_leads_email_idx on public.ebook_leads (email);
create index if not exists ebook_leads_created_idx on public.ebook_leads (created_at desc);

alter table public.ebook_leads enable row level security;
-- 공개 정책 없음: anon/authenticated 접근 불가, service role 만 사용.

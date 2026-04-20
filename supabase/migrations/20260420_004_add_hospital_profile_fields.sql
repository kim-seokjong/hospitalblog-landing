-- profiles 테이블에 병원 정보 컬럼 추가
alter table public.profiles
  add column if not exists full_name       text,
  add column if not exists phone           text,
  add column if not exists hospital_name   text,
  add column if not exists hospital_address text,
  add column if not exists position        text
    check (position in ('원장','부원장','간호사','원무','마케터','기타'));

-- 프로필 업데이트 정책 추가 (자신의 레코드만)
create policy "사용자는 자신의 프로필만 수정"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

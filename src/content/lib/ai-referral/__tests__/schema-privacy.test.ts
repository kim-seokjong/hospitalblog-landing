import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ★ 개인정보 최소화 고정 테스트 — 마이그 051 스키마가 "그 넷"에서 벗어나지 못하게 한다.
 *
 * 이 기능의 제1 제약은 "개인을 식별할 수 있는 어떤 값도 남기지 않는다"이다.
 * 첫 리뷰에서 실제로 차단된 사례가 created_at/updated_at 이었다: 하루 동안
 * (병원·출처·글) 조합의 방문이 1건뿐이면 그 타임스탬프가 곧 그 개인의 방문 시각이
 * 된다. 코드 리뷰 기억이 아니라 테스트가 규칙을 강제하게 한다.
 *
 * npm test 는 패키지 루트에서 실행되므로 process.cwd() 기준으로 SQL 을 읽는다.
 */

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260726_051_clinic_ai_referrals.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');

/** create table 본문에서 컬럼명만 뽑는다 (주석·제약 줄 제외). */
function tableColumns(source: string, table: string): string[] {
  const start = source.indexOf(`create table if not exists public.${table} (`);
  assert.notEqual(start, -1, `create table 구문을 찾지 못했다: ${table}`);
  const bodyStart = source.indexOf('(', start) + 1;
  const bodyEnd = source.indexOf('\n);', bodyStart);
  assert.notEqual(bodyEnd, -1, 'create table 종료 지점을 찾지 못했다');

  return source
    .slice(bodyStart, bodyEnd)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('/**') && !line.startsWith('--'))
    .map((line) => /^([a-z_][a-z0-9_]*)\s/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** create table 본문의 컬럼 정의 줄 전체 (타입 검사용). */
function tableColumnLines(source: string, table: string): string[] {
  const start = source.indexOf(`create table if not exists public.${table} (`);
  const bodyStart = source.indexOf('(', start) + 1;
  const bodyEnd = source.indexOf('\n);', bodyStart);
  return source
    .slice(bodyStart, bodyEnd)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('/**') && !line.startsWith('--'));
}

test('clinic_ai_referrals: 컬럼 집합이 정확히 고정돼 있다', () => {
  const columns = tableColumns(sql, 'clinic_ai_referrals').sort();
  assert.deepEqual(columns, ['id', 'post_id', 'source', 'user_id', 'visit_date', 'visits']);
});

test('★ clinic_ai_referrals: timestamp/timestamptz 컬럼이 하나도 없다', () => {
  // 소수 셀에서는 어떤 타임스탬프든 곧 그 개인의 방문 시각이 된다.
  // created_at/updated_at 같은 "관리용" 컬럼도 예외가 아니다.
  const lines = tableColumnLines(sql, 'clinic_ai_referrals');
  for (const line of lines) {
    assert.equal(
      /\b(timestamptz|timestamp|time)\b/.test(line),
      false,
      `시각 컬럼이 있다: ${line}`,
    );
  }
  // date 타입(일 단위)만 시간 정보로 허용된다
  assert.equal(lines.filter((l) => /\bdate\b/.test(l)).length, 1);
});

test('★ record RPC 가 어떤 타임스탬프도 갱신하지 않는다', () => {
  // 방문마다 updated_at = now() 를 찍으면 그 자체가 개인 방문 시각 기록이다.
  const fnStart = sql.indexOf('create or replace function public.record_clinic_ai_referral');
  assert.notEqual(fnStart, -1);
  const fnBody = sql.slice(fnStart, sql.indexOf('comment on function public.record_clinic_ai_referral'));
  assert.equal(/updated_at/.test(fnBody), false, 'updated_at 갱신이 남아 있다');
  assert.equal(/created_at/.test(fnBody), false, 'created_at 이 남아 있다');
  assert.equal(/now\(\)/.test(fnBody), false, 'now() 로 시각을 기록하고 있다');
});

test('마이그 051: 초안의 타임스탬프 컬럼을 제거하는 정리 구문이 있다', () => {
  // 리뷰 전 초안을 이미 적용한 환경에서도 시각 컬럼이 남지 않아야 한다.
  assert.match(sql, /drop column if exists created_at/);
  assert.match(sql, /drop column if exists updated_at/);
});

test('clinic_ai_referrals: 개인 식별 가능 컬럼이 존재하지 않는다', () => {
  const columns = tableColumns(sql, 'clinic_ai_referrals');
  const forbidden = [
    'ip', 'ip_address', 'ip_hash', 'client_ip', 'remote_addr',
    'user_agent', 'ua', 'device', 'device_id', 'fingerprint',
    'cookie', 'session_id', 'anon_id', 'visitor_id',
    'referrer', 'referer', 'referrer_url', 'landing_url', 'query',
    'email', 'phone', 'name',
    'created_at', 'updated_at', 'visited_at', 'occurred_at',
  ];
  for (const name of forbidden) {
    assert.equal(columns.includes(name), false, `금지 컬럼이 있다: ${name}`);
  }
});

test('record_clinic_ai_referral: insert 하는 컬럼도 허용 집합 안이다', () => {
  const match = /insert into public\.clinic_ai_referrals \(([^)]*)\)/.exec(sql);
  assert.notEqual(match, null, 'RPC 의 insert 구문을 찾지 못했다');
  const inserted = (match?.[1] ?? '').split(',').map((c) => c.trim()).sort();
  assert.deepEqual(inserted, ['post_id', 'source', 'user_id', 'visit_date', 'visits']);
});

test('마이그 051: RLS 가 켜져 있고 본인 조회 정책만 존재한다', () => {
  assert.match(sql, /alter table public\.clinic_ai_referrals enable row level security/);
  assert.match(sql, /for select\s*\n?\s*using \(auth\.uid\(\) = user_id\)/);
  // 클라이언트가 직접 쓰지 못하도록 insert/update/delete 정책은 만들지 않는다
  assert.equal(/create policy[\s\S]*?for (insert|update|delete)/.test(sql), false);
});

test('마이그 051: 쓰기 RPC 는 service_role 전용이다', () => {
  assert.match(sql, /revoke all on function public\.record_clinic_ai_referral\([^)]*\) from public/);
  assert.match(sql, /grant execute on function public\.record_clinic_ai_referral\([^)]*\) to service_role/);
  // authenticated 에게 쓰기 함수를 열지 않는다
  assert.equal(
    /grant execute on function public\.record_clinic_ai_referral\([^)]*\) to authenticated/.test(sql),
    false,
  );
});

test('마이그 051: 읽기 RPC 는 DB에서 집계하고 RLS 로 격리된다', () => {
  // 앱이 원시 행을 LIMIT 으로 끌어오면 통계가 조용히 잘린다 → DB 집계가 필수.
  assert.match(sql, /create or replace function public\.clinic_ai_referral_summary/);
  assert.match(sql, /returns jsonb/);
  // SECURITY DEFINER 가 아니어야 RLS 가 호출자 기준으로 적용된다
  const fnStart = sql.indexOf('create or replace function public.clinic_ai_referral_summary');
  const fnBody = sql.slice(fnStart, sql.indexOf('comment on function public.clinic_ai_referral_summary'));
  assert.equal(/security definer/i.test(fnBody), false, '읽기 함수가 SECURITY DEFINER 다 (RLS 우회 위험)');
  assert.match(fnBody, /jsonb_build_object/);
});

test('마이그 051: SECURITY DEFINER 함수는 빈 search_path + 스키마 수식 이름을 쓴다', () => {
  const fnStart = sql.indexOf('create or replace function public.record_clinic_ai_referral');
  const fnBody = sql.slice(fnStart, sql.indexOf('comment on function public.record_clinic_ai_referral'));
  assert.match(fnBody, /security definer/i);
  assert.match(fnBody, /set search_path = ''/);
  // 스키마 없이 참조하는 테이블이 없어야 한다
  assert.equal(/\sfrom\s+(?!public\.)[a-z_]+\s/i.test(fnBody), false, '스키마 수식 없는 참조가 있다');
});

test('마이그 051: visits 는 bigint (장기 남용 overflow 방지)', () => {
  assert.match(sql, /visits\s+bigint not null default 0/);
  assert.match(sql, /alter column visits type bigint/);
});

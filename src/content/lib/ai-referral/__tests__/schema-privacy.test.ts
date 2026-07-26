import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ★ 개인정보 최소화 고정 테스트 — 마이그 051 스키마가 "그 넷"에서 벗어나지 못하게 한다.
 *
 * 이 기능의 제1 제약은 "개인을 식별할 수 있는 어떤 값도 남기지 않는다"이다.
 * 나중에 누군가 "디버깅용으로 IP만 잠깐"·"UA도 같이" 같은 컬럼을 추가하면 이 테스트가
 * 깨진다. 코드 리뷰 기억이 아니라 테스트가 규칙을 강제하게 하려는 목적이다.
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

test('clinic_ai_referrals: 컬럼 집합이 정확히 고정돼 있다', () => {
  const columns = tableColumns(sql, 'clinic_ai_referrals').sort();
  assert.deepEqual(columns, [
    'created_at',
    'id',
    'post_id',
    'source',
    'updated_at',
    'user_id',
    'visit_date',
    'visits',
  ]);
});

test('clinic_ai_referrals: 개인 식별 가능 컬럼이 존재하지 않는다', () => {
  const columns = tableColumns(sql, 'clinic_ai_referrals');
  const forbidden = [
    'ip', 'ip_address', 'ip_hash', 'client_ip', 'remote_addr',
    'user_agent', 'ua', 'device', 'device_id', 'fingerprint',
    'cookie', 'session_id', 'anon_id', 'visitor_id',
    'referrer', 'referer', 'referrer_url', 'landing_url', 'query',
    'email', 'phone', 'name', 'visited_at', 'occurred_at',
  ];
  for (const name of forbidden) {
    assert.equal(columns.includes(name), false, `금지 컬럼이 있다: ${name}`);
  }
});

test('clinic_ai_referrals: 시각이 아니라 일자 단위로만 저장한다', () => {
  // 방문 시각(timestamptz)을 저장하면 개인 단위 타임라인 재구성이 가능해진다.
  // created_at/updated_at 은 행 관리용이며 개별 방문 시각이 아니다.
  assert.match(sql, /visit_date date not null/);
  assert.equal(/visit_at|visited_at|occurred_at/.test(sql), false);
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

test('마이그 051: RPC 실행 권한이 service_role 로 제한된다', () => {
  assert.match(sql, /revoke all on function public\.record_clinic_ai_referral\([^)]*\) from public/);
  assert.match(sql, /grant execute on function public\.record_clinic_ai_referral\([^)]*\) to service_role/);
});

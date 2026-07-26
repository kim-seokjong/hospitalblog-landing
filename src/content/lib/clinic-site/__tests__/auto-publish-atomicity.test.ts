import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * [차단 2 회귀] 하루 3편이 "동시 실행"에서도 강제되는지 검증한다.
 *
 * 실제 강제는 Postgres 함수(마이그 050)가 하므로 단위 테스트로 DB 를 돌릴 수 없다.
 * 대신 세 층으로 확인한다:
 *  ① 계약 모델 — 직렬화(advisory lock)가 있을 때/없을 때의 결과 차이를 시뮬레이션해
 *     "왜 RPC 가 필요한지"와 "RPC 계약이 상한을 지키는지"를 고정한다.
 *  ② 마이그레이션 소스 — 직렬화·집계·선점이 실제로 한 함수 안에 있는지 검사한다.
 *  ③ 라우트 소스 — 앱이 정말 그 RPC 를 호출하는지(옛 비원자 경로로 되돌아가지 않았는지).
 */

const SQL_PATH = new URL(
  '../../../../../supabase/migrations/20260726_050_auto_publish_atomic.sql',
  import.meta.url,
);
const ROUTE_PATH = new URL('../../../../app/api/cron/site-auto-publish/route.ts', import.meta.url);
const CLAIM_PATH = new URL('../auto-publish-claim.ts', import.meta.url);

const sql = readFileSync(SQL_PATH, 'utf8');
const routeSource = readFileSync(ROUTE_PATH, 'utf8');
const claimSource = readFileSync(CLAIM_PATH, 'utf8');

// ---------------------------------------------------------------------------
// ① 계약 모델 — 두 실행이 동시에 들어와도 하루 총 3편
// ---------------------------------------------------------------------------

const DAILY_CAP = 3;

/** 오늘 발행된 글 수를 공유 상태로 갖는 최소 DB 모델. */
interface DbModel {
  publishedToday: number;
  unpublished: string[];
}

/**
 * RPC 계약: 집계 → 잔여 몫 계산 → 그만큼만 선점을 "한 트랜잭션"에서 처리한다.
 * advisory lock 이 같은 회원의 동시 호출을 직렬화하므로, 이 함수는 원자적으로 실행된다.
 */
function claimAtomic(db: DbModel, candidateIds: readonly string[]): string[] {
  const quota = Math.max(0, DAILY_CAP - db.publishedToday);
  if (quota === 0) return [];

  const claimable = candidateIds.filter((id) => db.unpublished.includes(id)).slice(0, quota);
  for (const id of claimable) {
    db.unpublished = db.unpublished.filter((x) => x !== id);
    db.publishedToday += 1;
  }
  return claimable;
}

test('★ 동시 실행 2회에도 하루 총 3편을 넘지 않는다 (RPC 계약 = 직렬화)', () => {
  const db: DbModel = { publishedToday: 0, unpublished: ['a', 'b', 'c', 'd', 'e', 'f'] };

  // 두 실행이 각각 서로 다른 후보를 들고 "동시에" 들어온다.
  const runA = claimAtomic(db, ['a', 'b', 'c']);
  const runB = claimAtomic(db, ['d', 'e', 'f']);

  assert.equal(runA.length, 3, '첫 실행이 3편을 가져간다');
  assert.equal(runB.length, 0, '두 번째 실행은 몫이 없어야 한다');
  assert.equal(db.publishedToday, DAILY_CAP);
});

test('★ 3회 이상 재실행·중복 전달에도 총 3편', () => {
  const db: DbModel = { publishedToday: 0, unpublished: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
  const runs = [
    claimAtomic(db, ['a', 'b']),
    claimAtomic(db, ['c', 'd']),
    claimAtomic(db, ['e', 'f']),
    claimAtomic(db, ['g']),
  ];
  const totalPublished = runs.reduce((sum, r) => sum + r.length, 0);
  assert.equal(totalPublished, DAILY_CAP);
  assert.equal(db.publishedToday, DAILY_CAP);
});

test('★ 부분 발행 뒤 재실행하면 남은 몫만 (1편 + 2편 = 3편)', () => {
  const db: DbModel = { publishedToday: 0, unpublished: ['a', 'b', 'c', 'd'] };
  assert.equal(claimAtomic(db, ['a']).length, 1);
  assert.equal(claimAtomic(db, ['b', 'c', 'd']).length, 2);
  assert.equal(db.publishedToday, DAILY_CAP);
});

test('직렬화가 없으면(옛 경로) 상한이 깨진다 — RPC 가 필요한 이유', () => {
  // 두 실행이 모두 "오늘 0편"을 읽은 뒤 각자 서로 다른 글을 선점하는 인터리빙.
  const db: DbModel = { publishedToday: 0, unpublished: ['a', 'b', 'c', 'd', 'e', 'f'] };
  const snapshotA = db.publishedToday; // 실행 A 가 읽은 카운트
  const snapshotB = db.publishedToday; // 실행 B 도 같은 카운트를 읽는다

  const quotaA = Math.max(0, DAILY_CAP - snapshotA);
  const quotaB = Math.max(0, DAILY_CAP - snapshotB);
  const totalNonAtomic = quotaA + quotaB;

  assert.equal(totalNonAtomic, 6, '비원자 경로에서는 하루 6편까지 나갈 수 있다');
  assert.ok(totalNonAtomic > DAILY_CAP, '이 초과가 바로 마이그 050 이 막는 문제다');
});

// ---------------------------------------------------------------------------
// ② 마이그레이션 소스 — 집계·선점이 실제로 한 함수 안에서 직렬화되는가
// ---------------------------------------------------------------------------

test('마이그 050: claim_auto_publish_posts 가 advisory lock 으로 직렬화한다', () => {
  assert.match(sql, /create or replace function public\.claim_auto_publish_posts/);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test('마이그 050: 같은 함수 안에서 오늘 집계 → 잔여 몫 → 그만큼만 선점한다', () => {
  const fn = sql.slice(sql.indexOf('claim_auto_publish_posts'));
  // 오늘(KST 경계) 발행 수 집계
  assert.match(fn, /site_published_at >= p_day_start/);
  assert.match(fn, /published_to_site = true/);
  // 잔여 몫
  assert.match(fn, /v_quota := greatest\(0, p_daily_cap - v_used\)/);
  // 몫만큼만 선점 + 미발행 글만 + 동시성 안전
  assert.match(fn, /limit v_quota/);
  assert.match(fn, /s\.published_to_site = false/);
  assert.match(fn, /for update skip locked/);
});

test('마이그 050: 주기 실행권 선점 함수가 행 잠금 + 임계값 조건을 쓴다', () => {
  assert.match(sql, /create or replace function public\.claim_auto_publish_cycle/);
  const fn = sql.slice(sql.lastIndexOf('create or replace function public.claim_auto_publish_cycle'));
  assert.match(fn, /for update/);
  assert.match(fn, /v_prev > p_threshold/);
  assert.match(fn, /set site_publish_last_run = now\(\)/);
});

test('마이그 050: 순회 커서 테이블이 있고 공개 롤에 노출되지 않는다', () => {
  assert.match(sql, /create table if not exists public\.clinic_auto_publish_state/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.clinic_auto_publish_state from anon/);
  assert.match(sql, /revoke all on public\.clinic_auto_publish_state from authenticated/);
});

test('마이그 050: RPC 실행 권한이 service_role 로만 제한된다', () => {
  assert.match(sql, /revoke all on function public\.claim_auto_publish_posts[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_auto_publish_posts[\s\S]*?to service_role/);
  assert.match(sql, /revoke all on function public\.claim_auto_publish_cycle[\s\S]*?from public, anon, authenticated/);
});

test('마이그 050: 깨진 초안 함수가 남아 있지 않다 (claim_auto_publish_cycle 정의 1개)', () => {
  const defs = sql.match(/create or replace function public\.claim_auto_publish_cycle/g) ?? [];
  assert.equal(defs.length, 1);
  assert.ok(!sql.includes('returning p_threshold'), '잘못된 초안 RETURNING 이 남아 있다');
});

// ---------------------------------------------------------------------------
// ③ 라우트·클라이언트 소스 — 앱이 정말 원자 경로를 쓰는가
// ---------------------------------------------------------------------------

test('cron 라우트가 원자 선점 RPC 경로를 호출한다', () => {
  assert.match(routeSource, /claimAutoPublishPosts\(/);
  assert.match(routeSource, /claimAutoPublishCycle\(/);
});

test('cron 라우트가 커서를 읽고 저장한다 (순회 이어달리기)', () => {
  assert.match(routeSource, /readAutoPublishCursor\(/);
  assert.match(routeSource, /writeAutoPublishCursor\(/);
  assert.match(routeSource, /lastExaminedId = profile\.id/);
});

test('cron 라우트에 옛 비원자 카운트 경로가 남아 있지 않다', () => {
  assert.ok(
    !routeSource.includes('countPublishedToday'),
    '라우트에서 직접 집계하던 옛 경로가 남아 있다 — 원자성이 깨진다',
  );
});

test('클라이언트: RPC 이름·파라미터가 마이그레이션 시그니처와 일치한다', () => {
  assert.match(claimSource, /rpc\('claim_auto_publish_posts'/);
  assert.match(claimSource, /rpc\('claim_auto_publish_cycle'/);
  for (const param of ['p_user_id', 'p_daily_cap', 'p_day_start', 'p_post_ids']) {
    assert.ok(claimSource.includes(param), `${param} 누락`);
    assert.ok(sql.includes(param), `마이그레이션에 ${param} 없음`);
  }
  assert.ok(claimSource.includes('p_threshold') && sql.includes('p_threshold'));
});

test('클라이언트: RPC 미적용 환경에서도 죽지 않고 폴백한다', () => {
  // 42883 undefined_function / PGRST202 스키마 캐시 미스
  assert.match(claimSource, /42883/);
  assert.match(claimSource, /PGRST2/);
  assert.match(claimSource, /legacyClaimPosts/);
});

test('주기를 선점하고도 발행하지 못하면 되돌린다 (주기 낭비 방지)', () => {
  assert.match(claimSource, /restoreAutoPublishCycle/);
  assert.match(routeSource, /restoreAutoPublishCycle\(/);
  // 되돌리기는 "한 편도 못 가져간" 경로에서 호출돼야 한다
  assert.match(routeSource, /publishedIds\.length === 0[\s\S]{0,300}restoreAutoPublishCycle/);
});

test('마이그 050 미적용 폴백에서도 weekly last_run 이 갱신된다 (매일 발행 회귀 방지)', () => {
  // RPC 가 주기를 원자적으로 선점한 경우에만 라우트가 last_run 갱신을 건너뛴다.
  assert.match(routeSource, /cycleAlreadyStamped[\s\S]{0,120}cycle\.atomic/);
  assert.match(routeSource, /if \(!cycleAlreadyStamped\)[\s\S]{0,200}site_publish_last_run/);
});

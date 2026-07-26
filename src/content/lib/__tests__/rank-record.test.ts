import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRankingRow,
  toLegacyRow,
  isMissingRankingSchema,
  kstDateString,
  RANKING_CONFLICT_TARGET,
} from '../rank-record.ts';

const BASE = {
  userId: 'u1',
  postId: 'p1',
  keyword: '사랑니',
  targetSite: 'naver',
  scannedDepth: 300,
} as const;

// ── rank 는 ok 일 때만 값을 가진다 ──
test('★ 측정 실패 행에는 rank 가 들어가지 않는다', () => {
  const row = buildRankingRow({ ...BASE, status: 'failed', rank: 42, errorCode: 'rate_limited' });
  assert.equal(row.rank, null);
  assert.equal(row.status, 'failed');
  assert.equal(row.error_code, 'rate_limited');
});

test('ok 면 rank 유지', () => {
  const row = buildRankingRow({ ...BASE, status: 'ok', rank: 5 });
  assert.equal(row.rank, 5);
  assert.equal(row.status, 'ok');
  assert.equal(row.error_code, null);
});

test('not_found 는 rank=null + 스캔 깊이 기록 ("몇 위 밖"인지 정직하게)', () => {
  const row = buildRankingRow({ ...BASE, status: 'not_found', rank: null });
  assert.equal(row.rank, null);
  assert.equal(row.status, 'not_found');
  assert.equal(row.scanned_depth, 300);
});

test('target_site 가 null 이면 naver 로 채운다 (유니크 인덱스 구성요소)', () => {
  const row = buildRankingRow({ ...BASE, targetSite: null, status: 'ok', rank: 1 });
  assert.equal(row.target_site, 'naver');
});

test('checked_on 은 KST 날짜', () => {
  const row = buildRankingRow({ ...BASE, status: 'ok', rank: 1, checkedOn: '2026-07-26' });
  assert.equal(row.checked_on, '2026-07-26');
});

test('kstDateString: UTC 자정 직전도 KST 다음날로 계산', () => {
  // 2026-07-25 20:00 UTC = 2026-07-26 05:00 KST
  assert.equal(kstDateString(new Date('2026-07-25T20:00:00Z')), '2026-07-26');
  assert.equal(kstDateString(new Date('2026-07-25T10:00:00Z')), '2026-07-25');
});

test('UPSERT 충돌 대상은 마이그 052 유니크 인덱스와 같은 컬럼 구성', () => {
  assert.equal(RANKING_CONFLICT_TARGET, 'post_id,keyword,target_site,checked_on');
});

// ── 마이그 미적용 폴백 ──
test('★ 마이그 052 미적용 신호를 인식한다 (컬럼 없음 / 유니크 제약 없음)', () => {
  assert.equal(isMissingRankingSchema({ code: '42703' }), true, 'undefined_column');
  assert.equal(isMissingRankingSchema({ code: '42P01' }), true, 'undefined_table');
  assert.equal(isMissingRankingSchema({ code: '42P10' }), true, 'ON CONFLICT 제약 없음');
  assert.equal(isMissingRankingSchema({ code: 'PGRST204' }), true, 'PostgREST 스키마 캐시');
  assert.equal(
    isMissingRankingSchema({
      code: null,
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    }),
    true,
  );
  assert.equal(
    isMissingRankingSchema({ code: null, message: "column 'status' does not exist" }),
    true,
  );
});

test('그 외 오류는 폴백 대상이 아니다 (진짜 오류를 삼키면 안 된다)', () => {
  assert.equal(isMissingRankingSchema({ code: '23503', message: 'foreign key violation' }), false);
  assert.equal(isMissingRankingSchema({ code: '23514', message: 'check constraint' }), false);
  assert.equal(isMissingRankingSchema(null), false);
  assert.equal(isMissingRankingSchema(undefined), false);
});

test('폴백 행에는 신규 컬럼이 없다 (구 스키마로 insert 가능)', () => {
  const row = buildRankingRow({ ...BASE, status: 'not_found', rank: null });
  const legacy = toLegacyRow(row);
  assert.deepEqual(Object.keys(legacy).sort(), [
    'checked_at', 'keyword', 'post_id', 'rank', 'target_site', 'user_id',
  ]);
  assert.equal('status' in legacy, false);
  assert.equal('checked_on' in legacy, false);
  assert.equal('scanned_depth' in legacy, false);
});

test('★ checked_at 을 명시적으로 넣는다 — 같은 날 재실행(UPSERT)에도 시각이 갱신되도록', () => {
  const row = buildRankingRow({ ...BASE, status: 'ok', rank: 1, checkedAt: '2026-07-26T01:02:03.000Z' });
  assert.equal(row.checked_at, '2026-07-26T01:02:03.000Z');
  // 미지정이면 현재 시각
  const now = buildRankingRow({ ...BASE, status: 'ok', rank: 1 });
  assert.ok(Math.abs(Date.parse(now.checked_at) - Date.now()) < 5000);
});

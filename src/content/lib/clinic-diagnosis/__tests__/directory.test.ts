import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectoryTerms,
  combineWithDirectory,
  isDirectoryMngNo,
  lookupDirectory,
  sanitizeLikeTerm,
  shouldTryDirectory,
  toDirectoryCandidate,
  type DirectoryQuery,
  type DirectoryRow,
  type DirectorySearch,
  type DirectorySearchResult,
} from '../directory.ts';
import type { ClinicLookupOutcome } from '../types.ts';

/**
 * 회귀 테스트의 목적은 하나다 — 2026-07-27 장애의 재발 방지.
 *
 * 그날의 실패 조건은 "행안부가 HTTP 200 + 정상 엔벨로프 + 0건"이었고, 그 결과
 * 실존 병원 12곳이 전부 "그런 병원 없음"으로 표시됐다. 그래서 여기서 반드시 지켜야 할 것:
 *   ① 행안부 0건 → 폴백에서 찾아낸다
 *   ② 행안부 호출 실패 → 폴백에서 찾아낸다
 *   ③ 둘 다 실패 → **행안부의 판정을 뒤집지 않는다** (조회 실패를 "없음"으로 바꾸지 않는다)
 */

const ROW_MISO: DirectoryRow = {
  mng_no: 'hira:0123456789abcdef',
  name: '미소치과의원',
  road_address: '대구광역시 수성구 달구벌대로 2000',
  province: '대구광역시',
  region: '수성구',
  institution_type: '치과의원',
  specialty: '치과',
  subjects: ['치과', '구강악안면외과'],
  phone: '053-111-2222',
  opened_on: '2010-03-02',
  source_version: '2026Q1',
};

const ROW_MISO_SEOUL: DirectoryRow = {
  ...ROW_MISO,
  mng_no: 'hira:fedcba9876543210',
  road_address: '서울특별시 강남구 테헤란로 1',
  province: '서울특별시',
  region: '강남구',
};

/** 항상 같은 행을 돌려주는 검색 어댑터. */
function searchReturning(rows: readonly DirectoryRow[], total = rows.length): DirectorySearch {
  return async () => ({ ok: true, rows, total }) satisfies DirectorySearchResult;
}

/** 질의 기록을 남기는 어댑터 — 지역 필터 동작 검증용. */
function searchRecording(
  handler: (q: DirectoryQuery) => DirectorySearchResult,
): { search: DirectorySearch; queries: DirectoryQuery[] } {
  const queries: DirectoryQuery[] = [];
  return {
    queries,
    search: async (q) => {
      queries.push(q);
      return handler(q);
    },
  };
}

const FAILING_SEARCH: DirectorySearch = async () => ({ ok: false, message: '테이블 없음' });

/* ── 식별자 ──────────────────────────────────────────────── */

test('폴백 식별자는 행안부 관리번호와 키 공간이 겹치지 않는다', () => {
  assert.equal(isDirectoryMngNo('hira:0123456789abcdef'), true);
  assert.equal(isDirectoryMngNo('PHMA120253410023041100015'), false);
  assert.equal(isDirectoryMngNo(''), false);
});

test('접두사 없는 행은 후보로 만들지 않는다 (행안부 키로 위장 불가)', () => {
  assert.equal(toDirectoryCandidate({ ...ROW_MISO, mng_no: 'PHMA123' }), null);
  assert.equal(toDirectoryCandidate({ ...ROW_MISO, name: '' }), null);
  assert.equal(toDirectoryCandidate(null), null);
});

test('DB 행을 후보로 변환하면 출처가 directory 로 표시된다', () => {
  const c = toDirectoryCandidate(ROW_MISO);
  assert.ok(c);
  assert.equal(c.source, 'directory');
  assert.equal(c.sourceVersion, '2026Q1');
  assert.equal(c.specialty, '치과');
  assert.equal(c.phone, '053-111-2222');
  // 폴백 자료에는 폐업 구분이 없다 — 영업상태를 행안부가 확인해 준 것처럼 보이면 안 된다.
  assert.equal(c.active, true);
  assert.equal(c.statusLabel, '심평원 공개자료 기준');
});

/* ── 검색어 ──────────────────────────────────────────────── */

test('검색 조각은 공백이 제거된 형태로 만들어진다', () => {
  // name_norm 이 공백 제거본이라, 공백이 남으면 영영 매칭되지 않는다.
  const terms = buildDirectoryTerms('플로르 성형외과 의원');
  assert.ok(terms.length > 0);
  assert.ok(terms.every((t) => !t.includes(' ')));
  assert.ok(terms.includes('플로르성형외과의원'));
  assert.ok(terms.includes('플로르'));
});

test('LIKE 와일드카드는 입력에서 제거한다', () => {
  assert.equal(sanitizeLikeTerm('미소%_\\치과'), '미소치과');
  assert.ok(buildDirectoryTerms('%%%').length === 0);
});

/* ── 폴백 조회 ───────────────────────────────────────────── */

test('폴백이 단일 후보를 찾으면 자동 확정된다', async () => {
  const result = await lookupDirectory('미소치과의원', { search: searchReturning([ROW_MISO]) });
  assert.equal(result.usable, true);
  assert.equal(result.outcome?.kind, 'resolved');
});

test('폴백 후보가 여럿이면 사용자가 고르게 한다', async () => {
  const result = await lookupDirectory('미소치과의원', {
    search: searchReturning([ROW_MISO, ROW_MISO_SEOUL]),
  });
  assert.equal(result.outcome?.kind, 'ambiguous');
});

test('폴백 조회가 실패하면 usable=false — 결과 없음과 구분한다', async () => {
  const result = await lookupDirectory('미소치과의원', { search: FAILING_SEARCH });
  assert.equal(result.usable, false);
  assert.equal(result.outcome, null);
});

test('입력 지역에 없고 타 지역에만 있으면 region_miss 로 강등한다', async () => {
  const { search, queries } = searchRecording((q) =>
    q.region ? { ok: true, rows: [], total: 0 } : { ok: true, rows: [ROW_MISO_SEOUL], total: 1 },
  );
  const result = await lookupDirectory('대구 미소치과의원', { search });
  assert.equal(result.outcome?.kind, 'region_miss');
  // 지역을 건 질의가 먼저, 지역 없는 질의가 마지막.
  assert.ok(queries.some((q) => q.region === '대구광역시'));
  assert.equal(queries[queries.length - 1].region, '');
});

test('질의 상한을 넘겨 폭주하지 않는다', async () => {
  const { search, queries } = searchRecording(() => ({ ok: true, rows: [], total: 0 }));
  await lookupDirectory('대구 플로르 성형외과 의원', { search });
  assert.ok(queries.length <= 4, `질의 ${queries.length}회`);
});

/* ── 행안부 + 폴백 합성 (이번 장애의 회귀 방어) ─────────── */

test('행안부가 결과를 보여준 경우에는 폴백으로 내려가지 않는다', () => {
  assert.equal(shouldTryDirectory({ kind: 'resolved' } as unknown as ClinicLookupOutcome), false);
  assert.equal(shouldTryDirectory({ kind: 'ambiguous', candidates: [], truncated: false }), false);
  assert.equal(shouldTryDirectory({ kind: 'not_found' }), true);
  assert.equal(shouldTryDirectory({ kind: 'unavailable', reason: 'fetch_failed' }), true);
});

test('★행안부 0건 → 폴백에서 찾는다 (2026-07-27 장애 재현 방지)', async () => {
  const combined = await combineWithDirectory({ kind: 'not_found' }, '미소치과의원', {
    search: searchReturning([ROW_MISO]),
  });
  assert.equal(combined.outcome.kind, 'resolved');
  assert.equal(combined.usedDirectory, true);
});

test('★행안부 호출 실패 → 폴백에서 찾는다', async () => {
  const combined = await combineWithDirectory(
    { kind: 'unavailable', reason: 'fetch_failed' },
    '미소치과의원',
    { search: searchReturning([ROW_MISO]) },
  );
  assert.equal(combined.outcome.kind, 'resolved');
  assert.equal(combined.usedDirectory, true);
});

test('★둘 다 실패하면 행안부의 판정을 그대로 둔다 — 조회 실패를 "없음"으로 바꾸지 않는다', async () => {
  const combined = await combineWithDirectory(
    { kind: 'unavailable', reason: 'fetch_failed' },
    '미소치과의원',
    { search: FAILING_SEARCH },
  );
  assert.equal(combined.outcome.kind, 'unavailable');
  assert.equal(combined.usedDirectory, false);
});

test('행안부가 진짜 0건이고 폴백에도 없으면 not_found 를 유지한다', async () => {
  const combined = await combineWithDirectory({ kind: 'not_found' }, '없는이름의원', {
    search: searchReturning([]),
  });
  assert.equal(combined.outcome.kind, 'not_found');
  assert.equal(combined.usedDirectory, false);
  assert.equal(combined.directoryTried, true);
});

test('폴백이 아예 없는 환경(search=null)에서도 행안부 판정이 그대로 나간다', async () => {
  const combined = await combineWithDirectory({ kind: 'not_found' }, '미소치과의원', { search: null });
  assert.equal(combined.outcome.kind, 'not_found');
  assert.equal(combined.directoryTried, false);
});

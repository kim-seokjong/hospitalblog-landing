import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistrySeeds,
  decideLookup,
  deriveBrandCore,
  lookupClinics,
  normalizeClinicName,
  parseRegistryResponse,
  rankCandidates,
  scoreCandidate,
  splitAddress,
  splitRegionHint,
  stripInstitutionSuffix,
  toClinicCandidate,
  REGISTRY_SCAN_CAP,
} from '../registry.ts';
import type { ClinicCandidate } from '../types.ts';

/** 실제 행안부 응답 1건(대구 브이비성형외과의원)의 필드 구성을 그대로 옮긴 픽스처. */
const ROW_VB = {
  BPLC_NM: '브이비성형외과의원',
  TELNO: '053-255-0320',
  ROAD_NM_ADDR: '대구광역시 중구 공평로10길 18, 7층 (삼덕동2가)',
  LOTNO_ADDR: '대구광역시 중구 삼덕동2가 17-1',
  MNG_NO: 'PHMA120253410023041100015',
  MDEXM_SBJCT_CN_NM: '성형외과, 피부과',
  SALS_STTS_CD: '01',
  SALS_STTS_NM: '영업/정상',
  MDLCR_INST_BTP_NM: '의원',
  HMPG_ADDR: null,
  LCPMT_YMD: '2025-08-22',
  CLSBIZ_YMD: '',
};

const ROW_CLOSED = {
  ...ROW_VB,
  MNG_NO: 'PHMA-CLOSED-1',
  BPLC_NM: '아름다운미소치과',
  SALS_STTS_CD: '03',
  SALS_STTS_NM: '폐업',
  CLSBIZ_YMD: '2011-10-27',
  MDLCR_INST_BTP_NM: '치과의원',
  MDEXM_SBJCT_CN_NM: '치과',
};

function envelope(items: unknown[], totalCount = items.length): unknown {
  return { response: { header: { resultCode: '0' }, body: { totalCount, items } } };
}

function candidate(over: Partial<ClinicCandidate>): ClinicCandidate {
  return {
    mngNo: 'M1', name: '테스트의원', roadAddress: '', lotAddress: '', region: '', province: '',
    subjects: [], specialty: '', institutionType: '의원', phone: '', active: true,
    statusLabel: '영업/정상', openedOn: '', closedOn: '', ...over,
  };
}

/* ── 이름 정규화 · 시드 ─────────────────────────────────── */

test('normalizeClinicName 은 공백을 없애고 소문자로 통일한다', () => {
  assert.equal(normalizeClinicName('플로르 성형외과 의원'), '플로르성형외과의원');
  assert.equal(normalizeClinicName('ABC Clinic'), 'abcclinic');
});

test('stripInstitutionSuffix 는 기관 접미사만 떼고, 2자 미만이 되면 원본을 유지한다', () => {
  assert.equal(stripInstitutionSuffix('브이비성형외과의원'), '브이비성형외과');
  assert.equal(stripInstitutionSuffix('미소치과의원'), '미소');
  // 접미사를 떼면 남는 게 없다 → 원본 유지
  assert.equal(stripInstitutionSuffix('의원'), '의원');
});

test('deriveBrandCore 는 진료과 토큰 앞의 브랜드만 남긴다 (공백 표기 무관)', () => {
  assert.equal(deriveBrandCore('브이비성형외과의원'), '브이비');
  assert.equal(deriveBrandCore('플로르 성형외과 의원'), '플로르');
  assert.equal(deriveBrandCore('연세바로치과교정과의원'), '연세바로');
  // 진료과가 맨 앞이면 코어가 없다
  assert.equal(deriveBrandCore('성형외과의원'), '');
});

test('buildRegistrySeeds 는 입력그대로/공백제거/브랜드코어 순으로 중복 없이 만든다', () => {
  const seeds = buildRegistrySeeds('플로르 성형외과 의원');
  assert.deepEqual(seeds, ['플로르 성형외과 의원', '플로르성형외과의원', '플로르', '플로르 성형외과']);
  // 같은 값이 반복되면 하나만 남는다
  assert.deepEqual(buildRegistrySeeds('브이비성형외과의원'), ['브이비성형외과의원', '브이비', '브이비성형외과']);
});

test('splitRegionHint 는 앞쪽 지역 토큰을 떼고 정식 시도명으로 바꾼다', () => {
  assert.deepEqual(splitRegionHint('대구 브이비성형외과'), { name: '브이비성형외과', region: '대구광역시' });
  assert.deepEqual(splitRegionHint('대구 수성구 미소치과'), { name: '미소치과', region: '수성구' });
  // 지역이 없으면 그대로
  assert.deepEqual(splitRegionHint('브이비성형외과'), { name: '브이비성형외과', region: '' });
  // 명시 지역이 입력 내 지역보다 우선한다
  assert.deepEqual(splitRegionHint('대구 미소치과', '수성구'), { name: '미소치과', region: '수성구' });
  // 마지막 토큰이 지역처럼 보여도 이름이 사라지면 안 된다
  assert.equal(splitRegionHint('수성구').name, '수성구');
});

/* ── 응답 파싱 ──────────────────────────────────────────── */

test('parseRegistryResponse 는 행안부 응답을 후보로 정규화한다', () => {
  const page = parseRegistryResponse(envelope([ROW_VB]));
  assert.equal(page.totalCount, 1);
  const [clinic] = page.items;
  assert.equal(clinic.name, '브이비성형외과의원');
  assert.equal(clinic.phone, '053-255-0320');
  assert.equal(clinic.province, '대구광역시');
  assert.equal(clinic.region, '중구');
  assert.equal(clinic.specialty, '성형외과');
  assert.equal(clinic.active, true);
  assert.equal(clinic.openedOn, '2025-08-22');
});

test('parseRegistryResponse 는 items 가 객체 래핑(item)이어도 읽는다', () => {
  const page = parseRegistryResponse({ response: { body: { totalCount: 1, items: { item: [ROW_VB] } } } });
  assert.equal(page.items.length, 1);
});

test('parseRegistryResponse 는 형태가 어긋나면 빈 페이지를 준다 (throw 금지)', () => {
  for (const bad of [null, undefined, 'text', 42, {}, { response: {} }, { response: { body: { items: 'x' } } }]) {
    const page = parseRegistryResponse(bad);
    assert.equal(page.items.length, 0);
  }
});

test('toClinicCandidate 는 관리번호나 상호가 없으면 버린다', () => {
  assert.equal(toClinicCandidate({ ...ROW_VB, MNG_NO: '' }), null);
  assert.equal(toClinicCandidate({ ...ROW_VB, BPLC_NM: '' }), null);
  assert.equal(toClinicCandidate(null), null);
});

test('치과의원·한의원은 진료과목 원문 대신 대표 진료과로 매핑한다', () => {
  const dental = toClinicCandidate(ROW_CLOSED);
  assert.equal(dental?.specialty, '치과');
  const oriental = toClinicCandidate({ ...ROW_VB, MDLCR_INST_BTP_NM: '한의원', MDEXM_SBJCT_CN_NM: '한방내과' });
  assert.equal(oriental?.specialty, '한의원');
});

test('splitAddress 는 시도와 구·군을 분리한다', () => {
  assert.deepEqual(splitAddress('대구광역시 수성구 달구벌대로 2280'), { province: '대구광역시', region: '수성구' });
  assert.deepEqual(splitAddress('경기도 안양시 동안구 시민대로 171'), { province: '경기도', region: '동안구' });
  assert.deepEqual(splitAddress(''), { province: '', region: '' });
});

/* ── 랭킹 · 판정 ────────────────────────────────────────── */

test('scoreCandidate 는 정확일치 > 접미사제거일치 > 시작일치 > 부분일치 순이다', () => {
  const exact = candidate({ name: '미소치과의원' });
  const prefix = candidate({ name: '미소치과의원 강남점' });
  const partial = candidate({ name: '신서밝은미소치과의원' });
  assert.equal(scoreCandidate(exact, '미소치과의원'), 100);
  assert.ok(scoreCandidate(prefix, '미소치과의원') > scoreCandidate(partial, '미소치과의원'));
});

test('rankCandidates 는 점수 → 영업중 → 이름길이 순으로 정렬한다', () => {
  const ranked = rankCandidates(
    [
      candidate({ mngNo: 'A', name: '신서밝은미소치과의원' }),
      candidate({ mngNo: 'B', name: '미소치과의원', active: false }),
      candidate({ mngNo: 'C', name: '미소치과의원' }),
    ],
    '미소치과의원',
  );
  assert.equal(ranked[0].mngNo, 'C'); // 정확일치 + 영업중
  assert.equal(ranked[2].mngNo, 'A');
});

test('decideLookup: 영업중 정확일치가 1건이면 자동 확정한다', () => {
  const outcome = decideLookup([candidate({ name: '브이비성형외과의원' })], '브이비성형외과의원', {
    truncated: false, totalCount: 1, hasRegion: false,
  });
  assert.equal(outcome.kind, 'resolved');
});

test('decideLookup: 정확일치가 2건 이상이면 절대 자동 확정하지 않는다', () => {
  const outcome = decideLookup(
    [
      candidate({ mngNo: 'A', name: '미소치과의원', roadAddress: '전남 해남' }),
      candidate({ mngNo: 'B', name: '미소치과의원', roadAddress: '서울 노원' }),
    ],
    '미소치과의원',
    { truncated: false, totalCount: 2, hasRegion: false },
  );
  assert.equal(outcome.kind, 'ambiguous');
  assert.equal(outcome.kind === 'ambiguous' && outcome.candidates.length, 2);
});

test('decideLookup: 폐업만 있으면 closed_only 로 구분한다 (폐업을 영업중처럼 보여주지 않는다)', () => {
  const outcome = decideLookup([candidate({ name: '미소치과의원', active: false, statusLabel: '폐업' })], '미소치과의원', {
    truncated: false, totalCount: 1, hasRegion: false,
  });
  assert.equal(outcome.kind, 'closed_only');
});

test('decideLookup: 후보가 없고 스캔이 잘렸으면 추측하지 않고 지역을 요청한다', () => {
  const outcome = decideLookup([], '미소', { truncated: true, totalCount: 1230, hasRegion: false });
  assert.equal(outcome.kind, 'needs_region');
});

test('decideLookup: 정확일치 없이 후보만 많고 스캔이 잘렸으면 지역을 요청한다', () => {
  const many = Array.from({ length: REGISTRY_SCAN_CAP }, (_, i) =>
    candidate({ mngNo: `M${i}`, name: `${i}미소치과의원` }),
  );
  const outcome = decideLookup(many, '미소', { truncated: true, totalCount: 1230, hasRegion: false });
  assert.equal(outcome.kind, 'needs_region');
});

test('decideLookup: 후보가 하나도 없고 잘리지도 않았으면 not_found', () => {
  assert.equal(decideLookup([], '없는병원', { truncated: false, totalCount: 0, hasRegion: false }).kind, 'not_found');
});

/* ── HTTP 계층 (주입 fetch) ─────────────────────────────── */

test('lookupClinics: 키가 없으면 호출하지 않고 unavailable', async () => {
  let called = 0;
  const outcome = await lookupClinics('브이비성형외과의원', {
    env: {},
    fetchImpl: (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(outcome, { kind: 'unavailable', reason: 'not_configured' });
  assert.equal(called, 0);
});

test('lookupClinics: 첫 시드가 0건이면 다음 시드로 폴백한다 (공백 표기 차이 대응)', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    const seed = new URL(url).searchParams.get('cond[BPLC_NM::LIKE]') ?? '';
    calls.push(seed);
    // 실제 API 동작 재현: 공백이 있는 등록 상호는 붙여쓴 시드로 안 잡힌다
    const items = seed === '플로르' ? [{ ...ROW_VB, BPLC_NM: '플로르 성형외과 의원', MNG_NO: 'FLOR' }] : [];
    return new Response(JSON.stringify(envelope(items)), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const outcome = await lookupClinics('플로르성형외과의원', { env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl });
  assert.equal(outcome.kind, 'resolved');
  assert.equal(outcome.kind === 'resolved' && outcome.clinic.mngNo, 'FLOR');
  assert.ok(calls.includes('플로르'), '브랜드 코어 시드까지 폴백해야 한다');
});

test('lookupClinics: 모든 호출이 실패하면 unavailable(fetch_failed) — not_found 로 속이지 않는다', async () => {
  const fetchImpl = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const outcome = await lookupClinics('브이비성형외과의원', { env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl });
  assert.deepEqual(outcome, { kind: 'unavailable', reason: 'fetch_failed' });
});

test('lookupClinics: 타임아웃이 걸려도 throw 하지 않는다', async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const outcome = await lookupClinics('브이비성형외과의원', {
    env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl, timeoutMs: 20,
  });
  assert.equal(outcome.kind, 'unavailable');
});

test('lookupClinics: 비 200 응답도 조용히 실패로 흡수한다', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  const outcome = await lookupClinics('브이비성형외과의원', { env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl });
  assert.deepEqual(outcome, { kind: 'unavailable', reason: 'fetch_failed' });
});

test('lookupClinics: 호출 수는 상한을 넘지 않는다 (외부 API 비용 방어)', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify(envelope([])), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  await lookupClinics('대구 플로르 성형외과 의원', { env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl });
  assert.ok(calls <= 4, `최대 4콜이어야 하는데 ${calls}콜 발생`);
});

test('lookupClinics: 이름이 2자 미만이면 호출 없이 not_found', async () => {
  let called = 0;
  const fetchImpl = (async () => { called += 1; return new Response('{}'); }) as unknown as typeof fetch;
  const outcome = await lookupClinics('가', { env: { DATA_GO_SERVICE_KEY: 'k' }, fetchImpl });
  assert.equal(outcome.kind, 'not_found');
  assert.equal(called, 0);
});

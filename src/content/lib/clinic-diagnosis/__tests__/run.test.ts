import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_BUDGET_MS,
  BODY_TIMEOUT_MS,
  CADENCE_WEEKS,
  MAX_KEYWORDS,
  buildDiagnosisKeywords,
  buildSeoPosts,
  computeBlogRhythm,
  displayRegion,
  runClinicDiagnosis,
  shortProvinceOf,
} from '../run.ts';
import { SEO_POST_LIMIT } from '../post-seo.ts';

/**
 * run.ts 의 순수 헬퍼 검증. 파이프라인 전체(runClinicDiagnosis)는 외부 API 를
 * 실제로 호출하므로 여기서 돌리지 않고, 종단 확인 스크립트로 따로 검증한다.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-26T00:00:00.000Z');

test('shortProvinceOf 는 행정단위 접미사를 뗀다', () => {
  assert.equal(shortProvinceOf('대구광역시'), '대구');
  assert.equal(shortProvinceOf('경기도'), '경기');
  assert.equal(shortProvinceOf('제주특별자치도'), '제주');
  assert.equal(shortProvinceOf(''), '');
});

test('displayRegion 은 구·군 앞에 시·도를 붙인다 (전국 동명 지역 혼동 방지)', () => {
  // "중구 성형외과"는 전국 어느 중구인지 알 수 없다 → AI 답변이 엉뚱한 지역으로 채워졌다
  assert.equal(displayRegion({ province: '대구광역시', region: '중구' }), '대구 중구');
  assert.equal(displayRegion({ province: '대구광역시', region: '수성구' }), '대구 수성구');
  // 구·군을 못 뽑았으면 시·도만
  assert.equal(displayRegion({ province: '대구광역시', region: '' }), '대구');
  // 시·도 정보가 없으면 있는 것만
  assert.equal(displayRegion({ province: '', region: '수성구' }), '수성구');
  assert.equal(displayRegion({ province: '', region: '' }), '');
});

test('buildDiagnosisKeywords 는 지역+진료과와 제목 추출 키워드를 상한까지 합친다', () => {
  const keywords = buildDiagnosisKeywords(
    { province: '대구광역시', region: '수성구', specialty: '성형외과' },
    ['대구 코성형 잘하는 곳', '수성구 눈매교정 후 회복 기간', '대구 코성형 재수술 상담'],
  );
  assert.ok(keywords.length <= MAX_KEYWORDS);
  assert.ok(keywords.includes('수성구 성형외과'));
  assert.ok(keywords.includes('대구 성형외과'));
  assert.equal(new Set(keywords).size, keywords.length, '중복 키워드가 있으면 안 된다');
});

test('buildDiagnosisKeywords 는 진료과가 없어도 죽지 않는다', () => {
  const keywords = buildDiagnosisKeywords({ province: '', region: '', specialty: '' }, []);
  assert.ok(Array.isArray(keywords));
});

test('computeBlogRhythm 은 최근성과 주당 편수를 계산한다', () => {
  const rhythm = computeBlogRhythm(
    [
      new Date(NOW - 5 * DAY).toISOString(),
      new Date(NOW - 12 * DAY).toISOString(),
      new Date(NOW - 40 * DAY).toISOString(),
      // 집계 구간(12주) 밖 — 주당 편수에서 빠져야 한다
      new Date(NOW - 200 * DAY).toISOString(),
    ],
    NOW,
  );
  assert.equal(rhythm.daysSinceLatest, 5);
  assert.equal(rhythm.postsPerWeek, Math.round((3 / CADENCE_WEEKS) * 10) / 10);
});

test('computeBlogRhythm 은 발행일이 하나도 없으면 전부 null (0으로 속이지 않는다)', () => {
  assert.deepEqual(computeBlogRhythm([], NOW), { latestPostAt: null, daysSinceLatest: null, postsPerWeek: null });
  assert.deepEqual(computeBlogRhythm([null, 'not-a-date'], NOW), {
    latestPostAt: null, daysSinceLatest: null, postsPerWeek: null,
  });
});

test('computeBlogRhythm 은 미래 날짜에도 음수 일수를 내지 않는다', () => {
  const rhythm = computeBlogRhythm([new Date(NOW + 3 * DAY).toISOString()], NOW);
  assert.equal(rhythm.daysSinceLatest, 0);
});

/* ── 최근 글 SEO 표본 만들기 ─────────────────────────────── */

test('buildSeoPosts 는 본문 전문이 있으면 전문을, 없으면 RSS 요약을 쓴다', () => {
  const items = [
    { title: '첫 글', link: 'l1', summary: '요약1.......', hasImage: true },
    { title: '둘째 글', link: 'l2', summary: '요약2.......', hasImage: false },
  ];
  const posts = buildSeoPosts(items, new Map([['l1', '가'.repeat(1200)]]));

  assert.equal(posts[0].bodyKind, 'full');
  assert.equal(posts[0].body.length, 1200);
  assert.equal(posts[0].hasImage, true);

  assert.equal(posts[1].bodyKind, 'summary');
  assert.equal(posts[1].body, '요약2.......');
});

test('buildSeoPosts 는 요약도 본문도 없으면 none 으로 남긴다 (추정하지 않는다)', () => {
  const posts = buildSeoPosts([{ title: '제목만', link: 'l', summary: '', hasImage: false }], new Map());
  assert.equal(posts[0].bodyKind, 'none');
  assert.equal(posts[0].body, '');
});

test('buildSeoPosts 는 최근 5편까지만 만든다 (비용·시간 제한)', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    title: `글 ${i}`,
    link: `l${i}`,
    summary: '요약',
    hasImage: false,
  }));
  assert.equal(buildSeoPosts(items, new Map()).length, SEO_POST_LIMIT);
});

test('본문 수집 예산은 기존 최악 소요(2편×8초)보다 커지지 않는다', () => {
  assert.ok(BODY_BUDGET_MS <= 16_000, '편수를 늘리면서 대기 시간이 늘면 진단 전체가 타임아웃된다');
  assert.ok(BODY_TIMEOUT_MS <= BODY_BUDGET_MS);
});

/* ── 축 실패 격리 ────────────────────────────────────────── */

const CLINIC_FIXTURE = {
  mngNo: 'MNG-1',
  name: '테스트성형외과의원',
  roadAddress: '대구광역시 수성구 청호로 422',
  lotAddress: '',
  region: '수성구',
  province: '대구광역시',
  subjects: ['성형외과'],
  specialty: '성형외과',
  institutionType: '의원',
  phone: '053-000-0000',
  active: true,
  statusLabel: '영업/정상',
  openedOn: '2020-01-01',
  closedOn: '',
} as const;

/**
 * ★ 2026-07-27 주간 점검 지적.
 *   `runAiCitation` 과 `buildComplianceAxis` 만 try/catch 밖에 있었다. 하나가 throw 하면
 *   진단 전체가 실패하고, single-flight 팔로워까지 같은 실패를 받아
 *   **동시에 요청한 사용자 전원이 실패**했다. 어떤 축이 죽어도 리포트는 나와야 한다.
 */
test('어느 축이 던져도 진단은 리포트를 돌려준다 (진단 전체 500 방지)', async () => {
  const boom = (() => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const report = await runClinicDiagnosis(CLINIC_FIXTURE, {
    env: {
      NAVER_CLIENT_ID: 'id',
      NAVER_CLIENT_SECRET: 'secret',
      OPENAI_API_KEY: 'sk-test',
    },
    fetchImpl: boom,
    now: NOW,
  });

  assert.equal(report.version, 1);
  assert.equal(report.clinic.mngNo, 'MNG-1');
  // 실패한 축은 "확인하지 못했습니다"로 떨어진다 — 추정값으로 메우지 않는다.
  assert.equal(report.ai.checked, false);
  assert.equal(report.compliance.checked, false);
  assert.ok(report.findings.length > 0, '축이 죽어도 결과 화면은 채워져야 한다');
  assert.ok(report.unchecked.includes('AI 검색 인용'));
});

test('진단은 절대 reject 하지 않는다 (팔로워까지 함께 실패하지 않게)', async () => {
  const rejecting = (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
  const report = await runClinicDiagnosis(CLINIC_FIXTURE, {
    env: { NAVER_CLIENT_ID: 'id', NAVER_CLIENT_SECRET: 'secret' },
    fetchImpl: rejecting,
    now: NOW,
    includeAi: false,
  });
  assert.equal(report.version, 1);
});

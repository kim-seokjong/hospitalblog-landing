import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankPoints,
  computeCadence,
  classifyCadence,
  computeSeoScore,
  computeGeoScore,
  computeTitleQuality,
  buildFallbackFeedback,
  CADENCE_POINTS,
  NAVER_BLOG_GEO_MIN,
  NAVER_BLOG_GEO_MAX,
  AI_BLOCKED_CRAWLERS,
  type KeywordMeasurement,
  type Cadence,
} from '../blog-check-score.ts';
import type { KeywordVolume } from '../keyword-volume.ts';

const vol = (total: number): KeywordVolume => ({
  pc: Math.floor(total / 2),
  mobile: total - Math.floor(total / 2),
  total,
  compIdx: '중간',
});

const NOW = Date.parse('2026-07-20T00:00:00Z');
const daysAgo = (d: number): string => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

// ── rankPoints ──
test('rankPoints: 구간 계수 (1~3/4~10/11~30/31~100/미노출)', () => {
  assert.equal(rankPoints(1), 1.0);
  assert.equal(rankPoints(3), 1.0);
  assert.equal(rankPoints(4), 0.7);
  assert.equal(rankPoints(10), 0.7);
  assert.equal(rankPoints(11), 0.4);
  assert.equal(rankPoints(30), 0.4);
  assert.equal(rankPoints(31), 0.15);
  assert.equal(rankPoints(100), 0.15);
  assert.equal(rankPoints(null), 0);
  assert.equal(rankPoints(0), 0);
});

// ── computeCadence / classifyCadence ──
test('computeCadence: 주 2편 꾸준 발행 → 우수', () => {
  const dates = Array.from({ length: 24 }, (_, i) => daysAgo(i * 3 + 1));
  const c = computeCadence(dates, NOW);
  assert.equal(c.grade, '우수');
  assert.ok(c.postsPerWeek >= 1.5);
  assert.ok(c.maxGapDays !== null && c.maxGapDays <= 14);
});

test('computeCadence: 발행일 전무·오래된 글만 → 방치', () => {
  assert.equal(computeCadence([], NOW).grade, '방치');
  assert.equal(computeCadence([null, null], NOW).grade, '방치');
  const old = computeCadence([daysAgo(200), daysAgo(300)], NOW);
  assert.equal(old.grade, '방치');
  assert.equal(old.postsInWindow, 0);
});

test('classifyCadence: 등급 경계', () => {
  assert.equal(classifyCadence(1.5, 14), '우수');
  assert.equal(classifyCadence(1.5, 30), '양호'); // 공백이 길면 우수 미달
  assert.equal(classifyCadence(0.7, null), '양호');
  assert.equal(classifyCadence(0.3, null), '불규칙');
  assert.equal(classifyCadence(0.1, null), '방치');
});

// ── computeSeoScore ──
const goodCadence: Cadence = { postsInWindow: 20, postsPerWeek: 1.7, maxGapDays: 7, grade: '우수' };
const badCadence: Cadence = { postsInWindow: 1, postsPerWeek: 0.08, maxGapDays: 90, grade: '방치' };

test('computeSeoScore: 상위 노출 + 우수 꾸준함 → 고득점, 합산 0~100 클램프', () => {
  const measurements: KeywordMeasurement[] = [
    { keyword: 'a', volume: vol(5000), docCount: 100, rank: 2 },
    { keyword: 'b', volume: vol(3000), docCount: 200, rank: 5 },
  ];
  const s = computeSeoScore(measurements, goodCadence);
  assert.equal(s.consistency, CADENCE_POINTS['우수']);
  assert.equal(s.fit, 15); // 전부 검색량 100 이상
  assert.ok(s.exposure > 40); // 1.0/0.7 가중 평균 × 60
  assert.ok(s.total <= 100 && s.total >= 0);
  assert.equal(s.total, Math.min(100, s.exposure + s.consistency + s.fit));
});

test('computeSeoScore: 미노출 블로그 → exposure 0', () => {
  const measurements: KeywordMeasurement[] = [
    { keyword: 'a', volume: vol(5000), docCount: 100, rank: null },
  ];
  const s = computeSeoScore(measurements, badCadence);
  assert.equal(s.exposure, 0);
  assert.equal(s.consistency, CADENCE_POINTS['방치']);
});

test('computeSeoScore: 검색량 데이터 전무 → 균등 가중 + 중립 fit', () => {
  const measurements: KeywordMeasurement[] = [
    { keyword: 'a', volume: null, docCount: null, rank: 1 },
    { keyword: 'b', volume: null, docCount: null, rank: null },
  ];
  const s = computeSeoScore(measurements, goodCadence);
  assert.equal(s.exposure, 30); // (1.0+0)/2 × 60
  assert.equal(s.fit, 7);
});

test('computeSeoScore: 키워드 0개도 안전', () => {
  const s = computeSeoScore([], goodCadence);
  assert.equal(s.exposure, 0);
  assert.ok(s.total > 0); // 꾸준함+중립 fit 만으로 산정
});

// ── computeGeoScore ──
test('computeGeoScore: 네이버 단독은 5~10 고정 (AI 크롤러 차단 근거)', () => {
  const low = computeGeoScore({ totalPosts: 3, cadenceGrade: '방치' });
  assert.equal(low.score, NAVER_BLOG_GEO_MIN);
  const high = computeGeoScore({ totalPosts: 50, cadenceGrade: '우수' });
  assert.equal(high.score, NAVER_BLOG_GEO_MAX);
  assert.ok(high.reason.includes('robots.txt'));
  // 차단 크롤러 목록 — 근거 상수
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'CCBot']) {
    assert.ok(AI_BLOCKED_CRAWLERS.includes(bot));
  }
});

test('computeGeoScore: 자체도메인 병행 인터페이스 — 병행 시 상한 해제', () => {
  const combined = computeGeoScore({
    totalPosts: 50,
    cadenceGrade: '우수',
    ownDomain: { active: true },
  });
  assert.ok(combined.score > NAVER_BLOG_GEO_MAX);
});

// ── computeTitleQuality ──
test('computeTitleQuality: 사실상 동일 제목 쌍 검출', () => {
  const q = computeTitleQuality([
    '수성구 도수치료 잘하는 곳 안내',
    '수성구 도수치료 잘하는 곳 안내입니다',
    '전혀 다른 주제의 글',
  ]);
  assert.equal(q.duplicatePairs, 1);
  assert.ok(q.maxSimilarity >= 0.6);
  assert.equal(q.samples.length, 1);
});

test('computeTitleQuality: 빈 입력·단일 제목 안전', () => {
  assert.equal(computeTitleQuality([]).pairsChecked, 0);
  assert.equal(computeTitleQuality(['하나뿐']).duplicatePairs, 0);
});

// ── buildFallbackFeedback ──
test('buildFallbackFeedback: 항상 장점 2~3·부족한 점 2~3 보장', () => {
  const base = {
    seo: { exposure: 50, consistency: 25, fit: 15, total: 90 },
    geo: { score: 10, reason: 'r' },
    cadence: goodCadence,
    measurements: [
      { keyword: 'a', volume: vol(1000), docCount: 10, rank: 1 },
    ] as KeywordMeasurement[],
  };
  const good = buildFallbackFeedback({ ...base, complianceCount: 0 });
  assert.ok(good.strengths.length >= 2 && good.strengths.length <= 3);
  assert.ok(good.weaknesses.length >= 2 && good.weaknesses.length <= 3);

  const bad = buildFallbackFeedback({
    seo: { exposure: 5, consistency: 3, fit: 0, total: 8 },
    geo: { score: 5, reason: 'r' },
    cadence: badCadence,
    complianceCount: 12,
    measurements: [],
  });
  assert.ok(bad.strengths.length >= 2);
  assert.ok(bad.weaknesses.length >= 2 && bad.weaknesses.length <= 3);
  assert.ok(bad.weaknesses.some((w) => w.includes('12건')));
});

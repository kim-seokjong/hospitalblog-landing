import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ctrForRank,
  estimateMonthlyVisits,
  estimateFunnel,
  computeRoi,
  summarizeRoi,
  DEFAULT_INQUIRY_RATE,
  DEFAULT_BOOKING_RATE,
  RANK_CTR_CURVE,
} from '../roi-estimate.ts';

// ── ctrForRank: 순위별 CTR 곡선 + 클램프 ──
test('ctrForRank: 1~5위는 곡선값 그대로', () => {
  assert.equal(ctrForRank(1), RANK_CTR_CURVE[1]);
  assert.equal(ctrForRank(2), RANK_CTR_CURVE[2]);
  assert.equal(ctrForRank(3), RANK_CTR_CURVE[3]);
  assert.equal(ctrForRank(4), RANK_CTR_CURVE[4]);
  assert.equal(ctrForRank(5), RANK_CTR_CURVE[5]);
});

test('ctrForRank: 1위가 가장 높고 5위로 갈수록 단조 감소', () => {
  assert.ok(RANK_CTR_CURVE[1] > RANK_CTR_CURVE[2]);
  assert.ok(RANK_CTR_CURVE[2] > RANK_CTR_CURVE[3]);
  assert.ok(RANK_CTR_CURVE[3] > RANK_CTR_CURVE[4]);
  assert.ok(RANK_CTR_CURVE[4] > RANK_CTR_CURVE[5]);
});

test('ctrForRank: 범위 밖은 클램프 (0/음수→1위, 6+→5위)', () => {
  assert.equal(ctrForRank(0), RANK_CTR_CURVE[1]);
  assert.equal(ctrForRank(-3), RANK_CTR_CURVE[1]);
  assert.equal(ctrForRank(6), RANK_CTR_CURVE[5]);
  assert.equal(ctrForRank(99), RANK_CTR_CURVE[5]);
});

test('ctrForRank: 소수 순위는 반올림 후 클램프', () => {
  assert.equal(ctrForRank(2.4), RANK_CTR_CURVE[2]);
  assert.equal(ctrForRank(2.6), RANK_CTR_CURVE[3]);
});

test('ctrForRank: NaN/비정상은 1위로 안전 처리', () => {
  assert.equal(ctrForRank(NaN), RANK_CTR_CURVE[1]);
  assert.equal(ctrForRank(Infinity), RANK_CTR_CURVE[5]);
});

// ── estimateMonthlyVisits: 검색량 × CTR ──
test('estimateMonthlyVisits: 검색량 × CTR', () => {
  assert.equal(estimateMonthlyVisits(1000, 1), 1000 * RANK_CTR_CURVE[1]);
  assert.equal(estimateMonthlyVisits(2000, 3), 2000 * RANK_CTR_CURVE[3]);
});

test('estimateMonthlyVisits: ctrOverride 우선 적용', () => {
  assert.equal(estimateMonthlyVisits(1000, 1, 0.5), 500);
});

test('estimateMonthlyVisits: ctrOverride 0~1 클램프', () => {
  assert.equal(estimateMonthlyVisits(1000, 1, 2), 1000); // 1.0 클램프
  assert.equal(estimateMonthlyVisits(1000, 1, -1), 0); // 0 클램프
});

test('estimateMonthlyVisits: 음수/NaN 검색량은 0 하한', () => {
  assert.equal(estimateMonthlyVisits(-500, 1), 0);
  assert.equal(estimateMonthlyVisits(NaN, 1), 0);
  assert.equal(estimateMonthlyVisits(Infinity, 1), 0);
});

// ── estimateFunnel: 각 단계 곱 + 클램프 ──
test('estimateFunnel: 정상 퍼널 계산', () => {
  const r = estimateFunnel({ visits: 1000, inquiryRate: 0.02, bookingRate: 0.35, patientValue: 500000 });
  assert.equal(r.inquiries, 20);
  assert.equal(r.bookings, 7);
  assert.equal(r.revenue, 7 * 500000);
});

test('estimateFunnel: 전환율 0~1 클램프', () => {
  const r = estimateFunnel({ visits: 100, inquiryRate: 5, bookingRate: -1, patientValue: 1000 });
  assert.equal(r.inquiries, 100); // inquiryRate 1.0 클램프
  assert.equal(r.bookings, 0); // bookingRate 0 클램프
  assert.equal(r.revenue, 0);
});

test('estimateFunnel: 음수/NaN 입력 방어', () => {
  const r = estimateFunnel({ visits: -10, inquiryRate: NaN, bookingRate: 0.5, patientValue: -100 });
  assert.equal(r.inquiries, 0);
  assert.equal(r.bookings, 0);
  assert.equal(r.revenue, 0);
});

// ── computeRoi: 0 나누기 방어 ──
test('computeRoi: 정상 ROI', () => {
  const r = computeRoi({ revenue: 3000000, cost: 199000 });
  assert.equal(r.profit, 3000000 - 199000);
  assert.equal(r.roiPct, ((3000000 - 199000) / 199000) * 100);
  assert.equal(r.roiMultiple, 3000000 / 199000);
});

test('computeRoi: cost 0이면 roiPct/Multiple은 null (0 나누기 방어)', () => {
  const r = computeRoi({ revenue: 1000000, cost: 0 });
  assert.equal(r.profit, 1000000);
  assert.equal(r.roiPct, null);
  assert.equal(r.roiMultiple, null);
});

test('computeRoi: cost 음수도 null 처리', () => {
  const r = computeRoi({ revenue: 1000000, cost: -50 });
  assert.equal(r.roiPct, null);
  assert.equal(r.roiMultiple, null);
});

test('computeRoi: 손실(매출<비용)이면 profit 음수, roiPct 음수', () => {
  const r = computeRoi({ revenue: 100000, cost: 199000 });
  assert.equal(r.profit, 100000 - 199000);
  assert.ok(r.roiPct !== null && r.roiPct < 0);
});

test('computeRoi: NaN 입력 방어', () => {
  const r = computeRoi({ revenue: NaN, cost: 100 });
  assert.equal(r.profit, -100);
});

// ── summarizeRoi: 통합 ──
test('summarizeRoi: 모든 단계 묶어 반환 + breakdown 포함', () => {
  const s = summarizeRoi({
    totalMonthlyVolume: 1000,
    rank: 1,
    inquiryRate: 0.02,
    bookingRate: 0.35,
    patientValue: 500000,
    cost: 199000,
  });
  assert.equal(s.visits, 1000 * RANK_CTR_CURVE[1]);
  assert.equal(s.inquiries, s.visits * 0.02);
  assert.equal(s.bookings, s.inquiries * 0.35);
  assert.equal(s.revenue, s.bookings * 500000);
  assert.equal(s.profit, s.revenue - 199000);
  assert.ok(s.roiPct !== null);
  assert.ok(s.roiMultiple !== null);
  assert.ok(s.breakdown.ctr === RANK_CTR_CURVE[1]);
  assert.ok(typeof s.breakdown.cost === 'number');
});

test('summarizeRoi: 검색량 0이면 모든 결과 0, ROI null', () => {
  const s = summarizeRoi({
    totalMonthlyVolume: 0,
    rank: 3,
    inquiryRate: 0.02,
    bookingRate: 0.35,
    patientValue: 500000,
    cost: 199000,
  });
  assert.equal(s.visits, 0);
  assert.equal(s.revenue, 0);
  assert.equal(s.profit, -199000);
  assert.ok(s.roiPct !== null && s.roiPct < 0);
});

test('summarizeRoi: 기본 가정값 상수가 합리적 범위', () => {
  assert.ok(DEFAULT_INQUIRY_RATE > 0 && DEFAULT_INQUIRY_RATE < 1);
  assert.ok(DEFAULT_BOOKING_RATE > 0 && DEFAULT_BOOKING_RATE < 1);
});

test('summarizeRoi: 기본 가정값으로 호출 가능 (선택 인자 생략)', () => {
  const s = summarizeRoi({
    totalMonthlyVolume: 5000,
    rank: 2,
    patientValue: 300000,
    cost: 199000,
  });
  assert.equal(s.breakdown.inquiryRate, DEFAULT_INQUIRY_RATE);
  assert.equal(s.breakdown.bookingRate, DEFAULT_BOOKING_RATE);
});

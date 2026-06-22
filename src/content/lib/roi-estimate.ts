/**
 * 마케팅 ROI 추정 시뮬레이터 — 순수 로직 (외부 의존성 0).
 *
 * 검색량 → (순위별 CTR) → 방문 → 문의 → 예약 → 매출 → 순이익 → ROI 의
 * 단순 곱셈 퍼널 모델이다. 모든 함수는 순수·immutable 이며 음수/NaN/0나누기를 방어한다.
 *
 * ⚠️ 면책: 여기서 쓰는 CTR 곡선·전환율 기본값은 모두 "업계 추정치"이며 정확한 값이 아니다.
 *    마케팅 계획 수립을 돕기 위한 시뮬레이션일 뿐, 실제 성과나 치료·내원 효과를 보장하지 않는다.
 *    반올림은 표시 단계(UI)에서만 하고, 여기서는 원시값을 유지한다.
 */

/**
 * 네이버 검색결과 노출 순위(1~5)별 추정 클릭률(CTR).
 * 업계에서 통용되는 대략적 추정치이며 정확값이 아니다(검색어·디바이스·UI에 따라 크게 달라짐).
 * 보수적으로 상위권에 가중을 둔 단조 감소 곡선을 기본값으로 둔다.
 */
export const RANK_CTR_CURVE: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = {
  1: 0.3,
  2: 0.15,
  3: 0.1,
  4: 0.07,
  5: 0.05,
};

/** 문의 전환율 기본값 (방문→문의). 보수적 추정 기본값, 사용자 조정 가능. */
export const DEFAULT_INQUIRY_RATE = 0.02;
/** 예약 전환율 기본값 (문의→예약). 보수적 추정 기본값, 사용자 조정 가능. */
export const DEFAULT_BOOKING_RATE = 0.35;

/** 0~1 범위 클램프. NaN/비정상은 0. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 0 하한 + 유한성 보장. NaN/Infinity/음수는 0. */
function nonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

/**
 * 순위(1~5)에 해당하는 추정 CTR 을 반환한다.
 * 소수는 반올림하고, 범위 밖은 [1, 5] 로 클램프한다.
 * NaN 은 1위(가장 보수적이지 않은 상한)로 안전 처리, Infinity 는 5위로 클램프.
 */
export function ctrForRank(rank: number): number {
  if (Number.isNaN(rank)) return RANK_CTR_CURVE[1];
  const rounded = Math.round(rank);
  const clamped = Math.min(5, Math.max(1, rounded)) as 1 | 2 | 3 | 4 | 5;
  return RANK_CTR_CURVE[clamped];
}

/**
 * 추정 월 방문수 = 합산 월 검색량 × CTR.
 * ctrOverride 가 주어지면 순위 곡선 대신 사용(0~1 클램프).
 * 검색량은 음수/NaN/Infinity 방어(0 하한).
 */
export function estimateMonthlyVisits(
  totalMonthlyVolume: number,
  rank: number,
  ctrOverride?: number
): number {
  const volume = nonNegative(totalMonthlyVolume);
  const ctr =
    ctrOverride === undefined ? ctrForRank(rank) : clamp01(ctrOverride);
  return volume * ctr;
}

export interface FunnelInput {
  visits: number;
  inquiryRate: number;
  bookingRate: number;
  patientValue: number;
}

export interface FunnelResult {
  inquiries: number;
  bookings: number;
  revenue: number;
}

/**
 * 방문 → 문의 → 예약 → 매출 단순 곱셈 퍼널.
 * 전환율은 0~1 클램프, 방문/환자가치는 0 하한.
 */
export function estimateFunnel(input: FunnelInput): FunnelResult {
  const visits = nonNegative(input.visits);
  const inquiryRate = clamp01(input.inquiryRate);
  const bookingRate = clamp01(input.bookingRate);
  const patientValue = nonNegative(input.patientValue);

  const inquiries = visits * inquiryRate;
  const bookings = inquiries * bookingRate;
  const revenue = bookings * patientValue;

  return { inquiries, bookings, revenue };
}

export interface RoiInput {
  revenue: number;
  cost: number;
}

export interface RoiResult {
  profit: number;
  /** 비용 대비 순이익률(%). cost<=0 이면 null (0 나누기 방어). */
  roiPct: number | null;
  /** 비용 대비 매출 배수. cost<=0 이면 null (0 나누기 방어). */
  roiMultiple: number | null;
}

/**
 * 순이익 = 매출 − 비용, ROI(%)·배수.
 * cost 가 0 이하이면 ROI 는 정의 불가 → null (0 나누기 방어).
 * revenue/cost NaN 은 0 으로 안전 처리.
 */
export function computeRoi(input: RoiInput): RoiResult {
  const revenue = Number.isFinite(input.revenue) ? input.revenue : 0;
  const cost = Number.isFinite(input.cost) ? input.cost : 0;
  const profit = revenue - cost;

  if (cost <= 0) {
    return { profit, roiPct: null, roiMultiple: null };
  }

  return {
    profit,
    roiPct: (profit / cost) * 100,
    roiMultiple: revenue / cost,
  };
}

export interface RoiSimulationInput {
  /** 합산 월 검색량 */
  totalMonthlyVolume: number;
  /** 목표 검색순위 (1~5) */
  rank: number;
  /** 문의 전환율 (0~1). 생략 시 DEFAULT_INQUIRY_RATE. */
  inquiryRate?: number;
  /** 예약 전환율 (0~1). 생략 시 DEFAULT_BOOKING_RATE. */
  bookingRate?: number;
  /** 평균 환자가치 (원) */
  patientValue: number;
  /** 월 마케팅 비용 (원) */
  cost: number;
  /** CTR 직접 지정 (옵션, 순위 곡선 대체) */
  ctrOverride?: number;
}

export interface RoiBreakdown {
  totalMonthlyVolume: number;
  ctr: number;
  inquiryRate: number;
  bookingRate: number;
  patientValue: number;
  cost: number;
}

export interface RoiSummary {
  visits: number;
  inquiries: number;
  bookings: number;
  revenue: number;
  profit: number;
  roiPct: number | null;
  roiMultiple: number | null;
  /** 산출 근거 (UI 펼치기용). 사용한 가정값 그대로. */
  breakdown: RoiBreakdown;
}

/**
 * 전체 ROI 시뮬레이션을 한 번에 계산한다 (순수·immutable).
 * 선택 인자(전환율)는 기본 가정값으로 대체된다.
 * 반올림은 하지 않는다(표시 단계 책임).
 */
export function summarizeRoi(input: RoiSimulationInput): RoiSummary {
  const inquiryRate = input.inquiryRate ?? DEFAULT_INQUIRY_RATE;
  const bookingRate = input.bookingRate ?? DEFAULT_BOOKING_RATE;
  const ctr =
    input.ctrOverride === undefined
      ? ctrForRank(input.rank)
      : clamp01(input.ctrOverride);

  const visits = estimateMonthlyVisits(
    input.totalMonthlyVolume,
    input.rank,
    input.ctrOverride
  );
  const funnel = estimateFunnel({
    visits,
    inquiryRate,
    bookingRate,
    patientValue: input.patientValue,
  });
  const roi = computeRoi({ revenue: funnel.revenue, cost: input.cost });

  return {
    visits,
    inquiries: funnel.inquiries,
    bookings: funnel.bookings,
    revenue: funnel.revenue,
    profit: roi.profit,
    roiPct: roi.roiPct,
    roiMultiple: roi.roiMultiple,
    breakdown: {
      totalMonthlyVolume: nonNegative(input.totalMonthlyVolume),
      ctr,
      inquiryRate: clamp01(inquiryRate),
      bookingRate: clamp01(bookingRate),
      patientValue: nonNegative(input.patientValue),
      cost: Number.isFinite(input.cost) ? input.cost : 0,
    },
  };
}

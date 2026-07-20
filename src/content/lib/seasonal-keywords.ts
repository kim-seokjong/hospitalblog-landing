import { normalizeKeyword } from './keyword-volume.ts';
import { fetchJsonWithTimeout } from './fetch-timeout.ts';
import type { GoldenKeywordItem } from './golden-keywords.ts';

/**
 * 계절성(월별) 키워드 부스트 순수 로직.
 *
 * 네이버 데이터랩 검색어 트렌드(월 단위 시계열)로 "지금 달·다음 달에
 * 검색이 상승 국면인 증상 키워드"를 감지해 황금 키워드 추천에 반영한다.
 *
 * 점수 공식:
 *   boost = (대상월들의 월평균 ratio 평균) ÷ (전체 기간 ratio 평균)
 *   - 대상월 = 현재월 + 다음월
 *   - boost ≥ SEASONAL_BOOST_THRESHOLD 이면 계절 키워드로 판정
 *   예) 냉방병의 7·8월 평균 ratio 가 연평균의 3배면 boost=3.0
 *
 * 컴플라이언스: 키워드 풀은 효과·치료 표현 없는 증상/질환명 명사만 사용.
 * 그레이스풀: 오픈API env 없음/호출 실패 시 available:false — 계절 섹션만 숨김.
 */

// ─────────────────────────────────────────────────────────────
// 진료과별 증상 키워드 풀 (명사만 — 의료광고법상 효과 표현 금지)
// ─────────────────────────────────────────────────────────────

export const SYMPTOM_KEYWORD_POOLS: Record<string, readonly string[]> = {
  내과: [
    '냉방병', '장염', '식중독', '감기', '독감', '몸살', '위염',
    '역류성식도염', '과민성대장증후군', '편도염', '기관지염', '알레르기비염', '배탈',
  ],
  외과: [
    '충수염', '탈장', '치질', '하지정맥류', '담석증', '지방종',
    '화상', '동상', '봉와직염', '종기', '갑상선결절', '상처감염',
  ],
  피부과: [
    '땀띠', '햇빛화상', '여드름', '두드러기', '무좀', '아토피', '건선',
    '습진', '모낭염', '기미', '대상포진', '두피염', '탈모', '피부건조증',
  ],
  성형외과: [
    '안검하수', '눈꺼풀처짐', '켈로이드', '흉터', '튼살', '안면비대칭',
    '비중격만곡증', '함몰흉터', '다한증', '귀변형',
  ],
  정형외과: [
    '발목염좌', '무릎통증', '허리디스크', '오십견', '손목터널증후군',
    '족저근막염', '테니스엘보', '골절', '척추측만증', '어깨충돌증후군', '무지외반증',
  ],
  안과: [
    '안구건조증', '결막염', '유행성결막염', '다래끼', '백내장', '녹내장',
    '비문증', '눈피로', '알레르기결막염', '눈꺼풀염', '노안', '눈부심',
  ],
  이비인후과: [
    '비염', '알레르기비염', '축농증', '중이염', '이석증', '편도염', '인후염',
    '코막힘', '코피', '이명', '어지럼증', '목이물감', '성대결절', '외이도염',
  ],
  치과: [
    '충치', '치은염', '치주염', '사랑니통증', '시린이', '구내염',
    '입냄새', '턱관절장애', '치아파절', '치통',
  ],
  한의원: [
    '소화불량', '수족냉증', '다한증', '불면증', '만성피로', '어지럼증',
    '산후풍', '요통', '담결림', '위장장애', '두통', '식욕부진', '체기',
  ],
  산부인과: [
    '생리불순', '생리통', '질염', '방광염', '냉대하', '갱년기증상',
    '자궁근종', '다낭성난소증후군', '입덧', '골반통', '요실금',
  ],
  소아과: [
    '수족구병', '장염', '독감', '감기', '열감기', '모세기관지염', '수두',
    '볼거리', '중이염', '폐렴', '알레르기비염', '아토피', '열성경련', '편도염',
  ],
  신경과: [
    '두통', '편두통', '어지럼증', '손발저림', '수면장애', '기억력저하',
    '안면마비', '손떨림', '치매', '만성두통', '이석증',
  ],
  정신건강의학과: [
    '불면증', '우울증', '공황장애', '불안장애', '번아웃', '스트레스',
    'ADHD', '강박증', '수면장애', '무기력증', '계절성우울증',
  ],
  재활의학과: [
    '근육통', '오십견', '허리통증', '목통증', '회전근개파열', '족저근막염',
    '손목통증', '어깨통증', '무릎통증', '척추측만증', '거북목증후군', '림프부종',
  ],
  가정의학과: [
    '감기', '독감', '만성피로', '비만', '고혈압', '당뇨', '고지혈증',
    '골다공증', '대상포진', '장염', '두통', '수면장애',
  ],
  비뇨기과: [
    '방광염', '요로결석', '전립선비대증', '과민성방광', '요실금', '혈뇨',
    '빈뇨', '요도염', '전립선염', '신우신염', '야간뇨',
  ],
};

/** 프로필 표기 편차 → 풀 키 매핑 */
const SPECIALTY_ALIASES: Record<string, string> = {
  소아청소년과: '소아과',
  비뇨의학과: '비뇨기과',
  한방: '한의원',
  한방병원: '한의원',
  정신과: '정신건강의학과',
  신경정신과: '정신건강의학과',
};

/** 진료과목 → 증상 키워드 풀. 매핑 실패 시 빈 배열 (계절 섹션 숨김). */
export function getSymptomPool(specialty: string): readonly string[] {
  const cleaned = specialty.trim();
  if (!cleaned) return [];
  const key = SPECIALTY_ALIASES[cleaned] ?? cleaned;
  return SYMPTOM_KEYWORD_POOLS[key] ?? [];
}

// ─────────────────────────────────────────────────────────────
// 계절성 점수 (순수 함수)
// ─────────────────────────────────────────────────────────────

/** 계절 키워드 판정 임계 배율 (대상월 평균 ÷ 전체 평균) */
export const SEASONAL_BOOST_THRESHOLD = 1.2;
/** 시계열 최소 데이터 포인트 (이보다 적으면 판정 보류) */
export const SEASONAL_MIN_POINTS = 12;
/** 계절 키워드 최대 노출 수 */
export const SEASONAL_ITEM_LIMIT = 8;
/** 데이터랩 조회 기간 (개월) — 최근 3년 */
export const SEASONAL_LOOKBACK_MONTHS = 36;

export interface MonthlyPoint {
  /** 1~12 */
  month: number;
  ratio: number;
}

export interface SeasonalKeywordItem {
  keyword: string;
  /** 대상월 상승 배율 (소수 2자리 반올림) */
  boost: number;
}

export interface SeasonalKeywordResult {
  available: boolean;
  /** 판정 기준이 된 대상월 (1~12) */
  targetMonths: number[];
  items: SeasonalKeywordItem[];
}

/** 현재월·다음월 (12월 → [12, 1]) */
export function getTargetMonths(now: Date = new Date()): number[] {
  const current = now.getMonth() + 1;
  const next = current === 12 ? 1 : current + 1;
  return [current, next];
}

/**
 * 월별 시계열 → 대상월 상승 배율.
 * boost = mean(대상월들의 월평균 ratio) / mean(전체 ratio).
 * 데이터 부족(포인트 < SEASONAL_MIN_POINTS)·전체 평균 0·대상월 관측 없음 → null.
 */
export function computeSeasonalBoost(
  points: readonly MonthlyPoint[],
  targetMonths: readonly number[]
): number | null {
  const valid = points.filter(
    (p) => Number.isFinite(p.ratio) && p.ratio >= 0 && p.month >= 1 && p.month <= 12
  );
  if (valid.length < SEASONAL_MIN_POINTS) return null;

  const overallAvg = valid.reduce((sum, p) => sum + p.ratio, 0) / valid.length;
  if (overallAvg <= 0) return null;

  // 월별 평균 (연도 간 평균으로 특정 해 이벤트 왜곡 완화)
  const byMonth = new Map<number, { sum: number; count: number }>();
  for (const p of valid) {
    const acc = byMonth.get(p.month) ?? { sum: 0, count: 0 };
    byMonth.set(p.month, { sum: acc.sum + p.ratio, count: acc.count + 1 });
  }

  const targetAvgs: number[] = [];
  for (const m of targetMonths) {
    const acc = byMonth.get(m);
    if (acc && acc.count > 0) targetAvgs.push(acc.sum / acc.count);
  }
  if (targetAvgs.length === 0) return null;

  const targetAvg = targetAvgs.reduce((s, v) => s + v, 0) / targetAvgs.length;
  return targetAvg / overallAvg;
}

/** boost 배율 상위 계절 키워드 선별 (임계 미달 제외, 내림차순, limit) */
export function rankSeasonalKeywords(
  boosts: Record<string, number | null>,
  options: { threshold?: number; limit?: number } = {}
): SeasonalKeywordItem[] {
  const threshold = options.threshold ?? SEASONAL_BOOST_THRESHOLD;
  const limit = options.limit ?? SEASONAL_ITEM_LIMIT;

  return Object.entries(boosts)
    .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] >= threshold)
    .map(([keyword, boost]) => ({ keyword, boost: Math.round(boost * 100) / 100 }))
    .sort((a, b) => b.boost - a.boost)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// 데이터랩 호출 (그레이스풀)
// ─────────────────────────────────────────────────────────────

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search';
/** 데이터랩 keywordGroups 최대 5개/호출 */
export const DATALAB_GROUP_LIMIT = 5;

/** 로컬 기준 yyyy-mm-dd (toISOString 은 UTC 시프트 위험) */
export function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 조회 구간: 완결된 월만 — 3년 전 1일 ~ 지난달 말일 */
export function buildDatalabDateRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const start = new Date(now.getFullYear(), now.getMonth() - SEASONAL_LOOKBACK_MONTHS, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0); // 지난달 말일
  return { startDate: formatDateYmd(start), endDate: formatDateYmd(end) };
}

export interface DatalabRequestBody {
  startDate: string;
  endDate: string;
  timeUnit: 'month';
  keywordGroups: { groupName: string; keywords: string[] }[];
}

export function buildDatalabBody(
  keywords: readonly string[],
  startDate: string,
  endDate: string
): DatalabRequestBody {
  return {
    startDate,
    endDate,
    timeUnit: 'month',
    keywordGroups: keywords.slice(0, DATALAB_GROUP_LIMIT).map((kw) => ({
      groupName: kw,
      keywords: [kw],
    })),
  };
}

/** 데이터랩 응답 → { 키워드: 월별 포인트[] }. 형태가 어긋난 항목은 건너뜀. */
export function parseDatalabSeries(data: unknown): Record<string, MonthlyPoint[]> {
  const out: Record<string, MonthlyPoint[]> = {};
  if (!data || typeof data !== 'object') return out;
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return out;

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const { title, data: series } = result as { title?: unknown; data?: unknown };
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(series)) continue;

    const points: MonthlyPoint[] = [];
    for (const point of series) {
      if (!point || typeof point !== 'object') continue;
      const { period, ratio } = point as { period?: unknown; ratio?: unknown };
      if (typeof period !== 'string' || typeof ratio !== 'number' || !Number.isFinite(ratio)) continue;
      const month = Number(period.slice(5, 7));
      if (!Number.isInteger(month) || month < 1 || month > 12) continue;
      points.push({ month, ratio });
    }
    out[title.trim()] = points;
  }
  return out;
}

/**
 * 진료과 기준 계절 키워드 감지 (데이터랩 5개씩 배치 호출 — 일 1,000회 한도 배려).
 * 개별 배치 실패는 건너뛰고, 전부 실패 시에만 available:false.
 */
export async function fetchSeasonalKeywords(
  specialty: string,
  options: { now?: Date; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<SeasonalKeywordResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const targetMonths = getTargetMonths(now);

  const pool = getSymptomPool(specialty);
  if (pool.length === 0) {
    return { available: true, targetMonths, items: [] };
  }

  const clientId = env.NAVER_CLIENT_ID?.trim();
  const clientSecret = env.NAVER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { available: false, targetMonths, items: [] };
  }

  const { startDate, endDate } = buildDatalabDateRange(now);
  const boosts: Record<string, number | null> = {};
  let anySuccess = false;

  for (let i = 0; i < pool.length; i += DATALAB_GROUP_LIMIT) {
    const chunk = pool.slice(i, i + DATALAB_GROUP_LIMIT);
    try {
      const res = await fetchJsonWithTimeout(fetchImpl, DATALAB_URL, {
        method: 'POST',
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildDatalabBody(chunk, startDate, endDate)),
      });
      if (!res.ok) continue;

      const series = parseDatalabSeries(res.data);
      anySuccess = true;
      for (const [keyword, points] of Object.entries(series)) {
        boosts[keyword] = computeSeasonalBoost(points, targetMonths);
      }
    } catch {
      // 개별 배치 실패는 그레이스풀 — 다음 배치 계속
    }
  }

  if (!anySuccess) {
    return { available: false, targetMonths, items: [] };
  }

  return { available: true, targetMonths, items: rankSeasonalKeywords(boosts) };
}

// ─────────────────────────────────────────────────────────────
// 황금 키워드 추천에 계절 부스트 반영
// ─────────────────────────────────────────────────────────────

export interface SeasonalMatch {
  keyword: string;
  boost: number;
}

export interface GoldenKeywordWithSeasonal extends GoldenKeywordItem {
  /** 매칭된 계절 키워드 (없으면 null) */
  seasonal: SeasonalMatch | null;
}

/** 황금 키워드가 계절 키워드를 포함하면 매칭 (공백·대소문자 무시) */
export function matchSeasonal(
  goldenKeyword: string,
  seasonalItems: readonly SeasonalKeywordItem[]
): SeasonalMatch | null {
  const norm = normalizeKeyword(goldenKeyword);
  let best: SeasonalMatch | null = null;
  for (const item of seasonalItems) {
    const seasonalNorm = normalizeKeyword(item.keyword);
    if (!seasonalNorm || !norm.includes(seasonalNorm)) continue;
    if (!best || item.boost > best.boost) {
      best = { keyword: item.keyword, boost: item.boost };
    }
  }
  return best;
}

/**
 * 계절 부스트를 반영해 재정렬한 새 배열을 반환한다 (입력 불변).
 * - 경쟁도(ratio) 있는 그룹: (ratio ÷ boost) 오름차순 — 계절 키워드가 앞으로
 * - ratio 없는 그룹: (검색량 × boost) 내림차순
 */
export function applySeasonalBoost(
  items: readonly GoldenKeywordItem[],
  seasonalItems: readonly SeasonalKeywordItem[]
): GoldenKeywordWithSeasonal[] {
  const withSeasonal = items.map((item) => ({
    ...item,
    seasonal: matchSeasonal(item.keyword, seasonalItems),
  }));

  return withSeasonal.sort((a, b) => {
    const aBoost = a.seasonal?.boost ?? 1;
    const bBoost = b.seasonal?.boost ?? 1;
    if (a.ratio !== null && b.ratio !== null) {
      const aKey = a.ratio / aBoost;
      const bKey = b.ratio / bBoost;
      if (aKey !== bKey) return aKey - bKey;
      return b.volume.total - a.volume.total;
    }
    if (a.ratio !== null) return -1;
    if (b.ratio !== null) return 1;
    return b.volume.total * bBoost - a.volume.total * aBoost;
  });
}

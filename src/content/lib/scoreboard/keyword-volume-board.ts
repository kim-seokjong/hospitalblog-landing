import { fetchRelatedKeywords, type KeywordVolume } from '../keyword-volume.ts';

/**
 * 경쟁 종합 비교(스코어보드) — 키워드 검색량·경쟁정도 카드 순수 로직.
 *
 * 진료과목+지역으로 keywordstool 연관 키워드를 조회해
 * 월 검색량(PC/모바일)·광고 경쟁정도(compIdx) 상위 키워드를 보여준다.
 * 컴플라이언스: 네이버가 공개하는 사실 수치만 표시 — 매출·방문자 추정 절대 금지.
 * 그레이스풀: 검색광고 env 없으면 available:false → 카드 자체를 조용히 숨긴다.
 */

export interface KeywordBoardRow {
  keyword: string;
  pc: number;
  mobile: number;
  total: number;
  /** 네이버 광고 경쟁정도 원문: '낮음' | '중간' | '높음' | '-' */
  compIdx: string;
}

export interface KeywordBoardResult {
  available: boolean;
  rows: KeywordBoardRow[];
}

/** 카드에 표시할 최대 행 수 */
export const KEYWORD_BOARD_ROW_LIMIT = 8;

/**
 * keywordstool 힌트 구성: "지역+진료과목"(공백 제거) 우선, 진료과목 단독 보조.
 * 빈 값 제외·중복 제거. 예) ('피부과','수성구') → ['수성구피부과','피부과']
 */
export function buildKeywordHints(specialty: string, region: string): string[] {
  const cleanSpecialty = specialty.trim();
  const cleanRegion = region.trim();
  if (!cleanSpecialty) return [];

  const hints: string[] = [];
  if (cleanRegion) {
    hints.push(`${cleanRegion}${cleanSpecialty}`.replace(/\s+/g, ''));
  }
  hints.push(cleanSpecialty);
  return Array.from(new Set(hints));
}

/** 연관 키워드 → 검색량(total) 내림차순 상위 limit 행 (동률은 키워드 사전순 — 안정성) */
export function selectTopKeywordRows(
  volumes: Record<string, KeywordVolume>,
  limit: number = KEYWORD_BOARD_ROW_LIMIT
): KeywordBoardRow[] {
  return Object.entries(volumes)
    .map(([keyword, v]) => ({
      keyword,
      pc: v.pc,
      mobile: v.mobile,
      total: v.total,
      compIdx: v.compIdx,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.keyword.localeCompare(b.keyword, 'ko');
    })
    .slice(0, limit);
}

/** 진료과목+지역 기준 키워드 카드 데이터 조회 (keywordstool 1콜) */
export async function fetchKeywordBoard(
  specialty: string,
  region: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<KeywordBoardResult> {
  const hints = buildKeywordHints(specialty, region);
  if (hints.length === 0) {
    return { available: true, rows: [] };
  }

  const related = await fetchRelatedKeywords(hints, options);
  if (!related.available) {
    return { available: false, rows: [] };
  }

  return { available: true, rows: selectTopKeywordRows(related.volumes) };
}

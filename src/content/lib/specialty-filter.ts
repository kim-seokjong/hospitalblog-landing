import { normalizeKeyword } from './keyword-volume.ts';

/**
 * 타 진료과 키워드 블랙리스트 필터 (순수 로직 — API 비용 0, 결정적).
 *
 * 네이버 keywordstool 연관어는 광고그룹 동시등록 통계 기반이라
 * 씨앗 키워드와 무관한 타 진료과 키워드(예: 피부과+보톡스 → "치과")가 섞인다.
 * 사용자 진료과가 **아닌** 진료과의 명칭 토큰·시그니처 시술어를 포함한
 * 키워드를 후보에서 제외한다.
 *
 * 설계 원칙 (recall 보존 — 확실히 무관한 것만 제거):
 * - 명칭 토큰: 진료과 이름 그 자체 ("치과" → "어린이치과"도 매칭)
 * - 시그니처 시술어: 그 진료과에서만 쓰이는 명확한 것만 등재.
 *   보톡스·필러·리프팅·도수치료 같은 인접 진료과 공유 시술어는 절대 넣지 않는다.
 * - 사용자 본인 진료과 토큰은 절대 필터하지 않는다. 판정 전에 본인 토큰을
 *   키워드에서 제거해, "성형외과" 사용자가 "외과" 토큰에 오차단되는 일을 막는다.
 * - specialty 미설정·사전에 없는 진료과 → 필터 없음(그레이스풀, 기존 동작 유지).
 */

export interface SpecialtyLexicon {
  /** 진료과 명칭 토큰 (표기 변형 포함) */
  names: readonly string[];
  /** 그 진료과 전용임이 명확한 시그니처 시술어 (공유 시술어 금지) */
  signatures: readonly string[];
}

/**
 * 진료과별 어휘 사전.
 * 키 = CLAUDE.md 지원 진료과(15개) 기준 정식 명칭
 * (+ 연관어에 자주 등장하는 신경외과·가정의학과 — 키워드 공간 커버용).
 */
export const SPECIALTY_LEXICONS: Record<string, SpecialtyLexicon> = {
  내과: { names: ['내과'], signatures: ['위내시경', '대장내시경'] },
  외과: { names: ['외과'], signatures: [] },
  피부과: { names: ['피부과'], signatures: [] },
  성형외과: { names: ['성형외과'], signatures: ['양악수술', '가슴성형'] },
  정형외과: { names: ['정형외과'], signatures: [] },
  신경외과: { names: ['신경외과'], signatures: [] },
  안과: { names: ['안과'], signatures: ['라식', '라섹', '렌즈삽입술'] },
  이비인후과: { names: ['이비인후과'], signatures: [] },
  치과: {
    names: ['치과'],
    signatures: [
      '임플란트', '치아', '충치', '스케일링', '사랑니',
      '라미네이트', '틀니', '인비절라인', '잇몸',
    ],
  },
  한의원: {
    names: ['한의원', '한방병원', '한의'],
    signatures: ['한약', '추나', '보약', '부항', '경락', '침치료'],
  },
  산부인과: { names: ['산부인과'], signatures: ['자궁경부암', '산전검사'] },
  소아과: { names: ['소아과', '소아청소년과'], signatures: ['영유아검진'] },
  신경과: { names: ['신경과'], signatures: [] },
  정신건강의학과: {
    names: ['정신건강의학과', '정신과', '신경정신과'],
    signatures: [],
  },
  재활의학과: { names: ['재활의학과'], signatures: [] },
  비뇨기과: { names: ['비뇨기과', '비뇨의학과'], signatures: [] },
  가정의학과: { names: ['가정의학과'], signatures: [] },
};

/** 프로필 표기 편차 → 사전 키 매핑 (seasonal-keywords 의 별칭 규칙과 동일) */
const SPECIALTY_ALIASES: Record<string, string> = {
  소아청소년과: '소아과',
  비뇨의학과: '비뇨기과',
  한방: '한의원',
  한방병원: '한의원',
  정신과: '정신건강의학과',
  신경정신과: '정신건강의학과',
};

/** 진료과 입력 → 사전 키. 미설정·사전에 없으면 null (필터 건너뜀). */
export function resolveSpecialtyKey(specialty: string | undefined): string | null {
  const cleaned = (specialty ?? '').trim();
  if (!cleaned) return null;
  const key = SPECIALTY_ALIASES[cleaned] ?? cleaned;
  return key in SPECIALTY_LEXICONS ? key : null;
}

/** 키워드 허용 여부 판정 함수. true = 통과(유지), false = 타 진료과로 제외. */
export type SpecialtyKeywordFilter = (keyword: string) => boolean;

/**
 * 사용자 진료과 기준 타 진료과 필터를 만든다.
 * specialty 가 없거나 사전에 없으면 null — 호출부는 필터 없이 기존 동작 유지.
 * 판정: 본인 진료과 토큰을 키워드에서 제거한 뒤, 남은 문자열에
 * 타 진료과 토큰이 포함되면 제외. (제거는 새 문자열 생성 — 입력 불변)
 */
export function createSpecialtyFilter(
  specialty: string | undefined
): SpecialtyKeywordFilter | null {
  const key = resolveSpecialtyKey(specialty);
  if (!key) return null;

  const own = SPECIALTY_LEXICONS[key];
  // 긴 토큰 먼저 제거해야 부분 잔여물이 안 생긴다 (예: '정신건강의학과' → '정신과' 순)
  const ownTokens = [...own.names, ...own.signatures]
    .map(normalizeKeyword)
    .sort((a, b) => b.length - a.length);

  const foreignTokens: string[] = [];
  for (const [lexKey, lexicon] of Object.entries(SPECIALTY_LEXICONS)) {
    if (lexKey === key) continue;
    for (const token of [...lexicon.names, ...lexicon.signatures]) {
      const norm = normalizeKeyword(token);
      // 본인 토큰과 동일한 토큰은 제외 대상에서 뺀다 (본인 진료과 절대 보호)
      if (norm && !ownTokens.includes(norm)) foreignTokens.push(norm);
    }
  }

  return (keyword: string): boolean => {
    let remainder = normalizeKeyword(keyword);
    for (const token of ownTokens) {
      remainder = remainder.split(token).join('');
    }
    return !foreignTokens.some((token) => remainder.includes(token));
  };
}

/**
 * 병원명 → 서브도메인 슬러그 자동 생성 (순수 로직 모듈).
 *
 * 역할:
 *  1) 한글 병원명을 읽을 수 있는 로마자로 변환한다.
 *  2) 슬러그 형식(소문자 영숫자+하이픈, 3~30자)에 맞게 정규화·길이 보정한다.
 *  3) 중복(unique 충돌) 대비 후보 목록(base, base-2, base-3 …)을 만든다.
 *
 * 설계 방침 — "완벽한 국어의 로마자 표기법"이 아니라 "읽을 수 있고 안정적인 주소":
 *  - 표기법의 음운 변동 규칙(자음동화·구개음화·ㅎ 축약 등)은 구현하지 않는다.
 *    예: 신라 → 표기법은 'silla' 지만 여기서는 'sinra'. 발음이 조금 달라도
 *    같은 입력이 항상 같은 출력을 내는 것이 주소로서 훨씬 중요하다
 *    (변동 규칙은 예외가 많아 구현체마다 결과가 갈리고, 규칙을 고치는 순간
 *     기존 고객 주소가 바뀌어 색인이 끊긴다).
 *  - 자모 단위 결정적 매핑만 사용한다 → 재현 가능·테스트 가능·회귀 없음.
 *
 * ⚠️ 러너 제약(slug.ts / publish-gate.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    자립 모듈로 유지한다. 슬러그 길이 상수는 slug.ts 와 중복 정의하고,
 *    두 값이 어긋나지 않는지는 테스트가 고정한다(romanize.test.ts).
 */

/** 슬러그 길이 하한·상한 (slug.ts 의 SLUG_MIN_LENGTH / SLUG_MAX_LENGTH 와 동일해야 한다). */
export const SLUG_BASE_MIN_LENGTH = 3;
export const SLUG_BASE_MAX_LENGTH = 30;

// ---------------------------------------------------------------------------
// 1) 한글 → 로마자 (자모 단위 결정적 매핑)
// ---------------------------------------------------------------------------

const HANGUL_SYLLABLE_FIRST = 0xac00;
const HANGUL_SYLLABLE_LAST = 0xd7a3;
const MEDIAL_COUNT = 21;
const FINAL_COUNT = 28;

/** 초성 19자 — ㅇ(11번)은 소리값이 없어 빈 문자열. */
const INITIALS: readonly string[] = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];

/** 중성 21자. */
const MEDIALS: readonly string[] = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];

/** 종성 28자 — 받침 표기(ㄱ→k, ㄹ→l, ㅇ→ng …). 0번은 받침 없음. */
const FINALS: readonly string[] = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k',
  'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

/** 단독 자모(ㄱ, ㅏ …)가 이름에 섞인 경우를 위한 호환 자모 매핑(최소 지원). */
const COMPAT_JAMO: Readonly<Record<string, string>> = {
  'ㄱ': 'g', 'ㄲ': 'kk', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'tt', 'ㄹ': 'r', 'ㅁ': 'm',
  'ㅂ': 'b', 'ㅃ': 'pp', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅇ': 'ng', 'ㅈ': 'j', 'ㅉ': 'jj',
  'ㅊ': 'ch', 'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h',
  'ㅏ': 'a', 'ㅑ': 'ya', 'ㅓ': 'eo', 'ㅕ': 'yeo', 'ㅗ': 'o', 'ㅛ': 'yo',
  'ㅜ': 'u', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅣ': 'i', 'ㅐ': 'ae', 'ㅔ': 'e',
};

/**
 * 문자열을 로마자로 바꾼다.
 *  - 한글 음절 → 초성+중성+종성 로마자
 *  - 영문·숫자 → 소문자 그대로
 *  - 그 밖의 문자(공백·기호·한자·이모지 등) → 구분자('-')
 * 반환값은 아직 슬러그가 아니다(연속 하이픈·앞뒤 하이픈이 남아 있을 수 있다).
 */
export function romanizeKorean(text: string): string {
  let out = '';
  for (const char of text ?? '') {
    const code = char.codePointAt(0) ?? 0;

    if (code >= HANGUL_SYLLABLE_FIRST && code <= HANGUL_SYLLABLE_LAST) {
      const offset = code - HANGUL_SYLLABLE_FIRST;
      const initial = Math.floor(offset / (MEDIAL_COUNT * FINAL_COUNT));
      const medial = Math.floor((offset % (MEDIAL_COUNT * FINAL_COUNT)) / FINAL_COUNT);
      const final = offset % FINAL_COUNT;
      out += INITIALS[initial] + MEDIALS[medial] + FINALS[final];
      continue;
    }

    const compat = COMPAT_JAMO[char];
    if (compat !== undefined) {
      out += compat;
      continue;
    }

    if (/^[A-Za-z0-9]$/.test(char)) {
      out += char.toLowerCase();
      continue;
    }

    out += '-';
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2) 병원명 전처리 (법인격 접두어 · 종별 접미어)
// ---------------------------------------------------------------------------

/**
 * 법인격 접두어 — 브랜드가 아니라 법적 형태 표기라 항상 제거한다.
 * ("의료법인 연세의원" → "연세의원")
 */
const CORPORATE_PREFIXES: readonly string[] = [
  '의료법인재단', '사회복지법인', '학교법인', '의료법인', '재단법인', '사단법인',
];

/**
 * 병원 종별 접미어.
 *
 * ★ 처리 방침: **기본적으로 남긴다.** 길이 초과(30자)일 때만 하나 떼어낸다.
 *
 * 근거:
 *  - 접미어는 상호의 일부이고 환자가 실제로 검색하는 토큰이다
 *    ("연세의원"과 "연세한의원"은 완전히 다른 병원 — 접미어를 지우면 둘 다
 *     'yeonse' 가 되어 전역 unique 충돌이 급증하고, 뒤에 붙는 -2/-3 이
 *     오히려 신뢰도 낮은 주소를 만든다).
 *  - 접미어가 남으면 주소만 보고도 업종이 읽힌다(yeonsehanuiwon).
 *  - 길이 초과는 실제로 드물고, 그때만 떼면 "짧고 읽히는" 결과가 남는다
 *    ("강남연세정형외과의원" 33자 → 접미어 제거 후 'gangnamyeonsejeonghyeongoegwa').
 */
const CLINIC_SUFFIXES: readonly string[] = [
  '한방병원', '요양병원', '종합병원', '치과병원', '치과의원', '메디컬센터',
  '한의원', '치과', '의원', '병원', '의료원', '클리닉', '센터',
];

/** 긴 접미어부터 검사해야 '치과의원'이 '의원'으로 잘못 잡히지 않는다. */
const CLINIC_SUFFIXES_LONGEST_FIRST: readonly string[] = [...CLINIC_SUFFIXES].sort(
  (a, b) => b.length - a.length,
);

/** 법인격 접두어를 제거한다(앞뒤 공백 정리 포함). 입력을 변형하지 않는다. */
export function stripCorporatePrefix(name: string): string {
  let out = (name ?? '').trim();
  for (const prefix of CORPORATE_PREFIXES) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length).trim();
      break;
    }
  }
  return out;
}

/**
 * 병원 종별 접미어를 하나 떼어낸다. 떼어낼 게 없거나 떼면 빈 문자열이 되면
 * 원본을 그대로 돌려준다(입력 불변).
 */
export function stripClinicSuffix(name: string): string {
  const trimmed = (name ?? '').trim();
  for (const suffix of CLINIC_SUFFIXES_LONGEST_FIRST) {
    if (trimmed.length > suffix.length && trimmed.endsWith(suffix)) {
      const stripped = trimmed.slice(0, trimmed.length - suffix.length).trim();
      if (stripped.length > 0) return stripped;
    }
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// 3) 슬러그 정규화 · 길이 보정
// ---------------------------------------------------------------------------

/** 소문자 영숫자+하이픈만 남기고 연속·앞뒤 하이픈을 정리한다. */
export function normalizeSlugChars(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/** 짧은 슬러그를 보충할 때 붙이는 꼬리(주소로 읽히는 일반 명사). */
const SHORT_SLUG_PADDING = 'clinic';

/**
 * 길이를 [min, max] 로 보정한다.
 *  - 초과: max 로 자르되, 잘린 지점 가까이에 하이픈 경계가 있으면 거기서 자른다
 *    (단어 중간에서 잘려 읽을 수 없게 되는 것을 줄인다).
 *  - 미달: '-clinic' 을 붙여 채운다.
 *  - 보정 후에도 형식을 만족하지 못하면 빈 문자열(호출부가 실패로 처리).
 */
export function clampSlugLength(
  slug: string,
  min: number = SLUG_BASE_MIN_LENGTH,
  max: number = SLUG_BASE_MAX_LENGTH,
): string {
  let out = normalizeSlugChars(slug);
  if (out === '') return '';

  if (out.length > max) {
    const cut = out.slice(0, max);
    const lastHyphen = cut.lastIndexOf('-');
    // 하이픈 경계가 뒤쪽(마지막 8자 이내)에 있으면 단어 단위로 자른다.
    out = lastHyphen >= min && lastHyphen >= max - 8 ? cut.slice(0, lastHyphen) : cut;
    out = normalizeSlugChars(out);
  }

  if (out.length < min) {
    out = normalizeSlugChars(`${out}-${SHORT_SLUG_PADDING}`);
    if (out.length > max) out = normalizeSlugChars(out.slice(0, max));
  }

  return out.length >= min && out.length <= max ? out : '';
}

/**
 * 병원명에서 기본 슬러그를 만든다. 만들 수 없으면 null.
 *
 * 순서: 법인격 접두어 제거 → 로마자화 → 정규화 → (초과 시) 종별 접미어 제거 후 재시도
 *       → 길이 보정.
 */
export function hospitalNameToSlugBase(
  hospitalName: string,
  min: number = SLUG_BASE_MIN_LENGTH,
  max: number = SLUG_BASE_MAX_LENGTH,
): string | null {
  const cleaned = stripCorporatePrefix(hospitalName ?? '');
  if (cleaned === '') return null;

  const full = normalizeSlugChars(romanizeKorean(cleaned));
  if (full === '') return null;

  // 길이를 넘으면 종별 접미어를 떼고 다시 만들어 본다(자르기보다 읽기 좋다).
  let candidate = full;
  if (full.length > max) {
    const withoutSuffix = stripClinicSuffix(cleaned);
    if (withoutSuffix !== cleaned) {
      const shortened = normalizeSlugChars(romanizeKorean(withoutSuffix));
      if (shortened.length >= min) candidate = shortened;
    }
  }

  const clamped = clampSlugLength(candidate, min, max);
  return clamped === '' ? null : clamped;
}

// ---------------------------------------------------------------------------
// 4) 중복 대비 후보 생성
// ---------------------------------------------------------------------------

export interface SlugCandidateOptions {
  /** 예약어 판정 — 해당 후보는 건너뛴다(기본: 예약어 없음). */
  isReserved?: (slug: string) => boolean;
  /** 숫자 접미어 후보를 몇 번까지 만들지 (base 포함 총 개수, 기본 8). */
  attempts?: number;
  /**
   * 숫자 접미어를 모두 소진했을 때 덧붙일 무작위 꼬리 생성기.
   * 테스트 주입용 — 기본은 base36 4자.
   */
  randomSuffix?: () => string;
  /** 무작위 꼬리 후보 개수 (기본 2). */
  randomAttempts?: number;
  min?: number;
  max?: number;
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, '') || 'x1';
}

/**
 * 저장 시도 순서대로 슬러그 후보를 만든다.
 *
 *  ① base                       (병원명 그대로)
 *  ② base-2, base-3 … base-N    (unique 충돌 시 재시도용)
 *  ③ base-<무작위 4자>          (숫자 접미어까지 모두 충돌했을 때 최후 수단)
 *
 * 예약어·형식 위반 후보는 제외한다. 후보를 하나도 만들 수 없으면 빈 배열
 * (호출부는 슬러그 생성 실패로 처리하고, 고객이 마이페이지에서 직접 정하게 둔다).
 */
export function buildSlugCandidates(
  hospitalName: string,
  options: SlugCandidateOptions = {},
): string[] {
  const min = options.min ?? SLUG_BASE_MIN_LENGTH;
  const max = options.max ?? SLUG_BASE_MAX_LENGTH;
  const attempts = Math.max(1, options.attempts ?? 8);
  const randomAttempts = Math.max(0, options.randomAttempts ?? 2);
  const isReserved = options.isReserved ?? (() => false);
  const randomSuffix = options.randomSuffix ?? defaultRandomSuffix;

  const base = hospitalNameToSlugBase(hospitalName, min, max);
  if (base === null) return [];

  const seen = new Set<string>();
  const candidates: string[] = [];

  const push = (value: string): void => {
    const normalized = clampSlugLength(value, min, max);
    if (normalized === '' || seen.has(normalized) || isReserved(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  /** base 뒤에 꼬리를 붙이되 최대 길이를 넘지 않게 base 를 먼저 줄인다. */
  const withTail = (tail: string): string => {
    const room = max - (tail.length + 1);
    if (room < min) return '';
    const head = normalizeSlugChars(base.slice(0, room));
    return head.length >= min ? `${head}-${tail}` : '';
  };

  push(base);
  for (let n = 2; n <= attempts; n++) {
    const value = withTail(String(n));
    if (value !== '') push(value);
  }
  for (let i = 0; i < randomAttempts; i++) {
    const tail = normalizeSlugChars(randomSuffix());
    if (tail === '') continue;
    const value = withTail(tail);
    if (value !== '') push(value);
  }

  return candidates;
}

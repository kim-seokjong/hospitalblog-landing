import { createHmac } from 'crypto';

/**
 * 네이버 검색광고 API(keywordstool) 연동 순수 로직.
 *
 * 그레이스풀 철학: 환경변수가 없으면 throw하지 않고 available:false 를 반환한다.
 * (competitor-monitor 의 naverError graceful 패턴과 동일.)
 * HMAC 서명·응답 파싱은 외부 의존성 없는 순수 함수로 분리해 단위테스트가 가능하다.
 */

export interface KeywordVolume {
  pc: number;
  mobile: number;
  total: number;
  /** 경쟁강도: '낮음' | '중간' | '높음' (네이버 compIdx 원문) */
  compIdx: string;
}

export interface KeywordVolumeResult {
  available: boolean;
  volumes: Record<string, KeywordVolume>;
}

export interface SearchAdCredentials {
  apiKey: string;
  secretKey: string;
  customerId: string;
}

const SEARCHAD_BASE_URL = 'https://api.searchad.naver.com';
const KEYWORDSTOOL_URI = '/keywordstool';

/**
 * 환경변수에서 검색광고 자격증명을 읽는다. 하나라도 비면 null.
 * 절대 throw하지 않는다 (그레이스풀의 핵심).
 */
export function readSearchAdCredentials(
  env: NodeJS.ProcessEnv = process.env
): SearchAdCredentials | null {
  // 네이버 공식 용어는 '액세스 라이선스'(NAVER_AD_ACCESS_LICENSE).
  // 과거 명명(NAVER_AD_API_KEY)도 호환 유지.
  const apiKey = (env.NAVER_AD_ACCESS_LICENSE ?? env.NAVER_AD_API_KEY)?.trim();
  const secretKey = env.NAVER_AD_SECRET_KEY?.trim();
  const customerId = env.NAVER_AD_CUSTOMER_ID?.trim();

  if (!apiKey || !secretKey || !customerId) {
    return null;
  }
  return { apiKey, secretKey, customerId };
}

/**
 * 네이버 검색광고 API HMAC-SHA256 서명 생성.
 * 공식 sample(signaturehelper.py) 기준:
 *   message = `${timestamp}.${method}.${uri}`
 *   signature = base64( hmac_sha256(message, secretKey).digest() )
 * uri 는 query string 을 제외한 path 만 사용한다.
 */
export function buildSignature(
  timestamp: string,
  method: string,
  uri: string,
  secretKey: string
): string {
  const message = `${timestamp}.${method}.${uri}`;
  return createHmac('sha256', secretKey).update(message).digest('base64');
}

/**
 * 검색광고 API 호출용 헤더를 구성한다.
 */
export function buildSearchAdHeaders(
  creds: SearchAdCredentials,
  method: string,
  uri: string,
  timestamp: string = String(Date.now())
): Record<string, string> {
  return {
    'X-Timestamp': timestamp,
    'X-API-KEY': creds.apiKey,
    'X-Customer': creds.customerId,
    'X-Signature': buildSignature(timestamp, method, uri, creds.secretKey),
  };
}

/**
 * 월 검색수 필드 파싱. 네이버는 노출이 적으면 문자열 '< 10' 을 반환하므로 5로 본다.
 * 숫자/숫자문자열은 그대로, 파싱 불가는 0.
 */
export function parseQcCount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 0 ? 0 : raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('<')) {
      // '< 10' → 5 (10 미만 추정치)
      return 5;
    }
    const n = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

interface KeywordListItem {
  relKeyword?: unknown;
  monthlyPcQcCnt?: unknown;
  monthlyMobileQcCnt?: unknown;
  compIdx?: unknown;
}

/**
 * keywordstool 응답(keywordList)을 { [keyword]: KeywordVolume } 으로 변환.
 * requestedKeywords 가 주어지면 해당 키워드(정확 매칭, 대문자 무시·공백 정규화)만 추린다.
 */
export function parseKeywordVolumes(
  keywordList: unknown,
  requestedKeywords?: readonly string[]
): Record<string, KeywordVolume> {
  if (!Array.isArray(keywordList)) {
    return {};
  }

  const wanted = requestedKeywords
    ? new Set(requestedKeywords.map(normalizeKeyword))
    : null;

  const out: Record<string, KeywordVolume> = {};

  for (const item of keywordList) {
    if (!item || typeof item !== 'object') continue;
    const row = item as KeywordListItem;
    const rel = typeof row.relKeyword === 'string' ? row.relKeyword.trim() : '';
    if (!rel) continue;

    const norm = normalizeKeyword(rel);
    if (wanted && !wanted.has(norm)) continue;

    const pc = parseQcCount(row.monthlyPcQcCnt);
    const mobile = parseQcCount(row.monthlyMobileQcCnt);
    const compIdx = typeof row.compIdx === 'string' && row.compIdx.trim() ? row.compIdx.trim() : '-';

    // 같은 키워드가 중복 등장하면 검색량이 큰 행을 우선
    const existing = out[rel];
    const total = pc + mobile;
    if (!existing || total > existing.total) {
      out[rel] = { pc, mobile, total, compIdx };
    }
  }

  return out;
}

/** 키워드를 매칭용으로 정규화 (네이버는 공백제거·대문자 키 사용) */
export function normalizeKeyword(kw: string): string {
  return kw.replace(/\s+/g, '').toUpperCase();
}

/**
 * 경쟁자 주제/키워드 후보 중, 내가 아직 다루지 않은 것만 골라낸다(갭 분석).
 * 내 글 제목/키워드 텍스트를 합쳐 부분 문자열로 커버 여부를 판단한다.
 * 반환은 검색량(total) 내림차순. 검색량 정보가 없으면 입력 순서를 유지(안정 정렬).
 */
export interface GapCandidate {
  /** 추천 주제 또는 키워드 텍스트 */
  text: string;
  /** 글쓰기 입력에 넣을 핵심 키워드 (없으면 text 사용) */
  keyword: string;
  volume: KeywordVolume | null;
}

export function computeContentGaps(
  candidates: readonly { text: string; keyword: string }[],
  myCoveredText: readonly string[],
  volumes: Record<string, KeywordVolume>
): GapCandidate[] {
  const haystack = myCoveredText
    .map((t) => normalizeKeyword(t))
    .filter((t) => t.length > 0);

  const gaps: GapCandidate[] = [];
  const seen = new Set<string>();

  for (const cand of candidates) {
    const text = cand.text.trim();
    const keyword = (cand.keyword || cand.text).trim();
    if (!text) continue;

    const dedupeKey = normalizeKeyword(text);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const normKeyword = normalizeKeyword(keyword);
    // 내가 이미 다룬 주제인지: 내 글 텍스트가 후보 키워드를 포함하거나 그 반대
    const covered = haystack.some(
      (h) => normKeyword.length > 0 && (h.includes(normKeyword) || normKeyword.includes(h))
    );
    if (covered) continue;

    const volume = volumes[keyword] ?? volumes[text] ?? null;
    gaps.push({ text, keyword, volume });
  }

  // 검색량 내림차순 (volume 없는 항목은 뒤로, 동률은 원래 순서 유지)
  return gaps
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const av = a.g.volume?.total ?? -1;
      const bv = b.g.volume?.total ?? -1;
      if (bv !== av) return bv - av;
      return a.i - b.i;
    })
    .map(({ g }) => g);
}

/**
 * 검색광고 API 를 호출해 키워드 검색량을 조회한다.
 * 자격증명이 없으면 available:false 를 반환(그레이스풀). 호출/파싱 실패도 동일.
 * 외부 fetch 를 주입 가능하게 해 테스트에서 모킹할 수 있다.
 */
export async function fetchKeywordVolumes(
  keywords: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<KeywordVolumeResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  const cleaned = Array.from(
    new Set(
      keywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    )
  ).slice(0, 5); // keywordstool hintKeywords 권장 최대 5개

  if (cleaned.length === 0) {
    return { available: true, volumes: {} };
  }

  const creds = readSearchAdCredentials(env);
  if (!creds) {
    // 그레이스풀: 키 없으면 기능만 숨기고 전체는 정상
    return { available: false, volumes: {} };
  }

  try {
    const timestamp = String(Date.now());
    const headers = buildSearchAdHeaders(creds, 'GET', KEYWORDSTOOL_URI, timestamp);
    // hintKeywords 는 공백 없이 콤마 구분
    const hint = cleaned.map((k) => k.replace(/\s+/g, '')).join(',');
    const url = `${SEARCHAD_BASE_URL}${KEYWORDSTOOL_URI}?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`;

    const res = await fetchImpl(url, { headers, method: 'GET' });
    if (!res.ok) {
      return { available: false, volumes: {} };
    }

    const data = (await res.json()) as { keywordList?: unknown };
    const volumes = parseKeywordVolumes(data.keywordList, cleaned);
    return { available: true, volumes };
  } catch {
    // 호출 실패는 그레이스풀 degrade
    return { available: false, volumes: {} };
  }
}

/**
 * IndexNow — 즉시 색인 요청 (순수 로직 모듈).
 *
 * 공식 스펙 확인 결과 (https://www.indexnow.org/documentation, /faq):
 *  - 소유 증명: 호스트 루트에 `{key}.txt` (UTF-8, 본문 = 키 문자열 그대로) 를 둔다.
 *  - ★ "Each subdomain is treated as a separate host, which means you must create and
 *    manage individual key files for each one." — 상위 도메인의 키 파일은 서브도메인을
 *    커버하지 않는다. 그래서 {slug}.hospitalblog.kr 각각이 자기 루트에 키 파일을
 *    응답해야 한다(미들웨어 + /clinic-site/[slug]/indexnow/[key] 라우트로 자동 처리).
 *  - keyLocation 은 "within the same host" 로만 허용된다 → 다른 호스트의 키 파일을
 *    가리킬 수 없다. 루트 배치(Option 1)가 공식 권장.
 *  - 엔드포인트 1곳에 보내면 참여 검색엔진 전체(Bing·Naver·Yandex·Seznam·Yep 등)에
 *    공유된다 → api.indexnow.org 글로벌 엔드포인트만 사용한다.
 *  - POST 본문: { host, key, keyLocation, urlList }, Content-Type
 *    application/json; charset=utf-8, urlList 최대 10,000개.
 *  - 응답: 200 성공 / 202 키 검증 대기 / 400 형식오류 / 403 키 불일치 /
 *    422 호스트 불일치 / 429 과다요청.
 *  - "Submit only when content has changed. Do not resubmit unchanged URLs."
 *
 * ⚠️ 러너 제약(slug.ts / auto-publish.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    자립 모듈로 유지한다. 실제 네트워크 호출은 indexnow-submit.ts 가 담당한다.
 */

/** 글로벌 엔드포인트 — 여기 1곳에 보내면 참여 검색엔진 전체로 전파된다. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** 스펙상 1회 POST 최대 URL 수. */
export const INDEXNOW_PROTOCOL_MAX_URLS = 10_000;

/**
 * 우리 쪽 1회 제출 상한. 발행 트리거는 글 1~3편 단위라 이보다 훨씬 작지만,
 * 버그·백필로 대량 제출이 새어나가는 것을 막는 안전장치다.
 */
export const INDEXNOW_SUBMIT_LIMIT = 100;

/** 외부 호출 타임아웃 — 색인 요청이 발행 응답을 지연시키면 안 된다. */
export const INDEXNOW_TIMEOUT_MS = 4_000;

/**
 * 키 형식: 8~128자, 소문자·대문자·숫자·하이픈.
 * (documentation 은 "hexadecimal" 이라고도 쓰지만 FAQ 가 이 문자집합으로 확정한다.
 *  32자 소문자 hex 를 쓰면 두 서술을 모두 만족한다 — 권장 발급 형태.)
 */
export const INDEXNOW_KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;

export function isValidIndexNowKey(value: unknown): value is string {
  return typeof value === 'string' && INDEXNOW_KEY_RE.test(value);
}

/** 호스트 루트의 키 파일 절대 URL (keyLocation 값). */
export function indexNowKeyLocation(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

/** IndexNow POST 본문 (스펙 필드명 고정 — 변경 금지). */
export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface BuildPayloadInput {
  /** 제출 대상 호스트 — 예: myclinic.hospitalblog.kr */
  host: string;
  /** INDEXNOW_KEY 환경변수 값 (미설정/형식 오류면 null 반환) */
  key: string | null | undefined;
  /** 제출할 절대 URL 목록 */
  urls: ReadonlyArray<string>;
  /** 상한 (기본 INDEXNOW_SUBMIT_LIMIT) */
  limit?: number;
}

/**
 * URL 이 해당 호스트에 속하는 https URL 인지 판정한다.
 * 스펙상 호스트가 다른 URL 을 섞으면 422 로 전체 요청이 거절된다.
 */
export function belongsToHost(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 제출 페이로드를 만든다. 아래 경우 null (= 조용히 건너뛰기):
 *  - 키 미설정/형식 오류 (배포가 깨지면 안 되므로 예외를 던지지 않는다)
 *  - 호스트가 비어 있음
 *  - 유효한 URL 이 하나도 없음
 * 중복 URL 은 제거하고 입력 순서를 유지하며 limit 개까지만 담는다.
 */
export function buildIndexNowPayload(input: BuildPayloadInput): IndexNowPayload | null {
  const host = (input.host ?? '').trim().toLowerCase();
  if (host === '') return null;
  if (!isValidIndexNowKey(input.key)) return null;

  const rawLimit = input.limit ?? INDEXNOW_SUBMIT_LIMIT;
  const limit = Math.max(1, Math.min(rawLimit, INDEXNOW_PROTOCOL_MAX_URLS));

  const seen = new Set<string>();
  const urlList = input.urls.reduce<string[]>((acc, url) => {
    if (acc.length >= limit) return acc;
    if (typeof url !== 'string') return acc;
    if (!belongsToHost(url, host)) return acc;
    if (seen.has(url)) return acc;
    seen.add(url);
    return [...acc, url];
  }, []);

  if (urlList.length === 0) return null;

  return {
    host,
    key: input.key,
    keyLocation: indexNowKeyLocation(host, input.key),
    urlList,
  };
}

/**
 * 응답 상태코드가 "정상 접수"인지 판정한다.
 *  200 = 접수, 202 = 접수(키 검증 대기 — 최초 제출 시 정상 응답).
 */
export function isIndexNowAccepted(status: number): boolean {
  return status === 200 || status === 202;
}

/** 실패 상태코드를 로그용 사유 문자열로 (스펙 표 기준). */
export function describeIndexNowStatus(status: number): string {
  switch (status) {
    case 200: return 'OK';
    case 202: return 'Accepted (key validation pending)';
    case 400: return 'Bad request (invalid format)';
    case 403: return 'Forbidden (key file not found or key mismatch)';
    case 422: return 'Unprocessable (URL does not belong to host)';
    case 429: return 'Too many requests';
    default: return `Unexpected status ${status}`;
  }
}

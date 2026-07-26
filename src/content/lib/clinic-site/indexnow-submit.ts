/**
 * IndexNow 제출 (서버 전용 · 그레이스풀).
 *
 * 호출 규약:
 *  - 절대 throw 하지 않는다. 색인 요청이 실패해도 발행 자체는 성공해야 한다.
 *  - INDEXNOW_KEY 가 없으면 조용히 건너뛴다(배포가 깨지지 않게).
 *  - 외부 호출은 타임아웃(fetch-timeout 재사용)으로 감싼다.
 *
 * 스펙 근거·키 파일 구조는 ./indexnow.ts 상단 주석 참조.
 */

import { fetchStatusWithTimeout } from '@/content/lib/fetch-timeout';
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_TIMEOUT_MS,
  buildIndexNowPayload,
  describeIndexNowStatus,
  isIndexNowAccepted,
} from './indexnow';

export type IndexNowOutcome =
  /** 키 미설정·유효 URL 없음 등으로 요청을 보내지 않음 */
  | { status: 'skipped'; reason: string }
  | { status: 'accepted'; submitted: number; httpStatus: number }
  | { status: 'failed'; reason: string };

interface SubmitOptions {
  /** 테스트 주입용 (기본 globalThis.fetch) */
  fetchImpl?: typeof fetch;
  /** 테스트 주입용 (기본 process.env.INDEXNOW_KEY) */
  key?: string | null;
  timeoutMs?: number;
}

/**
 * 한 호스트({slug}.hospitalblog.kr)의 변경된 URL 을 IndexNow 에 알린다.
 * 호스트가 다른 URL 은 payload 단계에서 걸러진다(422 방지).
 */
export async function submitUrlsToIndexNow(
  host: string,
  urls: ReadonlyArray<string>,
  options: SubmitOptions = {},
): Promise<IndexNowOutcome> {
  const key = options.key !== undefined ? options.key : (process.env.INDEXNOW_KEY ?? null);

  const payload = buildIndexNowPayload({ host, key, urls });
  if (!payload) {
    return { status: 'skipped', reason: 'INDEXNOW_KEY 미설정 또는 제출할 유효 URL 없음' };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { status: 'skipped', reason: 'fetch 사용 불가' };
  }

  const result = await fetchStatusWithTimeout(
    fetchImpl,
    INDEXNOW_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    },
    options.timeoutMs ?? INDEXNOW_TIMEOUT_MS,
  );

  if (result.status === null) {
    return { status: 'failed', reason: '네트워크 오류 또는 타임아웃' };
  }
  if (!isIndexNowAccepted(result.status)) {
    return { status: 'failed', reason: describeIndexNowStatus(result.status) };
  }
  return { status: 'accepted', submitted: payload.urlList.length, httpStatus: result.status };
}

/**
 * 발행/발행취소 후 호출하는 fire-and-forget 래퍼.
 * 어떤 예외도 호출부로 전파하지 않는다(발행 트랜잭션과 완전 분리).
 */
export async function notifyIndexNow(
  host: string,
  urls: ReadonlyArray<string>,
  options: SubmitOptions = {},
): Promise<IndexNowOutcome> {
  try {
    return await submitUrlsToIndexNow(host, urls, options);
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'IndexNow 제출 중 알 수 없는 오류',
    };
  }
}

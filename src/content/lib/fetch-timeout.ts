/**
 * 외부 API 공통 타임아웃 fetch.
 *
 * AbortController 로 요청을 중단해 응답 없는 외부 연결이 라우트 실행
 * 한도(예: 30초)를 잠식하는 것을 막는다. 타임아웃은 헤더 수신뿐 아니라
 * JSON body 파싱까지 함께 덮는다 — 서버가 헤더만 보내고 body 를 멈추면
 * res.json() 이 무기한 대기하는 문제 방지.
 *
 * naver-blog-fetch.ts·clinic-profile.ts 의 기존 패턴을 키워드
 * 파이프라인(golden/volume/seasonal)에서 재사용하기 위한 공용 헬퍼.
 * 그레이스풀: 타임아웃·네트워크 오류·non-ok·파싱 실패 전부 { ok:false }.
 */

export const EXTERNAL_FETCH_TIMEOUT_MS = 5_000;

export type TimedJsonResult = { ok: true; data: unknown } | { ok: false };

export async function fetchJsonWithTimeout(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = EXTERNAL_FETCH_TIMEOUT_MS
): Promise<TimedJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(input, { ...init, signal: controller.signal });
    if (!res.ok) return { ok: false };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

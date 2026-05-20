/**
 * Vercel·Next.js가 서버 오류 시 HTML 에러 페이지(예: "An error occurred with
 * your deployment", 504 Gateway Timeout 등)를 반환하면 클라이언트의 `res.json()`
 * 호출이 `Unexpected token 'A', "An error o"... is not valid JSON` 같은 파싱
 * 예외를 던진다.
 *
 * 이 헬퍼는 응답의 Content-Type을 확인해서:
 * - JSON 이면 안전하게 파싱한 객체를 반환
 * - JSON 이 아니면 raw 텍스트의 첫 200자를 서버 로그용으로 보존하면서
 *   사용자에게는 status 기반의 한국어 메시지를 반환한다.
 *
 * 클라이언트는 항상 `{ ok, data, error }` 형태의 결과를 받으므로 JSON.parse
 * 예외가 컴포넌트로 전파되지 않는다.
 */

export interface SafeJsonSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface SafeJsonFailure {
  ok: false;
  status: number;
  error: string;
}

export type SafeJsonResult<T> = SafeJsonSuccess<T> | SafeJsonFailure;

function statusToKoreanMessage(status: number): string {
  if (status === 504 || status === 502 || status === 503) {
    return `서버 응답이 지연되어 요청이 종료되었습니다. 잠시 후 다시 시도해주세요. (status: ${status})`;
  }
  if (status === 413) {
    return '요청 데이터가 너무 큽니다. 입력을 줄여 다시 시도해주세요.';
  }
  if (status === 429) {
    return '요청이 일시적으로 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요.';
  }
  if (status >= 500) {
    return `서버에서 비정상 응답을 받았습니다. 잠시 후 다시 시도해주세요. (status: ${status})`;
  }
  if (status === 401 || status === 403) {
    return '인증 정보가 만료되었거나 권한이 없습니다. 다시 로그인해주세요.';
  }
  if (status === 404) {
    return '요청한 기능을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.';
  }
  return `요청을 처리하지 못했습니다. (status: ${status})`;
}

/**
 * `res.json()` 을 직접 호출하지 않고, content-type 가드를 거쳐 안전하게
 * JSON 을 파싱한다. 비-JSON 응답이거나 파싱이 실패하면 한국어 fallback
 * 메시지를 돌려준다.
 *
 * 사용 예:
 * ```ts
 * const result = await safeFetchJson<{ images: GeneratedImage[] }>(
 *   '/api/generate-images',
 *   { method: 'POST', body: JSON.stringify(payload) }
 * );
 * if (!result.ok) {
 *   setError(result.error);
 *   return;
 * }
 * setImages(result.data.images);
 * ```
 */
export async function safeFetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<SafeJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 네트워크 오류';
    return {
      ok: false,
      status: 0,
      error: `네트워크 연결에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요. (${message})`,
    };
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (!isJson) {
    // 비-JSON 응답은 텍스트로 읽어 서버 로그에만 남기고, 사용자에게는 한국어
    // 메시지를 노출한다. (Vercel HTML 에러 페이지, plain text 504 등)
    let bodySnippet = '';
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, 200);
    } catch {
      bodySnippet = '(본문 읽기 실패)';
    }
    if (typeof window !== 'undefined') {
      // 브라우저 콘솔에 원본 일부를 남겨 운영자 디버깅이 가능하게 한다.
      console.error('[safeFetchJson] non-JSON response', {
        url: typeof input === 'string' ? input : String(input),
        status: res.status,
        contentType,
        bodySnippet,
      });
    }
    return {
      ok: false,
      status: res.status,
      error: statusToKoreanMessage(res.status),
    };
  }

  // JSON content-type 이지만 본문이 비어있거나 깨졌을 수도 있으므로 try/catch.
  let data: unknown = null;
  try {
    data = await res.json();
  } catch (err) {
    if (typeof window !== 'undefined') {
      console.error('[safeFetchJson] JSON parse failed', {
        url: typeof input === 'string' ? input : String(input),
        status: res.status,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      ok: false,
      status: res.status,
      error: statusToKoreanMessage(res.status),
    };
  }

  if (!res.ok) {
    const errMessage =
      (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>) &&
        typeof (data as { error?: unknown }).error === 'string')
        ? (data as { error: string }).error
        : statusToKoreanMessage(res.status);
    // 결제·플랜 차단 같은 메타 필드를 컴포넌트에서 활용할 수 있도록
    // failure 객체에 원본 payload 도 보존한다.
    return {
      ok: false,
      status: res.status,
      error: errMessage,
      ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : {}),
    } as SafeJsonFailure;
  }

  return {
    ok: true,
    status: res.status,
    data: data as T,
  };
}

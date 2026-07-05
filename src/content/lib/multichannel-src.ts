// 멀티채널 변환 소스(sessionStorage dp_multichannel_src) 인코딩/디코딩 — 순수 함수.
//
// 배경: 기존 포맷은 "제목\n\n본문" 평문뿐이라 변환 이력(clinicflix_conversions)에
// 원본 글(saved_posts.id)을 연결할 수 없었다. postId 를 함께 실어 나르는 v2 JSON
// 포맷을 추가하되, 평문(구 포맷)도 그대로 읽히는 하위 호환을 유지한다.
//
// 포맷:
//  - postId 없음 → 평문 그대로 저장 (구 포맷과 동일 — 기존 탭/세션과 호환)
//  - postId 있음 → {"dp":"mc-src","v":2,"postId":"...","text":"..."}
//
// 이 파일은 DB/브라우저 의존이 없어야 한다 (단위 테스트 대상).

/** sessionStorage 키 — 작성 화면·추천 카드·멀티채널 페이지가 공유 */
export const MULTICHANNEL_SRC_KEY = 'dp_multichannel_src';

/** v2 JSON 포맷 식별 마커 (붙여넣은 본문이 우연히 '{'로 시작해도 오인하지 않도록) */
const FORMAT_MARKER = 'mc-src';

export interface MultichannelSrc {
  /** 변환 소스 본문 (제목\n\n본문 또는 붙여넣기 원문) */
  text: string;
  /** 원본 saved_posts.id — 블로그 글 진입일 때만. null = 키워드/붙여넣기/구 포맷 */
  postId: string | null;
}

/**
 * 소스 → 저장 문자열. postId 가 없으면 평문(구 포맷)을 그대로 반환해
 * 기존 소비자(구 버전 페이지)와의 하위 호환을 유지한다.
 */
export function encodeMultichannelSrc(src: MultichannelSrc): string {
  const postId = src.postId?.trim() ?? '';
  if (!postId) return src.text;
  return JSON.stringify({ dp: FORMAT_MARKER, v: 2, postId, text: src.text });
}

/**
 * 저장 문자열 → 소스. v2 JSON 이 아니면 평문(구 포맷)으로 간주한다.
 * null/빈 문자열은 { text: '', postId: null } — 호출부가 빈 소스로 처리.
 */
export function decodeMultichannelSrc(raw: string | null | undefined): MultichannelSrc {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { text: '', postId: null };
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).dp === FORMAT_MARKER &&
        typeof (parsed as Record<string, unknown>).text === 'string'
      ) {
        const obj = parsed as Record<string, unknown>;
        const text = (obj.text as string).trim();
        const postId =
          typeof obj.postId === 'string' && obj.postId.trim() ? obj.postId.trim() : null;
        return { text, postId };
      }
    } catch {
      // JSON 아님 — 우연히 '{'로 시작하는 붙여넣기 본문 → 평문으로 처리
    }
  }
  return { text: trimmed, postId: null };
}

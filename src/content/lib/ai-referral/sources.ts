/**
 * AI 유입 출처 목록 — **데이터 정의 단일 파일** (순수 데이터, 외부 의존 없음).
 *
 * 새 AI 서비스가 생기면 이 파일의 AI_REFERRAL_SOURCES 배열에만 항목을 추가하면 된다.
 * 판정 로직(detect.ts)·저장(RPC)·화면(마이페이지)은 이 목록을 그대로 따른다.
 *
 * ⚠️ 범위 제한 (의도적):
 *   - **AI 서비스 유입만** 잡는다. 검색엔진(google.com·naver.com·bing.com)과
 *     소셜(x.com·facebook.com)은 절대 넣지 않는다 — 이 기능의 목적은
 *     "AI 인용이 실제 방문으로 이어졌는가" 하나뿐이다.
 *   - 구글 AI Overviews / AI Mode 는 google.com 리퍼러로 오므로 구분이 불가능하다.
 *     일반 검색 유입과 섞이면 지표가 오염되므로 **넣지 않는다**(GA4도 동일하게 제외).
 *
 * ⚠️ 개인정보: 이 파일은 출처 분류만 정의한다. 방문자 식별 정보(IP·UA·쿠키)는
 *    어디에서도 다루지 않는다 (저장 스키마는 마이그 048 주석 참조).
 */

/** 저장·집계에 쓰는 출처 식별자 (DB source 컬럼 값 — 변경 금지). */
export type AiReferralSourceId =
  | 'chatgpt'
  | 'perplexity'
  | 'copilot'
  | 'gemini'
  | 'claude'
  | 'grok'
  | 'deepseek'
  | 'meta_ai'
  | 'mistral'
  | 'wrtn';

export interface AiReferralSource {
  /** DB 에 저장되는 소문자 토큰. 한 번 정하면 바꾸지 않는다(과거 집계와 연속성). */
  readonly id: AiReferralSourceId;
  /** 마이페이지 표시명. */
  readonly label: string;
  /**
   * Referer 헤더 호스트 매칭 대상. 정확히 일치하거나 서브도메인이면 매칭
   * (`endsWith('.' + host)`). 광범위한 상위 도메인은 넣지 않는다.
   */
  readonly hosts: readonly string[];
  /** `utm_source` 쿼리 값 매칭 대상 (소문자 비교). 없으면 빈 배열. */
  readonly utmSources: readonly string[];
  /** 판정 근거 — 왜 이 호스트/utm 값을 신뢰하는가. */
  readonly note: string;
}

export const AI_REFERRAL_SOURCES: readonly AiReferralSource[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    utmSources: ['chatgpt.com', 'chatgpt'],
    note:
      'OpenAI 가 ChatGPT 답변·검색 결과의 외부 링크에 utm_source=chatgpt.com 을 자동 부착한다 '
      + '(2025-06 부터 "더 보기" 출처 링크에도 확대 적용). 리퍼러가 제거된 경우에도 utm 으로 잡힌다. '
      + 'chat.openai.com 은 구 도메인(현 chatgpt.com 으로 리다이렉트)이라 함께 둔다.',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    hosts: ['perplexity.ai'],
    utmSources: ['perplexity'],
    note:
      'Perplexity 는 출처를 번호 링크로 노출하고 Referer 를 비교적 일관되게 전달한다(perplexity.ai). '
      + '자동 utm 부착은 하지 않으므로 utm_source=perplexity 는 관례값 보조 매칭일 뿐이다. '
      + 'www.perplexity.ai 등 서브도메인은 서브도메인 규칙으로 함께 잡힌다.',
  },
  {
    id: 'copilot',
    label: 'Microsoft Copilot',
    hosts: ['copilot.microsoft.com'],
    utmSources: [],
    note:
      'Microsoft Copilot 전용 호스트. GA4 가 AI Assistant 채널로 인식하는 출처 중 하나. '
      + 'bing.com 은 일반 검색엔진이므로 절대 포함하지 않는다.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    hosts: ['gemini.google.com', 'bard.google.com'],
    utmSources: [],
    note:
      'Gemini 앱 전용 호스트만 매칭한다. google.com 전체는 일반 검색·AI Overviews 가 섞여 '
      + '구분 불가하므로 제외. bard.google.com 은 구 도메인.',
  },
  {
    id: 'claude',
    label: 'Claude',
    hosts: ['claude.ai'],
    utmSources: [],
    note: 'Anthropic Claude 웹앱 전용 호스트. 자동 utm 부착은 확인되지 않아 리퍼러로만 판정.',
  },
  {
    id: 'grok',
    label: 'Grok',
    hosts: ['grok.com'],
    utmSources: [],
    note:
      'xAI Grok 독립 웹앱 호스트. x.com(소셜)은 AI 유입과 일반 소셜 유입을 구분할 수 없어 제외한다.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    utmSources: [],
    note: 'DeepSeek 채팅 전용 호스트. 마케팅 도메인(deepseek.com 루트)은 제외해 오탐을 줄인다.',
  },
  {
    id: 'meta_ai',
    label: 'Meta AI',
    hosts: ['meta.ai'],
    utmSources: [],
    note: 'Meta AI 독립 웹앱 호스트. facebook.com·instagram.com(소셜)은 제외.',
  },
  {
    id: 'mistral',
    label: 'Mistral Le Chat',
    hosts: ['chat.mistral.ai'],
    utmSources: [],
    note: 'Mistral Le Chat 채팅 전용 호스트.',
  },
  {
    id: 'wrtn',
    label: '뤼튼',
    hosts: ['wrtn.ai'],
    utmSources: [],
    note:
      '국내 AI 챗 서비스(뤼튼). 국내 환자 유입 채널이라 포함한다. '
      + '네이버 클로바X·큐:는 2026-04 서비스 종료되어 넣지 않는다.',
  },
];

/** 유효 출처 id 목록 (화이트리스트 — 이 외 값은 저장하지 않는다). */
export const AI_REFERRAL_SOURCE_IDS: readonly AiReferralSourceId[] =
  AI_REFERRAL_SOURCES.map((s) => s.id);

/** 값이 알려진 출처 id 인지 (타입 가드) — 라우트에서 클라이언트 입력 검증에 쓴다. */
export function isAiReferralSourceId(value: unknown): value is AiReferralSourceId {
  return (
    typeof value === 'string'
    && (AI_REFERRAL_SOURCE_IDS as readonly string[]).includes(value)
  );
}

/**
 * 출처 id → 표시명. 목록에서 제거된 과거 출처(=과거 집계에만 남은 값)도
 * 화면이 깨지지 않도록 id 를 그대로 돌려준다.
 */
export function aiReferralSourceLabel(id: string): string {
  const found = AI_REFERRAL_SOURCES.find((s) => s.id === id);
  return found ? found.label : id;
}

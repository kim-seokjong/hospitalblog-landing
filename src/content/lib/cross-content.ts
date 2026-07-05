// 블로그 ↔ 영상 크로스 콘텐츠 추천 — 순수 규칙 기반 로직 (LLM 호출 없음, 비용 0).
//
// 목적: 번들(블로그 + 클리닉픽스 영상) 보유 SaaS만 가능한 선순환 루프.
//  - 블로그 → 영상: 성과 좋은(상위 노출) 글 / 최근 발행 글을 영상화 추천
//  - 영상 → 블로그: 영상으로 다룬 주제의 후속 블로그 각도 추천
//
// 주제 연결의 한계: clinicflix_conversions 에는 원문 글 연결 컬럼이 없다.
// 저장된 결과물 텍스트(result_assets.threads/feed)와 글 키워드·제목의
// 토큰 겹침으로 판정하며, 확신이 높을 때만 "이미 영상화됨"으로 본다(보수적 판정).
//
// 이 파일은 DB/네트워크 의존이 없어야 한다 (단위 테스트 대상).

/** 발행 글 입력 (API 라우트가 saved_posts + post_rankings 를 합쳐 전달) */
export interface CrossPostInput {
  id: string;
  title: string;
  keyword: string | null;
  /** published_at ?? created_at (없으면 null → 최근성 판정 제외) */
  publishedAt: string | null;
  /** 최신 추정 순위 (추적 없으면 null) */
  latestRank: number | null;
}

/** 영상(멀티채널) 변환 이력 입력 */
export interface CrossConversionInput {
  conversionId: string;
  createdAt: string;
  /** result_assets 에서 추출한 텍스트 조각들 (없으면 빈 배열 → 주제 판정 불가) */
  texts: string[];
}

/** 블로그 → 영상 추천 1건 */
export interface ToVideoRecommendation {
  postId: string;
  title: string;
  keyword: string | null;
  latestRank: number | null;
  reason: string;
}

/** 영상 → 블로그(후속 글) 추천 1건 */
export interface ToBlogRecommendation {
  conversionId: string;
  /** 영상이 다룬 주제 (원문 글의 키워드 또는 제목) */
  topic: string;
  /** 글 생성 키워드 입력란에 프리필할 값 */
  suggestedKeyword: string;
  reason: string;
}

export const TOP_RANK_THRESHOLD = 15;
export const RECENT_DAYS = 30;
export const MAX_TO_VIDEO = 3;
export const MAX_TO_BLOG = 2;

// ── 토큰화 ──────────────────────────────────────────────────────────

/** 블로그 제목에 흔한 일반어 — 주제 판별력이 없어 토큰에서 제외 */
const STOPWORDS = new Set([
  '그리고', '하지만', '있는', '없는', '있나요', '위한', '대한', '대해', '까지', '부터',
  '알아보기', '알아보세요', '알아야', '한다면', '하는', '해야', '좋은', '좋을까',
  '총정리', '정리', '안내', '가이드', '방법', '이유', '궁금증', '궁금하다면',
  '무엇', '어떻게', '언제', '얼마나', '추천', '후기', '필독',
  '병원', '의원', '클리닉',
]);

/**
 * 한국어 친화 토큰 추출: 한글·영문·숫자 연속열만 취하고,
 * 2자 미만·일반어(STOPWORDS)를 제외해 소문자 Set 으로 반환한다.
 */
export function tokenize(text: unknown): Set<string> {
  if (typeof text !== 'string') return new Set();
  const matches = text.toLowerCase().match(/[0-9a-z가-힣]+/g) ?? [];
  const tokens = matches.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** 여러 텍스트 조각을 하나의 토큰 Set 으로 합친다 */
export function tokenizeAll(texts: readonly unknown[]): Set<string> {
  const merged = new Set<string>();
  for (const t of texts) {
    for (const token of tokenize(t)) merged.add(token);
  }
  return merged;
}

// ── result_assets → 텍스트 추출 ────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * clinicflix_conversions.result_assets(jsonb) 에서 주제 판정에 쓸 텍스트를 추출한다.
 * 쓰레드 posts / 해시태그, 피드 caption / 해시태그를 모은다. 형태가 다르면 빈 배열.
 */
export function extractConversionTexts(resultAssets: unknown): string[] {
  const root = asRecord(resultAssets);
  const threads = asRecord(root.threads);
  const feed = asRecord(root.feed);
  const texts = [
    ...asStringArray(threads.posts),
    ...asStringArray(threads.hashtags),
    ...(typeof feed.caption === 'string' ? [feed.caption] : []),
    ...asStringArray(feed.hashtags),
  ];
  return texts.map((t) => t.trim()).filter((t) => t.length > 0);
}

// ── 중복(이미 영상화) 판정 — 보수적 ─────────────────────────────────

const TITLE_MIN_OVERLAP = 2;
const TITLE_MIN_RATIO = 0.5;

/**
 * 글이 해당 변환(영상)에서 이미 다뤄졌는지 판정한다. 보수적 기준:
 *  (a) 키워드 토큰이 있고 그 전부가 변환 텍스트에 등장 — 또는
 *  (b) 제목 토큰과 변환 텍스트의 겹침이 2개 이상이면서 제목 토큰의 50% 이상
 * 변환 텍스트가 없으면(결과 미저장) 판정 불가 → 중복 아님으로 본다.
 */
export function isPostCoveredByConversion(
  post: Pick<CrossPostInput, 'title' | 'keyword'>,
  conversionTokens: ReadonlySet<string>,
): boolean {
  if (conversionTokens.size === 0) return false;

  const keywordTokens = tokenize(post.keyword ?? '');
  if (keywordTokens.size > 0) {
    let all = true;
    for (const t of keywordTokens) {
      if (!conversionTokens.has(t)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }

  const titleTokens = tokenize(post.title);
  if (titleTokens.size === 0) return false;
  let overlap = 0;
  for (const t of titleTokens) {
    if (conversionTokens.has(t)) overlap += 1;
  }
  return overlap >= TITLE_MIN_OVERLAP && overlap / titleTokens.size >= TITLE_MIN_RATIO;
}

// ── 블로그 → 영상 추천 ─────────────────────────────────────────────

function isRecent(publishedAt: string | null, now: Date, days: number): boolean {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

function isTopRanked(rank: number | null): boolean {
  return rank !== null && rank >= 1 && rank <= TOP_RANK_THRESHOLD;
}

function toVideoReason(post: CrossPostInput): string {
  const label = (post.keyword ?? '').trim() || post.title;
  if (isTopRanked(post.latestRank)) {
    return `'${label}' 글이 검색 ${post.latestRank}위에 노출되고 있어요 — 영상으로 확장하면 검색 밖 인식 채널까지 커버할 수 있어요.`;
  }
  return `최근 발행한 '${label}' 주제 — 영상으로도 만들어 두면 블로그(검색)와 영상(인식) 두 채널을 함께 가져갈 수 있어요.`;
}

/**
 * 영상화 추천 상위 3개.
 *  - 후보: (a) 검색 15위 이내 또는 (b) 최근 30일 내 발행
 *  - 이미 영상화된 주제(변환 텍스트와 토큰 겹침)는 제외
 *  - 정렬: 순위 보유 글 우선(순위 오름차순) → 나머지는 발행일 내림차순
 */
export function recommendBlogToVideo(
  posts: readonly CrossPostInput[],
  conversions: readonly CrossConversionInput[],
  now: Date = new Date(),
): ToVideoRecommendation[] {
  const conversionTokenSets = conversions
    .map((c) => tokenizeAll(c.texts))
    .filter((s) => s.size > 0);

  const candidates = posts.filter((p) => {
    if (!p.title.trim()) return false;
    if (!isTopRanked(p.latestRank) && !isRecent(p.publishedAt, now, RECENT_DAYS)) return false;
    return !conversionTokenSets.some((tokens) => isPostCoveredByConversion(p, tokens));
  });

  const sorted = [...candidates].sort((a, b) => {
    const aRanked = isTopRanked(a.latestRank);
    const bRanked = isTopRanked(b.latestRank);
    if (aRanked && bRanked) return (a.latestRank ?? 0) - (b.latestRank ?? 0);
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  return sorted.slice(0, MAX_TO_VIDEO).map((p) => ({
    postId: p.id,
    title: p.title,
    keyword: p.keyword,
    latestRank: isTopRanked(p.latestRank) ? p.latestRank : null,
    reason: toVideoReason(p),
  }));
}

// ── 영상 → 블로그(후속 글) 추천 ────────────────────────────────────

/** 후속 글 각도 템플릿 — 효과 단정 없는 정보성 각도만 (의료광고법 안전) */
const FOLLOW_UP_ANGLES = ['자주 묻는 질문', '오해와 사실', '관리 방법'] as const;

/** 제안 키워드가 기존 글에서 이미 다뤄졌는지 (토큰 전부 포함 시 커버로 판정) */
function isAngleCoveredByPosts(
  suggestedKeyword: string,
  postTokenSets: readonly ReadonlySet<string>[],
): boolean {
  const tokens = tokenize(suggestedKeyword);
  if (tokens.size === 0) return true;
  return postTokenSets.some((postTokens) => {
    for (const t of tokens) {
      if (!postTokens.has(t)) return false;
    }
    return true;
  });
}

/**
 * 후속 블로그 추천 상위 2개.
 *  - 최근 변환(텍스트 보유) 중 기존 발행 글과 매칭되는 주제를 찾고
 *    (변환 테이블에 원문 연결 컬럼이 없어 토큰 매칭으로 역추적),
 *  - 주제별로 아직 다루지 않은 후속 각도(자주 묻는 질문 등)를 제안한다.
 *  - 같은 주제는 1회만, 이미 후속 글이 있는 각도는 건너뛴다.
 */
export function recommendVideoToBlog(
  conversions: readonly CrossConversionInput[],
  posts: readonly CrossPostInput[],
): ToBlogRecommendation[] {
  // 각도 중복 검사용 — 제목+키워드 토큰 (STOPWORDS 제외 전 원본 각도 단어 포함 위해 raw 토큰도 병합)
  const postTokenSets = posts.map((p) => {
    const merged = new Set<string>();
    const raw = `${p.title} ${p.keyword ?? ''}`.toLowerCase().match(/[0-9a-z가-힣]+/g) ?? [];
    for (const t of raw) {
      if (t.length >= 2) merged.add(t);
    }
    return merged;
  });

  const recent = [...conversions]
    .filter((c) => c.texts.length > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const seenTopics = new Set<string>();
  const results: ToBlogRecommendation[] = [];

  for (const conversion of recent) {
    if (results.length >= MAX_TO_BLOG) break;

    const conversionTokens = tokenizeAll(conversion.texts);
    const matched = posts.find((p) => isPostCoveredByConversion(p, conversionTokens));
    if (!matched) continue; // 원문을 못 찾으면 주제를 특정할 수 없어 건너뜀 (보수적)

    const topic = (matched.keyword ?? '').trim() || matched.title.trim();
    if (!topic) continue;
    const topicKey = [...tokenize(topic)].sort().join('|') || topic.toLowerCase();
    if (seenTopics.has(topicKey)) continue;
    seenTopics.add(topicKey);

    const angle = FOLLOW_UP_ANGLES.find(
      (a) => !isAngleCoveredByPosts(`${topic} ${a}`, postTokenSets),
    );
    if (!angle) continue; // 모든 각도를 이미 다뤘으면 추천 생략

    results.push({
      conversionId: conversion.conversionId,
      topic,
      suggestedKeyword: `${topic} ${angle}`,
      reason: `'${topic}' 주제를 영상으로 다뤘어요 — '${angle}' 각도의 후속 글을 쓰면 영상(인식)에서 검색 유입까지 이어갈 수 있어요.`,
    });
  }

  return results;
}

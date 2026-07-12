/**
 * 병원 서브도메인 블로그 — 주제 기반 관련 글 랭킹 (순수 로직 모듈, topical authority).
 *
 * 배경: 기존 "이 병원의 다른 글"은 최신 3편을 그대로 노출했다. 같은 진료과/주제의
 * 글을 서로 연결하면(내부 링크) 검색·AI 가 주제 권위(topical authority)를 더 강하게
 * 인식한다. 이 모듈은 현재 글과 태그/키워드가 많이 겹치는 순으로 후보를 정렬하고,
 * 겹침이 부족하면 최신 글로 채워 최대 N편을 돌려준다.
 *
 * 랭킹 재료(saved_posts):
 *  - tags(text[])  예: ["#보톡스", "#주름"]  — '#' 는 토큰화 과정에서 자연 제거
 *  - keyword(text) 예: "보톡스 시술 주기"
 *  - title         보조 신호(현재 글 태그/키워드가 없을 때 폴백)
 *
 * 토큰화는 cross-content 의 tokenize/tokenizeAll(한국어 친화·일반어 제외)을 재사용해
 * 규칙을 일원화한다. DB/네트워크 의존이 없어 node:test 로 직접 검증 가능.
 */

import { tokenize, tokenizeAll } from '../cross-content.ts';

export interface RelatedPostCandidate {
  id: string;
  title: string;
  /** 발행 시각(ISO) 또는 null — 최신순 보충·동점 처리용 */
  publishedAt: string | null;
  /** saved_posts.tags — 없으면 빈 배열 */
  tags: readonly string[];
  /** saved_posts.keyword — 없으면 null */
  keyword: string | null;
}

/** 관련 글 노출 상한(3~4편). */
export const RELATED_POSTS_LIMIT = 4;

/** 현재 글의 주제 토큰 — 태그+키워드 우선, 둘 다 없으면 제목으로 폴백. */
function currentTopicTokens(post: Pick<RelatedPostCandidate, 'tags' | 'keyword' | 'title'>): Set<string> {
  const topic = tokenizeAll([...(post.tags ?? []), post.keyword ?? '']);
  return topic.size > 0 ? topic : tokenize(post.title);
}

/** 후보 글의 매칭 대상 토큰 — 태그+키워드+제목 전체. */
function candidateTokens(post: Pick<RelatedPostCandidate, 'tags' | 'keyword' | 'title'>): Set<string> {
  return tokenizeAll([...(post.tags ?? []), post.keyword ?? '', post.title]);
}

function toTime(publishedAt: string | null): number {
  if (!publishedAt) return 0;
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * 현재 글과 주제가 가까운 관련 글을 랭킹한다.
 *  - 현재 글은 제외(id 기준).
 *  - 정렬: (1) 주제 토큰 겹침 수 내림차순 → (2) 발행일 내림차순.
 *    겹침이 0인 후보도 뒤쪽에 남아, 상한에 못 미치면 최신순으로 자연 보충된다.
 *  - 최대 limit 편 반환.
 */
export function rankRelatedPosts(
  current: Pick<RelatedPostCandidate, 'id' | 'title' | 'tags' | 'keyword'>,
  candidates: readonly RelatedPostCandidate[],
  limit: number = RELATED_POSTS_LIMIT,
): RelatedPostCandidate[] {
  const topic = currentTopicTokens(current);

  const scored = candidates
    .filter((c) => c.id !== current.id && c.title.trim().length > 0)
    .map((c) => {
      const tokens = candidateTokens(c);
      let overlap = 0;
      for (const t of topic) {
        if (tokens.has(t)) overlap += 1;
      }
      return { post: c, overlap, time: toTime(c.publishedAt) };
    });

  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return b.time - a.time;
  });

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RELATED_POSTS_LIMIT;
  return scored.slice(0, safeLimit).map((s) => s.post);
}

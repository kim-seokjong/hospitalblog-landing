/**
 * 성과-DNA — 이 병원에서 "실제로 상위노출된 글"의 패턴을 다음 생성 프롬프트에 역주입.
 *
 * 데이터 소스 (모두 기존 테이블, 신규 마이그레이션 불필요):
 *  - post_rankings: 발행글 검색순위 시계열 (cron이 매일 기록)
 *  - saved_posts:   글 본문/제목/키워드
 *
 * 원리: VOICE-DNA 가 "말투"를 학습하듯, 성과-DNA 는 "이 병원·이 지역에서 통한 구조"를 학습한다.
 * 쓸수록 그 병원에 최적화되는 루프 → 제품 해자.
 *
 * 모든 실패는 빈 문자열 폴백 (생성 플로우 절대 보호).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** 상위노출로 간주하는 순위 상한 (네이버 블로그 검색 관련도 기준 추정 순위) */
const TOP_RANK_THRESHOLD = 10;
/** 프롬프트에 주입할 성공 글 최대 개수 */
const MAX_TOP_POSTS = 5;
/** 최근 N일 내 순위 기록만 사용 (오래된 성과는 알고리즘 변화로 신뢰도 하락) */
const LOOKBACK_DAYS = 60;

interface RankingRow {
  post_id: string | null;
  keyword: string;
  rank: number | null;
  checked_at: string;
}

interface PostRow {
  id: string;
  title: string;
  content: string;
  keyword: string | null;
}

export interface TopPostPattern {
  title: string;
  keyword: string;
  bestRank: number;
  charCount: number;
  headingCount: number;
  hasFaq: boolean;
}

/**
 * 사용자의 상위노출(TOP_RANK_THRESHOLD 이내) 글 패턴을 조회한다.
 * post 별 최고 순위 기준 상위 MAX_TOP_POSTS 개.
 */
export async function fetchTopPostPatterns(
  admin: SupabaseClient,
  userId: string,
): Promise<TopPostPattern[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: rankings, error: rankErr } = await admin
    .from('post_rankings')
    .select('post_id, keyword, rank, checked_at')
    .eq('user_id', userId)
    .not('rank', 'is', null)
    .lte('rank', TOP_RANK_THRESHOLD)
    .gte('checked_at', since)
    .order('rank', { ascending: true })
    .limit(100);

  if (rankErr || !rankings?.length) return [];

  // post 별 최고(숫자 최소) 순위로 집계
  const bestByPost = new Map<string, { keyword: string; bestRank: number }>();
  for (const r of rankings as RankingRow[]) {
    if (!r.post_id || r.rank == null) continue;
    const prev = bestByPost.get(r.post_id);
    if (!prev || r.rank < prev.bestRank) {
      bestByPost.set(r.post_id, { keyword: r.keyword, bestRank: r.rank });
    }
  }
  if (bestByPost.size === 0) return [];

  const topPostIds = [...bestByPost.entries()]
    .sort((a, b) => a[1].bestRank - b[1].bestRank)
    .slice(0, MAX_TOP_POSTS)
    .map(([id]) => id);

  const { data: posts, error: postErr } = await admin
    .from('saved_posts')
    .select('id, title, content, keyword')
    .in('id', topPostIds);

  if (postErr || !posts?.length) return [];

  return (posts as PostRow[])
    .map((p) => {
      const meta = bestByPost.get(p.id);
      if (!meta) return null;
      const content = p.content ?? '';
      return {
        title: p.title,
        keyword: meta.keyword || p.keyword || '',
        bestRank: meta.bestRank,
        charCount: content.replace(/\s/g, '').length,
        headingCount: (content.match(/^#{2,3}\s|\[소제목\]|^【.+】$/gm) || []).length,
        hasFaq: /\[자주 묻는 질문\]/.test(content),
      };
    })
    .filter((p): p is TopPostPattern => p !== null)
    .sort((a, b) => a.bestRank - b.bestRank);
}

/** 패턴 목록 → 프롬프트 주입 블록. 패턴 없으면 빈 문자열. */
export function buildPerformanceDnaBlock(patterns: TopPostPattern[]): string {
  if (patterns.length === 0) return '';

  const lines = patterns
    .map(
      (p) =>
        `- "${p.title}" (키워드: ${p.keyword} · 최고 ${p.bestRank}위 · 약 ${p.charCount.toLocaleString('ko-KR')}자${p.hasFaq ? ' · FAQ 포함' : ''})`,
    )
    .join('\n');

  const avgChars = Math.round(
    patterns.reduce((s, p) => s + p.charCount, 0) / patterns.length,
  );
  const faqRatio = patterns.filter((p) => p.hasFaq).length / patterns.length;

  return `【성과-DNA — 이 병원에서 실제 상위노출된 검증 패턴】
최근 ${LOOKBACK_DAYS}일 내 네이버 검색 상위(${TOP_RANK_THRESHOLD}위 이내)에 오른 이 병원의 글:
${lines}

→ 위 성공 글들의 제목 구성 방식·주제 접근·분량감(평균 약 ${avgChars.toLocaleString('ko-KR')}자)을 참고해 같은 "결"로 작성하세요.${faqRatio >= 0.5 ? ' 이 병원 글은 FAQ 섹션이 성과와 함께 갔으므로 FAQ 품질에 특히 신경 쓰세요.' : ''}
→ ⚠️ 제목·문장을 복제하지 말 것 — 패턴(구조·톤·깊이)만 계승하고 내용은 이번 키워드에 맞게 완전히 새로 쓴다.`;
}

import { createAdminClient } from '@/dev/lib/supabase/server';

/**
 * AI 중복 주제 방지 — 제목 생성 시 해당 유저가 최근 6개월간 이미 발행한
 * 글의 제목·키워드를 조회해 프롬프트에 "중복/유사 각도 회피" 컨텍스트로 제공.
 *
 * 주의:
 * - 기존 글이 0건이면 빈 문자열을 반환해 프롬프트가 단 한 글자도 변하지 않도록 한다.
 * - 조회 실패 시에도 제목 생성 자체는 실패하지 않도록 빈 결과로 폴백한다.
 */

export interface RecentTopic {
  title: string;
  keyword: string | null;
}

const RECENT_MONTHS = 6;
const MAX_TOPICS = 30; // 프롬프트 토큰 폭증 방지 상한

export async function fetchRecentPublishedTopics(userId: string): Promise<RecentTopic[]> {
  try {
    const admin = createAdminClient();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RECENT_MONTHS);

    const { data, error } = await admin
      .from('saved_posts')
      .select('title, keyword')
      .eq('user_id', userId)
      .eq('status', 'published')
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_TOPICS);

    if (error || !data) return [];
    return data as RecentTopic[];
  } catch {
    return [];
  }
}

/**
 * 프롬프트에 추가할 기존 발행 주제 섹션.
 * topics가 비어 있으면 빈 문자열 — 기존 프롬프트 무변화 보장.
 */
export function buildRecentTopicsSection(topics: RecentTopic[]): string {
  if (topics.length === 0) return '';

  const lines = topics
    .map((t) => `- ${t.title}${t.keyword ? ` (키워드: ${t.keyword})` : ''}`)
    .join('\n');

  return `\n【기존 발행 주제 — 중복/유사 각도 회피】\n이 병원이 최근 6개월간 이미 발행한 글 제목 목록:\n${lines}\n→ 위 제목들과 동일하거나 유사한 각도의 제목은 피하세요. 같은 키워드라도 아직 다루지 않은 새로운 관점·검색 의도·세부 주제를 발굴해 제목을 생성하세요.\n`;
}

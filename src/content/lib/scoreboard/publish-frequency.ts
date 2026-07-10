import type { NaverPost } from '@/content/lib/competitor-analysis';

/**
 * 블로그 발행 빈도 프록시.
 *
 * 기존 경쟁 블로그 검색 결과(NaverPost.postdate, 최대 10건)만으로
 * 최근 30일 기준 블로거별 주당 발행 수를 계산한다. 추가 API 호출 없음.
 *
 * 주의: 검색 결과 표본(최대 10건) 기반 프록시라 실제 발행량의 하한 추정이다.
 * UI 에서는 사실 수치만 표시하고 좋음/나쁨 평가 라벨은 붙이지 않는다 (회사 규칙).
 */

export interface BloggerFrequency {
  bloggerName: string;
  postsIn30Days: number;
  perWeek: number; // 소수 1자리 반올림
}

export interface PublishFrequencyResult {
  windowDays: number;
  bloggers: BloggerFrequency[]; // 주당 발행 수 내림차순
  sampleSize: number; // 계산에 쓰인 30일 이내 글 수
}

const WINDOW_DAYS = 30;

/** "YYYYMMDD" postdate → Date (실패 시 null) */
export function parsePostDate(postdate: string): Date | null {
  if (!/^\d{8}$/.test(postdate)) return null;
  const year = Number(postdate.slice(0, 4));
  const month = Number(postdate.slice(4, 6));
  const day = Number(postdate.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 최근 30일 이내 글만 블로거별로 묶어 주당 발행 수를 계산한다.
 * now 주입 가능 (테스트용).
 */
export function computePublishFrequency(
  posts: readonly NaverPost[],
  now: Date = new Date()
): PublishFrequencyResult {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const counts = new Map<string, number>();
  let sampleSize = 0;

  for (const post of posts) {
    const name = post.bloggername.trim();
    if (!name) continue;
    const date = parsePostDate(post.postdate);
    if (!date) continue;
    if (date.getTime() < cutoff || date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    sampleSize += 1;
  }

  const bloggers: BloggerFrequency[] = Array.from(counts.entries())
    .map(([bloggerName, postsIn30Days]) => ({
      bloggerName,
      postsIn30Days,
      perWeek: Math.round((postsIn30Days / WINDOW_DAYS) * 7 * 10) / 10,
    }))
    .sort((a, b) => b.postsIn30Days - a.postsIn30Days);

  return { windowDays: WINDOW_DAYS, bloggers, sampleSize };
}

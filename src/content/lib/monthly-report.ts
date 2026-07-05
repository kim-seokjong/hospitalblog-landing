// 월간 자동 성과 리포트 — 순수 집계 로직 (구독 해지 방어).
// 전부 규칙 기반(LLM 호출 없음). cron 라우트·마이페이지·리포트 페이지가 공유한다.
// 이 파일은 DB/네트워크 의존이 없어야 한다 (단위 테스트 대상).

export const MONTHLY_REPORT_VERSION = 1;

/** KST(UTC+9) 고정 오프셋 — 한국은 DST 없음 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 순위 상승 글 (리포트 노출 상위 5) */
export interface MonthlyImprovedPost {
  postId: string;
  title: string;
  keyword: string;
  /** 월초 순위(해당 월 첫 관측치) */
  fromRank: number;
  /** 월말 순위(해당 월 마지막 관측치) — fromRank보다 작을수록 상승 */
  toRank: number;
}

/** monthly_reports.data 스냅샷 (jsonb) */
export interface MonthlyReportData {
  version: number;
  period: string; // 'YYYY-MM'
  generatedAt: string; // ISO
  posts: {
    /** 지난달 생성(저장)한 글 수 */
    created: number;
    /** 지난달 발행한 글 수 */
    published: number;
  };
  compliance: {
    /** 의료광고법 자동 검사를 통과(수행·증빙 보관)한 글 수 */
    checked: number;
  };
  rankings: {
    /** 지난달 추적 중이던 키워드 수 (중복 제거) */
    trackedKeywords: number;
    /** 지난달 상위 10위 안에 진입했던 글 수 */
    top10Count: number;
    /** 순위 상승 글 상위 5 (상승 폭 큰 순) */
    improved: MonthlyImprovedPost[];
  };
  usage: {
    /** 지난달 AI 글 생성 횟수 */
    generated: number;
    /** 월 한도 (-1 = 무제한, 0 = 플랜 없음) */
    monthlyLimit: number;
    planName: string | null;
  };
  /** 다음 달 추천 액션 1~3개 (규칙 기반) */
  actions: string[];
}

export function isValidPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

/** 지금 시각 기준 "지난달"의 YYYY-MM (KST 기준) */
export function previousPeriodKST(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const prev = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** 해당 월의 [시작, 다음 달 시작) UTC ISO 범위 (KST 월 경계 기준). 형식 오류 시 null. */
export function periodRangeKST(period: string): { startIso: string; endIso: string } | null {
  if (!isValidPeriod(period)) return null;
  const [y, m] = period.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) - KST_OFFSET_MS;
  const end = Date.UTC(y, m, 1) - KST_OFFSET_MS;
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

/** '2026-06' → '2026년 6월' (형식 오류 시 원문 반환) */
export function periodLabel(period: string): string {
  if (!isValidPeriod(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** '2026-06' → 6 (월 숫자). 형식 오류 시 null. */
export function periodMonth(period: string): number | null {
  if (!isValidPeriod(period)) return null;
  return Number(period.split('-')[1]);
}

/** post_rankings 원시 행 (해당 월 범위, checked_at 오름차순 전제 아님 — 내부에서 정렬) */
export interface RankingPointRow {
  postId: string | null;
  keyword: string;
  rank: number | null;
  checkedAt: string;
}

/** 순위 상승 후보 (제목은 라우트에서 별도 조회해 붙인다) */
export interface ImprovedCandidate {
  postId: string;
  keyword: string;
  fromRank: number;
  toRank: number;
}

export interface RankingsAggregate {
  trackedKeywords: number;
  top10Count: number;
  improved: ImprovedCandidate[];
}

const MAX_IMPROVED = 5;
const TOP_RANK_THRESHOLD = 10;

/**
 * 지난달 순위 시계열 집계 (순수 함수).
 * - trackedKeywords: 관측된 키워드 수(중복 제거, 빈 키워드 제외)
 * - top10Count: 해당 월 최고(최소) 순위가 10위 이내였던 글 수
 * - improved: 월초 대비 월말 순위가 오른 글(관측 2회 이상), 상승 폭 큰 순 상위 5
 */
export function aggregateRankings(rows: readonly RankingPointRow[]): RankingsAggregate {
  const keywords = new Set<string>();
  const byPost = new Map<string, RankingPointRow[]>();

  for (const row of rows) {
    const keyword = row.keyword.trim();
    if (keyword) keywords.add(keyword);
    if (!row.postId) continue;
    const list = byPost.get(row.postId) ?? [];
    byPost.set(row.postId, [...list, row]);
  }

  let top10Count = 0;
  const candidates: Array<ImprovedCandidate & { delta: number }> = [];

  for (const [postId, points] of byPost) {
    const ranked = points
      .filter((p): p is RankingPointRow & { rank: number } => p.rank !== null)
      .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
    if (ranked.length === 0) continue;

    const best = Math.min(...ranked.map((p) => p.rank));
    if (best <= TOP_RANK_THRESHOLD) top10Count += 1;

    if (ranked.length < 2) continue;
    const first = ranked[0];
    const last = ranked[ranked.length - 1];
    const delta = first.rank - last.rank; // 양수 = 순위 상승
    if (delta > 0) {
      candidates.push({
        postId,
        keyword: last.keyword.trim(),
        fromRank: first.rank,
        toRank: last.rank,
        delta,
      });
    }
  }

  const improved = [...candidates]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_IMPROVED)
    .map(({ postId, keyword, fromRank, toRank }) => ({ postId, keyword, fromRank, toRank }));

  return { trackedKeywords: keywords.size, top10Count, improved };
}

export interface ActionInput {
  /** 프로필에 유효한 공개 블로그 주소가 설정됐는지 */
  blogConfigured: boolean;
  postsCreated: number;
  postsPublished: number;
  trackedKeywords: number;
  top10Count: number;
  /** -1 = 무제한, 0 = 플랜 없음 */
  monthlyLimit: number;
  generated: number;
}

const MAX_ACTIONS = 3;

/** 다음 달 추천 액션 1~3개 — 데이터 상태에 따른 규칙 분기 (우선순위 순) */
export function buildRecommendedActions(input: ActionInput): string[] {
  const actions: string[] = [];

  if (!input.blogConfigured) {
    actions.push(
      '마이페이지 내 정보 탭에 블로그 주소를 등록하면 발행 글의 검색 순위 추적이 시작됩니다.',
    );
  }
  if (input.postsCreated === 0) {
    actions.push(
      '이번 달에는 글 생성을 시작해보세요. 꾸준한 발행이 검색 상위노출의 기본입니다.',
    );
  }
  if (input.postsCreated > 0 && input.postsPublished === 0) {
    actions.push('작성해 둔 글을 발행하면 검색 노출과 순위 추적이 시작됩니다.');
  }
  if (input.postsPublished > 0 && input.trackedKeywords === 0) {
    actions.push('글마다 핵심 키워드를 설정하면 검색 순위 추적이 더 정확해집니다.');
  }
  if (input.top10Count > 0) {
    actions.push(
      '상위 10위에 진입한 키워드의 연관 키워드로 후속 글을 작성해 노출을 넓혀보세요.',
    );
  }
  if (input.monthlyLimit > 0 && input.generated < input.monthlyLimit) {
    const remaining = input.monthlyLimit - input.generated;
    actions.push(
      `지난달 플랜 생성 횟수 중 ${remaining}회를 사용하지 않았습니다. 이번 달에는 남김없이 활용해 발행량을 늘려보세요.`,
    );
  }
  if (actions.length === 0) {
    actions.push('이번 달에도 꾸준한 발행으로 검색 노출을 쌓아보세요. 주 1~2회 발행을 권장합니다.');
  }

  return actions.slice(0, MAX_ACTIONS);
}

export interface BuildReportInput {
  period: string;
  generatedAt: string;
  postsCreated: number;
  postsPublished: number;
  complianceChecked: number;
  rankings: RankingsAggregate;
  improvedPosts: MonthlyImprovedPost[];
  generated: number;
  monthlyLimit: number;
  planName: string | null;
  blogConfigured: boolean;
}

/** 집계값을 monthly_reports.data 스냅샷으로 조립 (순수 함수) */
export function buildReportData(input: BuildReportInput): MonthlyReportData {
  return {
    version: MONTHLY_REPORT_VERSION,
    period: input.period,
    generatedAt: input.generatedAt,
    posts: { created: input.postsCreated, published: input.postsPublished },
    compliance: { checked: input.complianceChecked },
    rankings: {
      trackedKeywords: input.rankings.trackedKeywords,
      top10Count: input.rankings.top10Count,
      improved: input.improvedPosts,
    },
    usage: {
      generated: input.generated,
      monthlyLimit: input.monthlyLimit,
      planName: input.planName,
    },
    actions: buildRecommendedActions({
      blogConfigured: input.blogConfigured,
      postsCreated: input.postsCreated,
      postsPublished: input.postsPublished,
      trackedKeywords: input.rankings.trackedKeywords,
      top10Count: input.rankings.top10Count,
      monthlyLimit: input.monthlyLimit,
      generated: input.generated,
    }),
  };
}

/** 인앱 알림 제목·본문 (NotificationBell 노출용) */
export function monthlyReportNotification(
  period: string,
  data: MonthlyReportData,
): { title: string; message: string } {
  const month = periodMonth(period);
  const title = month !== null ? `${month}월 성과 리포트가 도착했어요` : '월간 성과 리포트가 도착했어요';
  const parts = [
    `글 생성 ${data.usage.generated}회`,
    `발행 ${data.posts.published}건`,
    `의료광고법 검사 ${data.compliance.checked}건`,
  ];
  if (data.rankings.top10Count > 0) {
    parts.push(`상위 10위 진입 ${data.rankings.top10Count}건`);
  }
  const message = `지난달 닥터포스트가 ${parts.join(' · ')}을 도왔습니다. 마이페이지 성과 리포트 탭에서 확인하세요.`;
  return { title, message };
}

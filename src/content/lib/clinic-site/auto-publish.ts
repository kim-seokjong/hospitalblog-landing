/**
 * 병원 서브도메인 블로그 — 정기 자동발행 선정 로직 (순수 함수 모듈).
 *
 * 설계 대원칙:
 *  - 자동 "생성"이 아니라 이미 검수를 통과한 글의 "발행"만 스케줄한다.
 *  - 기본 OFF(opt-in). 회원이 켠 주기(weekly/biweekly)에만 동작한다.
 *  - 주기당 1편만 발행한다(과다발행=스팸 신호 방지).
 *  - 검수 게이트(publish-gate.ts)는 호출부(cron 라우트)가 후보를 거르는 데 쓰고,
 *    이 모듈은 "이미 게이트를 통과한 후보 목록"을 받아 선정만 한다(테스트 용이).
 *
 * ⚠️ 러너 제약(compliance-report.ts / slug.ts 패턴): node --experimental-strip-types
 *    테스트 러너가 별칭·상대 경로 해석 없이 로드할 수 있도록 값 import 없이
 *    자립 모듈로 유지한다.
 */

/**
 * 자동발행 주기.
 *  - off       : 사용 안 함 (기본값 — 기존 고객에게 예고 없이 켜지지 않는다)
 *  - auto      : 검수 통과 글이 있으면 매 실행(하루 1회 cron)마다 바로 발행
 *  - weekly    : 주 1회 1편
 *  - biweekly  : 격주 1편
 */
export type SitePublishCadence = 'off' | 'auto' | 'weekly' | 'biweekly';

/** 주기별 최소 경과 일수. off 는 판정에서 제외한다. auto 는 대기 없음(0일). */
const CADENCE_DAYS: Record<Exclude<SitePublishCadence, 'off'>, number> = {
  auto: 0,
  weekly: 7,
  biweekly: 14,
};

/**
 * 1회 실행에서 한 회원에게 발행할 최대 편수.
 *
 * auto = 3편/일 근거:
 *  - cron 은 하루 1회 실행되므로 auto 의 실질 상한은 "하루 3편"이다.
 *  - 병원 블로그가 하루 4편 이상 쏟아지면 사람이 쓴 운영으로 보이지 않고
 *    대량 자동생성(스팸) 신호가 된다. 반대로 하루 1편은 AI 인용에 필요한
 *    콘텐츠 밀도가 쌓이는 속도가 너무 느리다.
 *  - 월 환산 최대 ~90편으로, 실제 병원 블로그 운영량(월 8~20편)을 이미 크게
 *    웃돈다 → 밀린 검수 통과 글이 있을 때만 일시적으로 3편까지 나가고
 *    큐가 비면 자연히 0편이 된다(발행 대상이 없으면 아무 일도 안 함).
 *  - IndexNow 도 "변경된 URL 만" 제출하도록 권고하므로 소량 제출이 안전하다.
 * weekly/biweekly = 1편: 기존 동작을 그대로 유지한다(변경 금지).
 */
export const CADENCE_MAX_POSTS_PER_RUN: Record<Exclude<SitePublishCadence, 'off'>, number> = {
  auto: 3,
  weekly: 1,
  biweekly: 1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 문자열이 허용 주기값인지 판정한다(외부 입력 검증용). */
export function isValidCadence(value: unknown): value is SitePublishCadence {
  return value === 'off' || value === 'auto' || value === 'weekly' || value === 'biweekly';
}

/** 주기별 1회 실행 발행 편수 상한. off 는 0. */
export function maxPostsPerRun(cadence: SitePublishCadence): number {
  return cadence === 'off' ? 0 : CADENCE_MAX_POSTS_PER_RUN[cadence];
}

/**
 * 자동발행을 실행할 시점이 되었는지 판정한다.
 *  - off → 항상 false.
 *  - auto → 항상 true (대기 없음 — 검수 통과 글이 있으면 바로 발행).
 *  - lastRun 이 없거나(최초) 파싱 불가 → true(즉시 발행 허용 — graceful).
 *  - 그 외 → 마지막 발행 이후 주기 일수만큼 경과했으면 true.
 */
export function isDue(
  cadence: SitePublishCadence,
  lastRun: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (cadence === 'off') return false;
  if (cadence === 'auto') return true;
  if (!lastRun) return true;

  const last = Date.parse(lastRun);
  if (Number.isNaN(last)) return true;

  const elapsed = now.getTime() - last;
  return elapsed >= CADENCE_DAYS[cadence] * DAY_MS;
}

/**
 * 자동발행 후보 — 검수 게이트를 이미 통과하고 아직 미발행인 글의 최소 형태.
 * (createdAt 은 saved_posts.created_at ISO 문자열)
 */
export interface AutoPublishCandidate {
  id: string;
  createdAt: string;
}

/** created_at 파싱값(오래된 순 정렬 기준). 파싱 불가 시 +Infinity(맨 뒤로 밀어냄). */
function createdAtValue(candidate: AutoPublishCandidate): number {
  const parsed = Date.parse(candidate.createdAt);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * 후보 목록에서 자동발행할 1편을 고른다 — 가장 오래된 생성순(created_at 오름차순).
 * (오래 대기한 글부터 발행 → 발행 큐가 오래된 순으로 소진되도록)
 *
 * 입력은 "이미 검수 게이트를 통과하고 미발행인" 후보만 담겨 있다고 가정한다.
 * 후보가 없으면 null(그 회원은 이번 주기에 발행할 대상 없음 — graceful).
 * created_at 이 동률이면 id 사전순으로 안정 정렬한다.
 */
export function pickNextPost(
  candidates: ReadonlyArray<AutoPublishCandidate>,
): AutoPublishCandidate | null {
  return pickNextPosts(candidates, 1)[0] ?? null;
}

/**
 * 후보 목록에서 자동발행할 최대 limit 편을 고른다 — 오래된 생성순.
 * pickNextPost 와 동일한 정렬 규칙(created_at 오름차순, 동률이면 id 사전순)이며,
 * 'auto' 주기가 1회 실행에서 여러 편을 발행할 때 사용한다.
 *
 * 입력을 변형하지 않는다(불변) — 복사 후 정렬한다.
 * limit <= 0 이면 빈 배열.
 */
export function pickNextPosts(
  candidates: ReadonlyArray<AutoPublishCandidate>,
  limit: number,
): AutoPublishCandidate[] {
  if (candidates.length === 0 || limit <= 0) return [];

  return [...candidates]
    .sort((a, b) => {
      const av = createdAtValue(a);
      const bv = createdAtValue(b);
      if (av !== bv) return av < bv ? -1 : 1;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, limit);
}

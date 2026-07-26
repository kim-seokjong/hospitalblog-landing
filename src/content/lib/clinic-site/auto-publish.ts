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
 * 한 회원에게 "하루(KST)" 발행할 최대 편수.
 *
 * ★ 이 값은 cron 호출 횟수와 무관하게 강제된다 — 호출부가 site_published_at 이
 *   오늘인 글 수를 DB 에서 세어 남은 몫만 발행한다(remainingDailyQuota).
 *   호출당 상한으로만 두면 재시도·수동 재실행에 하루 6편·9편이 나갔다.
 *
 * auto = 3편/일 근거:
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

/** 한국 표준시 오프셋. "하루 몇 편" 판정은 병원 운영 감각(KST) 기준이어야 한다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 일 단위 인덱스 (1970-01-01 KST 부터의 일수).
 * 순회 회전 창을 매일 한 칸씩 밀어 모든 회원이 반드시 처리되게 하는 데 쓴다.
 */
export function kstDayIndex(now: Date): number {
  return Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS);
}

/**
 * KST 기준 오늘 00:00 의 UTC ISO 문자열.
 * 일일 발행 상한을 DB(site_published_at) 기준으로 집계할 때의 경계값.
 */
export function kstDayStartIso(now: Date): string {
  return new Date(kstDayIndex(now) * DAY_MS - KST_OFFSET_MS).toISOString();
}

/**
 * 순회 회전 오프셋.
 *
 * 왜 필요한가: 자동발행 대상 회원을 id 순 상위 N 명만 조회하면 N+1 번째부터는
 * 발행할 글이 있어도 영원히 처리되지 않는다(영구 기아). 창을 매일 한 칸씩 밀면
 * 모든 회원이 최대 ceil(total / windowSize) 일 안에 반드시 창 안에 들어온다.
 *
 * 별도 커서 저장소가 필요 없고(날짜만으로 결정), 같은 날 재시도하면 같은 창을
 * 처리하므로 재실행이 순회를 건너뛰지 않는다.
 */
export function rotationOffset(total: number, windowSize: number, dayIndex: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(windowSize) || windowSize <= 0) return 0;
  if (total <= windowSize) return 0; // 전원이 한 창에 들어오면 회전 불필요

  const windows = Math.ceil(total / windowSize);
  // dayIndex 가 음수여도 안전하게 0 이상으로 정규화한다.
  const slot = ((Math.trunc(dayIndex) % windows) + windows) % windows;
  return slot * windowSize;
}

/**
 * 주기 실행권 선점에 쓸 "이 시각 이하면 실행 가능" 임계값.
 * weekly=7일 전, biweekly=14일 전. auto/off 는 임계값 개념이 없어 null.
 *
 * isDue 와 같은 기준을 DB 조건부 update 로 옮기기 위한 값이다 — 앱에서만
 * 판정하면 두 실행이 같은 오래된 last_run 을 읽고 각각 1편씩 발행한다.
 */
export function dueThresholdIso(cadence: SitePublishCadence, now: Date): string | null {
  if (cadence === 'off' || cadence === 'auto') return null;
  return new Date(now.getTime() - CADENCE_DAYS[cadence] * DAY_MS).toISOString();
}

/**
 * 커서 기반 순회 순서 — 커서 다음부터 시작해 끝에 닿으면 앞으로 돌아온다.
 *
 * 왜 필요한가: 창 안에서 항상 id 오름차순으로 처리하면, 전체 발행 상한을 앞쪽
 * 회원들이 소진할 때 뒤쪽 회원은 "검사조차" 되지 않는다. 다음 실행이 마지막으로
 * 검사한 회원 다음부터 이어받으면, 커서가 매 실행 최소 1칸씩 전진하므로
 * 모든 회원이 최대 total 회 실행 안에 반드시 검사된다.
 *
 * 입력 배열은 id 오름차순으로 정렬돼 있다고 가정한다(호출부가 DB 정렬로 보장).
 * 입력을 변형하지 않는다.
 */
export function orderByCursor<T extends { id: string }>(
  all: ReadonlyArray<T>,
  cursor: string | null | undefined,
  windowSize: number,
): T[] {
  if (all.length === 0) return [];

  // 커서보다 큰 첫 위치 (커서가 삭제된 id 여도 그 다음 위치를 찾는다)
  const startIndex = !cursor ? 0 : all.findIndex((item) => item.id > cursor);
  const start = startIndex === -1 ? 0 : startIndex;

  // 라우트가 실제로 던지는 두 개의 keyset 쿼리와 같은 모양이다:
  //  ① id > cursor 페이지  ② 부족분을 처음부터 채우는 페이지
  return mergeCursorWindow(all.slice(start), all.slice(0, start), windowSize);
}

/**
 * 커서 순회의 두 페이지를 합친다 — ① 커서 이후 ② 부족분을 앞에서 채운 wrap-around.
 * 중복 id 를 제거하고 windowSize 개까지만 남긴다.
 *
 * ★ 라우트(cron)와 테스트 모델(orderByCursor)이 이 함수를 공유해 로직이 갈라지지 않게 한다.
 */
export function mergeCursorWindow<T extends { id: string }>(
  afterCursor: ReadonlyArray<T>,
  wrapped: ReadonlyArray<T>,
  windowSize: number,
): T[] {
  if (windowSize <= 0) return [];

  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...afterCursor, ...wrapped]) {
    if (merged.length >= windowSize) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

/**
 * DB 일일 집계로 상한을 강제해야 하는 주기인지.
 *
 * weekly/biweekly 는 site_publish_last_run 간격(isDue)이 이미 DB 상태로 재발행을
 * 막는다 — 재시도·재실행은 isDue 에서 걸러진다. 반면 'auto' 는 대기가 없어
 * last_run 이 방어선이 되지 못하므로 "오늘 몇 편 나갔나"를 DB 에서 세는 것이
 * 유일한 상한 강제 수단이다.
 *
 * ⚠️ 이 판정을 없애고 전 주기에 일일 집계를 적용하면, 회원이 마이페이지에서
 *    수동 발행한 날 cron 이 건너뛰게 되어 weekly/biweekly 동작이 바뀐다.
 */
export function needsDailyQuotaCheck(cadence: SitePublishCadence): boolean {
  return cadence === 'auto';
}

/**
 * 오늘 남은 발행 몫.
 *
 * ★ cron 호출당 상한만으로는 부족하다 — 재시도·수동 재실행·중복 전달이 있으면
 *   하루 6편, 9편이 나간다. 호출부는 이 값을 DB 집계(오늘 이미 발행된 편수)로
 *   계산해 실제 상한을 강제해야 한다.
 */
export function remainingDailyQuota(
  cadence: SitePublishCadence,
  publishedToday: number,
): number {
  const cap = maxPostsPerRun(cadence);
  if (cap <= 0) return 0;
  const already = Number.isFinite(publishedToday) && publishedToday > 0 ? publishedToday : 0;
  return Math.max(0, cap - already);
}

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

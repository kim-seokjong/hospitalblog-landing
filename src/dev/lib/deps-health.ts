/**
 * 외부 의존성 상태 판정 — **순수 로직만**. 네트워크는 라우트가 담당한다.
 *
 * ★ 왜 만들었나 (2026-08-22).
 *   "닥포 작동은 잘 되나"를 확인하려다 알게 된 것:
 *     · 마지막 생성이 2026-07-31 이었다. 3주간 아무도 제품을 태우지 않았고,
 *       그래서 **그동안 깨져 있었어도 알 방법이 없었다.**
 *     · 결제는 한 번도 실제로 돌아본 적이 없다(payments 2건 = PENDING 1 + 0원 TRIAL 1).
 *     · 메일 도메인은 2026-07-27 에 미검증으로 전건 실패했는데 아무도 몰랐다.
 *   공통점은 "쓰는 사람이 없으면 고장을 알 수 없다"는 것이다.
 *   ⇒ 사람 대신 **매일 카나리를 태워서** 안다.
 *
 * ⚠️판정은 보수적으로: 확인하지 못한 것을 ok 로 적지 않는다.
 *   키가 아예 없으면 fail 이 아니라 skipped 다 — "설정 안 함"과 "고장"은 다르다.
 *
 * ⛔비밀값은 어떤 경로로도 note 에 담지 않는다(응답·로그·텔레그램 전부 이 note 를 쓴다).
 *
 * 외부 의존 없는 모듈(@/ alias import 금지) — node:test 러너로 직접 검증한다.
 */

export type DepStatus = 'ok' | 'fail' | 'skipped';

export interface DepResult {
  readonly name: string;
  readonly status: DepStatus;
  /** 사람이 읽는 한 줄. 비밀값 금지. */
  readonly note: string;
}

export interface GenerationFreshness {
  /** 마지막 API 사용 기록(usage_logs). 없으면 null. */
  readonly lastUsageAt: string | null;
  /** 마지막 저장 글(saved_posts). 없으면 null. */
  readonly lastPostAt: string | null;
  /** 둘 중 최신 기준 경과일. 기록이 없으면 null. */
  readonly daysSince: number | null;
}

export interface DepsHealthReport {
  readonly checkedAt: string;
  /** fail 이 하나도 없으면 true. skipped 는 healthy 를 깨지 않는다. */
  readonly healthy: boolean;
  readonly deps: readonly DepResult[];
  readonly generation: GenerationFreshness;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 두 시각 중 최신을 고른다. 파싱 불가·null 은 무시한다. */
function latest(a: string | null, b: string | null): number | null {
  const times = [a, b]
    .map((v) => (v ? Date.parse(v) : Number.NaN))
    .filter((v) => Number.isFinite(v));
  return times.length ? Math.max(...times) : null;
}

/** 마지막 생성 경과일 계산. 미래 시각은 0일로 눕힌다(시계 어긋남 방어). */
export function summarizeGeneration(
  lastUsageAt: string | null,
  lastPostAt: string | null,
  nowMs: number,
): GenerationFreshness {
  const newest = latest(lastUsageAt, lastPostAt);
  if (newest === null) return { lastUsageAt, lastPostAt, daysSince: null };
  return {
    lastUsageAt,
    lastPostAt,
    daysSince: Math.max(0, Math.floor((nowMs - newest) / DAY_MS)),
  };
}

/** fail 이 하나라도 있으면 건강하지 않다. */
export function judgeDeps(deps: readonly DepResult[]): boolean {
  return !deps.some((d) => d.status === 'fail');
}

export function buildReport(
  deps: readonly DepResult[],
  generation: GenerationFreshness,
  nowMs: number,
): DepsHealthReport {
  return {
    checkedAt: new Date(nowMs).toISOString(),
    healthy: judgeDeps(deps),
    deps,
    generation,
  };
}

const LABELS: Record<DepStatus, string> = { ok: '정상', fail: '실패', skipped: '미설정' };

/** 실패한 항목만 사람이 읽는 문장으로. 실패가 없으면 빈 문자열 — 조용히 넘어가라는 뜻이다. */
export function buildAlertText(report: DepsHealthReport): string {
  const failed = report.deps.filter((d) => d.status === 'fail');
  if (failed.length === 0) return '';
  const lines = ['⛔[닥터포스트] 외부 의존성 점검 실패'];
  for (const d of failed) lines.push(`· ${d.name} — ${LABELS[d.status]}: ${d.note}`);
  const skipped = report.deps.filter((d) => d.status === 'skipped');
  if (skipped.length) lines.push(`· (미설정: ${skipped.map((d) => d.name).join(', ')})`);
  return lines.join('\n');
}

/**
 * 행정안전부 병원 조회 **카나리 점검** — 순수 판정 로직.
 *
 * ★ 왜 만들었나 (2026-07-27).
 *   행안부가 HTTP 200 + 정상 엔벨로프에 0건을 실어 보내는 동안, 홈페이지 첫 화면의
 *   병원 조회가 전건 실패했다. 그런데 그 사실을 **사람이 실존 병원 12곳을 직접 쏴 보고
 *   나서야** 알았다. 그 전까지 들어온 원장들은 전부 "그런 병원 없음"을 보고 떠났다.
 *
 * 방식은 단순하다. 전국에 수백~수천 곳 있는 상호("미소치과의원" 등)를 주기적으로
 * 조회한다. 그 이름이 0건이면 그건 "그런 병원이 없다"가 아니라 **조회가 죽은 것**이다.
 * 사람의 제보를 기다리지 않는 유일한 방법이 이거다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/**
 * 카나리 상호 — 전국에 다수 존재해서 **0건이 나올 수 없는** 이름만 고른다.
 * (실측: "미소치과의원" LIKE 기준 1,230곳)
 *
 * 여러 개를 두는 이유: 한 이름만 쓰면 그 상호가 실제로 전부 폐업·개명하는 날
 * 카나리가 영구 거짓 경보가 된다. 서로 다른 진료과에서 고른다.
 */
export const REGISTRY_CANARIES: readonly string[] = ['미소치과의원', '연세이비인후과의원'];

export type RegistryHealthStatus = 'ok' | 'degraded' | 'down';

/** 카나리 1건의 결과. */
export interface CanaryProbe {
  readonly name: string;
  /** 호출 자체가 성공했는가 (HTTP·엔벨로프 정상). */
  readonly ok: boolean;
  /** 응답의 totalCount. 호출 실패면 -1. */
  readonly totalCount: number;
  /** 파싱된 건수. 호출 실패면 0. */
  readonly items: number;
  /** 실패 사유 요약. 성공이면 null. */
  readonly failure: string | null;
}

export interface RegistryHealthVerdict {
  readonly status: RegistryHealthStatus;
  /** 사람이 읽을 한 줄 요약 — 알림 메일과 DB note 에 그대로 쓴다. */
  readonly note: string;
  /** 정상 응답 + 결과가 있었던 카나리 수. */
  readonly healthy: number;
  /** 정상 응답인데 0건이었던 카나리 수 — **이번 장애의 지문**. */
  readonly zero: number;
  /** 호출 자체가 실패한 카나리 수. */
  readonly failed: number;
}

/**
 * 카나리 결과로 조회 상태를 판정한다.
 *
 * "0건"과 "호출 실패"를 끝까지 구분한다. 둘 다 장애지만 대표가 할 일이 다르다
 * (전자는 행안부 쪽 데이터 사고, 후자는 네트워크·키 문제).
 */
export function judgeRegistryHealth(probes: readonly CanaryProbe[]): RegistryHealthVerdict {
  if (probes.length === 0) {
    return { status: 'down', note: '카나리를 하나도 실행하지 못했습니다.', healthy: 0, zero: 0, failed: 0 };
  }

  const healthy = probes.filter((p) => p.ok && p.items > 0).length;
  const zero = probes.filter((p) => p.ok && p.items === 0).length;
  const failed = probes.filter((p) => !p.ok).length;

  const detail = probes
    .map((p) => (p.ok ? `${p.name}=${p.items}건` : `${p.name}=실패(${p.failure ?? '원인 미상'})`))
    .join(', ');

  if (healthy === probes.length) {
    return { status: 'ok', note: `정상 (${detail})`, healthy, zero, failed };
  }
  if (healthy === 0) {
    const cause =
      zero > 0 && failed === 0
        ? '행안부가 정상 응답에 0건만 보내고 있습니다(병원이 없는 것이 아닙니다).'
        : failed > 0 && zero === 0
          ? '행안부 호출 자체가 실패하고 있습니다.'
          : '행안부 조회가 0건·실패로 뒤섞여 있습니다.';
    return { status: 'down', note: `${cause} (${detail})`, healthy, zero, failed };
  }
  return { status: 'degraded', note: `일부 카나리만 정상입니다. (${detail})`, healthy, zero, failed };
}

/**
 * 이번 판정으로 알림을 보내야 하는가.
 *
 * 매 점검마다 보내면 장애 한 번에 메일이 수십 통 쌓여 다음부터 아무도 안 본다.
 * **상태가 바뀌는 순간에만** 보낸다 — 나빠질 때 한 번, 복구될 때 한 번.
 */
export function shouldAlert(
  status: RegistryHealthStatus,
  previousStatus: RegistryHealthStatus | null,
): boolean {
  if (status === 'ok') return previousStatus !== null && previousStatus !== 'ok';
  return previousStatus !== status;
}

/** 알림 제목 — 받은편지함에서 제목만 보고 판단할 수 있어야 한다. */
export function alertSubject(status: RegistryHealthStatus): string {
  if (status === 'ok') return '[닥터포스트] 병원 조회 복구됨';
  if (status === 'degraded') return '[닥터포스트] 병원 조회 이상 징후';
  return '[닥터포스트] 병원 조회 중단 — 첫 화면 무료진단이 막힙니다';
}

/** 알림 본문(HTML). 대표가 읽는 말로, 지금 무슨 일이고 무엇이 대신 돌고 있는지까지. */
export function alertHtml(verdict: RegistryHealthVerdict, checkedAt: string): string {
  const head =
    verdict.status === 'ok'
      ? '행정안전부 병원 조회가 정상으로 돌아왔습니다.'
      : verdict.status === 'degraded'
        ? '행정안전부 병원 조회가 일부만 응답하고 있습니다.'
        : '행정안전부 병원 조회가 결과를 내놓지 못하고 있습니다. 홈페이지 첫 화면의 무료진단이 여기서 막힙니다.';
  const fallback =
    verdict.status === 'ok'
      ? ''
      : '<p style="margin:12px 0 0">그동안 병원 검색은 <b>심평원 공개자료 기반 자체 명부</b>로 대신 돌아갑니다(폴백). 화면에는 자료 출처가 표시됩니다.</p>';
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:14px;line-height:1.7;color:#202020">',
    `<p style="margin:0"><b>${head}</b></p>`,
    `<p style="margin:12px 0 0">점검 시각: ${checkedAt}</p>`,
    `<p style="margin:6px 0 0">판정 근거: ${verdict.note}</p>`,
    fallback,
    '</div>',
  ].join('');
}

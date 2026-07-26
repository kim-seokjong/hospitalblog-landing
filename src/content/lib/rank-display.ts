/**
 * 순위 표시 문구 결정 (순수·UI 비의존).
 *
 * ★ 이번 수정의 핵심이 여기 있다.
 *   예전에는 rank=null 하나로 "측정 실패"와 "순위권 밖"을 모두 표현해서,
 *   네이버 키가 빠져 두 달간 측정이 죽어 있는 동안에도 화면은
 *   "100위 밖"이라고 원장에게 말하고 있었다.
 *   두 상태는 반드시 다른 문구로 나가야 한다 — 그래서 순수 함수로 떼어 테스트한다.
 */

/** 측정 상태. null = 마이그 052 미적용 환경(구 스키마)에서 읽은 행 */
export type RankStatus = 'ok' | 'not_found' | 'failed' | 'ambiguous';

export type RankTone =
  /** 순위가 확정됨 — 숫자를 강조 */
  | 'rank'
  /** 정보는 있으나 순위 없음 (순위권 밖 등) */
  | 'muted'
  /** 주의 — 측정이 안 됐거나 특정 불가. "순위권 밖"과 절대 같게 보이면 안 된다 */
  | 'warn';

export interface RankDisplay {
  text: string;
  tone: RankTone;
  hint: string;
}

/** scanned_depth 가 없는 구 데이터의 표시 기준. */
export const DEFAULT_SCAN_DEPTH = 100;

export function rankDisplay(
  status: RankStatus | null,
  rank: number | null,
  scannedDepth: number | null,
): RankDisplay {
  const depth =
    typeof scannedDepth === 'number' && Number.isFinite(scannedDepth) && scannedDepth > 0
      ? scannedDepth
      : DEFAULT_SCAN_DEPTH;

  if (status === 'failed') {
    return {
      text: '측정 실패',
      tone: 'warn',
      hint: '네이버 검색 조회에 실패해 이번 회차 순위를 확인하지 못했습니다. 순위권 밖이라는 뜻이 아니며, 다음 자동 추적에서 다시 시도합니다.',
    };
  }
  if (status === 'ambiguous') {
    return {
      text: '확인 필요',
      tone: 'warn',
      hint: '이 키워드에서 같은 블로그의 글이 여러 편 검색돼 어느 글인지 특정하지 못했습니다.',
    };
  }
  if (status === 'not_found') {
    return {
      text: `${depth.toLocaleString('ko-KR')}위 밖`,
      tone: 'muted',
      hint: `${depth.toLocaleString('ko-KR')}위까지 확인했으나 이 글이 검색되지 않았습니다.`,
    };
  }
  if (rank !== null) {
    return {
      text: `${rank.toLocaleString('ko-KR')}위`,
      tone: 'rank',
      hint: '네이버 검색 API 기준 추정 순위입니다.',
    };
  }
  // 구 스키마(status 미기록) + rank 없음 — "순위권 밖"이라고 단정할 근거가 없다
  return {
    text: '집계 전',
    tone: 'muted',
    hint: '아직 유효한 측정 기록이 없습니다.',
  };
}

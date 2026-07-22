/**
 * 체험 종료 D-3 성과 리포트 — 순수 로직 (해지·이탈 방어).
 *
 * 배경: 체험 회원이 성과를 체감하기 전에 자동결제를 취소하고 이탈한다
 * (예: 바르다권치과 = 30일 체험 중 글 14개 생성했으나 체험 끝나기 전 이탈).
 * 체험 종료 3일 전에 "당신이 만든 N개 글의 성과"를 요약해 전환을 유도한다.
 *
 * 이 모듈은 순수 함수만 담는다(DB/네트워크/LLM 없음) — node:test 로 직접 검증.
 *  1) 발송 대상 탐색 (만료일 KST 기준 D-3, 실패 재시도용으로 D-2·D-1 포함)
 *  2) "당신이 만든 글" 성과 요약 조립 (글 수·키워드 순위·GEO 노출)
 *  3) 리포트 이메일(제목·HTML) 조립 — 실발송은 cron 이 게이트 뒤에서 수행
 */

import { sanitizeExcerpt } from './geo-tracking.ts';

/** 체험 종료 며칠 전에 리포트를 보낼지 (D-3). */
export const TRIAL_REPORT_WINDOW_DAYS = 3;

/**
 * 재시도 하한 (D-1까지). D-3 발송이 실패하면 notifications 미기록으로 남고,
 * 다음날(D-2·D-1) 배치가 다시 대상으로 잡아 재시도한다 — 발송 성공 시에만
 * notification 이 기록되므로 성공한 계정은 중복 발송되지 않는다.
 */
export const TRIAL_REPORT_MIN_DAYS = 1;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 날짜를 KST 기준 "일련 일수"(1970-01-01 KST=0)로 환산. 잘못된 날짜는 null. */
export function kstDayNumber(date: Date | string): number | null {
  const t = typeof date === 'string' ? Date.parse(date) : date.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t + KST_OFFSET_MS) / 86_400_000);
}

/**
 * 만료일까지 남은 KST 캘린더 일수. now 보다 과거면 음수. 계산 불가면 null.
 * 예: now=7/22 10:00, expires=7/25 09:00 → 3 (같은 KST 날짜 경계 기준).
 */
export function daysUntilKST(expiresAt: string | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const a = kstDayNumber(expiresAt);
  const b = kstDayNumber(now);
  if (a === null || b === null) return null;
  return a - b;
}

/** 만료일이 정확히 D-3(now+3 KST일)인지 — 일 1회 배치라 각 계정이 한 번만 걸린다. */
export function isDMinus3Window(expiresAt: string | null | undefined, now: Date): boolean {
  return daysUntilKST(expiresAt, now) === TRIAL_REPORT_WINDOW_DAYS;
}

export type TrialTargetSource = 'trial_until' | 'plan_expires_at';

export interface TrialCandidate {
  userId: string;
  email: string | null;
  hospitalName: string | null;
  expiresAt: string | null;
  source: TrialTargetSource;
  /**
   * 체험/구독 시작 시각(billing_keys.created_at 등) — 성과 집계 스코프 하한.
   * null 이면 호출부가 계정 생성 시각(profiles.created_at)으로 폴백한다.
   */
  startedAt?: string | null;
}

export interface TrialTarget extends TrialCandidate {
  daysLeft: number;
}

/**
 * 발송 대상 필터 + 중복 제거 + 만료 임박순 정렬 (순수 함수).
 *
 * - 윈도우: D-3 ~ D-1 (daysLeft ∈ [TRIAL_REPORT_MIN_DAYS, TRIAL_REPORT_WINDOW_DAYS]).
 *   D-2·D-1 은 "D-3 발송 실패분 재시도"용 — 성공분은 notifications 기록으로 중복 차단.
 * - 중복 제거: userId 기준 먼저 등장한 후보 유지(호출부가 trial_until 우선으로 넣는다).
 * - 정렬: 만료시각(expiresAt) 오름차순 — 호출부가 cap 으로 자르더라도 임박 대상이
 *   먼저 처리되고, 특정 소스(trial_until) 후보가 다른 소스 후보를 지속적으로 밀어내지 않는다.
 */
export function findTrialReportTargets(
  candidates: readonly TrialCandidate[],
  now: Date,
): TrialTarget[] {
  const seen = new Set<string>();
  const out: TrialTarget[] = [];
  for (const c of candidates) {
    if (!c.userId || seen.has(c.userId)) continue;
    const daysLeft = daysUntilKST(c.expiresAt, now);
    if (daysLeft === null) continue;
    if (daysLeft < TRIAL_REPORT_MIN_DAYS || daysLeft > TRIAL_REPORT_WINDOW_DAYS) continue;
    seen.add(c.userId);
    out.push({ ...c, daysLeft });
  }
  return out.sort((a, b) => {
    const ta = a.expiresAt ? Date.parse(a.expiresAt) : Number.MAX_SAFE_INTEGER;
    const tb = b.expiresAt ? Date.parse(b.expiresAt) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

// ---------------------------------------------------------------------------
// 성과 요약 — "당신이 만든 N개 글의 성과" 프레이밍
// ---------------------------------------------------------------------------

export interface TrialReportInput {
  hospitalName: string | null;
  /** 체험 기간 동안 만든(저장) 글 수 */
  postsCreated: number;
  /** 발행한 글 수 */
  postsPublished: number;
  /** 추적 중인 키워드 수 */
  trackedKeywords: number;
  /** 상위 10위 진입 글 수 */
  top10Count: number;
  /** AI 검색(GEO)에서 인용된 횟수 (geo_citations cited=true) */
  geoCitedCount: number;
  /** 발행 글 GEO 구조 준비도 점수 0~100 (scoreGeoReadiness), 없으면 null */
  geoReadiness: number | null;
  /** 순위가 오른 대표 키워드 (있으면 1개, 없으면 null) */
  topKeyword: string | null;
}

export interface TrialReportSummary {
  headline: string;
  lines: string[];
  /** 전환 유도 클로징 (해지 시 잃는 것 강조 — 과장·보장 표현 금지) */
  closing: string;
}

/**
 * 성과 요약 조립 (순수). 매출·방문자 추정 없음, 타 병원 비교 없음(회사 공통 규칙).
 * 데이터가 빈약하면(글 0개) "지금 시작해도 늦지 않다" 톤으로 분기한다.
 */
export function buildTrialReportSummary(input: TrialReportInput): TrialReportSummary {
  const who = input.hospitalName?.trim() ? `${input.hospitalName.trim()}에서` : '체험 기간 동안';

  if (input.postsCreated === 0) {
    return {
      headline: '체험이 3일 뒤 종료돼요 — 아직 첫 글을 시작할 시간이 있어요',
      lines: [
        '키워드 하나만 입력하면 60초 안에 첫 글 초안이 완성됩니다.',
        '지금 시작한 글도 발행하면 검색 노출과 순위 추적이 함께 시작돼요.',
      ],
      closing: '구독을 이어가면 매달 꾸준히 글을 쌓아 검색 노출을 넓힐 수 있어요.',
    };
  }

  const lines: string[] = [];
  lines.push(`${who} 블로그 글 ${input.postsCreated}개를 만들었어요.`);
  if (input.postsPublished > 0) {
    lines.push(`그중 ${input.postsPublished}개를 발행해 검색 노출을 시작했어요.`);
  }
  if (input.trackedKeywords > 0) {
    lines.push(`키워드 ${input.trackedKeywords}개의 검색 순위를 추적 중이에요.`);
  }
  if (input.top10Count > 0) {
    const kw = input.topKeyword ? ` (${input.topKeyword} 등)` : '';
    lines.push(`이 중 ${input.top10Count}개 글이 상위 10위 안에 들었어요${kw}.`);
  }
  if (input.geoCitedCount > 0) {
    lines.push(`AI 검색(ChatGPT·Perplexity)에서 ${input.geoCitedCount}회 인용됐어요.`);
  } else if (input.geoReadiness !== null) {
    lines.push(`발행 글의 AI 검색 준비도는 ${input.geoReadiness}점이에요.`);
  }

  return {
    headline: `당신이 만든 글 ${input.postsCreated}개, 이렇게 일하고 있어요`,
    lines,
    closing:
      '체험이 3일 뒤 종료돼요. 구독을 이어가면 지금까지 쌓은 순위와 추적이 계속 유지되고, 매달 새 글로 노출을 넓힐 수 있어요.',
  };
}

// ---------------------------------------------------------------------------
// 이메일 조립 (제목 + HTML) — 실발송은 cron 이 게이트 뒤에서 수행
// ---------------------------------------------------------------------------

/** HTML 이스케이프 (sanitizeExcerpt 재사용 — 태그·제어문자 방어). */
function esc(value: string): string {
  return sanitizeExcerpt(value, 500);
}

/**
 * 체험 회원에게 보낼 리포트 이메일(제목·HTML) 조립.
 * 실고객 발송은 cron 의 ENABLE_TRIAL_REPORT_SEND 게이트 뒤에서만 일어난다.
 */
export function buildTrialReportEmail(summary: TrialReportSummary): {
  subject: string;
  html: string;
} {
  const items = summary.lines.map((l) => `<li style="margin:6px 0;">${esc(l)}</li>`).join('');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;max-width:520px;margin:0 auto;color:#202020;">
      <h2 style="font-size:20px;font-weight:800;margin:0 0 12px;">${esc(summary.headline)}</h2>
      <ul style="padding-left:18px;font-size:15px;line-height:1.6;color:#333;">${items}</ul>
      <p style="font-size:14px;color:#555;line-height:1.6;margin-top:16px;">${esc(summary.closing)}</p>
      <p style="font-size:12px;color:#999;margin-top:20px;">본 요약은 네이버·AI 검색 공개 지표 기반 참고 자료예요. 매출·방문자 수치는 추정하지 않아요.</p>
    </div>`;
  return { subject: summary.headline, html };
}

/**
 * 대표 다이제스트 이메일 조립 — 게이트 OFF 일 때, 실고객 대신 대표에게만 보낸다.
 * D-3 대상 목록과 각 성과 요약 한 줄을 담는다(대표가 직접 발송 판단).
 */
export interface AdminDigestRow {
  hospitalName: string | null;
  email: string | null;
  postsCreated: number;
  headline: string;
}

export function buildTrialReportAdminDigest(rows: readonly AdminDigestRow[]): {
  subject: string;
  html: string;
} {
  const subject = `[닥터포스트] 체험 D-3 성과 리포트 대상 ${rows.length}건 (발송 대기)`;
  if (rows.length === 0) {
    return {
      subject: '[닥터포스트] 체험 D-3 대상 없음',
      html: '<p>오늘 체험 종료 D-3 대상이 없습니다.</p>',
    };
  }
  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(r.hospitalName ?? '(병원명 없음)')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(r.email ?? '-')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${r.postsCreated}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(r.headline)}</td>
      </tr>`,
    )
    .join('');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;color:#202020;">
      <h2 style="font-size:18px;">체험 종료 D-3 성과 리포트 대상 (${rows.length}건)</h2>
      <p style="font-size:13px;color:#555;">ENABLE_TRIAL_REPORT_SEND=off — 자동 발송하지 않았습니다. 아래 목록을 검토 후 직접 발송하세요.</p>
      <table style="border-collapse:collapse;font-size:13px;width:100%;">
        <thead>
          <tr style="background:#f4f6f8;">
            <th style="padding:6px 10px;text-align:left;">병원</th>
            <th style="padding:6px 10px;text-align:left;">이메일</th>
            <th style="padding:6px 10px;">글 수</th>
            <th style="padding:6px 10px;text-align:left;">요약 헤드라인</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  return { subject, html };
}

import type { DiagnosisLeadSummary } from './conversion.ts';

/**
 * 진단 결과 메일 보내기 — 입력 검증 · 남용 방어 · 메일 본문 (순수 로직).
 *
 * ★ 왜 이메일인가.
 *   진단은 병원의 문제를 잘 짚어주는데 그다음이 없다. 원장이 성적표만 보고 닫으면
 *   우리는 무료 봉사를 한 것이다. 그렇다고 가입을 목표로 잡으면 또 0이다 —
 *   처음 온 원장은 가입을 안 누른다. **자기 성적표를 메일로 받는 건 거절할 이유가
 *   없다.** 그 순간 연락처와 그 병원의 구체적 문제 목록이 함께 들어온다.
 *
 * ⚠️ 남용 방어가 특히 중요하다. 이 엔드포인트는 **비회원이 임의 주소로 메일을
 *    보내게 하는 통로**다. 남의 주소를 넣어 괴롭히는 데 쓰이지 않도록
 *    IP·수신주소·전체 3중 캡을 두고, 본문에 사용자 입력 문자열을 싣지 않는다
 *    (병원명·진단 수치 등 서버가 가진 값만 들어간다).
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 */

/* ── 이메일 검증 ─────────────────────────────────────────── */

/** RFC 전체를 흉내내지 않는다 — 실사용 주소를 받고 명백한 쓰레기만 거른다. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
/** 주소 전체 길이 상한 (RFC 5321). */
export const MAX_EMAIL_LENGTH = 254;

/**
 * 수신 주소 정규화. 통과하면 소문자 주소, 아니면 null.
 * · 앞뒤 공백 제거 → 소문자화 (같은 주소가 대소문자만 달라 캡을 우회하지 못하게)
 * · 길이·형식·연속 점(..) 검사
 */
export function normalizeLeadEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return null;
  if (value.includes('..')) return null;
  if (!EMAIL_RE.test(value)) return null;
  const [local, domain] = value.split('@');
  // 로컬 파트 64자 상한, 도메인 TLD 2자 이상 — 오타성 주소를 여기서 거른다.
  if (local.length > 64) return null;
  if (!/\.[A-Za-z]{2,}$/.test(domain)) return null;
  return value;
}

/* ── 남용 방어 캡 (blog-check-limits 패턴, 저장소만 분리) ── */

/** 발송 요청 IP당 일일 기본 캡. env: DIAGNOSIS_EMAIL_IP_DAILY_LIMIT */
export const DEFAULT_EMAIL_IP_DAILY_LIMIT = 5;
/** 같은 수신 주소 일일 기본 캡 — 남의 주소로 반복 발송하는 것을 막는다. env: DIAGNOSIS_EMAIL_ADDRESS_DAILY_LIMIT */
export const DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT = 3;
/** 전체 일일 기본 캡. env: DIAGNOSIS_EMAIL_GLOBAL_DAILY_LIMIT */
export const DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT = 200;

export interface EmailLeadLimits {
  readonly ipDaily: number;
  readonly addressDaily: number;
  readonly globalDaily: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** env 에서 캡을 읽는다. 비정상 값은 기본값 (절대 throw 안 함). */
export function readEmailLeadLimits(env: NodeJS.ProcessEnv = process.env): EmailLeadLimits {
  return {
    ipDaily: parsePositiveInt(env.DIAGNOSIS_EMAIL_IP_DAILY_LIMIT, DEFAULT_EMAIL_IP_DAILY_LIMIT),
    addressDaily: parsePositiveInt(
      env.DIAGNOSIS_EMAIL_ADDRESS_DAILY_LIMIT,
      DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
    ),
    globalDaily: parsePositiveInt(
      env.DIAGNOSIS_EMAIL_GLOBAL_DAILY_LIMIT,
      DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
    ),
  };
}

/** KST(UTC+9) 기준 날짜 키 (yyyy-mm-dd) — blog-check-limits 와 동일 경계. */
export function emailKstDayKey(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type EmailLeadLimitReason = 'ip_limit' | 'address_limit' | 'global_limit';

export type EmailLeadDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EmailLeadLimitReason };

/**
 * 캡 검사 후 통과 시 카운터를 소비한다 (검사·소비 원자 — 단일 함수).
 * store 는 key→count Map. 지난 날짜 키는 정리한다(무한 성장 방지).
 *
 * 검사 순서는 넓은 것부터: 전체 → 수신주소 → IP.
 * 어느 하나라도 걸리면 **아무 카운터도 소비하지 않는다**(거부된 요청이 캡을 갉아먹지 않게).
 */
export function consumeEmailLeadQuota(
  store: Map<string, number>,
  input: {
    readonly ip: string;
    readonly email: string;
    readonly now?: number;
    readonly limits?: EmailLeadLimits;
  },
): EmailLeadDecision {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? {
    ipDaily: DEFAULT_EMAIL_IP_DAILY_LIMIT,
    addressDaily: DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT,
    globalDaily: DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT,
  };
  const day = emailKstDayKey(now);
  const globalKey = `global:${day}`;
  const ipKey = `ip:${day}:${input.ip || 'unknown'}`;
  const addressKey = `addr:${day}:${input.email}`;

  // 지난 날짜 키 정리
  const suffix = `:${day}:`;
  for (const key of store.keys()) {
    if (key === globalKey || key.includes(suffix)) continue;
    store.delete(key);
  }

  const globalCount = store.get(globalKey) ?? 0;
  if (globalCount >= limits.globalDaily) return { allowed: false, reason: 'global_limit' };

  const addressCount = store.get(addressKey) ?? 0;
  if (addressCount >= limits.addressDaily) return { allowed: false, reason: 'address_limit' };

  const ipCount = store.get(ipKey) ?? 0;
  if (ipCount >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };

  store.set(globalKey, globalCount + 1);
  store.set(addressKey, addressCount + 1);
  store.set(ipKey, ipCount + 1);
  return { allowed: true };
}

/** 캡 초과 시 사용자에게 보여줄 문구 — 캡 숫자를 문구에 박지 않는다. */
export function emailLimitMessage(reason: EmailLeadLimitReason): string {
  if (reason === 'global_limit') {
    return '오늘 메일 발송 요청이 몰려 있어요. 내일 다시 시도해 주세요.';
  }
  if (reason === 'address_limit') {
    return '이 주소로는 오늘 이미 보내드렸어요. 메일함(스팸함 포함)을 확인해 주세요.';
  }
  return '잠시 후 다시 시도해 주세요. 짧은 시간에 요청이 많았어요.';
}

/* ── 메일 본문 ───────────────────────────────────────────── */

/** HTML 이스케이프 — 병원명 등 외부에서 온 문자열은 반드시 통과시킨다. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface DiagnosisEmailInput {
  readonly clinicName: string;
  readonly summary: DiagnosisLeadSummary;
  /** 결과를 다시 여는 절대 주소. */
  readonly reportUrl: string;
  /** 진단 시각 ISO. */
  readonly runAt: string;
}

export interface DiagnosisEmailContent {
  readonly subject: string;
  readonly html: string;
}

/**
 * 본문에 넣을 사실 줄 — **진단이 실제로 확인한 값만**. null 인 항목은 아예 빼고,
 * 추정으로 메우지 않는다(화면과 같은 원칙).
 */
export function buildEmailFactLines(summary: DiagnosisLeadSummary): readonly string[] {
  const lines: string[] = [];
  if (typeof summary.daysSinceLatestPost === 'number') {
    lines.push(`마지막 블로그 글: ${summary.daysSinceLatestPost}일 전`);
  }
  if (typeof summary.prohibitedCount === 'number' && summary.prohibitedCount > 0) {
    lines.push(`의료법이 광고에서 명시적으로 금지한 유형에 해당할 수 있는 표현: ${summary.prohibitedCount}건`);
  }
  if (typeof summary.cautionCount === 'number' && summary.cautionCount > 0) {
    lines.push(`심의에서 자주 지적되는 표현: ${summary.cautionCount}건`);
  }
  if (typeof summary.keywordsChecked === 'number' && summary.keywordsChecked > 0) {
    lines.push(`실측한 키워드 ${summary.keywordsChecked}개 중 상위권 ${summary.keywordsTop10 ?? 0}개`);
  }
  if (typeof summary.aiRecommendTotal === 'number' && summary.aiRecommendTotal > 0) {
    lines.push(
      `AI 추천 질문 ${summary.aiRecommendTotal}개 중 병원 이름이 나온 질문 ${summary.aiRecommendMentioned ?? 0}개`,
    );
  }
  return lines;
}

/**
 * 진단 결과 메일 — 요약 + 결과 링크.
 *
 * ⚠️ 의료광고법 표현 규칙은 화면과 동일하다: "위반입니다" 단정 금지, 조문 인용 금지,
 *    면책 문구 유지. 메일이라고 톤을 세게 쓰면 그 자체가 리스크다.
 */
export function buildDiagnosisEmail(input: DiagnosisEmailInput): DiagnosisEmailContent {
  const name = escapeHtml(input.clinicName);
  const url = escapeHtml(input.reportUrl);
  const facts = buildEmailFactLines(input.summary);
  const runAtText = (() => {
    const t = Date.parse(input.runAt);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
  })();

  const subject =
    input.summary.badCount > 0
      ? `[닥터포스트] ${input.clinicName} 온라인 노출 진단 — 지금 고쳐야 할 것 ${input.summary.badCount}건`
      : `[닥터포스트] ${input.clinicName} 온라인 노출 진단 결과`;

  const factHtml =
    facts.length > 0
      ? `<ul style="margin:0 0 20px;padding-left:20px;color:#3c4653;font-size:14px;line-height:1.9">${facts
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ul>`
      : '';

  const scopeHtml =
    input.summary.badCount > 0
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#3c4653">지금 고쳐야 할 것 <b>${input.summary.badCount}건</b> 중 <b>${input.summary.ourScopeCount}건</b>은 닥터포스트가 대신할 수 있는 항목입니다.</p>`
      : '';

  const html = `<!doctype html>
<html lang="ko"><body style="margin:0;padding:0;background:#f7f9fb">
<div style="max-width:600px;margin:0 auto;padding:32px 20px;background:#ffffff;color:#202020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:2px;color:#ff4628">FREE CHECK</p>
  <h1 style="margin:0 0 6px;font-size:22px;line-height:1.35;font-weight:800">${name} 온라인 노출 진단 결과</h1>
  <p style="margin:0 0 24px;font-size:12px;color:#8a93a0">${escapeHtml(runAtText)} 진단 · 요청하신 주소로 보내드립니다</p>
  ${factHtml}
  ${scopeHtml}
  <p style="margin:0 0 28px">
    <a href="${url}" style="display:inline-block;padding:14px 28px;background:#ff4628;color:#ffffff;font-weight:700;font-size:15px;border-radius:10px;text-decoration:none">진단 결과 전체 보기</a>
  </p>
  <p style="margin:0 0 20px;font-size:12px;line-height:1.8;color:#5b6573">링크가 열리지 않으면 주소를 직접 붙여넣어 주세요:<br><span style="word-break:break-all;color:#8a93a0">${url}</span> (30일 후 만료)</p>
  <hr style="border:none;border-top:1px solid #dbe2ea;margin:0 0 16px">
  <p style="margin:0 0 12px;font-size:11px;line-height:1.8;color:#8a93a0">
    본 진단은 행정안전부 공표 정보와 네이버 공개 API, 공개된 블로그 글·홈페이지를 각각 한 번씩 열어 만든 특정 시점의 참고 자료입니다.
    표현 점검은 기계적으로 찾아 표시한 것이며 저희가 위반 여부를 판단한 것은 아닙니다. 최종 판단은 심의기관과 담당 변호사의 몫입니다.
  </p>
  <p style="margin:0;font-size:11px;line-height:1.8;color:#8a93a0">
    이 메일은 진단 결과를 받아보시겠다고 직접 요청하셔서 1회 발송된 메일입니다. 광고성 정보는 보내지 않습니다.<br>
    광고진정성 · 대구광역시 수성구 청호로422 2층 · 070-8095-3320
  </p>
</div>
</body></html>`;

  return { subject, html };
}

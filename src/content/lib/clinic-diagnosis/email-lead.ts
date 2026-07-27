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
 *    보내게 하는 통로**다(우리 도메인 발신·우리 회신주소). 남의 주소를 넣어
 *    괴롭히거나 경쟁 병원에 뿌리는 데 쓰이면 발신 도메인 평판이 죽고 콜드메일
 *    영업까지 같이 죽는다. 그래서 캡은 5중이고(전체·IP·토큰·토큰당 주소수·수신주소),
 *    본문에 사용자 입력 문자열을 싣지 않는다(병원명·진단 수치 등 서버가 가진 값만).
 *
 * ★ 캡 판정은 **여기서 세지 않는다** — 이 모듈은 이미 센 값(EmailLeadCounts)으로
 *   판정만 한다. 실제 집계는 라우트가 DB(clinic_diagnosis_email_leads.created_at)로
 *   한다. 인메모리 카운터는 서버리스에서 인스턴스마다 따로 돌아 캡이 인스턴스 수만큼
 *   곱해지므로, **외부로 메일을 쏘는 엔드포인트에는 쓸 수 없다.**
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지) — node:test 러너로 직접 검증 가능.
 * (node: 내장 모듈은 예외 — node:crypto 는 러너에서 그대로 쓸 수 있다.)
 */

import { createHash } from 'node:crypto';

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

/* ── 남용 방어 캡 (DB 집계 기반 판정) ────────────────────── */

/** 발송 요청 IP당 일일 기본 캡. env: DIAGNOSIS_EMAIL_IP_DAILY_LIMIT */
export const DEFAULT_EMAIL_IP_DAILY_LIMIT = 5;
/** 같은 수신 주소 일일 기본 캡 — 남의 주소로 반복 발송하는 것을 막는다. env: DIAGNOSIS_EMAIL_ADDRESS_DAILY_LIMIT */
export const DEFAULT_EMAIL_ADDRESS_DAILY_LIMIT = 3;
/** 전체 일일 기본 캡. env: DIAGNOSIS_EMAIL_GLOBAL_DAILY_LIMIT */
export const DEFAULT_EMAIL_GLOBAL_DAILY_LIMIT = 200;
/**
 * 같은 진단 결과(공유 토큰) 하나로 보낼 수 있는 일일 발송 횟수.
 * 토큰은 진단만 돌리면 누구나 얻을 수 있으므로, 토큰 하나가 발신기가 되면 안 된다.
 * env: DIAGNOSIS_EMAIL_TOKEN_DAILY_LIMIT
 */
export const DEFAULT_EMAIL_TOKEN_DAILY_LIMIT = 3;
/**
 * 같은 토큰으로 보낼 수 있는 **서로 다른 수신 주소 수** (기간 무관).
 * 정상 사용은 본인 주소 1개, 많아야 원장님/실장님 2개다. 3개째부터는 뿌리는 행위로 본다.
 * env: DIAGNOSIS_EMAIL_TOKEN_ADDRESS_LIMIT
 */
export const DEFAULT_EMAIL_TOKEN_ADDRESS_LIMIT = 2;

export interface EmailLeadLimits {
  readonly ipDaily: number;
  readonly addressDaily: number;
  readonly globalDaily: number;
  readonly tokenDaily: number;
  readonly tokenAddresses: number;
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
    tokenDaily: parsePositiveInt(
      env.DIAGNOSIS_EMAIL_TOKEN_DAILY_LIMIT,
      DEFAULT_EMAIL_TOKEN_DAILY_LIMIT,
    ),
    tokenAddresses: parsePositiveInt(
      env.DIAGNOSIS_EMAIL_TOKEN_ADDRESS_LIMIT,
      DEFAULT_EMAIL_TOKEN_ADDRESS_LIMIT,
    ),
  };
}

/**
 * KST(UTC+9) 하루의 시작 시각을 UTC ISO 로 반환한다 — DB 집계 경계(created_at >= 이 값).
 * blog-check-limits 의 KST 일 경계와 같은 날짜에 대응한다.
 */
export function kstDayStartIso(now: number = Date.now()): string {
  const shifted = new Date(now + 9 * 60 * 60 * 1000);
  const startUtcMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    9 * 60 * 60 * 1000;
  return new Date(startUtcMs).toISOString();
}

export type EmailLeadLimitReason =
  | 'ip_limit'
  | 'address_limit'
  | 'global_limit'
  | 'token_limit'
  | 'token_address_limit';

export type EmailLeadDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EmailLeadLimitReason };

/**
 * 이미 저장된 리드 행에서 센 값. 전부 **DB 집계 결과**다(라우트가 채운다).
 * 셀 수 없으면(테이블 없음·조회 실패) 이 구조를 만들지 못하고, 그때는 발송하지 않는다.
 */
export interface EmailLeadCounts {
  /** 오늘(KST) 전체 발송 요청 수. */
  readonly globalToday: number;
  /** 오늘 같은 IP(해시)에서 온 수. */
  readonly ipToday: number;
  /** 오늘 같은 수신 주소로 나간 수. */
  readonly addressToday: number;
  /** 오늘 같은 공유 토큰으로 나간 수. */
  readonly tokenToday: number;
  /** 이 토큰으로 이미 발송된 **다른** 주소의 수 (요청 주소 제외, 기간 무관). */
  readonly tokenOtherAddresses: number;
}

/**
 * 캡 판정 — 소비(카운터 증가)가 없다. 실제 소비는 리드 행이 저장되는 순간 자연히 일어난다.
 *
 * 그래서 **만료·없는 토큰처럼 거부되는 요청은 캡을 전혀 소비하지 않는다**
 * (행이 안 생기니까). 인메모리 시절의 "거부된 요청이 캡을 갉아먹는" 문제가 구조적으로 사라진다.
 *
 * ⚠️ 한계: count → insert 사이는 원자적이지 않아 동시 요청이 캡을 1~2건 넘길 수 있다.
 *    인스턴스 수만큼 곱해지던 인메모리와 달리 오차가 상수이므로 수용한다.
 */
export function evaluateEmailLeadQuota(
  counts: EmailLeadCounts,
  limits: EmailLeadLimits,
): EmailLeadDecision {
  if (counts.globalToday >= limits.globalDaily) return { allowed: false, reason: 'global_limit' };
  if (counts.ipToday >= limits.ipDaily) return { allowed: false, reason: 'ip_limit' };
  if (counts.tokenToday >= limits.tokenDaily) return { allowed: false, reason: 'token_limit' };
  if (counts.tokenOtherAddresses + 1 > limits.tokenAddresses) {
    return { allowed: false, reason: 'token_address_limit' };
  }
  if (counts.addressToday >= limits.addressDaily) return { allowed: false, reason: 'address_limit' };
  return { allowed: true };
}

/**
 * 캡 초과 시 사용자에게 보여줄 문구.
 *
 * ★ 사유와 무관하게 **한 문장으로 통일**한다. 사유별로 다르게 말하면
 *   "이 주소로는 오늘 이미 보내드렸어요" 가 곧 **특정 주소가 오늘 이 서비스로 메일을
 *   받았는지 확인하는 오라클**이 된다(아무나 남의 주소를 넣어보면 알 수 있다).
 *   사유는 서버 로그에만 남긴다. 캡 숫자도 문구에 박지 않는다.
 */
export function emailLimitMessage(_reason: EmailLeadLimitReason): string {
  return '지금은 메일을 보내드릴 수 없어요. 잠시 후 또는 내일 다시 시도해 주세요. 급하시면 070-8095-3320 으로 연락 주세요.';
}

/**
 * 요청 IP 해시 — **원본 IP 를 저장하지 않기 위해서**다. 용도는 발송 한도 집계뿐이다.
 * 솔트(env DIAGNOSIS_EMAIL_IP_SALT)가 있으면 함께 넣는다(레인보우 역추적 방지).
 */
export function hashClientIp(ip: string, salt: string = ''): string {
  const value = (ip || '').trim();
  if (value.length === 0) return 'unknown';
  return createHash('sha256').update(`${salt}|${value}`).digest('hex').slice(0, 32);
}

/* ── 저장된 리포트에서 꺼내 쓰는 값 (방어적 추출) ───────── */

/**
 * 문자열이 아닐 수도 있는 값을 안전한 문자열로. 저장된 **옛 리포트**에는 필드가
 * 아예 없을 수 있다 — `clinic.specialty.slice()` 같은 접근이 TypeError 를 내면
 * 라우트가 500 을 내고, 그 시점이 발송 이후면 메일은 나간 채로 사용자가 재시도한다.
 */
export function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** 리드 테이블에 넣는 병원 필드 — 전부 문자열 보장(컬럼이 not null 이라 null 을 넣을 수 없다). */
export interface LeadClinicFields {
  readonly mngNo: string;
  readonly name: string;
  readonly region: string;
  readonly specialty: string;
  readonly phone: string;
}

/** 저장된 리포트의 clinic 을 결측 허용으로 읽는다. 어떤 입력에도 throw 하지 않는다. */
export function extractLeadClinicFields(clinic: unknown): LeadClinicFields {
  const c = (clinic ?? {}) as Record<string, unknown>;
  const province = safeText(c.province, 30);
  const region = safeText(c.region, 30);
  return {
    mngNo: safeText(c.mngNo, 60),
    name: safeText(c.name, 120),
    region: `${province} ${region}`.trim().slice(0, 60),
    specialty: safeText(c.specialty, 40),
    phone: safeText(c.phone, 30),
  };
}

/** 진단 시각 — 파싱되는 ISO 만 통과. 깨졌으면 null(컬럼 nullable). */
export function normalizeDiagnosedAt(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
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

/**
 * 메일 제목용 정리 — 제목은 HTML 이 아니라 **헤더 값**이다.
 * escapeHtml 을 쓰면 제목에 `&amp;` 가 그대로 보인다. 대신
 * 줄바꿈·제어문자를 제거해(헤더 주입 차단) 길이를 자른다.
 */
export function sanitizeSubjectText(value: unknown, max = 60): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * KST 기준 날짜(yyyy-mm-dd). UTC 로 찍으면 **KST 09시 이전 진단이 하루 전 날짜**로
 * 나가서 원장이 "이건 어제 것 아닌가" 하게 된다. 파싱 실패 시 빈 문자열.
 */
export function formatKstDate(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DiagnosisEmailInput {
  readonly clinicName: string;
  /** 요약을 만들지 못한 옛 리포트면 null — 그때는 링크만 담아 보낸다. */
  readonly summary: DiagnosisLeadSummary | null;
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
  // 제목·본문 모두 **정리한 이름**을 쓴다(제어문자 제거 → 본문은 추가로 HTML 이스케이프).
  const safeName = sanitizeSubjectText(input.clinicName);
  const name = escapeHtml(safeName);
  const url = escapeHtml(input.reportUrl);
  const summary = input.summary;
  const badCount = summary?.badCount ?? 0;
  const facts = summary ? buildEmailFactLines(summary) : [];
  const runAtText = formatKstDate(input.runAt);

  // 이름을 못 읽은 리포트면 이름 자리를 비운다(빈 자리에 '' 를 넣어 어색해지지 않게).
  const subjectName = safeName.length > 0 ? `${safeName} ` : '';
  const subject =
    badCount > 0
      ? `[닥터포스트] ${subjectName}온라인 노출 진단 — 지금 고쳐야 할 것 ${badCount}건`
      : `[닥터포스트] ${subjectName}온라인 노출 진단 결과`;
  const headingName = name.length > 0 ? `${name} ` : '';

  const factHtml =
    facts.length > 0
      ? `<ul style="margin:0 0 20px;padding-left:20px;color:#3c4653;font-size:14px;line-height:1.9">${facts
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ul>`
      : '';

  const scopeHtml =
    summary && badCount > 0
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#3c4653">지금 고쳐야 할 것 <b>${badCount}건</b> 중 <b>${summary.ourScopeCount}건</b>은 닥터포스트가 대신할 수 있는 항목입니다.</p>`
      : '';

  const html = `<!doctype html>
<html lang="ko"><body style="margin:0;padding:0;background:#f7f9fb">
<div style="max-width:600px;margin:0 auto;padding:32px 20px;background:#ffffff;color:#202020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:2px;color:#ff4628">FREE CHECK</p>
  <h1 style="margin:0 0 6px;font-size:22px;line-height:1.35;font-weight:800">${headingName}온라인 노출 진단 결과</h1>
  <p style="margin:0 0 24px;font-size:12px;color:#8a93a0">${escapeHtml(runAtText)} 진단(한국 시간 기준) · 요청하신 주소로 보내드립니다</p>
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

/**
 * 미인증 공개 엔드포인트의 남용 캡 — `/api/ebook-lead`, `/api/clinic/lookup`.
 *
 * ★ 왜 필요한가 (2026-08-03 주간점검).
 *   두 엔드포인트만 캡이 없었다. 각각 손해의 성격이 다르다:
 *     · ebook-lead  — 쓰기 엔드포인트다. 막지 않으면 리드 테이블이 가짜 주소로 오염되고,
 *                     나중에 그 명부로 메일을 보내면 **발신 도메인 평판**이 깎인다.
 *                     허니팟·형식검증은 "봇이 성의 없을 때"만 듣는다.
 *     · clinic/lookup — 네이버 지역검색 **일일 쿼터를 태우는 프록시**다. 쿼터가 마르면
 *                     가입 자동채우기와 진단 폴백 검색이 **함께** 죽는다. 이건 남의 집
 *                     한도라 우리가 복구할 방법이 없다 — 하루를 기다려야 한다.
 *
 * ⚠️ **"전체 캡" 은 실제 전체 캡이 아니다.** 저장소가 프로세스 메모리라 서버리스
 *    인스턴스마다 따로 센다 — 인스턴스가 2개면 실효 상한도 2배가 되고, cold start 가
 *    반복되면 더 커진다. IP 캡도 마찬가지다. 즉 이건 **한 인스턴스에서의 폭주 방어**이지
 *    보장된 상한이 아니다(2026-08-03 지적으로 문구 정정 — 보장한다고 써 두면 나중에
 *    쿼터가 터졌을 때 원인을 엉뚱한 데서 찾는다).
 *
 *    특히 clinic/lookup 의 목적이 **공유 자원(네이버 일일 쿼터) 보호**라는 점에서 이
 *    한계는 실질적이다. 확실히 보호하려면 공유 저장소(DB·KV)로 옮겨야 한다 — 규모가
 *    커지기 전에는 인스턴스가 한둘이라 실효가 있고, 그 전까지의 임시 방어다.
 *    기존 blog-check·clinic-diagnosis 캡도 같은 전제 위에 있다.
 *
 * ⚠️ Map 은 엔드포인트마다 **분리**한다. 같은 Map 을 공유하면 한쪽 사용량이
 *    다른 쪽 캡을 잠식한다(limits.ts 가 이미 겪은 문제).
 */

import {
  consumeBlogCheckQuota,
  extractClientIp,
  type BlogCheckLimits,
  type RateLimitDecision,
} from './blog-check-limits.ts';

export { extractClientIp };

/**
 * 전자책 리드 — IP당 일 5회.
 *
 * 사람은 자료 하나 받으려고 하루에 다섯 번 넘게 제출하지 않는다.
 * 병원 여러 곳을 대신 넣는 경우를 생각해도 5회면 넉넉하다.
 */
export const DEFAULT_EBOOK_LEAD_IP_LIMIT = 5;
/** 전자책 리드 인스턴스별 일 200회 — 하루 200건이 넘게 들어오면 그건 성과가 아니라 사고다. */
export const DEFAULT_EBOOK_LEAD_GLOBAL_LIMIT = 200;

/**
 * 병원 자동완성 — IP당 일 60회.
 *
 * 가입 한 번에 오타를 고쳐 가며 몇 차례 검색하는 것이 정상이고, 영업 담당자가
 * 여러 병원을 넣어 보는 경우까지 감안했다. 진단 쪽 후보검색 캡(30)보다 넉넉한 이유는
 * 이 경로가 **가입 화면**이라 막히면 곧바로 전환 손실이기 때문이다.
 */
export const DEFAULT_CLINIC_LOOKUP_IP_LIMIT = 60;
/**
 * 병원 자동완성 인스턴스별 일 2,000회.
 *
 * 네이버 지역검색 일일 쿼터(25,000) 대비 충분히 낮게 잡아, 이 엔드포인트가
 * 혼자 쿼터를 다 태우고 진단 폴백까지 죽이는 일이 없게 한다.
 * (인스턴스가 여러 개면 그만큼 곱해진다 — 파일 상단 경고 참조.)
 */
export const DEFAULT_CLINIC_LOOKUP_GLOBAL_LIMIT = 2_000;

function readLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readEbookLeadLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  return {
    ipDaily: readLimit(env.EBOOK_LEAD_IP_DAILY_LIMIT, DEFAULT_EBOOK_LEAD_IP_LIMIT),
    globalDaily: readLimit(env.EBOOK_LEAD_GLOBAL_DAILY_LIMIT, DEFAULT_EBOOK_LEAD_GLOBAL_LIMIT),
  };
}

export function readClinicLookupLimits(env: NodeJS.ProcessEnv = process.env): BlogCheckLimits {
  return {
    ipDaily: readLimit(env.CLINIC_LOOKUP_AUTOFILL_IP_DAILY_LIMIT, DEFAULT_CLINIC_LOOKUP_IP_LIMIT),
    globalDaily: readLimit(
      env.CLINIC_LOOKUP_AUTOFILL_GLOBAL_DAILY_LIMIT,
      DEFAULT_CLINIC_LOOKUP_GLOBAL_LIMIT,
    ),
  };
}

const ebookLeadStore = new Map<string, number>();
const clinicLookupStore = new Map<string, number>();

export function consumeEbookLeadQuota(ip: string, now?: number): RateLimitDecision {
  return consumeBlogCheckQuota(ebookLeadStore, { ip, now, limits: readEbookLeadLimits() });
}

export function consumeClinicLookupQuota(ip: string, now?: number): RateLimitDecision {
  return consumeBlogCheckQuota(clinicLookupStore, { ip, now, limits: readClinicLookupLimits() });
}

/**
 * 사용자에게 보여줄 문구.
 *
 * 전체 캡에 걸린 사람에게 "너무 많이 요청했다" 고 하면 거짓말이다 — 본인은 처음
 * 눌렀을 수 있다. 두 이유를 구분해서 말한다.
 */
export function publicLimitMessage(reason: 'ip_limit' | 'global_limit' | 'user_limit'): string {
  // user_limit 은 이 두 엔드포인트에서 발생하지 않지만(회원 캡을 쓰지 않는다),
  // 타입 전수성을 위해 개인 한도와 같은 문구로 묶는다.
  return reason === 'global_limit'
    ? '지금 요청이 몰려 잠시 제한되고 있습니다. 잠시 후 다시 시도해 주세요.'
    : '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
}

/** 테스트용 — 저장소 초기화. */
export function __resetPublicEndpointLimits(): void {
  ebookLeadStore.clear();
  clinicLookupStore.clear();
}

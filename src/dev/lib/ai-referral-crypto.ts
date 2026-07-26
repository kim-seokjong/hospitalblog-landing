/**
 * AI 유입 비콘 — 서명·해싱 (서버 전용, node:crypto).
 *
 * 두 가지 일을 한다.
 *
 * 1) **비콘 서명 토큰** — 페이지를 렌더할 때 (병원 slug · 글 id · 만료시각) 을 묶어
 *    HMAC-SHA256 으로 서명하고, 비콘이 그 서명을 되돌려주면 대조한다.
 *    이것이 없으면 slug·postId 가 전부 공개값이라 **누구나 임의 병원의 통계를
 *    조작**할 수 있다(경쟁 병원이 우리 고객 데이터를 오염시키는 시나리오).
 *    서명은 "우리 서버가 그 병원의 그 페이지를 최근에 실제로 렌더했다"는 증거이며,
 *    남의 병원 slug 로는 애초에 토큰을 만들 수 없다.
 *
 *    ⚠️ 한계(수용): 공개 페이지이므로 공격자가 직접 페이지를 받아 토큰을 뽑아
 *    재사용하는 것까지는 막지 못한다. 짧은 만료(10분) + 발신원 단위 레이트리밋으로
 *    재사용 창과 속도를 좁힌다. 완전 차단이 필요해지면 1회용 nonce 저장소가 필요한데,
 *    현 단계에서는 과설계다.
 *
 * 2) **레이트리밋 키 해싱** — 원본 IP 를 카운터 키로 쓰면 그 값이 하루치 메모리에
 *    남는다. 프로세스마다 무작위 salt + KST 일자로 HMAC 해 되돌릴 수 없는 키만
 *    남긴다. salt 는 프로세스 밖으로 나가지 않고 재시작마다 새로 생성된다.
 *
 * 시크릿(AI_REFERRAL_BEACON_SECRET)이 없으면 **비콘 기능 전체가 조용히 꺼진다** —
 * 토큰이 발급되지 않아 클라이언트가 아무 요청도 보내지 않고, 라우트는 전부 거부한다.
 * 배포는 정상 동작하며 집계만 쌓이지 않는다.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  buildBeaconSigningInput,
  isBeaconExpValid,
  BEACON_SIGNATURE_LENGTH,
  BEACON_TOKEN_TTL_MS,
  kstDateKey,
  type ParsedBeacon,
} from '@/content/lib/ai-referral/request';

/** 시크릿을 읽는다. 미설정(또는 너무 짧으면) null → 비콘 비활성. */
function readSecret(): string | null {
  const raw = process.env.AI_REFERRAL_BEACON_SECRET;
  if (typeof raw !== 'string') return null;
  const secret = raw.trim();
  // 너무 짧은 값은 설정 실수로 보고 거부한다(HMAC 강도 확보).
  return secret.length >= 16 ? secret : null;
}

/** 비콘 계측이 켜져 있는지 (시크릿 설정 여부). */
export function isBeaconSigningEnabled(): boolean {
  return readSecret() !== null;
}

export interface BeaconToken {
  /** HMAC-SHA256 hex 서명. */
  token: string;
  /** 만료시각 (epoch ms). */
  exp: number;
}

/**
 * 페이지 렌더 시 토큰을 발급한다. 시크릿 미설정이면 null (비콘 비활성).
 * 절대 throw 하지 않는다 — 계측 때문에 방문자 페이지가 500 이 되면 안 된다.
 */
export function issueBeaconToken(
  slug: string,
  postId: string | null = null,
  now: number = Date.now(),
): BeaconToken | null {
  const secret = readSecret();
  if (secret === null) return null;
  try {
    const exp = now + BEACON_TOKEN_TTL_MS;
    const token = createHmac('sha256', secret)
      .update(buildBeaconSigningInput(slug, postId, exp))
      .digest('hex');
    return { token, exp };
  } catch {
    return null;
  }
}

/**
 * 비콘이 돌려준 토큰을 대조한다. 만료 창 검사 → 서명 대조(타이밍 안전) 순.
 * 어떤 실패도 throw 하지 않고 false 를 돌려준다.
 */
export function verifyBeaconToken(beacon: ParsedBeacon, now: number = Date.now()): boolean {
  const secret = readSecret();
  if (secret === null) return false;
  if (!isBeaconExpValid(beacon.exp, now)) return false;
  try {
    const expected = createHmac('sha256', secret)
      .update(buildBeaconSigningInput(beacon.slug, beacon.postId, beacon.exp))
      .digest('hex');
    if (expected.length !== BEACON_SIGNATURE_LENGTH || beacon.token.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(beacon.token, 'utf8'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 레이트리밋 키 해싱 — 원본 IP 를 메모리에도 남기지 않는다
// ---------------------------------------------------------------------------

/**
 * 프로세스 수명 동안만 사용하는 무작위 salt.
 * 밖으로 나가지 않고 재시작마다 바뀌므로, 카운터 키에서 IP 를 역산할 수 없다.
 */
const RATE_LIMIT_SALT = randomBytes(32);

/**
 * IP → 되돌릴 수 없는 카운터 키. 일자를 함께 섞어 날짜가 바뀌면 키도 바뀐다.
 * 반환값은 16바이트(32 hex) — 충돌 확률이 무시할 수준이면서 짧다.
 */
export function hashRateLimitKey(ip: string, now: number = Date.now()): string {
  try {
    return createHmac('sha256', RATE_LIMIT_SALT)
      .update(`${kstDateKey(now)}|${ip}`)
      .digest('hex')
      .slice(0, 32);
  } catch {
    return 'unknown';
  }
}

/**
 * AI 유입 비콘 — 서명·해싱 (서버 전용, node:crypto).
 *
 * 두 가지 일을 한다.
 *
 * 1) **비콘 서명 토큰** — (병원 slug · 출처 · 글 id · 만료시각) 을 묶어 HMAC-SHA256
 *    으로 서명하고, 비콘이 그 서명을 되돌려주면 대조한다. 발급은 방문 시점에
 *    별도 동적 경로(/api/clinic-site/ai-referral/token)에서 이뤄진다 — 페이지
 *    HTML 에 박으면 토큰 수명과 페이지 캐시 수명이 어긋나 정상 유입이 조용히
 *    거부된다(2차 리뷰에서 차단된 실제 버그).
 *
 *    ★ 보증 범위 (과대 표현 금지):
 *      - 보증한다: 서명이 우리 서버에서 발급됐고(오프라인 위조 불가), 10분 안이며,
 *        적재되는 (slug·source·postId) 가 서명 시점과 같다.
 *      - 보증하지 않는다: 사람인지, 정말 AI 에서 왔는지, 처음 쓰이는 토큰인지.
 *        발급 경로도 병원 페이지도 공개라 **누구나 유효 토큰을 얻을 수 있다.**
 *    즉 "위조 방어"가 아니라 **위조 비용을 올리는 장치**다(오프라인 대량 생성 차단,
 *    온라인 왕복 강제, 재사용 창 10분). 피해 규모를 실제로 묶는 것은 발신원 단위
 *    레이트리밋이다. 1회용 nonce 저장소는 현 단계에서 과설계로 판단했다.
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
import type { AiReferralSourceId } from '@/content/lib/ai-referral/sources';

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
 * 방문 시점에 토큰을 발급한다. 시크릿 미설정이면 null (비콘 비활성).
 * 절대 throw 하지 않는다 — 계측 때문에 요청이 500 이 되면 안 된다.
 */
export function issueBeaconToken(
  slug: string,
  source: AiReferralSourceId,
  postId: string | null = null,
  now: number = Date.now(),
): BeaconToken | null {
  const secret = readSecret();
  if (secret === null) return null;
  try {
    const exp = now + BEACON_TOKEN_TTL_MS;
    const token = createHmac('sha256', secret)
      .update(buildBeaconSigningInput(slug, source, postId, exp))
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
      .update(buildBeaconSigningInput(beacon.slug, beacon.source, beacon.postId, beacon.exp))
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

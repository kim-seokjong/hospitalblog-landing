import { NextRequest, NextResponse } from 'next/server';
import { recordAiReferralVisit } from '@/dev/lib/ai-referral-server';
import { hashRateLimitKey, verifyBeaconToken } from '@/dev/lib/ai-referral-crypto';
import {
  parseAiReferralBeaconText,
  isLikelyBotUserAgent,
  consumeAiReferralQuota,
  readAiReferralLimits,
  MAX_BEACON_BODY_BYTES,
} from '@/content/lib/ai-referral/request';
import { extractClientIp } from '@/content/lib/blog-check-limits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/clinic-site/ai-referral — 병원 블로그 AI 유입 비콘 (공개, 인증 없음).
 *
 * body: { slug, source, postId?, exp, token }
 *
 * 호출자는 병원 블로그 페이지에 심긴 비콘 컴포넌트(navigator.sendBeacon)뿐이다.
 * **방문자 렌더 경로 밖**에서 비동기로 호출되므로 이 라우트가 느리거나 실패해도
 * 페이지에는 아무 영향이 없다.
 *
 * 가드 (순서대로):
 *  1. 봇/크롤러 UA 제외 — UA 는 판정에만 쓰고 **DB 로 내보내지 않는다**
 *  2. 본문 크기 상한 + 화이트리스트 검증(slug 형식·출처 목록·postId UUID·토큰 형식)
 *  3. ★ HMAC 서명 토큰 대조 — "우리 서버가 그 병원의 그 페이지를 최근 렌더했다"는
 *     증거. 이게 없으면 slug·postId 가 전부 공개값이라 **누구나 임의 병원의 통계를
 *     조작**할 수 있다. 시크릿 미설정이면 전부 거부(기능 비활성).
 *  4. 레이트리밋 — 위조 방어가 아니라 남용 완충. 키는 해시된 IP 이며
 *     발신원 기준으로만 잡아 남의 병원 집계를 고갈시킬 수 없다.
 *  5. 적재 (slug→병원, 글 소유·발행 검증은 DB 함수가 마무리)
 *
 * 응답은 성공·거부·오류 어느 쪽이든 **항상 204** 다:
 *  - 비콘은 응답 본문을 읽지 않는다
 *  - 슬러그 존재 여부·검증 결과가 응답으로 새어 열거(enumeration)에 쓰이지 않게 한다
 */

const QUOTA_KEY = '__dp_ai_referral_quota__';
function getQuotaStore(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[QUOTA_KEY] instanceof Map)) {
    g[QUOTA_KEY] = new Map<string, number>();
  }
  return g[QUOTA_KEY] as Map<string, number>;
}

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1) 봇 제외 — 크롤러 수집은 "사람의 방문"이 아니다. UA 는 여기서만 쓰고 버린다.
    if (isLikelyBotUserAgent(req.headers.get('user-agent'))) {
      return noContent();
    }

    // 2) 본문 검증 (sendBeacon 은 Content-Type 이 제각각이라 text 로 읽어 파싱)
    const raw = await req.text().catch(() => '');
    if (raw.length > MAX_BEACON_BODY_BYTES) return noContent();
    const parsed = parseAiReferralBeaconText(raw);
    if (!parsed.ok) return noContent();

    // 3) 서명 대조 — 이 라우트의 실질적 방어선
    if (!verifyBeaconToken(parsed.value)) return noContent();

    // 4) 레이트리밋 (해시 키만 사용 — 원본 IP 는 카운터에도 남기지 않는다)
    const ipKey = hashRateLimitKey(extractClientIp(req.headers));
    const decision = consumeAiReferralQuota(getQuotaStore(), {
      ipKey,
      slug: parsed.value.slug,
      limits: readAiReferralLimits(),
    });
    if (!decision.allowed) return noContent();

    // 5) 적재 (그레이스풀 — 마이그 미적용·DB 오류에도 throw 하지 않는다)
    await recordAiReferralVisit({
      slug: parsed.value.slug,
      source: parsed.value.source,
      postId: parsed.value.postId,
    });
    return noContent();
  } catch {
    // 계측 라우트는 어떤 경우에도 조용히 끝낸다
    return noContent();
  }
}

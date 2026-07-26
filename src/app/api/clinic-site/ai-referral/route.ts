import { NextRequest, NextResponse } from 'next/server';
import { recordAiReferralVisit } from '@/dev/lib/ai-referral-server';
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
 * body: { slug: string, source: AiReferralSourceId, postId?: string | null }
 *
 * 호출자는 병원 블로그 페이지에 심긴 비콘 컴포넌트(navigator.sendBeacon)뿐이다.
 * **방문자 렌더 경로 밖**에서 비동기로 호출되므로 이 라우트가 느리거나 실패해도
 * 페이지에는 아무 영향이 없다.
 *
 * 가드:
 *  - 봇/크롤러 UA 제외 — UA 는 판정에만 쓰고 **저장하지 않는다**
 *  - 본문 크기 상한 + 화이트리스트 검증(slug 형식·출처 목록·postId UUID)
 *  - 레이트리밋 (IP당/전체 일일 캡, 인메모리 best-effort — IP 는 카운터 키로만 소비)
 *  - slug→병원, 글 소유·발행 검증은 DB 함수(record_clinic_ai_referral)가 마무리
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

    // 3) 레이트리밋 (공개 엔드포인트 남용 방어)
    const decision = consumeAiReferralQuota(getQuotaStore(), {
      ip: extractClientIp(req.headers),
      limits: readAiReferralLimits(),
    });
    if (!decision.allowed) return noContent();

    // 4) 적재 (그레이스풀 — 마이그 미적용·DB 오류에도 throw 하지 않는다)
    await recordAiReferralVisit(parsed.value);
    return noContent();
  } catch {
    // 계측 라우트는 어떤 경우에도 조용히 끝낸다
    return noContent();
  }
}

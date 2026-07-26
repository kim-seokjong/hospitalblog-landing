import { NextRequest, NextResponse } from 'next/server';
import { issueBeaconToken, isBeaconSigningEnabled } from '@/dev/lib/ai-referral-crypto';
import { isLikelyBotUserAgent } from '@/content/lib/ai-referral/request';
import { isAiReferralSourceId } from '@/content/lib/ai-referral/sources';
import { validateSlug } from '@/content/lib/clinic-site/slug';

/**
 * GET /api/clinic-site/ai-referral/token — 비콘 서명 토큰 발급 (공개).
 *
 * ★ 왜 페이지 HTML 이 아니라 별도 경로인가 (2차 리뷰에서 차단된 실제 버그):
 *   토큰을 페이지 렌더 시 HTML 에 박으면 **토큰 수명(10분)과 페이지 캐시 수명이
 *   서로 어긋난다.** 병원 블로그 페이지는 `revalidate = 3600` 을 선언하고 있어,
 *   페이지가 한 번이라도 캐시되면 캐시 생성 후 ~12분까지만 토큰이 유효하고
 *   그 뒤 최대 48분 동안 **정상 AI 유입이 전부 거부된다**(조용한 실패).
 *   지금은 루트 레이아웃이 쿠키를 읽어 이 경로가 동적 렌더 상태라 문제가 드러나지
 *   않지만, 레이아웃을 분리해 ISR 이 되살아나는 순간 터지는 시한폭탄이다.
 *   토큰을 방문 시점에 별도 동적 경로에서 받으면 **캐시 여부와 무관하게** 항상
 *   신선하다. TTL 을 늘려 맞추는 방식은 재사용 창만 넓히므로 쓰지 않는다.
 *
 * ★ 이 토큰이 실제로 보증하는 것 (과대 표현 금지):
 *   - 보증한다: 서명이 **우리 서버에서 발급**됐고, 발급 후 10분 안이며,
 *     (slug·source·postId) 조합이 서명 이후 바뀌지 않았다.
 *   - 보증하지 않는다: 요청자가 진짜 사람인지, 정말 AI 서비스에서 왔는지,
 *     같은 토큰이 처음 쓰이는지. 이 경로도 공개 페이지도 누구나 호출할 수 있으므로
 *     **누구나 유효 토큰을 얻을 수 있다.**
 *   실질 효과는 "오프라인 위조 불가 + 온라인 왕복 강제 + 10분 재사용 창 제한"이며,
 *   피해 규모를 실제로 묶는 것은 발신원 단위 레이트리밋이다.
 *   1회용 nonce 저장소까지 두는 것은 현 단계에서 과설계로 판단했다.
 *
 * 응답: { token, exp } 또는 204 (시크릿 미설정·검증 실패 — 비콘은 조용히 포기).
 */

export const dynamic = 'force-dynamic';

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if (!isBeaconSigningEnabled()) return noContent();
    // 크롤러에는 발급하지 않는다 (UA 는 판정에만 쓰고 어디에도 남기지 않는다)
    if (isLikelyBotUserAgent(req.headers.get('user-agent'))) return noContent();

    const params = req.nextUrl.searchParams;
    const slugParam = params.get('slug') ?? '';
    const validated = validateSlug(slugParam);
    if (!validated.ok) return noContent();

    const source = params.get('source');
    if (!isAiReferralSourceId(source)) return noContent();

    const postIdParam = params.get('postId');
    const postId = postIdParam && postIdParam.length > 0 ? postIdParam : null;
    // 형식만 본다 — 소유·발행 검증은 적재 시 DB 함수가 최종 판단한다.
    if (postId !== null && !/^[0-9a-f-]{36}$/i.test(postId)) return noContent();

    const issued = issueBeaconToken(validated.slug, source, postId ? postId.toLowerCase() : null);
    if (issued === null) return noContent();

    return NextResponse.json(issued, {
      // 토큰은 방문 시점에 발급돼야 의미가 있다 — 어떤 계층에서도 캐시 금지.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return noContent();
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { recordFunnelEvent } from '@/dev/lib/funnel-server';
import {
  validateFunnelBody,
  isValidAnonId,
  generateAnonId,
  resolveAnonId,
  consumeFunnelQuota,
  hasSupabaseSessionCookie,
  readFunnelLimits,
  funnelKstDayKey,
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SEC,
} from '@/content/lib/funnel-events';
import { isBotUserAgent } from '@/content/lib/bot-user-agent';
import {
  INTERNAL_COOKIE,
  hasInternalCookie,
  isInternalUserId,
  readInternalUserIds,
} from '@/content/lib/internal-traffic';
import { extractClientIp } from '@/content/lib/blog-check-limits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/funnel-event — 자체 퍼널 이벤트 기록 (공개, 익명 방문자 포함).
 * body: { event: FunnelEvent, meta?: Record<string, string|number|boolean|null> }
 *
 * 가드 (blog-check-limits 패턴):
 * - 봇 User-Agent 차단(2026-07-29 신설): 크롤러·링크 미리보기·**메일 보안 링크스캐너**는
 *   기록하지 않는다. 이들은 쿠키를 저장하지 않아 매 요청마다 새 anon_id 를 받아가고,
 *   그 결과 7일 고유 방문자가 49명으로 잡히던 시기의 실제 사람은 1명이었다
 *   (근거·수치는 bot-user-agent.ts 헤더 주석 참조).
 * - 내부 트래픽 제외(2026-07-29 신설): 대표·팀 본인의 방문은 지표가 아니다.
 *   최근 7일 로그인 사용자 이벤트 44건이 **전부 한 계정(대표 본인)** 이었다.
 *   계정 기반(env FUNNEL_INTERNAL_USER_IDS) + 쿠키 기반(?dp_internal=1) 두 축으로 막는다.
 *   ⚠️ 실제 고객 계정은 절대 제외 대상이 아니다 — 그래서 목록을 코드가 아니라 env 로 받고,
 *      비어 있으면 아무도 제외하지 않는다.
 * - 이벤트명 화이트리스트: **저신뢰 의도 이벤트(PUBLIC_FUNNEL_EVENTS)만** 허용.
 *   전환 확정 이벤트(signup_complete·first_post_generated·payment_success)는 익명 위조로
 *   지표가 오염되므로 여기서 400 거부 — 각 서버 라우트가 service-role 로만 기록한다.
 * - meta 새니타이즈 (허용 키 화이트리스트 + 타입·길이 검증 — PII·중첩 폭탄 차단)
 * - 레이트리밋: IP당 일 300회 + 전체 일 20000회 (env FUNNEL_* 조절, 인메모리 best-effort
 *   — 서버리스 인스턴스 단위 한계는 funnel-events.ts 주석 참조)
 * - anon_id 쿠키(32 hex): 없거나 형식 불일치면 서버가 httpOnly 로 새로 발급, 클라 제공값은
 *   형식 통과 시에만 사용. 쿠키 삭제·다중 브라우저로 중복될 수 있는 **best-effort 신원**이다.
 * - service role insert (클라 직접 쓰기 금지 — RLS 정책 없음)
 *
 * 실패해도(레이트리밋·검증 외) 200 을 돌려준다 — 계측이 UX 를 막지 않는다.
 */

const QUOTA_KEY = '__dp_funnel_quota__';
function getQuotaStore(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[QUOTA_KEY] instanceof Map)) {
    g[QUOTA_KEY] = new Map<string, number>();
  }
  return g[QUOTA_KEY] as Map<string, number>;
}

export async function POST(req: NextRequest) {
  // 1) 본문 검증 (화이트리스트 + meta 새니타이즈)
  const raw = (await req.json().catch(() => null)) as unknown;
  const validation = validateFunnelBody(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }

  // 2) 봇·스캐너 제외 — 여기서 끝낸다.
  //    ★ anon_id 쿠키를 발급하지 않는다: 어차피 적재하지 않으므로 봇에게 ID 를 쥐여줄
  //      이유가 없고, 발급해봐야 쿠키를 안 저장하는 클라이언트라 매번 새로 나갈 뿐이다
  //      (바로 그 메커니즘이 방문자 수를 부풀린 원인이다).
  //    레이트리밋보다 앞에 둔다 — 봇 트래픽이 정상 사용자 몫의 일일 캡을 먹으면
  //    (전체 캡 20000 소진 시) 진짜 방문자 계측이 조용히 멈추기 때문이다.
  //    ⚠️ 그 대가로 "UA 에 bot 을 넣으면 캡을 우회"할 수 있다. 다만 이 경로는 DB·인증을
  //      건드리지 않고 JSON 파싱 후 즉시 반환이라 **변경 전보다 요청당 비용이 낮다** —
  //      새 남용 표면이 생기는 게 아니다. 실제 폭주 방어가 필요해지면 값싼 IP 리미터를
  //      이 앞단에 따로 두고 계측 쿼터와 분리한다(현 단계 과설계 금지).
  //    200 을 돌려주는 것은 기존 원칙 유지(계측이 UX 를 막지 않는다).
  if (isBotUserAgent(req.headers.get('user-agent'))) {
    return NextResponse.json({ ok: true, skipped: 'bot' });
  }

  // 3) 내부 트래픽 제외 ①: 브라우저에 심어둔 표시 쿠키 (로그아웃 상태 대비).
  //    대표는 로그아웃 상태로도 사이트를 보므로 user_id 만으로는 못 거른다.
  //    켜기 = 아무 페이지나 ?dp_internal=1 로 한 번 접속(미들웨어가 1년 쿠키를 심는다),
  //    끄기 = ?dp_internal=0. 봇과 동일하게 anon_id 쿠키를 발급하지 않는다.
  if (hasInternalCookie(req.cookies.get(INTERNAL_COOKIE)?.value)) {
    return NextResponse.json({ ok: true, skipped: 'internal' });
  }

  // 3-2) 우리 자신이 만든 경로 제외 (2026-07-30).
  //      배포 점검용 `/__deploy_check` 접속이 방문자 1명으로 잡혀 있었다
  //      (07/29 16:56:45, anon_id acf482d5). 사람이 아니라 우리 배포 스크립트다.
  //      쿠키·계정으로는 못 거른다 — 그쪽에는 브라우저도 계정도 없다.
  //      ⚠️경로 접두사로만 판단한다. 실제 고객이 볼 수 있는 페이지를 넣지 말 것.
  const rawPath = validation.value.meta?.path;
  const eventPath = typeof rawPath === 'string' ? rawPath : '';
  if (eventPath.startsWith('/__')) {
    return NextResponse.json({ ok: true, skipped: 'internal-path' });
  }

  // 4) 로그인 사용자면 user_id 귀속 (선택 — 익명 이벤트는 null)
  //    ★세션 쿠키가 없으면 auth 조회를 아예 건너뛴다(2026-08-10, Codex 지적).
  //      auth-js 는 토큰이 없으면 네트워크 없이 즉시 반환하지만, **가짜 세션 쿠키를 붙이면**
  //      요청마다 Supabase Auth 로 나간다. 이 블록이 레이트리밋보다 앞이라 한도로도 못 막는다.
  //      쿠키 유무만 먼저 보면 그 경로가 닫히고, 정상 익명 트래픽의 비용도 줄어든다.
  let userId: string | null = null;
  if (hasSupabaseSessionCookie(req.cookies.getAll().map((c) => c.name))) {
    try {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }
  }

  // 5) 내부 트래픽 제외 ②: 계정 기반 (env FUNNEL_INTERNAL_USER_IDS).
  //    최근 7일 로그인 사용자 이벤트 44건이 전부 대표 본인 계정이었다 — 그대로 두면
  //    "회원 활동" 지표가 우리 자신을 세는 꼴이 된다.
  //    ⚠️ 제외 대상은 **env 로만** 온다. 목록이 비면 아무도 제외되지 않는다(실제 고객이
  //      휩쓸리는 것이 최악의 실패 모드라, 기본값을 "전부 기록" 쪽에 둔다).
  //    여기서도 anon_id 쿠키를 발급하지 않는다(적재하지 않는데 ID 만 심을 이유가 없다).
  //
  // ★레이트리밋보다 **먼저** 판정한다(2026-08-10, Codex 지적). 순서가 반대였을 때는
  //   쿠키 없는 브라우저로 로그인한 내부 계정이 적재는 건너뛰면서 IP·전체 쿼터는
  //   계속 깎았다. 한도에 닿으면 그 뒤로 **실제 외부 사용자의 이벤트가 조용히 버려진다.**
  //   세션 쿠키가 없는 익명 요청은 auth 조회가 즉시 null 이라 남용 방어는 그대로다.
  if (isInternalUserId(userId, readInternalUserIds())) {
    return NextResponse.json({ ok: true, skipped: 'internal' });
  }

  // 6) 레이트리밋 (공개 엔드포인트 남용 방어)
  const decision = consumeFunnelQuota(getQuotaStore(), {
    ip: extractClientIp(req.headers),
    limits: readFunnelLimits(),
  });
  if (!decision.allowed) {
    // 조용히 성공처럼 처리 — 남용 방어일 뿐, 정상 사용자에게 에러를 노출하지 않는다.
    return NextResponse.json({ ok: true, throttled: true });
  }

  /**
   * 7) anon_id 확보 — 우선순위 판정은 순수 함수(resolveAnonId)에 있다.
   *    **클라 제공값 > 쿠키 > 새로 발급**. 이유는 그 함수 주석 참조
   *    (쿠키 우선이면 기존 방문자의 쿠키와 localStorage 가 영구히 어긋난다).
   *    쿠키는 아래에서 항상 확정값으로 다시 심어 둘이 수렴하게 한다.
   */
  const existing = req.cookies.get(ANON_ID_COOKIE)?.value;
  const { anonId } = resolveAnonId(existing, validation.value.anonId, generateAnonId);
  const isNewAnon = anonId !== existing;

  // 8) 적재 (그레이스풀 — 실패해도 UX 안 막음)
  await recordFunnelEvent({
    event: validation.value.event,
    userId,
    anonId,
    meta: validation.value.meta,
  });

  const res = NextResponse.json({ ok: true });
  if (isNewAnon) {
    res.cookies.set(ANON_ID_COOKIE, anonId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: ANON_ID_MAX_AGE_SEC,
    });
  }
  // 디버깅용 — 어느 KST 일자로 집계됐는지 (민감정보 아님)
  res.headers.set('x-funnel-day', funnelKstDayKey());
  return res;
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/dev/lib/supabase/server';
import { recordFunnelEvent } from '@/dev/lib/funnel-server';
import {
  validateFunnelBody,
  isValidAnonId,
  generateAnonId,
  consumeFunnelQuota,
  readFunnelLimits,
  funnelKstDayKey,
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SEC,
} from '@/content/lib/funnel-events';
import { extractClientIp } from '@/content/lib/blog-check-limits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/funnel-event — 자체 퍼널 이벤트 기록 (공개, 익명 방문자 포함).
 * body: { event: FunnelEvent, meta?: Record<string, string|number|boolean|null> }
 *
 * 가드 (blog-check-limits 패턴):
 * - 이벤트명 화이트리스트 검증 (임의 이벤트 적재 차단)
 * - meta 새니타이즈 (1단 원시값 맵·크기 제한 — 거대 payload·중첩 폭탄 방어)
 * - 레이트리밋: IP당 일 300회 + 전체 일 20000회 (env FUNNEL_* 조절, 인메모리 best-effort)
 * - anon_id 쿠키(32 hex) 발급/검증 — 비로그인 방문자 식별, 로그인 시 user_id 도 귀속
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

  // 2) 레이트리밋 (공개 엔드포인트 남용 방어)
  const decision = consumeFunnelQuota(getQuotaStore(), {
    ip: extractClientIp(req.headers),
    limits: readFunnelLimits(),
  });
  if (!decision.allowed) {
    // 조용히 성공처럼 처리 — 남용 방어일 뿐, 정상 사용자에게 에러를 노출하지 않는다.
    return NextResponse.json({ ok: true, throttled: true });
  }

  // 3) anon_id 쿠키 확보 (없거나 형식 오류면 새로 발급)
  const existing = req.cookies.get(ANON_ID_COOKIE)?.value;
  const anonId = isValidAnonId(existing) ? existing : generateAnonId();
  const isNewAnon = anonId !== existing;

  // 4) 로그인 사용자면 user_id 귀속 (선택 — 익명 이벤트는 null)
  let userId: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  // 5) 적재 (그레이스풀 — 실패해도 UX 안 막음)
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

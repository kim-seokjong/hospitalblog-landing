import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server';
import { validateChurnBody } from '@/content/lib/churn-reasons';

export const dynamic = 'force-dynamic';

/**
 * POST /api/churn-reason — 이탈 사유 수집 (회원 인증 필수).
 * body: { reason: ChurnReasonCode, detail?: string, source?: string }
 *
 * 가드:
 * - 인증 필수(세션) — 익명 수집 안 함(귀속 필요)
 * - reason 화이트리스트 검증 + detail 정규화(제어문자·길이·이메일/전화 PII 마스킹) — churn-reasons.ts
 * - 사용자당 24시간 1건 dedup — 반복 제출로 무제한 insert 되는 것 방지(최신 사유는 익일 다시 수집 가능)
 * - service role insert (RLS 정책 없음 — 클라 직접 쓰기 금지)
 *
 * 과설계 금지: 수집 경로만. 사후 분석·집계는 별도.
 */

/** 사용자당 dedup 윈도우 (24h 1건). */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const raw = (await req.json().catch(() => null)) as unknown;
  const validation = validateChurnBody(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: '유효한 이탈 사유가 아닙니다.' }, { status: 400 });
  }

  // source 는 짧은 맥락 라벨만 허용 (없으면 mypage)
  const rawSource = (raw as { source?: unknown } | null)?.source;
  const source =
    typeof rawSource === 'string' && /^[a-z_]{1,32}$/.test(rawSource) ? rawSource : 'mypage';

  try {
    const admin = createAdminClient();

    // 사용자당 24h 1건 dedup — 취소/만료 UI 반복 제출·스크립트 남용으로 무제한 insert 방지.
    // 조회 실패(마이그 미적용 등)면 dedup 없이 insert 시도(insert 도 같은 이유로 실패 → 그레이스풀).
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: recent, error: dedupErr } = await admin
      .from('churn_reasons')
      .select('id')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .limit(1);
    if (!dedupErr && recent && recent.length > 0) {
      // 이미 24h 내 수집됨 — 사용자 경험상 성공으로 응답(재제출 강요 안 함)
      return NextResponse.json({ ok: true, stored: false, deduped: true });
    }

    const { error } = await admin.from('churn_reasons').insert({
      user_id: user.id,
      reason: validation.reason,
      detail: validation.detail,
      source,
    });
    if (error) {
      // 테이블 미적용(마이그 047 전) 등 — 사용자 경험을 막지 않는다(그레이스풀).
      console.error('[churn-reason] insert 실패(무시):', error.message);
      return NextResponse.json({ ok: true, stored: false });
    }
    return NextResponse.json({ ok: true, stored: true });
  } catch (e) {
    console.error('[churn-reason] 예외(무시):', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true, stored: false });
  }
}

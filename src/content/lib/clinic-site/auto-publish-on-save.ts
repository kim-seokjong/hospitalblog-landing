/**
 * 저장 즉시 자동 발행 (서버 전용 · service role).
 *
 * "발행 버튼을 누르지 않아도 올라간다"를 구현하는 지점이다.
 * /api/posts POST 로 글이 저장되는 순간(= 사용자가 본문을 복사한 순간) 호출된다.
 *
 * 실행 규약:
 *  - 절대 throw 하지 않는다. 발행이 실패해도 글 저장은 성공해야 한다.
 *  - 검수 게이트(publishBlockReason)를 수동 발행과 "같은 함수"로 판정한다.
 *    차단 대상은 조용히 건너뛴다 — 사용자 저장 플로우를 막지 않는다.
 *  - 일일 상한(auto = 3편/일)은 cron 과 같은 원자적 선점 경로
 *    (claimPostsForPublish)로 강제한다. 두 경로가 각각 상한을 세면 하루 6편이 나간다.
 *  - ★ 이 훅은 "지금 저장되는 글" 한 편만 대상으로 한다. 과거 글을 훑지 않으므로
 *    기존 고객의 보관함이 소급 공개되는 일이 없다.
 *  - IndexNow 는 수동 발행과 동일한 1.5초 상한(INDEXNOW_INTERACTIVE_TIMEOUT_MS)으로
 *    호출한다 — 응답을 오래 붙잡지 않는다.
 */

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isActivePlan } from '@/payment/lib/plans';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import { decideAutoPublishOnSave } from './publish-gate';
import type { AutoPublishSkipReason } from './publish-gate';
import { serverPublishBlockReason } from './server-publish-gate';
import { claimPostsForPublish } from './auto-publish-claim';
import { kstDayStartIso } from './auto-publish';
import { clinicSiteHost, clinicSiteUrl } from './slug';
import { notifyIndexNow } from './indexnow-submit';
import { INDEXNOW_INTERACTIVE_TIMEOUT_MS } from './indexnow';

type Admin = SupabaseClient;

export type AutoPublishOnSaveResult =
  | { status: 'published'; slug: string; postId: string }
  | { status: 'skipped'; reason: AutoPublishSkipReason | 'profile_missing' | 'daily_cap' }
  | { status: 'failed'; reason: string };

interface ProfileRow {
  plan: string | null;
  plan_expires_at: string | null;
  site_slug: string | null;
  site_publish_cadence: string | null;
}

const PROFILE_COLS = 'plan, plan_expires_at, site_slug, site_publish_cadence';

export interface AutoPublishOnSaveInput {
  userId: string;
  postId: string;
  content: string;
  /** /api/posts 가 저장한 것과 동일한 검증 완료 스냅샷(또는 원본 — 여기서 다시 검증한다). */
  complianceReport: unknown;
}

/** 공개 페이지 ISR 재검증 — 실패해도 발행 자체는 성공 처리(최대 1시간 내 자연 갱신). */
function revalidateClinicPages(slug: string, postId: string): void {
  try {
    revalidatePath(`/clinic-site/${slug}`);
    revalidatePath(`/clinic-site/${slug}/posts/${postId}`);
  } catch (err) {
    console.error(
      '[clinic-site/on-save] 재검증 실패:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 방금 저장된 글 1편을 조건이 맞으면 즉시 내 블로그에 발행한다.
 * 어떤 경우에도 예외를 던지지 않는다.
 */
export async function autoPublishSavedPost(
  admin: Admin,
  input: AutoPublishOnSaveInput,
): Promise<AutoPublishOnSaveResult> {
  try {
    const { data: profile, error } = await admin
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', input.userId)
      .maybeSingle<ProfileRow>();

    // 마이그 043/044 미적용(42703) 포함 — 조회 실패는 조용히 건너뛴다.
    if (error || !profile) return { status: 'skipped', reason: 'profile_missing' };

    const decision = decideAutoPublishOnSave({
      cadence: profile.site_publish_cadence,
      siteSlug: profile.site_slug,
      subscriptionActive: isActivePlan(profile.plan, profile.plan_expires_at),
      // 수동 발행(/api/mypage/site-publish)과 같은 스냅샷 게이트 +
      // 서버가 본문을 직접 A층 재검사(위조·낡은 스냅샷 방어) — server-publish-gate.ts.
      blockReason: serverPublishBlockReason(
        validateComplianceReport(input.complianceReport),
        input.content,
      ),
      content: input.content,
    });

    if (!decision.publish) return { status: 'skipped', reason: decision.reason };

    const slug = (profile.site_slug ?? '').trim();

    // 일일 상한(3편/일)은 cron 과 같은 원자적 경로로 강제한다.
    const claim = await claimPostsForPublish(admin, {
      userId: input.userId,
      cadence: 'auto',
      dayStartIso: kstDayStartIso(new Date()),
      candidateIds: [input.postId],
      limit: 1,
    });

    if (!claim.ok) return { status: 'failed', reason: claim.reason };
    if (claim.claimedIds.length === 0) return { status: 'skipped', reason: 'daily_cap' };

    revalidateClinicPages(slug, input.postId);

    // 색인 요청 — 실패해도 발행은 이미 확정. 1.5초 안에 응답이 없으면 포기한다
    // (놓쳐도 사이트맵 인덱스로 결국 수집된다).
    await notifyIndexNow(
      clinicSiteHost(slug),
      [clinicSiteUrl(slug), clinicSiteUrl(slug, `/posts/${input.postId}`)],
      { timeoutMs: INDEXNOW_INTERACTIVE_TIMEOUT_MS },
    );

    return { status: 'published', slug, postId: input.postId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '자동 발행 중 알 수 없는 오류';
    console.error('[clinic-site/on-save] 예외:', input.userId, input.postId, reason);
    return { status: 'failed', reason };
  }
}

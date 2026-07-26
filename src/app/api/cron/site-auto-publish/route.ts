// 매일 1회 실행 — 내 블로그(서브도메인) 정기 자동발행.
//
// 설계 대원칙(자동 "생성" 아님, 발행만 스케줄):
//  - site_publish_cadence != 'off' 이고 site_slug 가 설정된 회원만 대상(opt-in).
//  - isDue(주기 경과) 판정 통과 시에만, 그 회원의 "검수 통과·미발행" 글 중
//    오래된 순으로 주기별 상한(maxPostsPerRun)만큼 발행한다.
//      · weekly/biweekly → 회당 1편 (기존 동작 그대로, 변경 없음)
//      · auto            → 매 실행 최대 3편 (근거는 auto-publish.ts 주석)
//  - 검수 게이트는 수동 발행(/api/mypage/site-publish)과 "동일 기준"을 재사용한다
//    (compliance_report 없음 / needsManualReview / HIGH·CRITICAL → 제외).
//  - 발행 대상이 없으면 아무것도 하지 않는다(last_run 도 갱신하지 않음 → 대상이
//    생기는 즉시 다음 실행에서 발행). 실제 주기 간격은 isDue 가 제어하므로 매일 돌아도
//    weekly/biweekly 회원은 주1회/격주만 실제 발행된다.
//  - 발행 후 IndexNow 로 색인 요청을 보낸다(실패해도 발행은 성공 — 그레이스풀).
//
// 인증: Authorization: Bearer ${CRON_SECRET} (기존 cron 패턴 동일). service role 로
//       update(RLS 우회). 개별 회원 실패는 기록만 하고 전체는 계속 진행한다.

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorizedCron } from '@/dev/lib/cron-auth';
import { createAdminClient } from '@/dev/lib/supabase/server';
import { validateComplianceReport } from '@/content/lib/compliance-report';
import { publishBlockReason } from '@/content/lib/clinic-site/publish-gate';
import { isDue, pickNextPosts, isValidCadence, maxPostsPerRun, type AutoPublishCandidate } from '@/content/lib/clinic-site/auto-publish';
import { clinicSiteHost, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { notifyIndexNow } from '@/content/lib/clinic-site/indexnow-submit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// 부하 방어 상한
const MAX_PROFILES = 200;      // 1회 실행 순회 회원 상한
const CANDIDATE_LIMIT = 50;    // 회원당 조회할 미발행 후보 상한(가장 오래된 것 우선 정렬 후 상한)
// 1회 실행 전체 발행 편수 상한. maxDuration(120초) 안에 끝나도록 하는 안전장치이며,
// 'auto' 회원이 늘어도 한 번에 색인 요청이 폭주하지 않게 한다.
const MAX_PUBLISH_PER_RUN = 100;
// IndexNow 색인 요청에 쓸 수 있는 총 시간 예산(ms). 호스트마다 1회 호출이 필요한데
// (서브도메인 = 별개 호스트라 묶을 수 없다) 회원 수가 많으면 maxDuration(120초)을
// 잠식할 수 있다 → 예산을 넘기면 색인 요청만 건너뛴다(발행은 계속 진행).
const INDEXNOW_BUDGET_MS = 30_000;
const INDEXNOW_CALL_TIMEOUT_MS = 3_000;

interface ScheduleProfileRow {
  id: string;
  site_slug: string | null;
  site_publish_cadence: string | null;
  site_publish_last_run: string | null;
}

interface CandidatePostRow {
  id: string;
  created_at: string;
  content: string | null;
  compliance_report: unknown;
}

/** 공개 페이지 ISR 재검증 — 실패해도 발행 자체는 성공 처리(최대 1시간 내 자연 갱신). */
function revalidateClinicPages(slug: string, postId: string): void {
  try {
    revalidatePath(`/clinic-site/${slug}`);
    revalidatePath(`/clinic-site/${slug}/posts/${postId}`);
  } catch (err) {
    console.error('[site-auto-publish] 재검증 실패:', err instanceof Error ? err.message : err);
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const startedAt = Date.now();

  let scanned = 0;           // isDue 통과해 후보를 조회한 회원 수
  let published = 0;         // 실제 발행된 글 수
  let indexNowFailures = 0;  // 색인 요청 실패 수(발행 성공과 무관 — 모니터링용)
  let indexNowSkipped = 0;   // 시간 예산 초과로 색인 요청을 건너뛴 회원 수
  const failures: Array<{ userId: string; reason: string }> = [];

  try {
    // 자동발행을 켠 회원만 (site_slug 설정 + cadence != off).
    // 컬럼 미적용(42703) 환경에서는 기능 비활성 상태로 graceful 반환.
    const { data, error } = await admin
      .from('profiles')
      .select('id, site_slug, site_publish_cadence, site_publish_last_run')
      .neq('site_publish_cadence', 'off')
      .not('site_slug', 'is', null)
      .order('id', { ascending: true })
      .limit(MAX_PROFILES);

    if (error) {
      if (error.code === '42703') {
        return NextResponse.json({
          ok: true,
          mode: 'disabled',
          message: '자동발행 스케줄 컬럼이 아직 적용되지 않았습니다(마이그 044 미적용).',
        });
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const profiles = (data ?? []) as ScheduleProfileRow[];

    for (const profile of profiles) {
      if (published >= MAX_PUBLISH_PER_RUN) break;

      const slug = profile.site_slug;
      const cadence = profile.site_publish_cadence;
      if (!slug || !isValidCadence(cadence)) continue;
      if (!isDue(cadence, profile.site_publish_last_run, now)) continue;

      scanned++;

      try {
        // 그 회원의 미발행 글 후보(가장 오래된 순). 검수 게이트는 아래에서 재검증한다.
        const { data: postRows, error: postErr } = await admin
          .from('saved_posts')
          .select('id, created_at, content, compliance_report')
          .eq('user_id', profile.id)
          .eq('published_to_site', false)
          .order('created_at', { ascending: true })
          .limit(CANDIDATE_LIMIT);

        if (postErr) {
          failures.push({ userId: profile.id, reason: postErr.message });
          continue;
        }

        // 검수 게이트 통과 + 본문 비어있지 않은 글만 후보로 남긴다(수동 발행과 동일 기준).
        const candidates: AutoPublishCandidate[] = ((postRows ?? []) as CandidatePostRow[])
          .filter((row) => {
            const content = typeof row.content === 'string' ? row.content : '';
            if (content.trim() === '') return false;
            return publishBlockReason(validateComplianceReport(row.compliance_report)) === null;
          })
          .map((row) => ({ id: row.id, createdAt: row.created_at }));

        // 주기별 상한 + 전체 상한 중 작은 값만큼 발행한다.
        const remaining = MAX_PUBLISH_PER_RUN - published;
        const picked = pickNextPosts(candidates, Math.min(maxPostsPerRun(cadence), remaining));
        if (picked.length === 0) continue; // 발행 대상 없음 → last_run 갱신 없이 다음 회원

        const publishedIds: string[] = [];
        let lastPublishedAt: string | null = null;

        for (const post of picked) {
          const publishedAt = new Date().toISOString();
          const { error: updatePostErr } = await admin
            .from('saved_posts')
            .update({ published_to_site: true, site_published_at: publishedAt })
            .eq('id', post.id)
            .eq('user_id', profile.id);

          if (updatePostErr) {
            failures.push({ userId: profile.id, reason: updatePostErr.message });
            continue;
          }

          publishedIds.push(post.id);
          lastPublishedAt = publishedAt;
          published++;
          revalidateClinicPages(slug, post.id);
        }

        if (publishedIds.length === 0 || !lastPublishedAt) continue;

        // 실제 발행에 성공했을 때만 last_run 갱신(주기 간격은 여기서부터 다시 카운트).
        const { error: updateProfileErr } = await admin
          .from('profiles')
          .update({ site_publish_last_run: lastPublishedAt })
          .eq('id', profile.id);

        if (updateProfileErr) {
          // 글은 이미 발행됨. last_run 갱신 실패만 기록(다음 실행에서 재시도되나
          // 미발행 글이 없으면 자연히 멈춘다 → 무한 발행 위험 낮음).
          failures.push({ userId: profile.id, reason: `last_run 갱신 실패: ${updateProfileErr.message}` });
        }

        // IndexNow — 발행된 글 + 목록이 바뀐 홈. 실패해도 발행은 이미 성공 상태다.
        // 시간 예산을 넘기면 색인 요청만 건너뛴다(다음 실행/사이트맵으로 자연 수렴).
        if (Date.now() - startedAt < INDEXNOW_BUDGET_MS) {
          const outcome = await notifyIndexNow(
            clinicSiteHost(slug),
            [clinicSiteUrl(slug), ...publishedIds.map((id) => clinicSiteUrl(slug, `/posts/${id}`))],
            { timeoutMs: INDEXNOW_CALL_TIMEOUT_MS },
          );
          if (outcome.status === 'failed') {
            indexNowFailures++;
          }
        } else {
          indexNowSkipped++;
        }
      } catch (e) {
        // 한 회원 실패가 전체를 중단시키지 않는다.
        failures.push({ userId: profile.id, reason: e instanceof Error ? e.message : 'unknown' });
      }
    }

    return NextResponse.json({ ok: true, mode: 'live', scanned, published, indexNowFailures, indexNowSkipped, failures });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'cron failed';
    return NextResponse.json(
      { ok: false, error: message, scanned, published, indexNowFailures, indexNowSkipped, failures },
      { status: 500 },
    );
  }
}

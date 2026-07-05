import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  clinicflixApprove,
  clinicflixGetJob,
  ClinicflixUnavailableError,
  type ClinicflixPlanEdits,
} from '@/content/lib/clinicflix'
import {
  getConversionByJobId,
  commitUsage,
  updateConversionTopic,
} from '@/content/lib/clinicflix-usage'
import { extractPlanTopic } from '@/content/lib/clinicflix-characters'

export const dynamic = 'force-dynamic'

function getSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
}

/**
 * POST /api/clinicflix/jobs/[jobId]/approve
 *
 * 순서:
 *   1) 인증 + 소유자 검증
 *   2) 사용량 멱등 차감 (conversion_id 단위로 단 1회 video+1 / channel+1)  ← 렌더 확정 지점
 *   3) ClinicFlix approve 프록시
 *
 * 사용량을 approve 프록시 "앞"에서 차감하는 이유:
 *   - 변환 1건당 1회만 차감되어야 하고(멱등 RPC가 보장), 사용자가 approve 를 눌렀다는 것은
 *     렌더 비용 발생에 동의한 시점이기 때문이다.
 *   - 멱등이므로 approve 가 실패해 사용자가 다시 눌러도 중복 차감되지 않는다.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  try {
    const supabase = getSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    }

    const jobId = params.jobId
    if (!jobId) {
      return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
    }

    // ── 채널별 텍스트 수정안(선택) 파싱 (없으면 undefined → 기존 동작 유지) ──
    let edits: ClinicflixPlanEdits | undefined
    try {
      const body = (await req.json()) as { edits?: ClinicflixPlanEdits } | null
      if (body?.edits && typeof body.edits === 'object') {
        edits = body.edits
      }
    } catch {
      // 본문 없음/비JSON → edits 미적용 (기존 동작)
    }

    const mapping = await getConversionByJobId(jobId)
    if (!mapping) {
      return NextResponse.json({ error: '변환 정보를 찾을 수 없습니다' }, { status: 404 })
    }
    if (mapping.user_id !== user.id) {
      return NextResponse.json({ error: '접근 권한이 없습니다' }, { status: 403 })
    }

    // ── 멱등 사용량 차감 (렌더 확정) ──
    const committed = await commitUsage(mapping.conversion_id, user.id)
    if (!committed.ok) {
      return NextResponse.json(
        { error: committed.reason === 'forbidden' ? '접근 권한이 없습니다' : '사용량 차감에 실패했습니다' },
        { status: committed.reason === 'forbidden' ? 403 : 400 },
      )
    }

    // ── ClinicFlix approve 프록시 ──
    try {
      await clinicflixApprove(jobId, edits)
    } catch (e) {
      // 이미 차감은 멱등이므로 재시도 시 중복되지 않는다.
      if (e instanceof ClinicflixUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: 503 })
      }
      const msg = e instanceof Error ? e.message : '생성 승인에 실패했습니다'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // ── 에피소드 주제 확정 기록 (best-effort) ──
    // 기획(plan)의 topic 을 저장해 다음 변환의 series_context(전속 캐릭터 시리즈 연속성 —
    // 반복 방지 + 가벼운 콜백) 원천으로 쓴다. 실패해도 승인 흐름에는 영향 없음.
    try {
      const job = await clinicflixGetJob(jobId)
      const topic = extractPlanTopic(job.plan)
      if (topic) {
        await updateConversionTopic(mapping.conversion_id, topic)
      }
    } catch {
      /* topic 은 부가 정보 — 조회 실패 무시 */
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

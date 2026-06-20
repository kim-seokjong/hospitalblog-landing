import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { clinicflixGetJob, ClinicflixUnavailableError } from '@/content/lib/clinicflix'
import { getConversionByJobId } from '@/content/lib/clinicflix-usage'

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
 * GET /api/clinicflix/jobs/[jobId]
 * 인증 → (매핑이 있으면) 소유자 검증 → ClinicFlix /jobs/{jobId} 프록시 → status/plan/assets 반환.
 */
export async function GET(
  _req: NextRequest,
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

    // 매핑이 있으면 소유자 검증 (없으면 — 저장 실패 등 — 통과시키되 폴링만 허용)
    const mapping = await getConversionByJobId(jobId)
    if (mapping && mapping.user_id !== user.id) {
      return NextResponse.json({ error: '접근 권한이 없습니다' }, { status: 403 })
    }

    let job
    try {
      job = await clinicflixGetJob(jobId)
    } catch (e) {
      if (e instanceof ClinicflixUnavailableError) {
        return NextResponse.json({ error: e.message }, { status: 503 })
      }
      const msg = e instanceof Error ? e.message : '작업 조회에 실패했습니다'
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    return NextResponse.json({
      job_id: job.job_id,
      conversion_id: job.conversion_id,
      status: job.status,
      tier: job.tier ?? null,
      error: job.error ?? null,
      cost_krw: job.cost_krw ?? null,
      plan: job.plan ?? null,
      assets: job.assets ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

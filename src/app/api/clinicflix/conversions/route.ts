import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import {
  getConversionsByUser,
  getConversionSaveTarget,
  saveConversionResult,
  type ResultAssets,
} from '@/content/lib/clinicflix-usage'
import { clinicflixGetJob } from '@/content/lib/clinicflix'
import { isAllowedClinicflixAssetUrl } from '@/content/lib/clinicflix-asset-hosts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    const conversions = await getConversionsByUser(user.id, 50)
    return NextResponse.json({ conversions })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

const BUCKET = 'clinic-assets'

function extFromUrl(url: string, contentType: string | null): string {
  const clean = url.split('?')[0]
  const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/)
  if (m) return m[1].toLowerCase()
  const sub = (contentType ?? '').split('/')[1]
  return (sub || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** url 에서 받아 clinic-assets/{userId}/conversions/{conversionId}/{name}.{ext} 로 업로드, public url 반환. */
async function copyToStorage(
  admin: ReturnType<typeof createAdminClient>,
  url: string,
  userId: string,
  conversionId: string,
  name: string,
): Promise<string> {
  // SSRF 방지: 신뢰 호스트(생성 결과 CDN / Supabase Storage / ClinicFlix 서비스 호스트)만 서버 fetch 허용.
  if (!isAllowedClinicflixAssetUrl(url)) throw new Error('허용되지 않은 자산 호스트')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`)
  const contentType = res.headers.get('content-type')
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromUrl(url, contentType)
  const path = `${userId}/conversions/${conversionId}/${name}.${ext}`
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: contentType ?? undefined,
    upsert: true,
  })
  if (error) throw new Error(error.message)
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('public URL 생성 실패')
  return data.publicUrl
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { job_id?: string }
    const jobId = body.job_id
    if (!jobId) return NextResponse.json({ error: 'job_id 가 필요합니다' }, { status: 400 })

    const target = await getConversionSaveTarget(jobId)
    if (!target) return NextResponse.json({ error: '변환 기록을 찾을 수 없습니다' }, { status: 404 })
    if (target.user_id !== user.id) {
      return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 })
    }
    if (target.result_saved_at) {
      return NextResponse.json({ ok: true, already: true })
    }

    const job = await clinicflixGetJob(jobId)
    const admin = createAdminClient()

    let videoUrl: string | null = null
    const cardnewsUrls: string[] = []
    const storyUrls: string[] = []

    // 영상 — 개별 try/catch (하나 실패해도 나머지 진행, 부분 저장 허용)
    const shortsPath = job.assets?.shorts_video_path
    if (isHttpUrl(shortsPath)) {
      try {
        videoUrl = await copyToStorage(admin, shortsPath, user.id, target.conversion_id, 'video')
      } catch {
        videoUrl = null
      }
    }

    // 카드뉴스
    const cardnewsSrc = job.assets?.cardnews_image_urls ?? []
    for (let i = 0; i < cardnewsSrc.length; i += 1) {
      const src = cardnewsSrc[i]
      if (!isHttpUrl(src)) continue
      try {
        cardnewsUrls.push(await copyToStorage(admin, src, user.id, target.conversion_id, `cardnews-${i + 1}`))
      } catch {
        // 개별 실패는 무시하고 계속
      }
    }

    // 스토리
    const storySrc = job.assets?.story_image_urls ?? []
    for (let i = 0; i < storySrc.length; i += 1) {
      const src = storySrc[i]
      if (!isHttpUrl(src)) continue
      try {
        storyUrls.push(await copyToStorage(admin, src, user.id, target.conversion_id, `story-${i + 1}`))
      } catch {
        // 개별 실패는 무시하고 계속
      }
    }

    const resultAssets: ResultAssets = {
      video_url: videoUrl,
      cardnews_urls: cardnewsUrls,
      story_urls: storyUrls,
      threads: job.plan?.threads ?? null,
      feed: job.plan?.feed ?? null,
    }

    await saveConversionResult(target.conversion_id, resultAssets)

    return NextResponse.json({ ok: true, already: false, result_assets: resultAssets })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

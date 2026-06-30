import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/dev/lib/supabase/server'
import {
  clinicflixGeneratePresenter,
  ClinicflixUnavailableError,
} from '@/content/lib/clinicflix'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'clinic-assets'

// 프리셋 화이트리스트 (서비스 /presenter 와 일치)
const GENDERS = ['male', 'female']
const AGES = ['20s', '30s', '40s', '50s']
const VIBES = ['trustworthy', 'friendly', 'energetic']
const ATTIRES = ['smart_casual', 'suit', 'clinical']

// SSRF 방지: 생성 결과 CDN(fal) / Supabase Storage 만 서버 fetch 허용.
const ALLOWED_FETCH_SUFFIXES = ['.fal.media', 'fal.media', '.supabase.co']

function isAllowedAssetUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === 'https:' &&
      ALLOWED_FETCH_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(s))
    )
  } catch {
    return false
  }
}

function extFromUrl(url: string, contentType: string | null): string {
  const clean = url.split('?')[0]
  const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/)
  if (m) return m[1].toLowerCase()
  const sub = (contentType ?? '').split('/')[1]
  return (sub || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** url 에서 받아 clinic-assets/{userId}/presenter/{uuid}.{ext} 로 업로드, public url 반환. */
async function copyToStorage(
  admin: ReturnType<typeof createAdminClient>,
  url: string,
  userId: string,
): Promise<string> {
  if (!isAllowedAssetUrl(url)) throw new Error('허용되지 않은 이미지 호스트')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`)
  const contentType = res.headers.get('content-type')
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromUrl(url, contentType)
  const path = `${userId}/presenter/${crypto.randomUUID()}.${ext}`
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: contentType ?? undefined,
    upsert: true,
  })
  if (error) throw new Error(error.message)
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('public URL 생성 실패')
  return data.publicUrl
}

interface SavedPresenter {
  virtual_presenter_urls: string[]
  gender: string | null
  age: string | null
  vibe: string | null
  attire: string | null
  extra: string | null
}

async function loadSaved(userId: string): Promise<SavedPresenter> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('profiles')
    .select(
      'clinic_virtual_presenter_urls, clinic_presenter_gender, clinic_presenter_age, clinic_presenter_vibe, clinic_presenter_attire, clinic_presenter_extra',
    )
    .eq('id', userId)
    .single()
  const row = (data ?? {}) as Record<string, unknown>
  const urls = Array.isArray(row.clinic_virtual_presenter_urls)
    ? (row.clinic_virtual_presenter_urls as unknown[]).filter(
        (u): u is string => typeof u === 'string',
      )
    : []
  return {
    virtual_presenter_urls: urls,
    gender: (row.clinic_presenter_gender as string | null) ?? null,
    age: (row.clinic_presenter_age as string | null) ?? null,
    vibe: (row.clinic_presenter_vibe as string | null) ?? null,
    attire: (row.clinic_presenter_attire as string | null) ?? null,
    extra: (row.clinic_presenter_extra as string | null) ?? null,
  }
}

/** GET /api/clinicflix/presenter — 저장된 가상 진행자 + 프리셋 반환 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
    return NextResponse.json(await loadSaved(user.id))
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function pick(v: unknown, allowed: string[]): string | null {
  return typeof v === 'string' && allowed.includes(v) ? v : null
}

/**
 * POST /api/clinicflix/presenter
 * - { action:'generate', gender, age, vibe, attire, extra, count } → 후보 이미지 URL(미리보기)
 * - { action:'confirm', urls:[...], gender, age, vibe, attire, extra } → clinic-assets 영구저장 + 프로필 잠금
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = body.action

    if (action === 'generate') {
      const count = typeof body.count === 'number' ? Math.max(1, Math.min(4, body.count)) : 2
      try {
        const out = await clinicflixGeneratePresenter({
          gender: pick(body.gender, GENDERS) ?? 'male',
          age: pick(body.age, AGES),
          vibe: pick(body.vibe, VIBES),
          attire: pick(body.attire, ATTIRES),
          extra: typeof body.extra === 'string' ? body.extra.slice(0, 300) : null,
          count,
        })
        return NextResponse.json({ presenter_urls: out.presenter_urls })
      } catch (e) {
        if (e instanceof ClinicflixUnavailableError) {
          return NextResponse.json({ error: e.message }, { status: 503 })
        }
        const msg = e instanceof Error ? e.message : '진행자 생성에 실패했습니다'
        return NextResponse.json({ error: msg }, { status: 502 })
      }
    }

    if (action === 'confirm') {
      const rawUrls = Array.isArray(body.urls) ? body.urls : []
      const urls = rawUrls.filter((u): u is string => typeof u === 'string' && isAllowedAssetUrl(u))
      if (urls.length === 0) {
        return NextResponse.json({ error: '확정할 이미지가 없습니다' }, { status: 400 })
      }
      const admin = createAdminClient()
      const stored: string[] = []
      for (const url of urls.slice(0, 4)) {
        try {
          stored.push(await copyToStorage(admin, url, user.id))
        } catch {
          // 개별 실패는 건너뛰고 계속 (부분 저장 허용)
        }
      }
      if (stored.length === 0) {
        return NextResponse.json({ error: '진행자 이미지 저장에 실패했습니다' }, { status: 500 })
      }
      const updates = {
        clinic_virtual_presenter_urls: stored,
        clinic_presenter_gender: pick(body.gender, GENDERS),
        clinic_presenter_age: pick(body.age, AGES),
        clinic_presenter_vibe: pick(body.vibe, VIBES),
        clinic_presenter_attire: pick(body.attire, ATTIRES),
        clinic_presenter_extra: typeof body.extra === 'string' ? body.extra.slice(0, 300) : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await admin.from('profiles').update(updates).eq('id', user.id)
      if (error) {
        return NextResponse.json({ error: '진행자 저장 실패' }, { status: 500 })
      }
      return NextResponse.json(await loadSaved(user.id))
    }

    if (action === 'clear') {
      const admin = createAdminClient()
      const { error } = await admin
        .from('profiles')
        .update({ clinic_virtual_presenter_urls: [], updated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) return NextResponse.json({ error: '초기화 실패' }, { status: 500 })
      return NextResponse.json(await loadSaved(user.id))
    }

    return NextResponse.json({ error: '알 수 없는 요청입니다' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '서버 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

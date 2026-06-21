import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 외부(fal.media 등) 에셋을 서버에서 받아 Content-Disposition: attachment 로 흘려보내
// 브라우저가 "새 탭 열기"가 아니라 "컴퓨터에 파일 저장"하도록 강제한다.
// (외부 도메인은 a[download] 속성이 무시되어 다운로드가 안 됨 → 동일 출처 프록시로 해결.)

const ALLOWED_HOST_SUFFIXES = ['.fal.media', '.up.railway.app', 'fal.media', '.supabase.co']

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const name = req.nextUrl.searchParams.get('name')
  if (!url) {
    return NextResponse.json({ error: 'url 파라미터가 필요합니다' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: '잘못된 url' }, { status: 400 })
  }
  // SSRF 방지: 허용된 호스트(생성 결과물 CDN)만
  if (
    parsed.protocol !== 'https:' ||
    !ALLOWED_HOST_SUFFIXES.some((s) => parsed.hostname === s || parsed.hostname.endsWith(s))
  ) {
    return NextResponse.json({ error: '허용되지 않은 주소입니다' }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(parsed.toString(), { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: '파일을 가져오지 못했습니다' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: '파일을 가져오지 못했습니다' }, { status: 502 })
  }

  const baseName = name || parsed.pathname.split('/').pop() || 'clinicflix-download'
  const safeName = baseName.replace(/[^\w.\-가-힣]/g, '_').slice(0, 120)

  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
  const len = upstream.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  headers.set(
    'Content-Disposition',
    `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  )
  headers.set('Cache-Control', 'no-store')

  return new NextResponse(upstream.body, { status: 200, headers })
}

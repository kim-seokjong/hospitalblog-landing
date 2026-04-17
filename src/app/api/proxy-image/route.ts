import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = [
  'fal.run',
  'v3.fal.media',
  'storage.googleapis.com',
  'images.pexels.com',
  'images.unsplash.com',
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url 파라미터가 필요합니다.' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: '유효하지 않은 URL입니다.' }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return NextResponse.json({ error: '허용되지 않은 이미지 도메인입니다.' }, { status: 400 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: '이미지를 가져올 수 없습니다.' }, { status: 502 });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('이미지 프록시 실패:', err);
    return NextResponse.json({ error: '이미지 프록시 실패' }, { status: 500 });
  }
}

import { ImageResponse } from 'next/og'

// OG 이미지 (1200×630) — ImageResponse 동적 생성 (개발팀 소관)
// runtime 'edge' 사용 이유: @vercel/og Node 번들이 Windows에서 path.join(import.meta.url) 버그로
// 빌드 prerender가 실패함. edge 번들은 wasm·폰트를 웹팩 에셋으로 로드해 OS 무관하게 동작.
// 한글 렌더링: Noto Sans KR 서브셋 TTF 로드 (ImageResponse는 시스템 폰트 사용 불가)
// 주의: 아래 텍스트를 바꾸면 src/dev/lib/seo/fonts/ 서브셋에 글리프가 없어 깨질 수 있음.
//       서브셋 포함 글자: "닥터포스트 의료광고법 준수 병원 블로그 자동 작성 hospitalblog.kr·"

export const runtime = 'edge'

export const alt = '닥터포스트 - 의료광고법 준수 병원 블로그 자동 작성'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

async function loadFont(url: URL): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`OG 이미지 폰트 로드 실패: ${res.status}`)
  }
  return res.arrayBuffer()
}

export default async function Image() {
  const [notoSansKrRegular, notoSansKrBold] = await Promise.all([
    loadFont(new URL('../dev/lib/seo/fonts/noto-sans-kr-400-subset.ttf', import.meta.url)),
    loadFont(new URL('../dev/lib/seo/fonts/noto-sans-kr-700-subset.ttf', import.meta.url)),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 96px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 58%, #2563eb 100%)',
          fontFamily: 'Noto Sans KR',
        }}
      >
        {/* 상단 도메인 라벨 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              background: '#60a5fa',
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 400, color: '#93c5fd' }}>
            hospitalblog.kr
          </div>
        </div>

        {/* 브랜드명 */}
        <div
          style={{
            fontSize: 120,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: -2,
            marginBottom: 32,
          }}
        >
          닥터포스트
        </div>

        {/* 포인트 바 */}
        <div
          style={{
            width: 120,
            height: 8,
            borderRadius: 9999,
            background: '#60a5fa',
            marginBottom: 36,
          }}
        />

        {/* 태그라인 */}
        <div
          style={{
            fontSize: 44,
            fontWeight: 400,
            color: '#dbeafe',
            lineHeight: 1.4,
          }}
        >
          의료광고법 준수 · 병원 블로그 자동 작성
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Noto Sans KR',
          data: notoSansKrRegular,
          style: 'normal',
          weight: 400,
        },
        {
          name: 'Noto Sans KR',
          data: notoSansKrBold,
          style: 'normal',
          weight: 700,
        },
      ],
    }
  )
}

import type { Metadata } from 'next';
import { SITE_NAME } from '@/dev/lib/seo/site';

/**
 * /sample 전용 메타데이터.
 *
 * ⚠️ page.tsx 는 'use client' 라서 metadata 를 export 할 수 없다. 그래서 레이아웃에
 *    붙인다 — 전환 페이지 본문을 건드리지 않는 가장 작은 방법이다.
 *
 * ★ 왜 필요한가 (2026-07-28).
 *   /sample 은 **콜드메일이 보내는 착지 페이지**다(지금까지 772통 발송). 그런데
 *   자체 metadata 가 없어서 루트 layout 의 홈 제품 카피가 그대로 상속됐다 —
 *   원장이 카카오톡·페이스북에서 링크를 받으면 미리보기 제목·설명이 "샘플"과
 *   무관한 홈 문구로 뜬다. /clinic-check 도 같은 문제로 2026-07-27 에 고쳤다
 *   (커밋 55522b8·ccf9176). 같은 구멍이 여기 남아 있었다.
 *
 * ⚠️ openGraph 를 선언하면 **부모 블록을 통째로 대체**한다. 이미지도 반드시 여기서
 *    다시 지정해야 한다 — 빼먹으면 썸네일 없는 카드가 뜬다.
 *    (전용 이미지를 새로 만들지 않는 이유: OG 이미지 폰트가 서브셋이라 새 문구는
 *    글리프가 깨진다. 루트의 파일 규약 이미지를 그대로 쓴다.)
 * ⚠️ 제목에 '| 닥터포스트'를 직접 붙이지 않는다 — layout 의 title.template 이 붙인다.
 *
 * 의료광고법: 효과·순위 단정 없음. "검수한다"까지만 말하고 안전을 보장하지 않는다.
 */

const PAGE_TITLE = '병원명으로 만드는 무료 블로그 샘플';

const PAGE_DESCRIPTION =
  '병원 이름과 진료과만 넣으면 우리 병원에 맞춘 블로그 글 한 편을 가입 없이 전체로 확인할 수 있습니다. 의료광고법에서 자주 지적되는 표현은 생성 단계에서 함께 검수합니다.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    // og:title 에는 브랜드를 직접 붙인다 — title.template 은 og 에 적용되지 않아
    // 이렇게 해야 <title> 과 공유 미리보기 제목이 같아진다(중복 표기가 아니다).
    title: `${PAGE_TITLE} | ${SITE_NAME}`,
    description: PAGE_DESCRIPTION,
    // metadataBase 기준 현재 경로(/sample)로 해석된다 — canonical 과 동일 규칙.
    url: './',
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: '닥터포스트 - 의료광고법 준수 병원 블로그 자동 작성',
      },
    ],
  },
};

export default function SampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

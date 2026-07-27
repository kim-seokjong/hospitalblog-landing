import type { Metadata } from 'next';
import { Suspense } from 'react';
import ClinicCheckClient from '@/components/clinic-diagnosis/ClinicCheckClient';
import JsonLd from '@/dev/lib/seo/JsonLd';
import { buildFaqPageJsonLd, type FaqEntry } from '@/dev/lib/seo/schemas';
import { SITE_NAME } from '@/dev/lib/seo/site';

/**
 * /clinic-check — 병원명 무료진단 (영업 관문, 비회원 공개).
 *
 * 병원 이름만 넣으면 행정안전부 공표 정보로 병원을 특정하고,
 * 네이버 블로그·홈페이지·AI 검색 인용·의료광고법 표현 네 축을 진단한다.
 *
 * ⚠️ 이 페이지가 대표가 원장에게 그대로 보내는 영업 링크다. 따라서
 *    자체 openGraph 를 반드시 갖는다 — 없으면 루트 layout 의 홈 제품 카피가
 *    카카오톡·페이스북 공유 미리보기에 그대로 뜬다(Next 는 페이지 title/description
 *    으로 og 를 역채움하지 않고 부모 openGraph 를 통째로 물려준다).
 * ⚠️ 제목에 '| 닥터포스트'를 직접 붙이지 않는다 — layout 의 title.template 이 붙인다.
 */

const PAGE_TITLE = '병원 온라인 노출 무료진단 — 블로그·홈페이지·AI 검색 실측';

const PAGE_DESCRIPTION =
  '병원 이름만 넣으면 네이버 블로그 노출, 홈페이지 접속·검색 설정, AI 검색 인용 여부, 의료광고법에서 자주 지적되는 표현까지 공개 자료로 조회해 무료로 진단해 드립니다.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  openGraph: {
    // og:title 에는 브랜드를 직접 붙인다 — title.template 은 og 에 적용되지 않아
    // 이렇게 해야 <title> 과 공유 미리보기 제목이 같아진다(중복 표기가 아니다).
    title: `${PAGE_TITLE} | ${SITE_NAME}`,
    description: PAGE_DESCRIPTION,
    // metadataBase 기준 현재 경로(/clinic-check)로 해석된다 — canonical 과 동일 규칙.
    url: './',
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
    // ⚠️ 이미지도 반드시 여기서 다시 지정한다. 페이지가 openGraph 를 선언하면 부모 블록을
    //    통째로 대체하므로, 루트의 파일 규약 OG 이미지(app/opengraph-image.tsx)가 딸려오지
    //    않는다 — 빼먹으면 카카오톡·페북 미리보기에 썸네일 없는 카드가 뜬다.
    //    (전용 이미지를 새로 만들지 않는 이유: OG 이미지 폰트가 서브셋이라 새 문구는 글리프가 깨진다.)
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

/**
 * 진단 전 정적 본문 FAQ — 화면(아래 섹션)과 FAQPage JSON-LD 의 단일 소스.
 * 의료광고법: 효과·순위 단정 금지, 위반 여부 확정 표현 금지(검출·표시까지만).
 */
const CLINIC_CHECK_FAQS: readonly FaqEntry[] = [
  {
    question: '진단에 회원가입이나 결제가 필요한가요?',
    answer:
      '필요 없습니다. 병원 이름만 입력하면 회원가입·카드 등록 없이 무료로 진단 결과를 볼 수 있습니다. 결과를 나중에 다시 보거나 원장님께 전달하시려면 이메일로 리포트 링크를 보내드립니다.',
  },
  {
    question: '어떤 자료를 보고 진단하나요?',
    answer:
      '행정안전부가 공표한 의료기관 정보로 병원을 특정하고, 네이버가 공개한 검색 API와 공개된 블로그 글·홈페이지를 열람한 결과만 사용합니다. 비공개 데이터는 사용하지 않으며, 방문자 수나 매출 같은 추정치는 제공하지 않습니다.',
  },
  {
    question: '진단 결과가 의료광고법 위반 여부를 확정해 주나요?',
    answer:
      '아닙니다. 심의 과정에서 자주 지적되는 표현을 찾아 어디를 다시 보면 좋을지 표시할 뿐이고, 위반 여부는 문맥과 사안에 따라 달라집니다. 표시된 부분은 발행 전에 직접 확인하시고, 필요하면 사전심의나 법률 검토를 받으시길 권해 드립니다.',
  },
] as const;

export default function ClinicCheckPage() {
  return (
    <>
      <Suspense fallback={null}>
        <ClinicCheckClient />
      </Suspense>

      {/*
        폼 아래 정적 설명 — 진단 전 HTML 이 한글 130자뿐이라 검색엔진·AI 크롤러가
        "무엇을 진단하는 페이지인지" 읽을 근거가 없었다. 폼 위가 아니라 아래라
        전환 동선에는 영향을 주지 않는다. 서버 렌더이므로 JS 없이도 본문에 남는다.
        ⚠️ 라이트 테마 명시(bg-white·본문 색) — 다크 루트 상속 가드.
      */}
      <section
        aria-labelledby="clinic-check-about-heading"
        className="bg-white text-[#202020] border-t border-[#dbe2ea]"
      >
        <div className="max-w-3xl mx-auto px-5 sm:px-6 py-14 sm:py-16">
          <h2
            id="clinic-check-about-heading"
            className="text-[22px] sm:text-[30px] font-black leading-tight"
            style={{ letterSpacing: '-0.5px' }}
          >
            무료진단은 무엇을 보나요
          </h2>

          <div className="mt-5 space-y-5 text-[15px] sm:text-base leading-relaxed text-[#4a4f55]">
            <p>
              닥터포스트 무료진단은 병원 이름 하나로{' '}
              <b className="font-bold text-[#202020]">네이버 블로그 · AI 검색 · 홈페이지 · 의료광고법 표현</b>{' '}
              네 축을 공개된 자료에서 실제로 조회해 지금 상태를 정리해 드립니다. 행정안전부가 공표한
              의료기관 정보로 병원을 특정하기 때문에 원장님이 자료를 준비하실 필요가 없고,
              회원가입이나 결제도 필요하지 않습니다.
            </p>
            <p>
              <b className="font-bold text-[#202020]">네이버 블로그</b>는 병원 이름으로 찾을 수 있는 공개
              블로그를 확인해 최근 발행 간격, 글의 길이와 구성, 제목에 쓰인 키워드를 살펴봅니다. 네이버
              노출은 C-Rank·D.I.A+ 등 여러 요인이 함께 작용하므로 순위를 보장하거나 단정하지 않고, 공개
              자료에서 확인되는 사실과 보완할 지점만 짚어 드립니다.
            </p>
            <p>
              <b className="font-bold text-[#202020]">AI 검색(GEO)</b>은 ChatGPT·퍼플렉시티 같은 AI 검색이
              해당 지역·진료과 질문에 답할 때 병원이 언급되는지, 어떤 자료가 인용되는지를 확인합니다.
              환자가 검색창 대신 AI에게 묻는 비중이 늘어난 만큼, 병원 정보가 AI가 읽을 수 있는 형태로
              남아 있는지가 블로그 노출과는 별개의 문제가 됩니다.
            </p>
            <p>
              <b className="font-bold text-[#202020]">홈페이지</b>는 접속이 되는지, 모바일에서 정상적으로
              보이는지, 제목·설명 같은 검색엔진이 읽는 기본 태그가 채워져 있는지를 점검합니다. 마지막으로{' '}
              <b className="font-bold text-[#202020]">의료광고법 표현</b>은 공개된 글에서 심의 때 자주
              지적되는 표현(효과 단정, 최상급·비교 표현, 환자 후기 인용 등)이 있는지를 찾아 표시만 합니다.
              문구를 임의로 바꾸지 않으며, 위반 여부의 최종 판단은 사전심의·법률 검토의 몫입니다.
            </p>
          </div>

          <h2 className="mt-12 text-[20px] sm:text-[26px] font-black leading-tight" style={{ letterSpacing: '-0.5px' }}>
            자주 묻는 질문
          </h2>
          <dl className="mt-5 space-y-6">
            {CLINIC_CHECK_FAQS.map((faq) => (
              <div key={faq.question}>
                <dt className="text-[15px] sm:text-base font-bold text-[#202020] leading-snug">
                  {faq.question}
                </dt>
                <dd className="mt-2 text-[15px] sm:text-base leading-relaxed text-[#4a4f55]">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 화면에 실제로 노출되는 위 FAQ 와 동일한 데이터만 구조화 데이터로 내보낸다. */}
      <JsonLd data={buildFaqPageJsonLd(CLINIC_CHECK_FAQS)} />
    </>
  );
}

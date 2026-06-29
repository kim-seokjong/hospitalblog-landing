'use client';

import { useState } from 'react';
import { HOME_FAQS } from '@/dev/lib/seo/homeFaq';

/**
 * 홈(랜딩) 자주 묻는 질문 아코디언 섹션.
 * 데이터는 단일 소스 HOME_FAQS 를 사용하며, 같은 데이터로 FAQPage JSON-LD 가 주입된다.
 * 랜딩 톤 유지: 라이트 테마(섹션 #eef2f6 · 흰 카드 + #dbe2ea 보더), 헤더 그라데이션 금지.
 * 모바일 최적화: 반응형 텍스트 + 최소 44px 터치 영역.
 */
export default function HomeFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <section id="faq" aria-labelledby="home-faq-heading" className="py-16 sm:py-[84px] bg-[#eef2f6]">
      <div className="max-w-3xl mx-auto px-5 sm:px-6">
        <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px] uppercase">FAQ</p>
        <h2
          id="home-faq-heading"
          className="text-center text-[28px] sm:text-4xl font-black text-[#202020] mt-2.5 leading-tight"
          style={{ letterSpacing: '-0.5px' }}
        >
          자주 묻는 질문
        </h2>
        <p className="text-center text-[#4a4f55] mt-3 mb-10 sm:mb-12 text-base">
          원장님들이 가장 많이 물어보시는 점을 모았어요.
        </p>

        <div className="space-y-3">
          {HOME_FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={faq.question}
                className="bg-white border border-[#dbe2ea] rounded-2xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
              >
                <button
                  type="button"
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`home-faq-panel-${index}`}
                  className="w-full min-h-[56px] flex items-center justify-between gap-3 text-left px-5 sm:px-6 py-4 cursor-pointer"
                >
                  <span className="text-[15px] sm:text-base font-bold text-[#202020] leading-snug">
                    {faq.question}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-[#ff4628] transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  >
                    ▼
                  </span>
                </button>
                {isOpen && (
                  <div
                    id={`home-faq-panel-${index}`}
                    className="px-5 sm:px-6 pb-5 text-sm sm:text-[15px] leading-relaxed text-[#4a4f55] border-t border-[#dbe2ea] pt-3.5"
                  >
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

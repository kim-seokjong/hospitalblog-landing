'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * BlogCheckSection — 네이버 블로그 무료진단 진입 섹션 (리드 마그넷).
 * 주소를 입력하면 /blog-check 전용 페이지로 이동해 자동 실행된다.
 * 과장·보장 표현 금지, 매출·방문자 추정 언급 금지 (랜딩 공통 규칙).
 */
export default function BlogCheckSection() {
  const [value, setValue] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/blog-check?blog=${encodeURIComponent(trimmed)}`);
  };

  return (
    <section className="py-16 sm:py-[84px] bg-[#eef2f6]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center bg-white border border-[#dbe2ea] rounded-3xl p-7 sm:p-12 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          {/* 왼쪽: 소개 */}
          <div>
            <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
            <h2 className="text-[26px] sm:text-[34px] font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
              우리 병원 블로그,
              <br />
              <span className="text-[#ff4628]">30초 만에 무료진단</span>
            </h2>
            <p className="text-[#4a4f55] mt-4 text-[15px] sm:text-base leading-relaxed">
              네이버 블로그 주소만 넣으면 <b>실측 데이터</b>로 진단해 드려요.
              검색량·노출 순위·경쟁 문서수를 직접 조회해서 점수를 냅니다.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-[#4a4f55]">
              <li>· 네이버 SEO 점수 — 타깃 키워드가 실제로 노출되고 있는지</li>
              <li>· AI 검색(GEO) 점수 — ChatGPT·Perplexity에 인용될 수 있는 상태인지</li>
              <li>· 의료광고법 위험 신호 — 최근 글의 위험 표현 검출 건수</li>
            </ul>
          </div>

          {/* 오른쪽: 입력 폼 */}
          <div>
            <form onSubmit={handleSubmit} className="bg-[#fafbfc] border border-[#dbe2ea] rounded-2xl p-6 sm:p-7 space-y-3.5">
              <div>
                <label className="block text-[13px] font-bold text-[#202020] mb-1.5">
                  네이버 블로그 주소
                </label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="blog.naver.com/블로그아이디"
                  className="w-full px-4 py-3 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]"
                  style={{ colorScheme: 'light' }}
                  maxLength={300}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={value.trim() === ''}
                className="w-full py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                무료 진단하기 →
              </button>
              <p className="text-[11.5px] text-[#8a93a0] leading-relaxed">
                회원가입 없이 바로 확인해요 · 하루 3회 무료 · 공개 지표(RSS·네이버 검색·검색광고)만 사용해요
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

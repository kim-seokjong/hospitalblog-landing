'use client';

import { useState, useEffect } from 'react';

/**
 * FloatingCta — 랜딩 전용 플로팅 CTA.
 *
 * - 스크롤 ~400px 이후 나타남 (히어로 CTA와 중복 노출 방지)
 * - 데스크톱: 우하단 고정 버튼 / 모바일: 하단 중앙 바 형태
 * - 클릭 동작은 히어로 "회원가입하기" CTA와 동일 (핸들러를 prop으로 재사용)
 * - z-40: 모달 z-[110]보다 낮고, NotificationBell(fixed top-right z-40)과는
 *   위치가 겹치지 않음 (상단 vs 하단)
 */

const SCROLL_THRESHOLD_PX = 400;

interface FloatingCtaProps {
  /** 히어로 "회원가입하기" CTA와 동일한 핸들러 재사용 */
  onClick: () => void;
}

export default function FloatingCta({ onClick }: FloatingCtaProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > SCROLL_THRESHOLD_PX);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      className={`fixed z-40 bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-hidden={!visible}
    >
      <button
        onClick={onClick}
        tabIndex={visible ? 0 : -1}
        className="w-full sm:w-auto px-6 sm:px-7 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold text-base rounded-2xl sm:rounded-full transition-all shadow-[0_16px_40px_-12px_rgba(255,70,40,0.55)] hover:brightness-105 hover:-translate-y-0.5"
      >
        무료로 시작하기 →
      </button>
    </div>
  );
}

'use client';

/**
 * RevealInit — 랜딩 전 섹션 스크롤 리빌 자동 장착 (2026-07-04 고급화).
 *
 * 마운트 시 각 <section>의 첫 컨테이너 div에 dp-reveal을 달고
 * IntersectionObserver로 진입 시 dp-in을 붙인다 (1회).
 * - 첫 화면(뷰포트 안) 요소는 건드리지 않음 → 플래시/CLS 없음
 * - aria-hidden 장식 레이어(그레인 등)는 제외
 * - prefers-reduced-motion 이면 아무것도 하지 않음 (CSS도 이중 방어)
 */

import { useEffect } from 'react';

export default function RevealInit() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets: Element[] = [];
    document.querySelectorAll('section').forEach((sec) => {
      const el = sec.querySelector(':scope > div:not([aria-hidden])');
      if (!el) return;
      // 이미 화면에 보이는 요소는 제외 — 첫 페인트 플래시 방지
      if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
      el.classList.add('dp-reveal');
      targets.push(el);
    });
    if (targets.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('dp-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return null;
}

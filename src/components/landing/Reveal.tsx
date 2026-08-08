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

    // 안전장치 — 페이지를 그리기만 하고 스크롤하지 않는 쪽을 위한 것.
    // AI 크롤러·스크린샷 수집기·미리보기 봇은 첫 화면만 렌더하고 끝내므로
    // 그 아래 섹션을 영영 opacity:0 으로 본다. 사람 눈에는 안 보이는 문제지만
    // 우리가 파는 것이 검색·AI 노출이라 빈 페이지로 읽히면 치명적이다.
    // 사람은 대개 1초 안에 스크롤을 시작하므로, 스크롤이 한 번이라도 있으면
    // 타이머를 취소해 등장 효과를 그대로 살린다.
    const failsafe = window.setTimeout(() => {
      targets.forEach((t) => t.classList.add('dp-in'));
    }, 1200);
    const cancelFailsafe = () => window.clearTimeout(failsafe);
    window.addEventListener('scroll', cancelFailsafe, { passive: true, once: true });

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
      window.removeEventListener('scroll', cancelFailsafe);
    };
  }, []);

  return null;
}

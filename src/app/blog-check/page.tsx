import { redirect } from 'next/navigation';

/**
 * /blog-check — 구 "네이버 블로그 무료진단" 진입 페이지 (2026-07-27 은퇴).
 *
 * 무료진단은 랜딩 첫 화면의 **병원명 진단(/clinic-check)** 으로 일원화했다.
 * 페이지를 지우지 않고 메인으로 넘기는 이유: 영업 메일·블로그 등 외부에 공유된
 * /blog-check 링크와 검색 유입이 404 로 죽지 않게 하기 위함이다.
 *
 * ⚠️ 진단 엔진은 여전히 blog-check 계열 모듈(blog-check-rss·keywords·serp)과
 *    /api/blog-check/* 를 내부적으로 사용한다 — 이 파일만 은퇴시킨 것이다.
 *
 * 307(임시)로 보낸다: 첫 화면 교체는 전환 실험이라 되돌릴 수 있어야 하고,
 * 308(영구)은 브라우저에 캐시되어 복구가 어렵다.
 */
export default function BlogCheckPage(): never {
  redirect('/');
}

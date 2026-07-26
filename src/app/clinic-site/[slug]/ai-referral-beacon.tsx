'use client';

import { useEffect } from 'react';
import { detectAiReferral } from '@/content/lib/ai-referral/detect';

/**
 * AI 유입 비콘 — 병원 블로그 페이지에 심는 무표시(null 렌더) 컴포넌트.
 *
 * ★ 왜 서버 렌더 중 적재가 아니라 클라이언트 비콘인가 (성능·정확성):
 *  1) 방문자 경험 보호 — 서버 컴포넌트에서 DB 를 쓰면 그 왕복이 TTFB 에 그대로
 *     얹힌다. 병원 블로그는 환자가 보는 화면이라 집계 때문에 느려지면 안 된다.
 *     Vercel 서버리스에서는 응답 후 fire-and-forget 이 안전하지 않아(응답과 함께
 *     실행이 얼어붙을 수 있다) "쓰고 기다리지 않기"라는 선택지가 없다.
 *     비콘은 페이지가 이미 그려진 뒤 브라우저가 백그라운드로 보낸다 — 렌더 경로에
 *     걸리는 비용이 0 이고, 실패해도 화면에 영향이 없다.
 *  2) 캐시 안전 — 출처 판정을 서버에서 하면 페이지가 캐시될 때 그 출처가 HTML 에
 *     굳어 이후 모든 방문자에게 같은 출처가 붙는다(구조적 오염). 판정을 브라우저에서
 *     하면 캐시 여부와 무관하게 항상 그 방문의 실제 유입 경로로 판정된다.
 *  3) 봇 제외 — 크롤러는 이 스크립트를 실행하지 않으므로 자연히 빠진다.
 *
 * ★ 서명 토큰을 **방문 시점에 별도 경로에서 받아온다** (2차 리뷰 차단 사항):
 *   토큰을 서버 렌더 시 HTML 에 박으면 토큰 수명(10분)과 페이지 캐시 수명이
 *   어긋난다. 이 페이지들은 `revalidate = 3600` 을 선언하고 있어, 한 번이라도
 *   캐시되면 캐시 생성 후 ~12분까지만 유효하고 그 뒤 최대 48분 동안 **정상 AI
 *   유입이 전부 거부된다**(조용한 실패). 발급을 동적 경로로 분리하면 페이지가
 *   캐시되든 말든 토큰은 항상 신선하다.
 *   서명이 실제로 보증하는 범위는 발급 경로 주석 참조 — "위조 방어"가 아니라
 *   위조 비용을 올리는 장치다(오프라인 생성 차단·온라인 왕복 강제·10분 재사용 창).
 *   시크릿 미설정이면 발급 경로가 204 를 주고 비콘은 조용히 포기한다.
 *
 * ★ 요청 순서 — AI 유입일 때만 네트워크를 쓴다:
 *   판정(로컬) → 토큰 GET → 비콘 POST. AI 유입이 아니면 요청이 0건이다.
 *
 * 이 기능의 DB 에 저장되는 것은 병원 slug·출처·글 id·KST 일자뿐이다. 쿠키·
 * localStorage 를 쓰지 않고 방문자 식별자를 만들지도 보내지도 않는다.
 * (공개 HTTP API 를 거치므로 Vercel/CDN 액세스 로그에 시각·IP 가 남는 것까지
 *  없앨 수는 없다 — 그래서 "수집하지 않는다"가 아니라 "이 기능의 DB 에 저장하지
 *  않는다"고 말한다.)
 */

const BEACON_PATH = '/api/clinic-site/ai-referral';
const TOKEN_PATH = '/api/clinic-site/ai-referral/token';

/**
 * "이 문서 로드에서 이미 보냈는가" 플래그 — **모듈 스코프인 것이 핵심**이다.
 *
 * 블로그 내부 이동(next/link)은 문서를 새로 로드하지 않으므로 document.referrer 가
 * 여전히 chatgpt.com 으로 남는다. 컴포넌트 지역 플래그만 쓰면 글을 3편 읽은 방문자가
 * "AI 유입 3회"로 집계돼 지표가 부풀려진다. 모듈 플래그는 하드 로드(=AI 링크로 실제
 * 착지한 그 순간)마다 초기화되므로 **진입 1회만** 집계된다 — "방문" 이라는 표기와
 * 실제 숫자가 일치한다. React StrictMode 의 effect 이중 실행도 함께 막는다.
 */
let beaconSentForThisDocument = false;

interface AiReferralBeaconProps {
  /** 병원 블로그 슬러그. */
  slug: string;
  /** 글 상세면 글 id, 블로그 홈이면 생략. */
  postId?: string | null;
}

/** 발급 경로 응답 — 형태를 신뢰하지 않고 좁혀서 쓴다. */
function readIssuedToken(raw: unknown): { token: string; exp: number } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { token, exp } = raw as { token?: unknown; exp?: unknown };
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return null;
  return { token, exp };
}

export default function AiReferralBeacon({ slug, postId = null }: AiReferralBeaconProps) {
  useEffect(() => {
    // 문서 1회 = 방문 1회. 내부 이동·StrictMode 재실행에서는 다시 보내지 않는다.
    if (beaconSentForThisDocument) return;

    const source = detectAiReferral({
      referrer: document.referrer,
      search: window.location.search,
    });
    // AI 유입이 아니면 아무 요청도 보내지 않는다 (검색·소셜·직접 방문은 범위 밖).
    // 이 경우에도 플래그를 세운다 — 같은 문서의 내부 이동은 모두 같은 판정이다.
    beaconSentForThisDocument = true;
    if (!source) return;

    const params = new URLSearchParams({ slug, source });
    if (postId) params.set('postId', postId);

    // 토큰 발급 → 비콘 전송. 전부 렌더 이후 백그라운드이며 실패는 조용히 무시한다.
    void (async () => {
      try {
        const res = await fetch(`${TOKEN_PATH}?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok || res.status === 204) return; // 시크릿 미설정·검증 실패 → 포기
        const issued = readIssuedToken(await res.json());
        if (issued === null) return;

        const payload = JSON.stringify({
          slug,
          source,
          postId,
          exp: issued.exp,
          token: issued.token,
        });

        // sendBeacon: 브라우저가 렌더·이탈과 무관하게 백그라운드로 전송한다.
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon(BEACON_PATH, blob)) return;
        }

        // 폴백 — keepalive fetch.
        await fetch(BEACON_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
          cache: 'no-store',
        });
      } catch {
        // 계측 실패가 방문자 화면을 깨서는 안 된다.
      }
    })();
  }, [slug, postId]);

  return null;
}

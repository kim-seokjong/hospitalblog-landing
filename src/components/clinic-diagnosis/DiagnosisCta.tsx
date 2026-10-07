'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthModal from '@/hr/components/AuthModal';
import { createClient } from '@/dev/lib/supabase/client';
import { trackFunnel } from '@/dev/lib/funnel';
import { DIAGNOSIS_PIXEL_EVENT, trackDiagnosisOnce } from '@/dev/lib/meta-pixel';
import type { ServiceOffer } from '@/content/lib/clinic-diagnosis/conversion';

/**
 * 결과 맨 아래 전환 버튼.
 *
 * ★2026-10-08 부터 주 버튼 = 「맡기기」 견적(hospitalmarketing.kr/services · 상품은 진단 맨 위 경고로 고른다).
 *   셀프 가입(무료 2편)은 보조 링크로 남긴다 — 9월 셀프 가입 두 곳이 한 번도 쓰지 않았다.
 *   두 버튼 모두 제품 소개(/ 또는 /pricing)로 우회하지 않는다. 여기까지 읽은 사람은 이미 설득된 사람이다.
 *
 * 문구(headline·offer)는 부모가 진단 결과에서 계산해 넘긴다(conversion.ts).
 * 이 컴포넌트는 문구를 만들지 않는다 — 계산 로직은 순수 모듈에서 테스트된다.
 */

interface DiagnosisCtaProps {
  /** 원장이 방금 본 자기 숫자가 들어간 버튼 문구. */
  readonly headline: string;
  /** 맡기기 견적 — 상품·가격·링크(conversion.ts buildServiceOffer). */
  readonly offer: ServiceOffer;
  /** 가입 폼에 미리 채울 병원명. */
  readonly hospitalName: string;
  /**
   * 이 리포트의 공유 토큰 — **계측 중복 판정에만** 쓴다.
   * ⚠️광고 플랫폼으로 전송하지 않는다. 한 방문에서 병원을 바꿔 다시 진단했을 때
   *   두 번째 리포트의 CTA 클릭이 통째로 빠지는 것을 막기 위한 로컬 키다.
   */
  readonly shareToken?: string | null;
}

export default function DiagnosisCta({ headline, offer, hospitalName, shareToken }: DiagnosisCtaProps) {
  const [showAuth, setShowAuth] = useState(false);
  /** 이미 로그인한 사람에게는 「무료 2편」을 약속하지 않는다(소진·만료·재가입 회수 가능). */
  // null = 아직 확인 전 · 확인 실패. 이때도 무료 약속은 보이지 않게 한다(Codex 2라운드).
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (!alive) return;
        if (data.user) {
          setSignedIn(true);
          return;
        }
        // 세션이 없다는 정상 응답일 때만 비로그인으로 본다. 그 밖의 오류(네트워크 등)는
        // 확인 실패(null)로 남겨 무료 약속을 띄우지 않는다.
        if (!error || error.name === 'AuthSessionMissingError') setSignedIn(false);
      })
      .catch(() => {
        /* 세션 확인 실패 = null 유지(무료 약속을 띄우지 않는다). 버튼 동작은 같다 */
      });
    return () => {
      alive = false;
    };
  }, [supabase]);
  const rootRef = useRef<HTMLElement | null>(null);
  const viewSent = useRef(false);

  /**
   * 이 버튼이 **화면에 실제로 들어왔을 때** 한 번만 노출을 기록한다.
   *
   * 버튼은 긴 결과 화면의 맨 아래에 있다. 클릭 수만 세면 "여기까지 오지 않았다"와
   * "보고도 안 눌렀다"를 구분할 수 없어서, 문구를 고쳐도 나아졌는지 판정이 안 된다.
   * (2026-08-11 실측: 결과 도달 17건에 클릭 0건 — 원인을 가릴 근거가 없었다.)
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // 미지원 브라우저에서는 계측을 건너뛴다 — 화면 동작에는 영향이 없어야 한다.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (viewSent.current) continue;
          // ⚠️isIntersecting 만 보면 1px 만 걸쳐도 true 다(threshold 는 콜백 시점만 정한다).
          //   비율을 직접 확인해야 "절반 이상 보였다"가 실제로 지켜진다.
          //   버튼이 화면보다 큰 경우를 위해 화면을 꽉 채운 상태도 노출로 인정한다.
          const filledViewport =
            entry.rootBounds != null &&
            entry.intersectionRect.height >= entry.rootBounds.height * 0.9;
          if (!entry.isIntersecting) continue;
          if (entry.intersectionRatio < 0.5 && !filledViewport) continue;
          viewSent.current = true;
          trackFunnel('diagnosis_cta_view');
          observer.disconnect();
        }
      },
      // 버튼이 절반 이상 보였을 때만 노출로 센다 — 스크롤이 스쳐 지나간 것은 노출이 아니다.
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * ★2026-10-08 — 주 버튼은 「맡기기」 견적(hospitalmarketing.kr/services)이다.
   *   셀프 가입으로 온 9월 두 곳이 한 번도 쓰지 않아서, 결과를 본 원장을 **만들어 주는 상품**으로 보낸다.
   *   계측은 새 이벤트 diagnosis_offer_click(+pick). diagnosis_cta_click 은 계속 「셀프 가입」 클릭이다
   *   (한 이름에 두 행동을 섞으면 과거 데이터와 전환율이 같이 망가진다 — 코덱스 10/8).
   *   실제 신청은 광고진정성 텔레그램 알림의 유입 줄 `dp-diagnosis` 로 센다.
   */
  const handleOfferClick = useCallback(() => {
    trackFunnel('diagnosis_offer_click', { pick: offer.pick });
    // ⚠️메타 픽셀 ctaClicked 는 옮기지 않는다 — 셀프 가입 클릭 이력이라 의미가 바뀌면 맞춤 전환이 섞인다(코덱스 10/8 2차).
  }, [offer.pick]);

  /** 보조 링크 — 직접 써 보실 분은 기존처럼 가입·무료 2편으로. */
  const handleClick = useCallback(async () => {
    trackFunnel('diagnosis_cta_click');
    // 리포트당 한 번만(모달을 닫았다 다시 누르는 경우). 표준 InitiateCheckout 은 결제 시작 전용이라 쓰지 않는다.
    trackDiagnosisOnce(DIAGNOSIS_PIXEL_EVENT.ctaClicked, shareToken ?? 'no-token');
    // 이미 로그인한 사용자에게 가입 모달을 다시 띄우지 않는다.
    try {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        router.push('/app');
        return;
      }
    } catch {
      /* 세션 확인 실패는 무시 — 가입 모달로 진행한다 */
    }
    setShowAuth(true);
  }, [router, supabase, shareToken]);

  const handleSuccess = useCallback(
    (completedMode: 'login' | 'signup', info?: { freeGranted: boolean | null }) => {
      setShowAuth(false);
      // 신규 가입은 무료 2편 안내가 붙은 화면으로 — 소개 페이지를 다시 읽히지 않는다.
      // 무료 2편이 실제로 남았다고 확인된 경우에만 무료 안내를 띄운다(재가입 회수·확인 실패는 일반 /app).
      router.push(completedMode === 'signup' && info?.freeGranted === true ? '/app?welcome=free' : '/app');
    },
    [router],
  );

  return (
    <section ref={rootRef} className="mt-8 bg-white text-[#202020]">
      {showAuth && (
        // AuthModal 자체는 z-50 이라 이 페이지의 sticky 헤더(z-40) 위에 뜬다.
        // 다만 프로젝트 규칙(모달 z-[110])을 화면 어디서나 지키도록 쌓임 맥락을 올려 둔다.
        <div className="relative z-[110]">
          <AuthModal
            onClose={() => setShowAuth(false)}
            onSuccess={handleSuccess}
            initialMode="signup"
            initialHospitalName={hospitalName}
          />
        </div>
      )}

      {/*
        ★2026-10-05: 버튼 글자를 「누르면 무엇을 받는가」로 바꿨다.
          60일 실측 — 이 버튼까지 내려온 16명 중 클릭 1명(같은 화면의 메일 받기는 4명).
          버튼에 문제 문장(headline)만 있고, 받는 것(무료 2편)은 아래 회색 작은 글씨뿐이었다.
          원장 자기 숫자가 든 headline 은 버리지 않고 버튼 바로 위 굵은 줄로 올린다.
          판정 = funnel_events 의 diagnosis_cta_click / diagnosis_cta_view.
      */}
      <div className="rounded-2xl border border-[#dbe2ea] bg-[#f7f9fb] px-4 py-5 sm:px-6 sm:py-6 text-center">
        <p className="text-[15px] sm:text-[16px] font-black text-[#202020] leading-snug">{headline}</p>
        <p className="text-[13px] sm:text-[14px] font-bold text-[#3c4653] leading-relaxed mt-1.5">
          이 결과, 직접 고치지 않으셔도 됩니다. {offer.line}
        </p>
        <a
          href={offer.href}
          target="_blank"
          rel="noopener"
          onClick={handleOfferClick}
          className="inline-block w-full sm:w-auto mt-3.5 px-7 py-4 min-h-[44px] bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-black rounded-xl text-[15px] sm:text-[16px] leading-snug shadow-[0_12px_30px_-14px_rgba(255,70,40,0.45)] transition-all hover:brightness-105"
        >
          {offer.name} 맡기고 견적 받기 →
        </a>
        <p className="text-[12px] text-[#5b6573] mt-2 leading-relaxed">{offer.price} · 신청만으로는 비용이 생기지 않습니다</p>
        <button
          type="button"
          onClick={() => void handleClick()}
          className="mt-2 min-h-[44px] px-3 text-[12.5px] font-bold text-[#3c4653] underline underline-offset-2 hover:text-[#202020]"
        >
          {signedIn === false ? '직접 써 보시려면: 우리 병원 첫 글 2편 무료로 받아보기' : signedIn ? '닥터포스트에서 직접 이어서 쓰기' : '닥터포스트로 직접 써 보기'}
        </button>
        {signedIn === false && (
          <p className="text-[11px] text-[#8a93a0] mt-1.5 leading-relaxed">
            무료 혜택을 받은 적 없는 연락처·이메일로 처음 가입할 때 · 가입 후 7일 안에 2편 무료 · 결제 정보는 입력하지 않습니다
          </p>
        )}
      </div>
    </section>
  );
}

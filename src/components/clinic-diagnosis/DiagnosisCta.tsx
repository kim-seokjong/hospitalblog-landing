'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthModal from '@/hr/components/AuthModal';
import { createClient } from '@/dev/lib/supabase/client';
import { trackFunnel } from '@/dev/lib/funnel';

/**
 * 결과 맨 아래 전환 버튼.
 *
 * ★ 버튼을 제품 소개(/ 또는 /pricing)로 보내지 않는다. 여기까지 읽고 누른 사람은
 *   이미 설득된 사람이라, 소개를 다시 읽히면 식는다. 바로 가입 → 무료 2편으로 보낸다
 *   (가입 무료 2회 크레딧 정책, 마이그 033 — 가입 후 /app?welcome=free).
 *
 * 문구(headline/sub)는 부모가 진단 결과에서 계산해 넘긴다(conversion.ts).
 * 이 컴포넌트는 문구를 만들지 않는다 — 계산 로직은 순수 모듈에서 테스트된다.
 */

interface DiagnosisCtaProps {
  /** 원장이 방금 본 자기 숫자가 들어간 버튼 문구. */
  readonly headline: string;
  /** 버튼 위 한 줄 요약. */
  readonly sub: string;
  /** 가입 폼에 미리 채울 병원명. */
  readonly hospitalName: string;
}

export default function DiagnosisCta({ headline, sub, hospitalName }: DiagnosisCtaProps) {
  const [showAuth, setShowAuth] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
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

  const handleClick = useCallback(async () => {
    trackFunnel('diagnosis_cta_click');
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
  }, [router, supabase]);

  const handleSuccess = useCallback(
    (completedMode: 'login' | 'signup') => {
      setShowAuth(false);
      // 신규 가입은 무료 2편 안내가 붙은 화면으로 — 소개 페이지를 다시 읽히지 않는다.
      router.push(completedMode === 'signup' ? '/app?welcome=free' : '/app');
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

      <div className="rounded-2xl border border-[#dbe2ea] bg-[#f7f9fb] px-4 py-5 sm:px-6 sm:py-6 text-center">
        <p className="text-[13px] sm:text-[14px] font-bold text-[#3c4653] leading-relaxed">{sub}</p>
        <button
          type="button"
          onClick={() => void handleClick()}
          className="w-full sm:w-auto mt-3.5 px-7 py-4 min-h-[44px] bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-black rounded-xl text-[15px] sm:text-[16px] leading-snug shadow-[0_12px_30px_-14px_rgba(255,70,40,0.45)] transition-all hover:brightness-105"
        >
          {headline}
        </button>
        <p className="text-[11.5px] text-[#8a93a0] mt-2.5 leading-relaxed">
          가입하면 글 2편을 무료로 만들어 볼 수 있어요. 결제 정보는 입력하지 않습니다.
        </p>
      </div>
    </section>
  );
}

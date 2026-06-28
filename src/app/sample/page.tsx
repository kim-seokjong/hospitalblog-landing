'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthModal from '@/hr/components/AuthModal';
import Logo from '@/components/landing/Logo';

interface FreeSample {
  clinicName: string;
  specialty: string;
  region: string;
  title: string;
  intro: string;
  subheadings: string[];
  sampleSection: { heading: string; body: string };
}

/**
 * useSearchParams는 반드시 <Suspense> 경계 안에서만 사용해야 App Router 빌드가
 * 깨지지 않으므로, 파라미터를 읽어 상위로 전달하는 작은 컴포넌트로 분리한다.
 */
function ClinicParamReader({ onClinic }: { onClinic: (name: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    // useSearchParams는 이미 디코딩된 값을 반환한다(한글·공백 안전).
    // 혹시 이중 인코딩된 경우를 대비해 안전하게 한 번 더 디코딩 시도.
    const raw = searchParams.get('clinic') ?? '';
    let name = raw.trim();
    if (name.includes('%')) {
      try {
        name = decodeURIComponent(name).trim();
      } catch {
        /* 디코딩 실패 시 원본 사용 */
      }
    }
    onClinic(name);
  }, [searchParams, onClinic]);
  return null;
}

const CORAL = '#ff4628';

function SamplePageInner() {
  const router = useRouter();
  const [clinic, setClinic] = useState('');
  const [clinicResolved, setClinicResolved] = useState(false);
  const [sample, setSample] = useState<FreeSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  const onClinic = useCallback((name: string) => {
    setClinic(name);
    setClinicResolved(true);
  }, []);

  useEffect(() => {
    if (!clinicResolved || !clinic) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch('/api/clinic/free-sample', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clinic }),
        });
        const data = (await res.json()) as { sample?: FreeSample; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.sample) {
          setError(data.error || '샘플을 불러오지 못했습니다.');
        } else {
          setSample(data.sample);
        }
      } catch {
        if (!cancelled) setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicResolved, clinic]);

  const openSignup = () => setShowAuth(true);

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <Suspense fallback={null}>
        <ClinicParamReader onClinic={onClinic} />
      </Suspense>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            setShowAuth(false);
            router.push('/app');
          }}
          initialMode="signup"
          initialHospitalName={clinic}
        />
      )}

      {/* 상단 컬러 스와치 바 */}
      <div className="flex h-2">
        <i className="flex-1" style={{ background: CORAL }} />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/85 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <button onClick={() => router.push('/')} aria-label="닥터포스트 홈">
            <Logo />
          </button>
          <button
            onClick={openSignup}
            className="text-sm font-semibold text-white px-4 py-2 rounded-lg"
            style={{ background: CORAL }}
          >
            무료로 시작하기
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 sm:py-12">
        {/* 안내 배지 */}
        <div
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-full mb-5"
          style={{ background: '#fff0ed', color: CORAL }}
        >
          가입 전 무료 맞춤 샘플
        </div>

        {clinicResolved && !clinic && (
          <NoClinicView onStart={openSignup} />
        )}

        {clinic && (
          <h1 className="text-2xl sm:text-3xl font-bold leading-snug mb-2">
            <span style={{ color: CORAL }}>{clinic}</span>
            <span className="text-[#202020]"> 맞춤 블로그 샘플</span>
          </h1>
        )}
        {clinic && (
          <p className="text-sm sm:text-base text-[#5b6470] mb-7">
            병원명만으로 만든 미리보기예요. 실제 발행 글은 가입 후 더 풍성하게 제공됩니다.
          </p>
        )}

        {loading && <LoadingView clinic={clinic} />}

        {error && !loading && (
          <div className="rounded-xl border border-[#f3c9c1] bg-[#fff6f4] p-5 sm:p-6">
            <p className="font-semibold mb-1" style={{ color: CORAL }}>
              샘플을 준비하지 못했어요
            </p>
            <p className="text-sm text-[#5b6470] mb-4">{error}</p>
            <button
              onClick={openSignup}
              className="text-sm font-semibold text-white px-4 py-2 rounded-lg"
              style={{ background: CORAL }}
            >
              무료로 가입하고 직접 만들어보기
            </button>
          </div>
        )}

        {sample && !loading && (
          <SampleView sample={sample} onSignup={openSignup} />
        )}
      </main>

      <footer className="border-t border-[#dbe2ea] py-8 text-center text-xs text-[#8a929c]">
        닥터포스트 · 의료광고법 걱정 없는 병원 블로그
      </footer>
    </div>
  );
}

function LoadingView({ clinic }: { clinic: string }) {
  return (
    <div className="rounded-xl border border-[#e6ebf1] p-6 sm:p-8 text-center">
      <div
        className="w-10 h-10 mx-auto mb-4 rounded-full border-4 border-[#ffd9d1] animate-spin"
        style={{ borderTopColor: CORAL }}
      />
      <p className="font-semibold mb-1">{clinic} 맞춤 샘플을 만들고 있어요</p>
      <p className="text-sm text-[#8a929c]">잠시만 기다려 주세요 (보통 10초 이내)</p>
    </div>
  );
}

function SampleView({ sample, onSignup }: { sample: FreeSample; onSignup: () => void }) {
  const meta = [sample.specialty, sample.region].filter(Boolean).join(' · ');
  return (
    <div>
      {/* 샘플 카드 */}
      <article className="rounded-2xl border border-[#e6ebf1] shadow-sm overflow-hidden">
        <div className="px-5 sm:px-7 pt-6 pb-5 border-b border-[#eef1f5]">
          {meta && <p className="text-xs font-semibold text-[#8a929c] mb-2">{meta}</p>}
          <h2 className="text-xl sm:text-2xl font-bold leading-snug">{sample.title}</h2>
        </div>

        <div className="px-5 sm:px-7 py-6 space-y-6">
          <p className="text-[15px] sm:text-base leading-relaxed text-[#3a414b]">
            {sample.intro}
          </p>

          {/* 목차(소제목) */}
          <div>
            <p className="text-xs font-semibold text-[#8a929c] mb-3">이 글의 목차</p>
            <ul className="space-y-2">
              {sample.subheadings.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[15px] text-[#202020]">
                  <span
                    className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-bold text-white flex-shrink-0"
                    style={{ background: CORAL }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium">{h}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 예시 본문 섹션 */}
          {sample.sampleSection.body && (
            <div className="rounded-xl bg-[#fafbfc] border border-[#eef1f5] p-4 sm:p-5">
              <p className="font-semibold mb-2" style={{ color: CORAL }}>
                {sample.sampleSection.heading}
              </p>
              <p className="text-[15px] leading-relaxed text-[#3a414b]">
                {sample.sampleSection.body}
              </p>
              <p className="mt-3 text-xs text-[#a4abb4]">
                ※ 나머지 본문·이미지·발행은 가입 후 전체 제공됩니다.
              </p>
            </div>
          )}
        </div>
      </article>

      {/* 가입 CTA */}
      <div
        className="mt-7 rounded-2xl p-6 sm:p-8 text-center"
        style={{ background: '#fff0ed' }}
      >
        <p className="text-lg sm:text-xl font-bold mb-2">
          마음에 드시나요? 전체 글은 1분이면 완성돼요
        </p>
        <p className="text-sm text-[#5b6470] mb-5">
          전체 본문·이미지·네이버 발행·멀티채널(인스타·쓰레드)은 가입 후 이용하실 수 있어요.
          의료광고법은 자동으로 검수됩니다.
        </p>
        <button
          onClick={onSignup}
          className="text-base font-bold text-white px-7 py-3.5 rounded-xl w-full sm:w-auto"
          style={{ background: CORAL }}
        >
          무료로 가입하고 전체 글 만들기
        </button>
      </div>
    </div>
  );
}

function NoClinicView({ onStart }: { onStart: () => void }) {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold leading-snug mb-3">
        병원 이름으로 <span style={{ color: CORAL }}>맞춤 블로그 샘플</span>을 만들어 드려요
      </h1>
      <p className="text-sm sm:text-base text-[#5b6470] mb-7">
        의료광고법 걱정 없는 병원 블로그, 닥터포스트에서 직접 확인해보세요.
        가입하면 우리 병원 이름으로 전체 글을 1분 만에 만들 수 있습니다.
      </p>
      <button
        onClick={onStart}
        className="text-base font-bold text-white px-7 py-3.5 rounded-xl w-full sm:w-auto"
        style={{ background: CORAL }}
      >
        무료로 시작하기
      </button>
    </div>
  );
}

export default function SamplePage() {
  return (
    <Suspense fallback={null}>
      <SamplePageInner />
    </Suspense>
  );
}

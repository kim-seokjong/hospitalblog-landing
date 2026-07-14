'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, Suspense, type SyntheticEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthModal from '@/hr/components/AuthModal';
import Logo from '@/components/landing/Logo';
import { trackEvent } from '@/dev/lib/meta-pixel';

interface FreeSampleSection {
  heading: string;
  body: string;
}

interface FreeSample {
  version: number;
  clinicName: string;
  specialty: string;
  region: string;
  title: string;
  intro: string;
  sections: FreeSampleSection[];
  closing: string;
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
          // 무료 맞춤 샘플이 실제로 노출된 시점 = 관심 리드 발생.
          trackEvent('Lead', {
            content_name: 'free_sample',
            content_category: 'sample_view',
          });
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
          onSuccess={(completedMode) => {
            setShowAuth(false);
            // 신규 가입은 구독 페이지로 (랜딩과 동일 정책 — free로는 이용 불가)
            router.push(completedMode === 'signup' ? '/pricing' : '/app');
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
            병원명만으로 만든 완성 글 전체예요. 의료광고법은 자동 검수됩니다.
            발행·이미지·멀티채널은 가입 후 이용하실 수 있어요.
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

/**
 * 본문 단락 렌더 — 줄바꿈을 단락으로 분리해 자연스러운 아티클 흐름을 만든다.
 */
function BodyParagraphs({ text }: { text: string }) {
  const paras = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} className="text-[15px] sm:text-base leading-[1.85] text-[#3a414b]">
          {p}
        </p>
      ))}
    </>
  );
}

function SampleView({ sample, onSignup }: { sample: FreeSample; onSignup: () => void }) {
  const meta = [sample.specialty, sample.region].filter(Boolean).join(' · ');
  // 읽기전용 미리보기 — 캐주얼 복사 차단(완벽 차단은 불가, 진입장벽 수준).
  const preventCopy = (e: SyntheticEvent) => e.preventDefault();
  return (
    <div>
      <article
        className="relative rounded-2xl border border-[#e6ebf1] shadow-sm overflow-hidden select-none"
        style={{ WebkitUserSelect: 'none', MozUserSelect: 'none', userSelect: 'none' }}
        onCopy={preventCopy}
        onCut={preventCopy}
        onContextMenu={preventCopy}
        onDragStart={preventCopy}
      >
        {/* 상단 미리보기 표식 */}
        <div
          className="text-center text-[11px] font-semibold tracking-wide py-2 border-b border-[#f1e3df]"
          style={{ background: '#fff7f5', color: '#caa79e' }}
        >
          닥터포스트 미리보기 · 읽기 전용
        </div>

        <div className="px-5 sm:px-8 pt-7 pb-5 border-b border-[#eef1f5]">
          {meta && <p className="text-xs font-semibold text-[#8a929c] mb-2">{meta}</p>}
          <h2 className="text-xl sm:text-[26px] font-bold leading-snug">{sample.title}</h2>
        </div>

        <div className="px-5 sm:px-8 py-7 space-y-7">
          {/* 인트로 */}
          <div className="space-y-4">
            <BodyParagraphs text={sample.intro} />
          </div>

          {/* 본문 섹션 전체 */}
          {sample.sections.map((sec, i) => (
            <section key={i} className="space-y-3.5">
              <h3 className="text-[17px] sm:text-[19px] font-bold leading-snug text-[#202020] pt-1">
                <span style={{ color: CORAL }}>·</span> {sec.heading}
              </h3>
              <div className="space-y-4">
                <BodyParagraphs text={sec.body} />
              </div>
            </section>
          ))}

          {/* 마무리 */}
          {sample.closing && (
            <p className="text-[15px] sm:text-base leading-[1.85] text-[#5b6470] pt-2 border-t border-[#f1f3f6]">
              {sample.closing}
            </p>
          )}
        </div>

        {/* 하단 미리보기 표식 */}
        <div
          className="text-center text-[11px] font-medium py-2.5 border-t border-[#f1e3df]"
          style={{ background: '#fff7f5', color: '#caa79e' }}
        >
          이 글은 닥터포스트가 생성한 미리보기입니다 · 복사·다운로드·발행은 가입 후 제공
        </div>
      </article>

      {/* 가입 CTA — 전환 게이팅 */}
      <div
        className="mt-7 rounded-2xl p-6 sm:p-8 text-center"
        style={{ background: '#fff0ed' }}
      >
        <p className="text-lg sm:text-xl font-bold mb-2">
          이 글, 마음에 드시나요? 우리 병원 글로 바로 발행하세요
        </p>
        <p className="text-sm text-[#5b6470] mb-4">
          지금 보시는 건 글 텍스트 미리보기예요. 가입하시면 아래 기능까지 모두 열립니다.
        </p>
        <ul className="text-left max-w-md mx-auto text-sm text-[#3a414b] mb-6 space-y-2">
          {[
            '네이버 블로그 자동 발행',
            'AI 이미지 자동 생성·삽입',
            '멀티채널 5종(영상·카드뉴스·스토리·쓰레드·인스타)',
            '글 무제한 추가 생성',
            '문장 수정·재생성 편집',
          ].map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <span
                className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0"
                style={{ background: CORAL }}
              >
                ✓
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onSignup}
          className="text-base font-bold text-white px-7 py-3.5 rounded-xl w-full sm:w-auto"
          style={{ background: CORAL }}
        >
          무료로 가입하고 전체 기능 열기
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

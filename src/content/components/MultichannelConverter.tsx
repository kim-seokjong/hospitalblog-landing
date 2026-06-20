'use client';

import { useEffect, useRef, useState } from 'react';
import {
  startConvert,
  approveJob,
  pollUntil,
  UpgradeRequiredError,
  type ClinicflixJobView,
} from '@/content/lib/clinicflix-client';

interface MultichannelConverterProps {
  /** 변환 대상 블로그 본문 (제목 + 본문). page.tsx 의 content.title / content.body 에서 합쳐 전달. */
  blogText: string;
  /** 변환 가능 여부 (영상 쿼터 보유 = 번들 플랜). false 면 업그레이드 모달을 띄운다. */
  canConvert: boolean;
  /** 닫기 */
  onClose: () => void;
}

type Stage = 'idle' | 'planning' | 'review1' | 'approving' | 'rendering' | 'done' | 'failed';

const CHANNEL_LABELS: Record<string, string> = {
  shorts: '쇼츠 영상',
  cardnews: '카드뉴스',
  threads: '쓰레드',
  feed: '인스타 피드',
  story: '스토리',
};

function isPlayableUrl(path: string | null | undefined): path is string {
  return typeof path === 'string' && /^https?:\/\//i.test(path);
}

export default function MultichannelConverter({ blogText, canConvert, onClose }: MultichannelConverterProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [job, setJob] = useState<ClinicflixJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ESC 닫기 + 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      abortRef.current?.abort();
    };
  }, [onClose]);

  async function handleStart() {
    if (!canConvert) {
      setUpgrade(true);
      return;
    }
    setError(null);
    setStage('planning');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { job_id } = await startConvert(blogText);
      const planned = await pollUntil(
        job_id,
        ['planned'],
        (j) => setJob(j),
        { signal: controller.signal },
      );
      if (planned.status === 'failed') {
        setError(planned.error || '기획 생성에 실패했습니다.');
        setStage('failed');
        return;
      }
      setStage('review1');
    } catch (e) {
      if (e instanceof UpgradeRequiredError) {
        setUpgrade(true);
        setStage('idle');
        return;
      }
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '변환에 실패했습니다.');
      setStage('failed');
    }
  }

  async function handleApprove() {
    if (!job) return;
    setError(null);
    setStage('approving');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await approveJob(job.job_id);
      setStage('rendering');
      const done = await pollUntil(
        job.job_id,
        ['review'],
        (j) => setJob(j),
        { signal: controller.signal },
      );
      if (done.status === 'failed') {
        setError(done.error || '생성에 실패했습니다.');
        setStage('failed');
        return;
      }
      setStage('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '생성에 실패했습니다.');
      setStage('failed');
    }
  }

  // ── 업그레이드 모달 ──
  if (upgrade) {
    return (
      <Shell onClose={onClose} title="🎬 멀티채널로 변환">
        <div className="text-center py-6 space-y-4">
          <div className="text-4xl">🚀</div>
          <p className="text-sm sm:text-base font-bold text-[#202020]">
            올인원 플랜으로 업그레이드하면 영상·멀티채널을 만들 수 있어요
          </p>
          <p className="text-xs text-[#5b6573] leading-relaxed">
            블로그 1편을 쇼츠 영상 · 카드뉴스 · 스토리 · 쓰레드 · 인스타 피드로
            한 번에 제작합니다. (생성 후 직접 게시)
          </p>
          <a
            href="/pricing"
            className="inline-block px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold rounded-xl transition-colors"
          >
            올인원 플랜 보기
          </a>
        </div>
      </Shell>
    );
  }

  const planChannels = job?.plan?.channels ?? [];

  return (
    <Shell onClose={onClose} title="🎬 멀티채널로 변환">
      {/* 안내 */}
      <p className="text-[11px] text-[#73808f] mb-4 leading-relaxed">
        블로그 본문을 영상(쇼츠)·카드뉴스·스토리·쓰레드·인스타 피드로 제작합니다.
        생성된 콘텐츠는 다운로드 후 직접 게시하세요. (자동 발행되지 않습니다)
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* idle: 시작 */}
      {stage === 'idle' && (
        <button
          type="button"
          onClick={handleStart}
          className="w-full py-3.5 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm sm:text-base font-bold transition-colors"
        >
          멀티채널 기획 생성하기
        </button>
      )}

      {/* planning / rendering: 진행중 */}
      {(stage === 'planning' || stage === 'approving' || stage === 'rendering') && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-[#ff4628] border-t-transparent animate-spin" />
          <p className="text-sm font-semibold text-[#202020]">
            {stage === 'rendering' || stage === 'approving'
              ? '콘텐츠를 제작하고 있어요… (수 분 소요)'
              : '채널별 기획안을 만들고 있어요…'}
          </p>
          <p className="text-[11px] text-[#73808f]">이 창을 닫지 말고 잠시 기다려 주세요.</p>
        </div>
      )}

      {/* review1: 기획 검수 */}
      {stage === 'review1' && job && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#b4bfce] bg-[#f7f9fb] px-4 py-3">
            <p className="text-xs font-bold text-[#202020] mb-2">검수 1 · 채널별 기획안</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {planChannels.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded-full bg-[#ff4628]/10 text-[#ff4628] text-[11px] font-semibold">
                  {CHANNEL_LABELS[c] ?? c}
                </span>
              ))}
            </div>
            <PlanBlock label="쇼츠 (스토리보드 · 자막 · 내레이션)" value={job.plan?.shorts} />
            <PlanBlock label="카드뉴스 (슬라이드 헤드라인)" value={job.plan?.cardnews} />
            <PlanBlock label="쓰레드" value={job.plan?.threads} />
            <PlanBlock label="인스타 피드" value={job.plan?.feed} />
            <PlanBlock label="스토리" value={job.plan?.story} />
          </div>
          {typeof job.cost_krw === 'number' && (
            <p className="text-[11px] text-[#73808f]">예상 비용: 약 {job.cost_krw.toLocaleString()}원</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApprove}
              className="flex-[2] py-3 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold transition-colors"
            >
              승인하고 생성
            </button>
          </div>
        </div>
      )}

      {/* done: 결과 + 다운로드 */}
      {stage === 'done' && job && (
        <div className="space-y-5">
          <p className="text-xs font-bold text-[#202020]">검수 2 · 생성 결과 (다운로드 후 직접 게시)</p>

          {/* 영상 */}
          {job.assets?.shorts_video_path && (
            <Section title="🎬 쇼츠 영상">
              {isPlayableUrl(job.assets.shorts_video_path) ? (
                <>
                  <video
                    src={job.assets.shorts_video_path}
                    controls
                    playsInline
                    className="w-full max-w-[280px] mx-auto rounded-xl bg-black"
                  />
                  <DownloadLink href={job.assets.shorts_video_path} label="영상 다운로드" />
                </>
              ) : (
                <p className="text-[11px] text-[#73808f] break-all">{job.assets.shorts_video_path}</p>
              )}
            </Section>
          )}

          {/* 카드뉴스 */}
          {(job.assets?.cardnews_image_urls?.length ?? 0) > 0 && (
            <Section title="🖼️ 카드뉴스">
              <ImageCarousel urls={job.assets!.cardnews_image_urls!} />
            </Section>
          )}

          {/* 스토리 */}
          {(job.assets?.story_image_urls?.length ?? 0) > 0 && (
            <Section title="📱 스토리">
              <ImageCarousel urls={job.assets!.story_image_urls!} />
            </Section>
          )}

          {/* 쓰레드 / 피드 텍스트 */}
          <TextSection title="🧵 쓰레드" value={job.plan?.threads} />
          <TextSection title="📰 인스타 피드 캡션" value={job.plan?.feed} />

          {typeof job.cost_krw === 'number' && (
            <p className="text-[11px] text-[#73808f]">사용 비용: 약 {job.cost_krw.toLocaleString()}원 · 이번 변환 1건이 차감되었습니다.</p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors"
          >
            닫기
          </button>
        </div>
      )}

      {/* failed */}
      {stage === 'failed' && (
        <div className="space-y-4 py-2">
          <button
            type="button"
            onClick={() => { setStage('idle'); setError(null); setJob(null); }}
            className="w-full py-3 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}
    </Shell>
  );
}

// ── 하위 표시 컴포넌트 ──────────────────────────────────────────────

function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center bg-black/85 backdrop-blur-md isolate"
      onClick={onClose}
    >
      <div
        className="relative w-full sm:w-[min(640px,92vw)] max-h-screen sm:max-h-[90vh] flex flex-col bg-[#f7f9fb] sm:rounded-2xl border-0 sm:border sm:border-[#b4bfce] shadow-2xl overflow-hidden isolate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-[#b4bfce] bg-white sticky top-0 z-30">
          <h2 className="text-sm sm:text-base font-bold text-[#202020] truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg bg-[#eef2f6] text-[#202020] hover:bg-red-500/80 hover:text-white transition-colors text-2xl leading-none font-bold border border-[#b4bfce] hover:border-red-500"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#b4bfce] bg-white p-3 sm:p-4 space-y-2">
      <p className="text-xs font-bold text-[#202020]">{title}</p>
      {children}
    </div>
  );
}

function PlanBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-[11px] font-semibold text-[#5b6573] mb-0.5">{label}</p>
      <pre className="text-[11px] text-[#202020] whitespace-pre-wrap break-words bg-white rounded-lg border border-[#e2e8ef] p-2 max-h-40 overflow-y-auto">
        {renderValue(value)}
      </pre>
    </div>
  );
}

function TextSection({ title, value }: { title: string; value: unknown }) {
  if (value == null) return null;
  const text = renderValue(value);
  return (
    <Section title={title}>
      <pre className="text-[11px] text-[#202020] whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{text}</pre>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(text); }}
        className="mt-1 px-3 py-1.5 rounded-lg bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-[11px] font-semibold border border-[#b4bfce] transition-colors"
      >
        텍스트 복사
      </button>
    </Section>
  );
}

function ImageCarousel({ urls }: { urls: string[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
      {urls.map((url, i) => (
        <div key={`${url}-${i}`} className="flex-shrink-0 snap-start space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`슬라이드 ${i + 1}`} className="h-44 w-auto rounded-lg border border-[#e2e8ef] bg-white object-contain" />
          <DownloadLink href={url} label={`#${i + 1} 저장`} small />
        </div>
      ))}
    </div>
  );
}

function DownloadLink({ href, label, small }: { href: string; label: string; small?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={`block text-center rounded-lg bg-[#ff4628]/10 hover:bg-[#ff4628]/20 text-[#ff4628] font-semibold transition-colors ${
        small ? 'text-[10px] py-1' : 'text-xs py-2 mt-2'
      }`}
    >
      ⬇ {label}
    </a>
  );
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

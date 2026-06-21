'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startConvert,
  approveJob,
  pollUntil,
  saveConversion,
  UpgradeRequiredError,
  type ClinicflixJobView,
} from '@/content/lib/clinicflix-client';
import {
  CHANNEL_LABELS,
  EditablePlan,
  buildDraft,
  draftToEdits,
  Section,
  TextSection,
  ImageCarousel,
  DownloadLink,
  isPlayableUrl,
  type EditableDraft,
} from '@/content/components/multichannel-views';

type Stage = 'loading' | 'idle' | 'select' | 'planning' | 'review1' | 'approving' | 'rendering' | 'done' | 'failed';

const SRC_KEY = 'dp_multichannel_src';

// 생성 가능한 채널. id 는 ClinicFlix 서비스 식별자(shorts = 영상).
const CHANNEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'shorts', label: '🎬 영상' },
  { id: 'cardnews', label: '🖼️ 카드뉴스' },
  { id: 'threads', label: '🧵 쓰레드' },
  { id: 'feed', label: '📰 피드' },
  { id: 'story', label: '📱 스토리' },
];

export default function MultichannelPage() {
  const router = useRouter();
  const [blogText, setBlogText] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [job, setJob] = useState<ClinicflixJobView | null>(null);
  // 검수1 채널별 편집 드래프트 (기획 도착 시 1회 초기화) + 리셋용 원본
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const draftOriginalRef = useRef<EditableDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // 선택된 채널 (기본: 전체 선택)
  const [selected, setSelected] = useState<string[]>(() => CHANNEL_OPTIONS.map((c) => c.id));
  const abortRef = useRef<AbortController | null>(null);

  // 마운트 시 블로그 본문 로드 → 채널 선택 단계 노출 (자동 시작하지 않음)
  useEffect(() => {
    const src = (sessionStorage.getItem(SRC_KEY) ?? '').trim();
    if (!src) {
      setStage('idle');
      setBlogText('');
      return;
    }
    setBlogText(src);
    setStage('select');
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleChannel(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  // 선택 순서와 무관하게 표시/전송 순서를 고정한다.
  function orderedSelection(): string[] {
    return CHANNEL_OPTIONS.filter((c) => selected.includes(c.id)).map((c) => c.id);
  }

  async function runPlanning(src: string, channels: string[]) {
    setError(null);
    setUpgrade(false);
    setStage('planning');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { job_id } = await startConvert(src, channels);
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
      const initialDraft = buildDraft(planned.plan);
      draftOriginalRef.current = initialDraft;
      setDraft(initialDraft);
      setStage('review1');
    } catch (e) {
      if (e instanceof UpgradeRequiredError) {
        setUpgrade(true);
        setStage('failed');
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
      const edits = draft ? draftToEdits(draft) : undefined;
      await approveJob(job.job_id, edits);
      setStage('rendering');
      const done = await pollUntil(
        job.job_id,
        ['review'],
        (j) => setJob(j),
        { signal: controller.signal, intervalMs: 4000, maxAttempts: 400 }, // 영상 렌더 ~15분 여유
      );
      if (done.status === 'failed') {
        setError(done.error || '생성에 실패했습니다.');
        setStage('failed');
        return;
      }
      // done 렌더를 먼저 띄우고, 결과를 영구 보관함에 저장(서버가 Storage 복사)
      setStage('done');
      setSaveState('saving');
      const ok = await saveConversion(job.job_id);
      setSaveState(ok ? 'saved' : 'failed');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : '생성에 실패했습니다.');
      setStage('failed');
    }
  }

  function retry() {
    setError(null);
    setUpgrade(false);
    setSaveState('idle');
    setJob(null);
    setDraft(null);
    draftOriginalRef.current = null;
    // 채널 선택 단계로 되돌아간다 (재선택 가능).
    setStage(blogText ? 'select' : 'idle');
  }

  const planChannels = job?.plan?.channels ?? [];

  return (
    <div className="min-h-screen bg-[#eaeef4] text-[#202020]">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#b4bfce] bg-white/85 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-1.5 text-[#5b6573] hover:text-[#202020] transition-colors text-sm">
            ← 블로그로
          </Link>
          <span className="font-bold text-[#202020] text-sm sm:text-base truncate">🎬 멀티채널 생성</span>
          <span className="w-16" aria-hidden />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* 페이지 타이틀 */}
        <div className="space-y-1.5">
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#202020]">🎬 멀티채널 생성</h1>
          <p className="text-sm text-[#5b6573] leading-relaxed">
            블로그 1편 → 영상 · 카드뉴스 · 스토리 · 쓰레드 · 인스타 피드 · 생성 후 다운로드해서 직접 게시
          </p>
        </div>

        {error && !upgrade && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 업그레이드 안내 */}
        {upgrade && (
          <div className="rounded-2xl border border-[#ff4628]/40 bg-[#ffece7] p-6 sm:p-8 text-center space-y-4">
            <div className="text-4xl">🚀</div>
            <p className="text-base sm:text-lg font-bold text-[#202020]">
              올인원 플랜으로 업그레이드하면 영상·멀티채널을 만들 수 있어요
            </p>
            <p className="text-sm text-[#5b6573] leading-relaxed">
              블로그 1편을 쇼츠 영상 · 카드뉴스 · 스토리 · 쓰레드 · 인스타 피드로 한 번에 제작합니다.
              (생성 후 직접 게시)
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Link
                href="/pricing"
                className="inline-block px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold rounded-xl transition-colors"
              >
                올인원 플랜 보기
              </Link>
              <Link
                href="/app"
                className="inline-block px-6 py-3 bg-white hover:bg-[#eef2f6] text-[#202020] text-sm font-semibold rounded-xl border border-[#b4bfce] transition-colors"
              >
                블로그로 돌아가기
              </Link>
            </div>
          </div>
        )}

        {/* 소스 없음 안내 */}
        {stage === 'idle' && !upgrade && (
          <div className="rounded-2xl border border-[#b4bfce] bg-white p-6 sm:p-8 text-center space-y-4">
            <div className="text-4xl">📝</div>
            <p className="text-base font-bold text-[#202020]">먼저 블로그를 생성해 주세요</p>
            <p className="text-sm text-[#5b6573] leading-relaxed">
              블로그 본문이 있어야 영상·카드뉴스·스토리·쓰레드·피드를 만들 수 있어요.
            </p>
            <Link
              href="/app"
              className="inline-block px-6 py-3 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold rounded-xl transition-colors"
            >
              블로그 생성하러 가기
            </Link>
          </div>
        )}

        {/* 채널 선택 단계 */}
        {stage === 'select' && !upgrade && (
          <div className="rounded-2xl border border-[#b4bfce] bg-white p-5 sm:p-7 space-y-5">
            <div className="space-y-1.5">
              <p className="text-base font-bold text-[#202020]">생성할 채널을 골라주세요</p>
              <p className="text-sm text-[#5b6573] leading-relaxed">
                선택한 채널만 제작되고, 선택한 만큼만 사용량이 차감됩니다.
                <br />
                🎬 영상 = 영상 1건 · 카드뉴스/쓰레드/피드/스토리 = 멀티채널 세트 1건
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((c) => {
                const on = selected.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChannel(c.id)}
                    aria-pressed={on}
                    className={
                      'px-4 py-2.5 rounded-full text-sm font-semibold border transition-colors ' +
                      (on
                        ? 'bg-[#ff4628] text-white border-[#ff4628]'
                        : 'bg-white text-[#5b6573] border-[#b4bfce] hover:border-[#ff4628]/60')
                    }
                  >
                    {on ? '✓ ' : ''}
                    {c.label}
                  </button>
                );
              })}
            </div>

            {selected.length === 0 && (
              <p className="text-sm text-[#ff4628] font-medium">채널을 1개 이상 선택해 주세요.</p>
            )}

            {/* 품질 안내 — 마이페이지 정보를 채울수록 결과물 퀄리티가 올라간다 */}
            <div className="rounded-xl border border-[#ff4628]/30 bg-[#ffece7] px-4 py-3">
              <p className="text-sm text-[#202020] leading-relaxed">
                <span className="font-semibold">✨ 마이페이지 정보를 채울수록 퀄리티가 올라갑니다.</span>
                <br />
                로고 · 원장님 사진 · 병원 사진을 등록하면 더 우리 병원다운 영상 · 카드뉴스가 만들어져요.
              </p>
              <Link
                href="/mypage?tab=brandkit"
                className="inline-block mt-2 text-sm font-semibold text-[#ff4628] underline underline-offset-2 hover:text-[#e63a1c]"
              >
                마이페이지에서 채우기 →
              </Link>
            </div>

            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => {
                if (blogText && selected.length > 0) {
                  void runPlanning(blogText, orderedSelection());
                }
              }}
              className="w-full py-3.5 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#d6c0bb] disabled:cursor-not-allowed text-white text-sm sm:text-base font-bold transition-colors"
            >
              이 채널들 생성
            </button>
          </div>
        )}

        {/* 진행중 (초기 로드 / 기획 / 승인·렌더) */}
        {(stage === 'loading' || stage === 'planning' || stage === 'approving' || stage === 'rendering') && (
          <div className="rounded-2xl border border-[#b4bfce] bg-white p-8 sm:p-12 flex flex-col items-center justify-center gap-4 text-center">
            <div className="h-11 w-11 rounded-full border-[3px] border-[#ff4628] border-t-transparent animate-spin" />
            {stage === 'rendering' || stage === 'approving' ? (
              <>
                <p className="text-base font-bold text-[#202020]">콘텐츠를 제작하고 있어요</p>
                <p className="text-sm text-[#5b6573] leading-relaxed">
                  영상 포함 ~15분 소요 · 이 페이지를 닫지 마세요
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-[#202020]">채널별 기획안을 만들고 있어요…</p>
                <p className="text-sm text-[#5b6573]">잠시 기다려 주세요.</p>
              </>
            )}
          </div>
        )}

        {/* 검수1 · 채널별 기획안 (인라인 편집) */}
        {stage === 'review1' && job && draft && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-base font-bold text-[#202020]">검수 1 · 채널별 기획안 편집</p>
              <p className="text-sm text-[#5b6573] leading-relaxed">
                생성하기 전에 채널별 문구를 직접 고칠 수 있어요. 특히 <span className="font-semibold text-[#202020]">🎬 영상 대본(컷별 내레이션)과 자막</span>을 우리 병원 멘트로 직접 작성·수정하면 그대로 영상에 반영됩니다.
              </p>
              <div className="flex flex-wrap gap-2">
                {planChannels.map((c) => (
                  <span key={c} className="px-3 py-1 rounded-full bg-[#ff4628]/10 text-[#ff4628] text-xs font-semibold">
                    {CHANNEL_LABELS[c] ?? c}
                  </span>
                ))}
              </div>
            </div>

            <EditablePlan
              draft={draft}
              original={draftOriginalRef.current ?? draft}
              onChange={setDraft}
            />

            {typeof job.cost_krw === 'number' && (
              <p className="text-sm text-[#73808f]">예상 비용: 약 {job.cost_krw.toLocaleString()}원</p>
            )}

            <div className="flex gap-3 sticky bottom-0 bg-[#eaeef4] py-3">
              <Link
                href="/app"
                className="flex-1 py-3.5 rounded-xl bg-white hover:bg-[#eef2f6] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors text-center"
              >
                취소
              </Link>
              <button
                type="button"
                onClick={handleApprove}
                className="flex-[2] py-3.5 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm sm:text-base font-bold transition-colors"
              >
                승인하고 생성
              </button>
            </div>
          </div>
        )}

        {/* 결과 · 검수2 */}
        {stage === 'done' && job && (
          <div className="space-y-5">
            <p className="text-base font-bold text-[#202020]">검수 2 · 생성 결과 (다운로드 후 직접 게시)</p>

            {/* 영상 */}
            {job.assets?.shorts_video_path && (
              <Section title="🎬 영상">
                {isPlayableUrl(job.assets.shorts_video_path) ? (
                  <>
                    <video
                      src={job.assets.shorts_video_path}
                      controls
                      playsInline
                      className="w-full max-w-[360px] mx-auto rounded-xl bg-black"
                    />
                    <DownloadLink href={job.assets.shorts_video_path} label="영상 다운로드" />
                  </>
                ) : (
                  <p className="text-sm text-[#73808f] break-all">{job.assets.shorts_video_path}</p>
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

            {/* 쓰레드 / 피드 */}
            <TextSection kind="threads" title="🧵 쓰레드" value={job.plan?.threads} />
            <TextSection kind="feed" title="📰 인스타 피드 캡션" value={job.plan?.feed} />

            {typeof job.cost_krw === 'number' && (
              <p className="text-sm text-[#73808f]">
                사용 비용: 약 {job.cost_krw.toLocaleString()}원 · 이번 변환 1건이 차감되었습니다.
              </p>
            )}

            {saveState === 'saving' && (
              <p className="text-xs text-[#73808f]">변환 내역에 저장 중…</p>
            )}
            {saveState === 'saved' && (
              <p className="text-xs text-[#73808f]">
                ✓ 변환 내역에 저장되었습니다 (마이페이지 → 변환 내역에서 다시 볼 수 있어요)
              </p>
            )}
            {saveState === 'failed' && (
              <p className="text-xs text-[#73808f]">
                결과는 지금 다운로드해 주세요(보관함 저장은 일시적으로 실패했습니다)
              </p>
            )}

            <Link
              href="/app"
              className="block w-full py-3.5 rounded-xl bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors text-center"
            >
              새 변환 / 닫기
            </Link>
          </div>
        )}

        {/* 실패 */}
        {stage === 'failed' && !upgrade && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={retry}
              className="w-full py-3.5 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold transition-colors"
            >
              다시 시도
            </button>
            <Link
              href="/app"
              className="block w-full py-3.5 rounded-xl bg-white hover:bg-[#eef2f6] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors text-center"
            >
              블로그로 돌아가기
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

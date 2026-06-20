'use client';

// 멀티채널 생성 — 채널별 읽기 좋은 표시 컴포넌트 모음.
// 기존 모달(MultichannelConverter)에서 추출. /app/multichannel 페이지가 유일한 소비자다.
// raw JSON 덤프 대신 채널별 포맷터로 사람이 읽기 좋게 렌더한다. (internal image_prompt 숨김)

import type { PlanEdits } from '@/content/lib/clinicflix-client';

export const CHANNEL_LABELS: Record<string, string> = {
  shorts: '쇼츠 영상',
  cardnews: '카드뉴스',
  threads: '쓰레드',
  feed: '인스타 피드',
  story: '스토리',
};

export type PlanKind = 'shorts' | 'cardnews' | 'threads' | 'feed' | 'story';

export function isPlayableUrl(path: string | null | undefined): path is string {
  return typeof path === 'string' && /^https?:\/\//i.test(path);
}

// ── 기획 JSON(unknown) 안전 접근 헬퍼 (any 회피) ──────────────────────
export function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function asRecArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(asRec) : [];
}
export function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
export function oneLine(v: unknown): string {
  return str(v).replace(/\s*\n\s*/g, ' ').trim();
}

// ── 채널별 기획안 본문 렌더 (raw JSON 덤프 X) ────────────────────────
export function PlanBody({ kind, value }: { kind: PlanKind; value: unknown }) {
  const o = asRec(value);
  if (kind === 'shorts') {
    const scenes = asRecArr(o.scenes);
    return (
      <>
        {scenes.map((s, i) => (
          <div key={i} className="border-b border-[#eef2f6] pb-2 last:border-0">
            <p className="font-semibold text-[#ff4628] text-xs">
              컷 {String(s.index ?? i + 1)}{s.is_doctor_shot ? ' · 원장 정면' : ' · B-roll'}
            </p>
            <p>{str(s.narration)}</p>
            {str(s.caption) && <p className="text-[#5b6573] text-xs">자막: {str(s.caption)}</p>}
          </div>
        ))}
      </>
    );
  }
  if (kind === 'cardnews') {
    const slides = asRecArr(o.slides);
    return (
      <>
        {slides.map((s, i) => (
          <div key={i} className="border-b border-[#eef2f6] pb-2 last:border-0">
            <p><span className="font-semibold text-[#ff4628]">{i + 1}.</span> <b>{oneLine(s.headline)}</b></p>
            {str(s.body) && <p className="text-[#5b6573] text-xs">{oneLine(s.body)}</p>}
          </div>
        ))}
      </>
    );
  }
  if (kind === 'threads') {
    const posts = asStrArr(o.posts);
    const tags = asStrArr(o.hashtags);
    return (
      <>
        {posts.map((p, i) => (
          <p key={i} className="whitespace-pre-line"><span className="font-semibold text-[#ff4628]">{i + 1}/</span> {p}</p>
        ))}
        {tags.length > 0 && <p className="text-[#ff4628] text-xs">{tags.join(' ')}</p>}
      </>
    );
  }
  if (kind === 'feed') {
    const tags = asStrArr(o.hashtags);
    return (
      <>
        <p className="whitespace-pre-line">{str(o.caption)}</p>
        {tags.length > 0 && <p className="text-[#ff4628] text-xs">{tags.join(' ')}</p>}
      </>
    );
  }
  // story
  const frames = asRecArr(o.frames);
  return (
    <>
      {frames.map((f, i) => (
        <div key={i} className="border-b border-[#eef2f6] pb-2 last:border-0">
          <p><span className="font-semibold text-[#ff4628]">프레임 {i + 1}:</span> {str(f.text)}</p>
          {str(f.sticker_suggestion) && <p className="text-[#5b6573] text-xs">스티커: {str(f.sticker_suggestion)}</p>}
        </div>
      ))}
    </>
  );
}

// 검수1(기획) — 채널 한 칸: 라벨 + 본문
export function PlanBlock({ kind, label, value }: { kind: PlanKind; label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="rounded-xl border border-[#b4bfce] bg-white p-4 sm:p-5 space-y-2">
      <p className="text-sm font-bold text-[#202020]">{label}</p>
      <div className="text-sm text-[#202020] leading-relaxed space-y-2">
        <PlanBody kind={kind} value={value} />
      </div>
    </div>
  );
}

// 쓰레드/피드 복사용 깔끔한 텍스트
export function planToCopyText(kind: PlanKind, value: unknown): string {
  const o = asRec(value);
  if (kind === 'threads') {
    return [...asStrArr(o.posts), asStrArr(o.hashtags).join(' ')].filter(Boolean).join('\n\n');
  }
  if (kind === 'feed') {
    return [str(o.caption), asStrArr(o.hashtags).join(' ')].filter(Boolean).join('\n\n');
  }
  return '';
}

// ── 검수1 편집(EditablePlan) ────────────────────────────────────────
// 채널별 텍스트만 편집 가능한 드래프트. (internal image_prompt/영문 필드는 노출하지 않는다)
export interface EditableDraft {
  shorts: { scenes: { narration: string; caption: string }[] };
  cardnews: { slides: { headline: string; body: string }[]; caption: string };
  threads: { posts: string[] };
  feed: { caption: string };
  story: { frames: { text: string }[] };
  // 어떤 채널이 기획에 존재하는지 (없으면 카드 자체를 숨김)
  present: Record<PlanKind, boolean>;
}

/** job.plan 으로부터 편집 드래프트 초기화. 존재하지 않는 채널은 present=false. */
export function buildDraft(plan: {
  shorts?: unknown; cardnews?: unknown; threads?: unknown; feed?: unknown; story?: unknown;
} | null | undefined): EditableDraft {
  const shortsO = asRec(plan?.shorts);
  const cardnewsO = asRec(plan?.cardnews);
  const threadsO = asRec(plan?.threads);
  const feedO = asRec(plan?.feed);
  const storyO = asRec(plan?.story);
  return {
    shorts: {
      scenes: asRecArr(shortsO.scenes).map((s) => ({
        narration: str(s.narration),
        caption: str(s.caption),
      })),
    },
    cardnews: {
      slides: asRecArr(cardnewsO.slides).map((s) => ({
        headline: str(s.headline),
        body: str(s.body),
      })),
      caption: str(cardnewsO.caption),
    },
    threads: { posts: asStrArr(threadsO.posts) },
    feed: { caption: str(feedO.caption) },
    story: { frames: asRecArr(storyO.frames).map((f) => ({ text: str(f.text) })) },
    present: {
      shorts: plan?.shorts != null,
      cardnews: plan?.cardnews != null,
      threads: plan?.threads != null,
      feed: plan?.feed != null,
      story: plan?.story != null,
    },
  };
}

/** 편집 드래프트 → 서비스 계약(PlanEdits) 직렬화. 존재하는 채널만 포함한다. */
export function draftToEdits(d: EditableDraft): PlanEdits {
  const edits: PlanEdits = {};
  if (d.present.shorts) {
    edits.shorts = {
      scenes: d.shorts.scenes.map((s) => ({ narration: s.narration, caption: s.caption })),
    };
  }
  if (d.present.cardnews) {
    edits.cardnews = {
      slides: d.cardnews.slides.map((s) => ({ headline: s.headline, body: s.body })),
      caption: d.cardnews.caption,
    };
  }
  if (d.present.threads) {
    edits.threads = { posts: [...d.threads.posts] };
  }
  if (d.present.feed) {
    edits.feed = { caption: d.feed.caption };
  }
  if (d.present.story) {
    edits.story = { frames: d.story.frames.map((f) => ({ text: f.text })) };
  }
  return edits;
}

const editLabel = 'block text-xs font-semibold text-[#5b6573]';
const editInput =
  'w-full rounded-lg border border-[#b4bfce] bg-white px-3 py-2 text-sm text-[#202020] focus:border-[#ff4628] focus:outline-none focus:ring-1 focus:ring-[#ff4628]';
const editTextarea = `${editInput} resize-y leading-relaxed`;

function EditCard({
  title, onReset, children,
}: { title: string; onReset?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#b4bfce] bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm sm:text-base font-bold text-[#202020]">{title}</p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-[#73808f] hover:text-[#ff4628] underline underline-offset-2 transition-colors shrink-0"
          >
            원래대로
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * 검수1 — 채널별 텍스트 인라인 편집기.
 * draft 를 controlled 로 받아 onChange(next) 로 상위 상태를 갱신한다.
 * original 은 채널별 "원래대로" 리셋용.
 */
export function EditablePlan({
  draft, original, onChange,
}: {
  draft: EditableDraft;
  original: EditableDraft;
  onChange: (next: EditableDraft) => void;
}) {
  function resetChannel<K extends keyof EditableDraft>(key: K) {
    onChange({ ...draft, [key]: original[key] });
  }

  return (
    <div className="space-y-4">
      {/* 🎬 쇼츠 */}
      {draft.present.shorts && (
        <EditCard title="🎬 쇼츠 영상 (컷별 내레이션·자막)" onReset={() => resetChannel('shorts')}>
          {draft.shorts.scenes.map((s, i) => (
            <div key={i} className="space-y-1.5 border-b border-[#eef2f6] pb-3 last:border-0 last:pb-0">
              <p className="text-xs font-semibold text-[#ff4628]">컷 {i + 1}</p>
              <div className="space-y-1">
                <label className={editLabel}>내레이션</label>
                <textarea
                  className={editTextarea}
                  rows={2}
                  value={s.narration}
                  onChange={(e) => {
                    const scenes = draft.shorts.scenes.map((x, j) => (j === i ? { ...x, narration: e.target.value } : x));
                    onChange({ ...draft, shorts: { scenes } });
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className={editLabel}>자막</label>
                <input
                  className={editInput}
                  value={s.caption}
                  onChange={(e) => {
                    const scenes = draft.shorts.scenes.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x));
                    onChange({ ...draft, shorts: { scenes } });
                  }}
                />
              </div>
            </div>
          ))}
        </EditCard>
      )}

      {/* 🖼️ 카드뉴스 */}
      {draft.present.cardnews && (
        <EditCard title="🖼️ 카드뉴스 (슬라이드)" onReset={() => resetChannel('cardnews')}>
          {draft.cardnews.slides.map((s, i) => (
            <div key={i} className="space-y-1.5 border-b border-[#eef2f6] pb-3 last:border-0 last:pb-0">
              <p className="text-xs font-semibold text-[#ff4628]">슬라이드 {i + 1}</p>
              <div className="space-y-1">
                <label className={editLabel}>헤드라인</label>
                <input
                  className={editInput}
                  value={s.headline}
                  onChange={(e) => {
                    const slides = draft.cardnews.slides.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x));
                    onChange({ ...draft, cardnews: { ...draft.cardnews, slides } });
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className={editLabel}>본문</label>
                <textarea
                  className={editTextarea}
                  rows={2}
                  value={s.body}
                  onChange={(e) => {
                    const slides = draft.cardnews.slides.map((x, j) => (j === i ? { ...x, body: e.target.value } : x));
                    onChange({ ...draft, cardnews: { ...draft.cardnews, slides } });
                  }}
                />
              </div>
            </div>
          ))}
          <div className="space-y-1">
            <label className={editLabel}>캡션 (선택)</label>
            <textarea
              className={editTextarea}
              rows={2}
              value={draft.cardnews.caption}
              onChange={(e) => onChange({ ...draft, cardnews: { ...draft.cardnews, caption: e.target.value } })}
            />
          </div>
        </EditCard>
      )}

      {/* 🧵 쓰레드 */}
      {draft.present.threads && (
        <EditCard title="🧵 쓰레드" onReset={() => resetChannel('threads')}>
          {draft.threads.posts.map((p, i) => (
            <div key={i} className="space-y-1">
              <label className={editLabel}>{i + 1}번째 글</label>
              <textarea
                className={editTextarea}
                rows={3}
                value={p}
                onChange={(e) => {
                  const posts = draft.threads.posts.map((x, j) => (j === i ? e.target.value : x));
                  onChange({ ...draft, threads: { posts } });
                }}
              />
            </div>
          ))}
        </EditCard>
      )}

      {/* 📰 인스타 피드 */}
      {draft.present.feed && (
        <EditCard title="📰 인스타 피드" onReset={() => resetChannel('feed')}>
          <div className="space-y-1">
            <label className={editLabel}>캡션</label>
            <textarea
              className={editTextarea}
              rows={5}
              value={draft.feed.caption}
              onChange={(e) => onChange({ ...draft, feed: { caption: e.target.value } })}
            />
          </div>
        </EditCard>
      )}

      {/* 📱 스토리 */}
      {draft.present.story && (
        <EditCard title="📱 스토리" onReset={() => resetChannel('story')}>
          {draft.story.frames.map((f, i) => (
            <div key={i} className="space-y-1">
              <label className={editLabel}>프레임 {i + 1}</label>
              <textarea
                className={editTextarea}
                rows={2}
                value={f.text}
                onChange={(e) => {
                  const frames = draft.story.frames.map((x, j) => (j === i ? { text: e.target.value } : x));
                  onChange({ ...draft, story: { frames } });
                }}
              />
            </div>
          ))}
        </EditCard>
      )}
    </div>
  );
}

// 결과(검수2) 묶음 카드
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-6 space-y-3">
      <p className="text-base sm:text-lg font-bold text-[#202020]">{title}</p>
      {children}
    </div>
  );
}

// 쓰레드/피드 결과 — 읽기 좋은 본문 + 복사
export function TextSection({ kind, title, value }: { kind: PlanKind; title: string; value: unknown }) {
  if (value == null) return null;
  const copyText = planToCopyText(kind, value);
  return (
    <Section title={title}>
      <div className="text-sm text-[#202020] leading-relaxed space-y-2">
        <PlanBody kind={kind} value={value} />
      </div>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(copyText); }}
        className="px-4 py-2 rounded-lg bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#202020] text-sm font-semibold border border-[#b4bfce] transition-colors"
      >
        텍스트 복사
      </button>
    </Section>
  );
}

export function ImageCarousel({ urls }: { urls: string[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {urls.map((url, i) => (
        <div key={`${url}-${i}`} className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`슬라이드 ${i + 1}`} className="w-full h-auto rounded-xl border border-[#e2e8ef] bg-white object-contain" />
          <DownloadLink href={url} label={`#${i + 1} 저장`} small />
        </div>
      ))}
    </div>
  );
}

export function DownloadLink({ href, label, name, small }: { href: string; label: string; name?: string; small?: boolean }) {
  // 외부 도메인(fal.media)은 a[download]가 무시되어 새 탭만 열림 → 동일 출처 프록시로 강제 다운로드(컴퓨터 저장)
  const proxied = `/api/clinicflix/download?url=${encodeURIComponent(href)}${name ? `&name=${encodeURIComponent(name)}` : ''}`
  return (
    <a
      href={proxied}
      download={name ?? true}
      className={`block text-center rounded-lg bg-[#ff4628]/10 hover:bg-[#ff4628]/20 text-[#ff4628] font-semibold transition-colors ${
        small ? 'text-xs py-1.5' : 'text-sm py-2.5 mt-2'
      }`}
    >
      ⬇ {label}
    </a>
  );
}

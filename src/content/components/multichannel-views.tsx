'use client';

// 멀티채널 생성 — 채널별 읽기 좋은 표시 컴포넌트 모음.
// 기존 모달(MultichannelConverter)에서 추출. /app/multichannel 페이지가 유일한 소비자다.
// raw JSON 덤프 대신 채널별 포맷터로 사람이 읽기 좋게 렌더한다. (internal image_prompt 숨김)

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

export function DownloadLink({ href, label, small }: { href: string; label: string; small?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={`block text-center rounded-lg bg-[#ff4628]/10 hover:bg-[#ff4628]/20 text-[#ff4628] font-semibold transition-colors ${
        small ? 'text-xs py-1.5' : 'text-sm py-2.5 mt-2'
      }`}
    >
      ⬇ {label}
    </a>
  );
}

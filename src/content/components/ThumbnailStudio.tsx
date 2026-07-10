'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '@/types';
import type { ThumbnailTemplate } from '@/content/lib/thumbnail/types';

type ImageSource = 'ai' | 'upload';

interface BgChoice {
  url: string;
  source: ImageSource;
  label: string;
}

interface ClinicPhoto {
  id: string;
  category: string;
  url: string;
  consent: boolean;
}

interface PreviewState {
  loading: boolean;
  url?: string;
  error?: string;
}

interface ThumbnailStudioProps {
  /** 에디터의 생성 이미지들 (배경 후보) */
  images: GeneratedImage[];
  /** 생성 이미지의 출처 — 'upload'(첨부)면 원본, 그 외(AI 생성)면 provenance 대상 */
  imagesSource: ImageSource;
  /** 기본 제목 (글 제목) */
  defaultTitle: string;
  /** 기본 라벨 시드 (키워드) */
  defaultKlabel?: string;
  /** 기본 병원명 */
  defaultClinicName?: string;
  onClose: () => void;
}

const TEMPLATES: { id: ThumbnailTemplate; name: string; desc: string }[] = [
  { id: 'bottom-gradient', name: '① 바텀 그라데이션', desc: '가장 흔한 형 · 안전빵' },
  { id: 'full-scrim', name: '② 풀 스크림 센터', desc: '사진 전체 어둡게 · 집중형' },
  { id: 'footer-bar', name: '③ 하단 컬러바', desc: '사진 깨끗 · 가독성↑' },
];

const CATEGORY_LABEL: Record<string, string> = {
  exterior: '외관',
  interior: '내부',
  equipment: '장비',
  staff: '의료진',
  etc: '기타',
};

/** 의료진(인물) 사진은 동의된 것만 카드 배경으로 허용. 병원 공간 사진은 게이트 불필요. */
function isPhotoSelectable(p: ClinicPhoto): boolean {
  return p.category !== 'staff' || p.consent === true;
}

export default function ThumbnailStudio({
  images,
  imagesSource,
  defaultTitle,
  defaultKlabel,
  defaultClinicName,
  onClose,
}: ThumbnailStudioProps) {
  const firstBg: BgChoice | null =
    images.length > 0 ? { url: images[0].url, source: imagesSource, label: '생성 이미지 1' } : null;

  const [bg, setBg] = useState<BgChoice | null>(firstBg);
  const [title, setTitle] = useState(defaultTitle);
  const [klabel, setKlabel] = useState(defaultKlabel ?? '');
  const [clinicName, setClinicName] = useState(defaultClinicName ?? '');
  const [tagsText, setTagsText] = useState('');
  const [accent, setAccent] = useState('#ff4628');
  const [photos, setPhotos] = useState<ClinicPhoto[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [generating, setGenerating] = useState(false);

  const objectUrlsRef = useRef<string[]>([]);

  // 업로드 사진 보관함 로드 (배경 후보 + 동의 게이트)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/clinicflix/photos');
        if (!res.ok) return;
        const json = (await res.json()) as { photos?: ClinicPhoto[] };
        if (!cancelled && Array.isArray(json.photos)) setPhotos(json.photos);
      } catch {
        /* 보관함 없음 — 생성 이미지만 사용 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC 닫기 + 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const revokeAll = useCallback(() => {
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => revokeAll, [revokeAll]);

  const parseTags = (text: string): string[] =>
    text
      .split(/[,\s#]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3);

  const generatePreviews = useCallback(async () => {
    if (!bg || !title.trim()) return;
    setGenerating(true);
    revokeAll();
    setPreviews(Object.fromEntries(TEMPLATES.map((t) => [t.id, { loading: true }])));

    await Promise.all(
      TEMPLATES.map(async ({ id }) => {
        try {
          const res = await fetch('/api/generate-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: bg.url,
              title,
              klabel: klabel.trim() || undefined,
              clinicName: clinicName.trim() || undefined,
              tags: parseTags(tagsText),
              accentColor: accent,
              template: id,
              imageSource: bg.source,
            }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error || '생성 실패');
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          setPreviews((prev) => ({ ...prev, [id]: { loading: false, url } }));
        } catch (e) {
          setPreviews((prev) => ({
            ...prev,
            [id]: { loading: false, error: e instanceof Error ? e.message : '생성 실패' },
          }));
        }
      }),
    );
    setGenerating(false);
  }, [bg, title, klabel, clinicName, tagsText, accent]);

  const download = (id: string) => {
    const pv = previews[id];
    if (!pv?.url) return;
    const a = document.createElement('a');
    a.href = pv.url;
    a.download = `thumbnail-${id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const selectablePhotos = photos.filter(isPhotoSelectable);
  const blockedStaff = photos.filter((p) => !isPhotoSelectable(p));

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-[110] flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="썸네일 만들기"
    >
      <div
        className="relative bg-white w-full sm:max-w-4xl sm:rounded-2xl shadow-2xl my-0 sm:my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-4 border-b border-[#e2e8ef] bg-white sm:rounded-t-2xl">
          <div className="w-9 h-9 rounded-xl bg-[#ffece7] border border-[#ff4628]/30 flex items-center justify-center">
            <span className="text-[#ff4628] text-lg">🎨</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-[#202020]">썸네일 만들기</h2>
            <p className="text-xs text-[#5b6573]">배경 사진 + 제목 오버레이 · 템플릿 3종</p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[#eef2f6] hover:bg-[#e2e8ef] text-[#5b6573] text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 배경 선택 */}
          <div>
            <label className="block text-xs font-bold text-[#4a4f55] mb-2">배경 사진 선택</label>

            {images.length > 0 && (
              <>
                <p className="text-[11px] text-[#73808f] mb-1.5">생성 이미지</p>
                <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                  {images.map((img, i) => {
                    const active = bg?.url === img.url;
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={img.id}
                        src={img.url}
                        alt={`생성 이미지 ${i + 1}`}
                        onClick={() => setBg({ url: img.url, source: imagesSource, label: `생성 이미지 ${i + 1}` })}
                        className={`h-16 w-16 flex-shrink-0 object-cover rounded-lg cursor-pointer border-2 ${
                          active ? 'border-[#ff4628]' : 'border-transparent'
                        }`}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {selectablePhotos.length > 0 && (
              <>
                <p className="text-[11px] text-[#73808f] mb-1.5">업로드한 병원 사진</p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {selectablePhotos.map((p) => {
                    const active = bg?.url === p.url;
                    return (
                      <div key={p.id} className="relative flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={CATEGORY_LABEL[p.category] ?? '병원 사진'}
                          onClick={() =>
                            setBg({ url: p.url, source: 'upload', label: CATEGORY_LABEL[p.category] ?? '사진' })
                          }
                          className={`h-16 w-16 object-cover rounded-lg cursor-pointer border-2 ${
                            active ? 'border-[#ff4628]' : 'border-transparent'
                          }`}
                        />
                        <span className="absolute bottom-0.5 left-0.5 px-1 py-0.5 rounded bg-black/60 text-white text-[9px]">
                          {CATEGORY_LABEL[p.category] ?? p.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {blockedStaff.length > 0 && (
              <p className="text-[11px] text-[#ff4628] mt-2">
                의료진·인물 사진 {blockedStaff.length}장은 게시 동의가 없어 배경으로 쓸 수 없습니다. (마이페이지 &gt; 사진 보관함에서 동의 후 재등록)
              </p>
            )}

            {images.length === 0 && selectablePhotos.length === 0 && (
              <p className="text-xs text-[#5b6573]">
                배경으로 쓸 사진이 없습니다. 먼저 이미지를 생성하거나 병원 사진을 업로드하세요.
              </p>
            )}
          </div>

          {/* 입력 필드 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-[#4a4f55] mb-1">제목 *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#b4bfce] text-[#202020] text-sm [color-scheme:light] focus:outline-none focus:border-[#ff4628]"
                placeholder="카드에 크게 들어갈 제목"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4a4f55] mb-1">라벨 (선택)</label>
              <input
                value={klabel}
                onChange={(e) => setKlabel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#b4bfce] text-[#202020] text-sm [color-scheme:light] focus:outline-none focus:border-[#ff4628]"
                placeholder="예: 신림동 치아교정"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4a4f55] mb-1">병원명 (선택)</label>
              <input
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#b4bfce] text-[#202020] text-sm [color-scheme:light] focus:outline-none focus:border-[#ff4628]"
                placeholder="예: 바르다권치과"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4a4f55] mb-1">태그 (선택, 최대 3)</label>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#b4bfce] text-[#202020] text-sm [color-scheme:light] focus:outline-none focus:border-[#ff4628]"
                placeholder="쉼표로 구분 · 예: 신림동치과, 투명교정"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#4a4f55] mb-1">강조색</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-10 w-14 rounded-lg border border-[#b4bfce] bg-white cursor-pointer"
                  aria-label="강조색 선택"
                />
                <span className="text-xs text-[#5b6573]">{accent}</span>
              </div>
            </div>
          </div>

          <button
            onClick={generatePreviews}
            disabled={generating || !bg || !title.trim()}
            className="w-full py-3 rounded-xl bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-bold transition-colors disabled:opacity-40"
          >
            {generating ? '생성 중...' : '미리보기 3종 생성'}
          </button>

          {/* 미리보기 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TEMPLATES.map((tpl) => {
              const pv = previews[tpl.id];
              return (
                <div key={tpl.id} className="space-y-2">
                  <div className="aspect-square rounded-xl overflow-hidden bg-[#eef2f6] border border-[#e2e8ef] flex items-center justify-center">
                    {pv?.loading ? (
                      <div className="w-6 h-6 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
                    ) : pv?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pv.url} alt={tpl.name} className="w-full h-full object-cover" />
                    ) : pv?.error ? (
                      <p className="text-[11px] text-[#ff4628] px-2 text-center">{pv.error}</p>
                    ) : (
                      <p className="text-[11px] text-[#73808f] px-2 text-center">미리보기 대기</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-[#202020]">{tpl.name}</p>
                    <p className="text-[10px] text-[#73808f]">{tpl.desc}</p>
                  </div>
                  <button
                    onClick={() => download(tpl.id)}
                    disabled={!pv?.url}
                    className="w-full py-2 rounded-lg bg-[#ffece7] text-[#ff4628] text-[11px] font-bold border border-[#ff4628]/20 disabled:opacity-40"
                  >
                    ⬇ 다운로드
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { BlogContent, TagResult, GeneratedImage } from '@/types';

interface NaverPublisherProps {
  title: string;
  content: BlogContent;
  tags: TagResult | null;
  images: GeneratedImage[];
}

/** 본문에 이미지 자리표시자를 균등 삽입 */
function buildBodyWithPlaceholders(body: string, imageCount: number): string {
  if (imageCount === 0) return body;
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim());
  if (paragraphs.length === 0) return body;

  const result: string[] = [];
  let imgIdx = 1;
  for (let i = 0; i < paragraphs.length; i++) {
    result.push(paragraphs[i]);
    if (imgIdx <= imageCount) {
      const threshold = Math.round((imgIdx / (imageCount + 1)) * paragraphs.length);
      if (i + 1 >= threshold) {
        result.push(`[이미지${imgIdx}]`);
        imgIdx++;
      }
    }
  }
  return result.join('\n\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    } else {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
  } catch {
    window.open(url, '_blank');
  }
}

export default function NaverPublisher({ title, content, tags, images }: NaverPublisherProps) {
  const [titleCopied, setTitleCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [tagsCopied, setTagsCopied] = useState(false);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);

  const flash = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 3000);
  };

  const handleCopyTitle = async () => {
    if (await copyText(title)) flash(setTitleCopied);
  };

  const handleCopyBody = async () => {
    const bodyText = buildBodyWithPlaceholders(content.body, images.length);
    if (await copyText(bodyText)) flash(setBodyCopied);
  };

  const handleCopyTags = async () => {
    const tagStr = (tags?.naverTags ?? []).slice(0, 10).map((t) => `#${t}`).join(' ');
    if (await copyText(tagStr)) flash(setTagsCopied);
  };

  const handleDownloadOne = async (img: GeneratedImage, index: number) => {
    const safe = img.prompt.slice(0, 20).replace(/[^\w가-힣]/g, '_');
    await downloadImage(img.url, `이미지${index + 1}_${safe}.png`);
    setDownloaded((prev) => new Set([...prev, img.id]));
  };

  const handleDownloadAll = async () => {
    const snapshot = [...images];
    setDownloadingAll(true);
    for (let i = 0; i < snapshot.length; i++) {
      await handleDownloadOne(snapshot[i], i);
      if (i < snapshot.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
    setDownloadingAll(false);
  };

  const doneCount = [titleCopied, bodyCopied, downloaded.size > 0, tagsCopied && (tags?.naverTags?.length ?? 0) > 0].filter(Boolean).length;

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
        <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center">
          <span className="text-white text-base font-bold">N</span>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-900">네이버 블로그 발행 도우미</h3>
          <p className="text-xs text-gray-500">단계별로 복사 → 네이버에 붙여넣기</p>
        </div>
        {doneCount > 0 && (
          <span className="text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded-lg">
            {doneCount}단계 완료
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-2.5">
        {/* STEP 1: 제목 복사 */}
        <Step
          n={1}
          label="제목 복사"
          sub={titleCopied ? '제목이 클립보드에 복사됨 — 제목란에 Ctrl+V' : `"${title.slice(0, 30)}${title.length > 30 ? '…' : ''}"`}
          done={titleCopied}
          btnLabel={titleCopied ? '재복사' : '제목 복사'}
          btnClass="bg-green-500 hover:bg-green-600"
          onClick={handleCopyTitle}
        />

        {/* STEP 2: 본문 복사 */}
        <Step
          n={2}
          label="본문 복사"
          sub={bodyCopied
            ? `본문 복사됨 — 본문 영역에 Ctrl+V${images.length > 0 ? ' ([이미지N] 위치에 이미지 삽입)' : ''}`
            : `${content.charCount.toLocaleString()}자${images.length > 0 ? ` · 이미지 자리표시자 ${images.length}개 포함` : ''}`}
          done={bodyCopied}
          btnLabel={bodyCopied ? '재복사' : '본문 복사'}
          btnClass="bg-blue-500 hover:bg-blue-600"
          onClick={handleCopyBody}
        />

        {/* STEP 3: 이미지 다운로드 */}
        {images.length > 0 && (
          <div className={`rounded-xl border p-3 space-y-2 transition-colors ${downloaded.size === images.length ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-2.5">
              <span className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${downloaded.size > 0 ? 'bg-green-500 text-white' : 'bg-gray-300 text-white'}`}>
                {downloaded.size > 0 ? '✓' : '3'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800">이미지 다운로드</p>
                <p className="text-xs text-gray-500">{downloaded.size}/{images.length}개 · [이미지N] 위치에 삽입</p>
              </div>
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                className="flex-shrink-0 text-xs font-bold px-3 py-1.5 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white rounded-lg transition-colors"
              >
                {downloadingAll ? '다운로드 중…' : '전체 다운로드'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => handleDownloadOne(img, i)}
                  title={`이미지${i + 1} 다운로드`}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${downloaded.has(img.id) ? 'border-green-400' : 'border-transparent hover:border-blue-400'}`}
                >
                  <img src={img.url} alt={`이미지${i + 1}`} className="w-full h-full object-cover" />
                  <div className={`absolute inset-0 flex items-end justify-center pb-1 ${downloaded.has(img.id) ? 'bg-green-500/60' : 'bg-black/30 opacity-0 hover:opacity-100'} transition-opacity`}>
                    <span className="text-white text-xs font-bold">
                      {downloaded.has(img.id) ? '✓ 완료' : `이미지${i + 1}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: 태그 복사 */}
        {(tags?.naverTags?.length ?? 0) > 0 && (
          <Step
            n={images.length > 0 ? 4 : 3}
            label="태그 복사"
            sub={tagsCopied
              ? '태그 복사됨 — 태그 입력란에 Ctrl+V'
              : (tags?.naverTags ?? []).slice(0, 5).map((t) => `#${t}`).join(' ') + (((tags?.naverTags?.length ?? 0) > 5) ? ' …' : '')}
            done={tagsCopied}
            btnLabel={tagsCopied ? '재복사' : '태그 복사'}
            btnClass="bg-orange-500 hover:bg-orange-600"
            onClick={handleCopyTags}
          />
        )}

        {/* 가이드 */}
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs font-semibold text-blue-800 mb-1">붙여넣기 순서</p>
          <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
            <li>네이버 블로그 글쓰기 열기</li>
            <li>제목 복사 → 제목란 Ctrl+V</li>
            <li>본문 복사 → 본문 영역 Ctrl+V</li>
            {images.length > 0 && <li>이미지 다운로드 → [이미지N] 자리에 삽입</li>}
            {(tags?.naverTags?.length ?? 0) > 0 && <li>태그 복사 → 태그 입력란 Ctrl+V → Enter</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  n: number;
  label: string;
  sub: string;
  done: boolean;
  btnLabel: string;
  btnClass: string;
  onClick: () => void;
}

function Step({ n, label, sub, done, btnLabel, btnClass, onClick }: StepProps) {
  return (
    <div className={`rounded-xl border p-3 flex items-center gap-2.5 transition-colors ${done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
      <span className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-green-500 text-white' : 'bg-gray-300 text-white'}`}>
        {done ? '✓' : n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 truncate">{sub}</p>
      </div>
      <button
        onClick={onClick}
        className={`flex-shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors text-white ${done ? 'bg-green-400 hover:bg-green-500' : btnClass}`}
      >
        {btnLabel}
      </button>
    </div>
  );
}

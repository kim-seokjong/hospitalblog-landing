'use client';

import { useEffect, useState, useCallback } from 'react';
import { Section } from '@/hr/components/form-controls';
import { uploadClinicAsset } from '@/content/lib/clinic-assets';

type Category = 'exterior' | 'interior' | 'equipment' | 'staff' | 'etc';

interface ClinicPhoto {
  id: string;
  category: string;
  url: string;
  consent: boolean;
  note: string | null;
  created_at: string;
}

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'exterior', label: '외관' },
  { value: 'interior', label: '내부' },
  { value: 'equipment', label: '장비' },
  { value: 'staff', label: '의료진' },
  { value: 'etc', label: '기타' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

export default function PhotoLibraryTab() {
  const [photos, setPhotos] = useState<ClinicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<Category>('exterior');
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clinicflix/photos');
      if (!res.ok) throw new Error('사진 조회 실패');
      const json = (await res.json()) as { photos?: ClinicPhoto[] };
      setPhotos(Array.isArray(json.photos) ? json.photos : []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  // 의료진 카테고리는 동의 체크 전에는 업로드 비활성
  const uploadDisabled = uploading || (category === 'staff' && !consent);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploading(true);
    let success = 0;
    let failed = 0;
    try {
      for (const file of files) {
        try {
          const { url } = await uploadClinicAsset(file, 'photo');
          const res = await fetch('/api/clinicflix/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category,
              url,
              consent: category === 'staff' ? consent : false,
            }),
          });
          if (!res.ok) {
            failed += 1;
          } else {
            success += 1;
          }
        } catch {
          failed += 1;
        }
      }
      await fetchPhotos();
      if (failed === 0) {
        showMsg('success', `${success}장이 등록되었습니다.`);
      } else {
        showMsg('error', `${success}장 등록, ${failed}장 실패했습니다.`);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/clinicflix/photos?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('삭제 실패');
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      showMsg('error', e instanceof Error ? e.message : '삭제 실패');
    }
  };

  return (
    <div>
      {msg && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            msg.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-600'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="space-y-4">
        {/* 업로드 */}
        <Section title="사진 등록">
          <p className="text-xs text-[#ff4628] mb-3 bg-[#ffece7] border border-[#ff4628]/30 rounded-lg px-3 py-2">
            사진을 등록하면 카드뉴스가 실제 병원 사진 중심으로 생성됩니다. 등록 안 하면 의학
            일러스트로 자동 생성됩니다.
          </p>

          <label className="block text-xs font-medium text-[#4a4f55] mb-1.5">카테고리</label>
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setCategory(opt.value);
                  if (opt.value !== 'staff') setConsent(false);
                }}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  category === opt.value
                    ? 'bg-[#ffece7] border-[#ff4628] text-[#ff4628] font-medium'
                    : 'bg-white border-[#b4bfce] text-[#5b6573] hover:text-[#202020]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {category === 'staff' && (
            <label className="flex items-start gap-2 mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#ff4628]"
              />
              <span className="text-sm text-[#202020]">
                환자/의료진 사진 게시 동의를 받았습니다
                <span className="block text-xs text-[#5b6573] mt-0.5">
                  의료진·환자가 식별되는 사진은 동의 없이 사용할 수 없습니다.
                </span>
              </span>
            </label>
          )}

          <label
            className={`inline-block w-full sm:w-auto text-center px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
              uploadDisabled
                ? 'bg-[#b4bfce] text-white cursor-not-allowed'
                : 'bg-[#ff4628] text-white hover:bg-[#e63a1c] cursor-pointer'
            }`}
          >
            {uploading ? '업로드 중...' : '사진 선택 (여러 장 가능)'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploadDisabled}
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </Section>

        {/* 그리드 */}
        <Section title={`등록된 사진 (${photos.length})`}>
          {loading ? (
            <div className="py-10 text-center text-[#5b6573] text-sm">불러오는 중...</div>
          ) : photos.length === 0 ? (
            <div className="py-10 text-center text-[#5b6573] text-sm">
              아직 등록된 사진이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative group rounded-lg overflow-hidden border border-[#b4bfce] bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={CATEGORY_LABEL[photo.category] ?? '병원 사진'}
                    className="w-full aspect-square object-cover"
                  />
                  <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px]">
                    {CATEGORY_LABEL[photo.category] ?? photo.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(photo.id)}
                    className="absolute top-1.5 right-1.5 h-6 w-6 flex items-center justify-center rounded-full bg-black/60 text-white text-sm hover:bg-red-600 transition-colors"
                    aria-label="사진 삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

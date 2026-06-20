'use client';

import { useEffect, useState, useCallback } from 'react';
import { Section, Field, Select } from '@/hr/components/form-controls';
import { uploadClinicAsset } from '@/content/lib/clinic-assets';

interface BrandKit {
  logo_url: string | null;
  brand_color: string;
  hashtags: string[];
  voice_gender: string;
  threads_tone: string;
  cardnews_style: number;
  shorts_concept: string;
  doctor_photo_url: string | null;
  doctor_video_url: string | null;
}

const DEFAULT_BRANDKIT: BrandKit = {
  logo_url: null,
  brand_color: '#ff4628',
  hashtags: [],
  voice_gender: 'female',
  threads_tone: 'haeyo',
  cardnews_style: 2,
  shorts_concept: '정보형',
  doctor_photo_url: null,
  doctor_video_url: null,
};

const VOICE_OPTIONS = [
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
];

const TONE_OPTIONS = [
  { value: 'haeyo', label: '해요체' },
  { value: 'banmal', label: '반말체' },
  { value: 'hamnida', label: '합니다체' },
];

const CARDNEWS_OPTIONS = [
  { value: '2', label: '의학 실사' },
  { value: '1', label: '그라데이션' },
  { value: '3', label: '플랫 벡터' },
  { value: '4', label: '인포그래픽' },
];

const CONCEPT_OPTIONS = [
  { value: '정보형', label: '정보형' },
  { value: '후킹형', label: '후킹형' },
  { value: '친근형', label: '친근형' },
];

export default function BrandKitTab() {
  const [brand, setBrand] = useState<BrandKit>(DEFAULT_BRANDKIT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hashtagInput, setHashtagInput] = useState('');
  const [uploading, setUploading] = useState<'logo' | 'photo' | 'video' | null>(null);

  const fetchBrandKit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clinicflix/brandkit');
      if (!res.ok) throw new Error('브랜드킷 조회 실패');
      const json = (await res.json()) as Partial<BrandKit>;
      const incoming = Object.fromEntries(
        Object.entries(json ?? {}).filter(([, v]) => v !== null && v !== undefined),
      ) as Partial<BrandKit>;
      setBrand({ ...DEFAULT_BRANDKIT, ...incoming });
    } catch {
      setBrand(DEFAULT_BRANDKIT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBrandKit();
  }, [fetchBrandKit]);

  const showError = (text: string) => {
    setSaveMsg({ type: 'error', text });
    setTimeout(() => setSaveMsg(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/clinicflix/brandkit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logo_url: brand.logo_url,
          brand_color: brand.brand_color,
          hashtags: brand.hashtags,
          voice_gender: brand.voice_gender,
          threads_tone: brand.threads_tone,
          cardnews_style: brand.cardnews_style,
          shorts_concept: brand.shorts_concept,
          doctor_photo_url: brand.doctor_photo_url,
          doctor_video_url: brand.doctor_video_url,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? '저장 실패');
      }
      setSaveMsg({ type: 'success', text: '콘텐츠 설정이 저장되었습니다.' });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      showError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (
    file: File | undefined,
    kind: 'logo' | 'doctor',
    busy: 'logo' | 'photo' | 'video',
    apply: (url: string) => void,
  ) => {
    if (!file) return;
    setUploading(busy);
    try {
      const { url } = await uploadClinicAsset(file, kind);
      apply(url);
    } catch (e) {
      showError(e instanceof Error ? e.message : '업로드 실패');
    } finally {
      setUploading(null);
    }
  };

  const addHashtag = () => {
    const tag = hashtagInput.trim().replace(/^#/, '');
    if (!tag || brand.hashtags.includes(tag)) return;
    if (brand.hashtags.length >= 10) return;
    setBrand((p) => ({ ...p, hashtags: [...p.hashtags, tag] }));
    setHashtagInput('');
  };

  const removeHashtag = (tag: string) => {
    setBrand((p) => ({ ...p, hashtags: p.hashtags.filter((t) => t !== tag) }));
  };

  const handleHashtagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addHashtag();
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-[#5b6573] text-sm">콘텐츠 설정을 불러오는 중...</div>
    );
  }

  return (
    <div>
      {saveMsg && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            saveMsg.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-600'
          }`}
        >
          {saveMsg.text}
        </div>
      )}

      <div className="space-y-4">
        {/* 1. 브랜드 */}
        <Section title="브랜드">
          <Field label="로고">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {brand.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.logo_url}
                  alt="로고 미리보기"
                  className="h-16 w-16 object-contain rounded-lg border border-[#b4bfce] bg-white"
                />
              ) : (
                <div className="h-16 w-16 flex items-center justify-center rounded-lg border border-dashed border-[#b4bfce] text-[10px] text-[#5b6573] text-center">
                  미등록
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-3 py-2 bg-[#eef2f6] border border-[#b4bfce] rounded-lg text-sm text-[#202020] cursor-pointer hover:bg-[#e2e8f0] transition-colors">
                  {uploading === 'logo' ? '업로드 중...' : '이미지 선택'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) =>
                      void handleUpload(e.target.files?.[0], 'logo', 'logo', (url) =>
                        setBrand((p) => ({ ...p, logo_url: url })),
                      )
                    }
                  />
                </label>
                {brand.logo_url && (
                  <button
                    type="button"
                    onClick={() => setBrand((p) => ({ ...p, logo_url: null }))}
                    className="text-xs text-[#5b6573] hover:text-red-600 transition-colors"
                  >
                    제거
                  </button>
                )}
              </div>
            </div>
          </Field>

          <Field label="브랜드 색상">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brand.brand_color}
                onChange={(e) => setBrand((p) => ({ ...p, brand_color: e.target.value }))}
                className="h-10 w-16 rounded-lg border border-[#b4bfce] bg-white cursor-pointer"
                aria-label="브랜드 색상 선택"
              />
              <span className="text-sm text-[#202020] font-mono">{brand.brand_color}</span>
            </div>
          </Field>
        </Section>

        {/* 2. 고정 해시태그 */}
        <Section title="고정 해시태그">
          <p className="text-xs text-[#5b6573] mb-3">
            Enter 키로 추가 · 최대 10개 · 모든 채널 게시물에 자동으로 붙습니다
          </p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={handleHashtagKeyDown}
              placeholder="해시태그 입력 후 Enter"
              className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
            />
            <button
              type="button"
              onClick={addHashtag}
              className="px-3 py-2 bg-[#ff4628] text-white rounded-lg text-sm font-medium hover:bg-[#e63a1c] transition-colors"
            >
              추가
            </button>
          </div>
          {brand.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brand.hashtags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#eef2f6] border border-[#b4bfce] rounded-full text-sm text-[#202020]"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => removeHashtag(tag)}
                    className="text-[#5b6573] hover:text-red-600 transition-colors leading-none"
                    aria-label={`${tag} 삭제`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 3. 콘텐츠 스타일 */}
        <Section title="콘텐츠 스타일">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="영상 음성 성별">
              <Select
                value={brand.voice_gender}
                onChange={(v) => setBrand((p) => ({ ...p, voice_gender: v }))}
                options={VOICE_OPTIONS}
              />
            </Field>
            <Field label="쓰레드 말투">
              <Select
                value={brand.threads_tone}
                onChange={(v) => setBrand((p) => ({ ...p, threads_tone: v }))}
                options={TONE_OPTIONS}
              />
            </Field>
            <Field label="카드뉴스 스타일">
              <Select
                value={String(brand.cardnews_style)}
                onChange={(v) => setBrand((p) => ({ ...p, cardnews_style: Number(v) }))}
                options={CARDNEWS_OPTIONS}
              />
            </Field>
            <Field label="쇼츠 콘셉트">
              <Select
                value={brand.shorts_concept}
                onChange={(v) => setBrand((p) => ({ ...p, shorts_concept: v }))}
                options={CONCEPT_OPTIONS}
              />
            </Field>
          </div>
        </Section>

        {/* 4. 원장 미디어 */}
        <Section title="원장 미디어 (선택)">
          <Field label="원장 사진">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {brand.doctor_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.doctor_photo_url}
                  alt="원장 사진 미리보기"
                  className="h-20 w-20 object-cover rounded-lg border border-[#b4bfce] bg-white"
                />
              ) : (
                <div className="h-20 w-20 flex items-center justify-center rounded-lg border border-dashed border-[#b4bfce] text-[10px] text-[#5b6573] text-center">
                  미등록
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-3 py-2 bg-[#eef2f6] border border-[#b4bfce] rounded-lg text-sm text-[#202020] cursor-pointer hover:bg-[#e2e8f0] transition-colors">
                  {uploading === 'photo' ? '업로드 중...' : '사진 선택'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) =>
                      void handleUpload(e.target.files?.[0], 'doctor', 'photo', (url) =>
                        setBrand((p) => ({ ...p, doctor_photo_url: url })),
                      )
                    }
                  />
                </label>
                {brand.doctor_photo_url && (
                  <button
                    type="button"
                    onClick={() => setBrand((p) => ({ ...p, doctor_photo_url: null }))}
                    className="text-xs text-[#5b6573] hover:text-red-600 transition-colors"
                  >
                    제거
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-[#ff4628] mt-2 bg-[#ffece7] border border-[#ff4628]/30 rounded-lg px-3 py-2">
              원장님 사진을 등록하면 영상에 원장님이 직접 말하는 장면이 생성됩니다(선택).
            </p>
          </Field>

          <Field label="원장 영상 (선택)">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {brand.doctor_video_url ? (
                <video
                  src={brand.doctor_video_url}
                  className="h-20 w-32 object-cover rounded-lg border border-[#b4bfce] bg-black"
                  muted
                  playsInline
                />
              ) : (
                <div className="h-20 w-32 flex items-center justify-center rounded-lg border border-dashed border-[#b4bfce] text-[10px] text-[#5b6573] text-center">
                  미등록
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-3 py-2 bg-[#eef2f6] border border-[#b4bfce] rounded-lg text-sm text-[#202020] cursor-pointer hover:bg-[#e2e8f0] transition-colors">
                  {uploading === 'video' ? '업로드 중...' : '영상 선택'}
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) =>
                      void handleUpload(e.target.files?.[0], 'doctor', 'video', (url) =>
                        setBrand((p) => ({ ...p, doctor_video_url: url })),
                      )
                    }
                  />
                </label>
                {brand.doctor_video_url && (
                  <button
                    type="button"
                    onClick={() => setBrand((p) => ({ ...p, doctor_video_url: null }))}
                    className="text-xs text-[#5b6573] hover:text-red-600 transition-colors"
                  >
                    제거
                  </button>
                )}
              </div>
            </div>
          </Field>
        </Section>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || uploading !== null}
          className="w-full sm:w-auto px-8 py-3 bg-[#ff4628] text-white rounded-xl font-semibold text-sm hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>
    </div>
  );
}

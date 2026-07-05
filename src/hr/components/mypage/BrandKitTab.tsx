'use client';

import { useEffect, useState, useCallback } from 'react';
import { Section, Field, Select } from '@/hr/components/form-controls';
import { uploadClinicAsset } from '@/content/lib/clinic-assets';
// 전속 캐릭터 프리셋 메타 — 원본(clinicflix_pipeline/clinicflix/characters.py)과 동기화 필수
import { CLINICFLIX_CHARACTER_PRESETS } from '@/content/lib/clinicflix-characters';

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
  doctor_consent: boolean;
  /** 전속 AI 캐릭터 프리셋 id (null = 미선택 → 자동 배정) */
  character_preset_id: string | null;
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
  doctor_consent: false,
  character_preset_id: null,
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

// AI 가상 진행자 프리셋 (서비스 /presenter 화이트리스트와 일치)
const PRESENTER_GENDER_OPTIONS = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
];
const PRESENTER_AGE_OPTIONS = [
  { value: '30s', label: '30대' },
  { value: '40s', label: '40대' },
  { value: '50s', label: '50대' },
  { value: '20s', label: '20대' },
];
const PRESENTER_VIBE_OPTIONS = [
  { value: 'trustworthy', label: '신뢰감 있는' },
  { value: 'friendly', label: '친근한' },
  { value: 'energetic', label: '활기찬' },
];
const PRESENTER_ATTIRE_OPTIONS = [
  { value: 'smart_casual', label: '스마트 캐주얼' },
  { value: 'suit', label: '정장' },
  { value: 'clinical', label: '클리닉 톤(가운 느낌)' },
];

interface PresenterState {
  urls: string[];
  gender: string;
  age: string;
  vibe: string;
  attire: string;
  extra: string;
}

const DEFAULT_PRESENTER: PresenterState = {
  urls: [],
  gender: 'male',
  age: '40s',
  vibe: 'trustworthy',
  attire: 'smart_casual',
  extra: '',
};

export default function BrandKitTab() {
  const [brand, setBrand] = useState<BrandKit>(DEFAULT_BRANDKIT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hashtagInput, setHashtagInput] = useState('');
  const [uploading, setUploading] = useState<'logo' | 'photo' | 'video' | null>(null);

  // AI 가상 진행자
  const [presenter, setPresenter] = useState<PresenterState>(DEFAULT_PRESENTER);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  const fetchPresenter = useCallback(async () => {
    try {
      const res = await fetch('/api/clinicflix/presenter');
      if (!res.ok) return;
      const j = (await res.json()) as {
        virtual_presenter_urls?: string[];
        gender?: string | null;
        age?: string | null;
        vibe?: string | null;
        attire?: string | null;
        extra?: string | null;
      };
      setPresenter((p) => ({
        urls: Array.isArray(j.virtual_presenter_urls) ? j.virtual_presenter_urls : [],
        gender: j.gender || p.gender,
        age: j.age || p.age,
        vibe: j.vibe || p.vibe,
        attire: j.attire || p.attire,
        extra: j.extra || '',
      }));
    } catch {
      /* 무시 — 진행자 미설정 상태로 둠 */
    }
  }, []);

  useEffect(() => {
    void fetchBrandKit();
    void fetchPresenter();
  }, [fetchBrandKit, fetchPresenter]);

  const generatePresenter = async () => {
    setGenBusy(true);
    setCandidates([]);
    try {
      const res = await fetch('/api/clinicflix/presenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          gender: presenter.gender,
          age: presenter.age,
          vibe: presenter.vibe,
          attire: presenter.attire,
          extra: presenter.extra,
          count: 2,
        }),
      });
      const j = (await res.json()) as { presenter_urls?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? '진행자 생성 실패');
      setCandidates(Array.isArray(j.presenter_urls) ? j.presenter_urls : []);
    } catch (e) {
      showError(e instanceof Error ? e.message : '진행자 생성 실패');
    } finally {
      setGenBusy(false);
    }
  };

  const confirmPresenter = async (url: string) => {
    setConfirmBusy(true);
    try {
      const res = await fetch('/api/clinicflix/presenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          urls: [url],
          gender: presenter.gender,
          age: presenter.age,
          vibe: presenter.vibe,
          attire: presenter.attire,
          extra: presenter.extra,
        }),
      });
      const j = (await res.json()) as { virtual_presenter_urls?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? '진행자 저장 실패');
      setPresenter((p) => ({ ...p, urls: j.virtual_presenter_urls ?? [] }));
      setCandidates([]);
      setSaveMsg({ type: 'success', text: '가상 진행자가 확정되었습니다. 모든 영상에 이 진행자가 나옵니다.' });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      showError(e instanceof Error ? e.message : '진행자 저장 실패');
    } finally {
      setConfirmBusy(false);
    }
  };

  const clearPresenter = async () => {
    setConfirmBusy(true);
    try {
      const res = await fetch('/api/clinicflix/presenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      const j = (await res.json()) as { virtual_presenter_urls?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? '초기화 실패');
      setPresenter((p) => ({ ...p, urls: j.virtual_presenter_urls ?? [] }));
    } catch (e) {
      showError(e instanceof Error ? e.message : '초기화 실패');
    } finally {
      setConfirmBusy(false);
    }
  };

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
          doctor_consent: brand.doctor_consent,
          character_preset_id: brand.character_preset_id,
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

        {/* 4. 전속 AI 캐릭터 (시리즈 각인) */}
        <Section title="전속 AI 캐릭터">
          <p className="text-xs text-[#5b6573] mb-3 leading-relaxed">
            병원마다 고정 캐릭터가 시리즈물처럼 등장해 <strong>&quot;그 병원 그 캐릭터&quot;</strong>로
            기억되게 합니다. 캐릭터를 선택하면 이후 영상의 진행자 말투·시그니처 멘트가 캐릭터로
            고정되고, 영상 음성도 캐릭터 성별로 통일됩니다. 아래에서 확정한 &lsquo;AI 가상
            진행자&rsquo;가 이미 있으면 얼굴은 그 진행자로 유지되고 말투·멘트만 캐릭터가 적용됩니다.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CLINICFLIX_CHARACTER_PRESETS.map((c) => {
              const selected = brand.character_preset_id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setBrand((p) => ({
                      ...p,
                      // 같은 카드를 다시 누르면 선택 해제 (자동 배정으로 복귀)
                      character_preset_id: selected ? null : c.id,
                    }))
                  }
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    selected
                      ? 'border-[#ff4628] bg-[#fff2ef] ring-1 ring-[#ff4628]'
                      : 'border-[#b4bfce] bg-white hover:border-[#ff4628]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#202020]">{c.name}</span>
                    <span
                      className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${
                        selected
                          ? 'border-[#ff4628] text-[#ff4628] font-semibold'
                          : 'border-[#b4bfce] text-[#5b6573]'
                      }`}
                    >
                      {selected ? '선택됨 ✓' : c.voiceGender === 'male' ? '남성 목소리' : '여성 목소리'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#5b6573] leading-relaxed">{c.intro}</p>
                  <p className="mt-1.5 text-xs text-[#5b6573]">
                    <span className="font-medium text-[#202020]">말투</span> · {c.tone}
                  </p>
                  <p className="mt-1 text-xs text-[#202020]">
                    시그니처 <span className="font-medium">&ldquo;{c.catchphrase}&rdquo;</span>
                  </p>
                </button>
              );
            })}
          </div>
          {brand.character_preset_id === null ? (
            <p className="mt-3 text-xs text-[#5b6573]">
              미선택 상태입니다 — 기존처럼 영상 음성 성별에 맞춰 진행자가 자동 배정됩니다.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs text-[#5b6573]">
                선택한 캐릭터는 아래 &lsquo;저장하기&rsquo;를 눌러야 적용됩니다.
              </p>
              <button
                type="button"
                onClick={() => setBrand((p) => ({ ...p, character_preset_id: null }))}
                className="text-xs text-[#5b6573] hover:text-red-600 transition-colors"
              >
                선택 해제 (자동 배정으로)
              </button>
            </div>
          )}
        </Section>

        {/* 5. AI 가상 진행자 */}
        <Section title="AI 가상 진행자">
          <p className="text-xs text-[#5b6573] mb-3 leading-relaxed">
            영상에 나와서 설명하는 진행자입니다. <strong>한 번 만들면 모든 영상에 같은 얼굴</strong>로
            나옵니다. 실제 원장님 얼굴은 사용하지 않으며, 생성 영상에는 &apos;AI 생성 영상&apos; 표기가
            표시됩니다.
          </p>

          {presenter.urls.length > 0 ? (
            <div className="mb-2 rounded-lg border border-green-200 bg-green-50 px-3 py-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={presenter.urls[0]}
                  alt="확정된 가상 진행자"
                  className="h-20 w-20 object-cover rounded-lg border border-[#b4bfce] bg-white"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-700">진행자가 확정되었습니다 ✓</p>
                  <p className="text-xs text-[#5b6573] mt-0.5">
                    모든 영상에 이 진행자가 동일하게 나옵니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => void clearPresenter()}
                    disabled={confirmBusy}
                    className="mt-2 text-xs text-[#5b6573] hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    진행자 삭제 · 다시 만들기
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-1">
                <Field label="성별">
                  <Select
                    value={presenter.gender}
                    onChange={(v) => setPresenter((p) => ({ ...p, gender: v }))}
                    options={PRESENTER_GENDER_OPTIONS}
                  />
                </Field>
                <Field label="연령대">
                  <Select
                    value={presenter.age}
                    onChange={(v) => setPresenter((p) => ({ ...p, age: v }))}
                    options={PRESENTER_AGE_OPTIONS}
                  />
                </Field>
                <Field label="분위기">
                  <Select
                    value={presenter.vibe}
                    onChange={(v) => setPresenter((p) => ({ ...p, vibe: v }))}
                    options={PRESENTER_VIBE_OPTIONS}
                  />
                </Field>
                <Field label="복장">
                  <Select
                    value={presenter.attire}
                    onChange={(v) => setPresenter((p) => ({ ...p, attire: v }))}
                    options={PRESENTER_ATTIRE_OPTIONS}
                  />
                </Field>
              </div>
              <Field label="추가 설명 (선택)">
                <input
                  type="text"
                  value={presenter.extra}
                  maxLength={300}
                  onChange={(e) => setPresenter((p) => ({ ...p, extra: e.target.value }))}
                  placeholder="예: 안경 착용, 단정한 짧은 머리, 밝은 인상"
                  className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
                />
              </Field>
              <button
                type="button"
                onClick={() => void generatePresenter()}
                disabled={genBusy}
                className="mt-3 px-4 py-2 bg-[#ff4628] text-white rounded-lg text-sm font-medium hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {genBusy ? '생성 중... (수십 초)' : candidates.length > 0 ? '다시 생성' : '진행자 후보 생성'}
              </button>

              {candidates.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-[#5b6573] mb-2">
                    마음에 드는 진행자를 고르세요. 확정하면 이후 모든 영상에 이 얼굴이 나옵니다.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {candidates.map((url, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-[#b4bfce] bg-white overflow-hidden"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`진행자 후보 ${i + 1}`}
                          className="w-full aspect-[3/4] object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void confirmPresenter(url)}
                          disabled={confirmBusy}
                          className="w-full px-2 py-2 bg-[#ff4628] text-white text-xs font-medium hover:bg-[#e63a1c] disabled:opacity-50 transition-colors"
                        >
                          {confirmBusy ? '저장 중...' : '이 진행자로 확정'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
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

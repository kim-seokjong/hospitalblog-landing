'use client';

import { useCallback, useEffect, useState } from 'react';
import { Section, Field, Input } from '@/hr/components/form-controls';
import type { VoiceDnaCard, VoiceDnaSource } from '@/content/lib/voice-dna';

/**
 * 마이페이지 — 내 문체(VOICE-DNA) 탭.
 *
 * 병원 고유 문체 카드를 표시·편집하고, 기존 블로그 글 붙여넣기 분석/편집 학습 재분석을 수동 트리거한다.
 *
 * 입력란 가독성: 흰 글자 회귀 방지 3중 안전망 —
 *   ① 공용 Input/textarea 에 명시적 text-[#202020] + bg-white + placeholder-[#5b6573]
 *   ② textarea 에 style colorScheme:'light' 적용
 *   ③ 컨테이너 배경 흰색 유지
 */

const SOURCE_BADGE: Record<VoiceDnaSource, { label: string; cls: string }> = {
  seed: { label: '기본(시드)', cls: 'bg-[#eef2f6] text-[#5b6573] border-[#b4bfce]' },
  learned: { label: '편집 학습됨', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pasted: { label: '붙여넣기/직접 설정', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const TEXTAREA_CLASS =
  'w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] resize-none focus:outline-none focus:border-[#ff4628] transition-colors';

export default function VoiceDnaTab() {
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<VoiceDnaCard | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // 편집 폼 상태 (카드 필드)
  const [tone, setTone] = useState('');
  const [patientTerm, setPatientTerm] = useState('');
  const [narrator, setNarrator] = useState('');
  const [sentenceStyle, setSentenceStyle] = useState('');
  const [description, setDescription] = useState('');
  const [signatures, setSignatures] = useState<string[]>([]);
  const [signatureInput, setSignatureInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 네이버 블로그 주소 학습 상태
  const [blogUrl, setBlogUrl] = useState('');
  const [blogLoading, setBlogLoading] = useState(false);

  // 붙여넣기 분석 상태
  const [pasteText, setPasteText] = useState('');
  const [pasteLoading, setPasteLoading] = useState(false);

  // 편집 학습 재분석 상태
  const [refreshLoading, setRefreshLoading] = useState(false);

  const applyCard = useCallback((c: VoiceDnaCard | null) => {
    setCard(c);
    setTone(c?.tone ?? '');
    setPatientTerm(c?.patientTerm ?? '');
    setNarrator(c?.narrator ?? '');
    setSentenceStyle(c?.sentenceStyle ?? '');
    setDescription(c?.description ?? '');
    setSignatures(Array.isArray(c?.signatures) ? c!.signatures : []);
  }, []);

  const fetchCard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/voice-dna');
      if (!res.ok) throw new Error('조회 실패');
      const json = (await res.json()) as { card: VoiceDnaCard | null; updatedAt: string | null };
      applyCard(json.card);
      setUpdatedAt(json.updatedAt ?? null);
    } catch {
      applyCard(null);
      setUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, [applyCard]);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  // 프로필의 기존 네이버 블로그 주소(순위추적용)를 블로그 학습 입력란 기본값으로 자동 채움
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (!res.ok) return;
        const json = (await res.json()) as { profile?: { naver_blog_url?: string | null } };
        const url = json.profile?.naver_blog_url;
        if (active && typeof url === 'string' && url.trim() !== '') {
          setBlogUrl(url.trim());
        }
      } catch {
        // 자동 채움 실패는 무시 — 사용자가 직접 입력
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const addSignature = () => {
    const s = signatureInput.trim();
    if (!s || signatures.includes(s) || signatures.length >= 5) return;
    setSignatures((prev) => [...prev, s]);
    setSignatureInput('');
  };

  const removeSignature = (s: string) => {
    setSignatures((prev) => prev.filter((x) => x !== s));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/voice-dna', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone, patientTerm, narrator, sentenceStyle, description, signatures }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? '저장 실패');
      }
      const json = (await res.json()) as { card: VoiceDnaCard; updatedAt: string };
      applyCard(json.card);
      setUpdatedAt(json.updatedAt);
      flash('success', '문체가 저장되었습니다.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleAnalyzeBlog = async () => {
    const url = blogUrl.trim();
    if (!url) {
      flash('error', '네이버 블로그 주소를 입력해주세요.');
      return;
    }
    setBlogLoading(true);
    try {
      const res = await fetch('/api/voice-dna/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogUrl: url }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? '블로그 학습에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      const json = (await res.json()) as { card: VoiceDnaCard; updatedAt: string; collected: number };
      applyCard(json.card);
      setUpdatedAt(json.updatedAt);
      flash('success', `블로그에서 글 ${json.collected}편을 모아 문체를 학습했습니다.`);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : '블로그 학습에 실패했습니다.');
    } finally {
      setBlogLoading(false);
    }
  };

  const handleAnalyzePaste = async () => {
    // textarea 하나에 1~3편을 빈 줄 2개 이상으로 구분해 입력 → 분리
    const samples = pasteText
      .split(/\n{3,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const effective = samples.length > 0 ? samples : [pasteText.trim()].filter(Boolean);

    if (effective.length === 0) {
      flash('error', '분석할 글을 붙여넣어 주세요.');
      return;
    }
    setPasteLoading(true);
    try {
      const res = await fetch('/api/voice-dna/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samples: effective.slice(0, 3) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? '분석에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      const json = (await res.json()) as { card: VoiceDnaCard; updatedAt: string };
      applyCard(json.card);
      setUpdatedAt(json.updatedAt);
      setPasteText('');
      flash('success', '붙여넣은 글에서 문체를 분석해 반영했습니다.');
    } catch (e) {
      flash('error', e instanceof Error ? e.message : '분석에 실패했습니다.');
    } finally {
      setPasteLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshLoading(true);
    try {
      const res = await fetch('/api/voice-dna/refresh', { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? '재분석에 실패했습니다.');
      }
      const json = (await res.json()) as { status?: string; card?: VoiceDnaCard };
      if (json.card) {
        applyCard(json.card);
      }
      // 최신 갱신 시각 반영을 위해 다시 조회
      await fetchCard();
      const learned = json.status === 'learned';
      const seeded = json.status === 'seeded';
      flash(
        'success',
        learned
          ? '그동안 고친 방향을 반영해 문체를 다시 학습했습니다.'
          : seeded
            ? '기본 문체 카드를 만들었습니다.'
            : '아직 학습할 만큼 편집이 쌓이지 않았어요. 글을 쓰고 직접 고친 뒤 다시 시도해주세요.',
      );
    } catch (e) {
      flash('error', e instanceof Error ? e.message : '재분석에 실패했습니다.');
    } finally {
      setRefreshLoading(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-[#5b6573] text-sm">문체 정보를 불러오는 중...</div>;
  }

  const badge = card ? SOURCE_BADGE[card.source] : null;

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

      {/* 안내 */}
      <div className="mb-5 rounded-xl border border-[#ff4628]/30 bg-[#ffece7] px-4 py-3.5">
        <p className="text-sm font-semibold text-[#202020] flex items-center gap-1.5">
          <span aria-hidden>🧬</span> 우리 병원만의 문체를 학습합니다
        </p>
        <p className="text-xs text-[#5b6573] leading-relaxed mt-1.5">
          글을 만든 뒤 <strong className="text-[#202020]">우리 사이트에서 직접 고치면</strong>, 그 고친 방향을
          AI가 학습해 다음 글부터 우리 병원 말투에 맞춰갑니다. 아래에서 현재 문체를 확인·수정하거나, 기존 블로그
          글을 붙여넣어 문체를 바로 분석할 수 있어요.
        </p>
      </div>

      <div className="space-y-4">
        {/* 현재 카드 표시 + 편집 */}
        <Section title="현재 문체 카드">
          {!card ? (
            <div className="rounded-lg bg-[#eef2f6] border border-[#b4bfce] px-4 py-5 text-center">
              <p className="text-sm font-semibold text-[#202020] mb-1">아직 병원 문체가 학습되지 않았어요</p>
              <p className="text-xs text-[#5b6573] leading-relaxed">
                글을 만들고 우리 사이트의 본문 편집에서 직접 고친 뒤 복사하면 자동으로 학습이 시작됩니다.
                <br className="hidden sm:block" />
                지금 바로 적용하고 싶다면 아래 <strong>기존 글 붙여넣기 분석</strong>을 이용하세요.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
                {card.source === 'learned' && card.sampleCount > 0 && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce]">
                    편집 {card.sampleCount}건 학습
                  </span>
                )}
                {updatedAt && (
                  <span className="text-[10px] text-[#73808f]">갱신: {formatUpdatedAt(updatedAt)}</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="환자 호칭">
                  <Input value={patientTerm} onChange={setPatientTerm} placeholder="예: 환자분" />
                </Field>
                <Field label="화자 관점">
                  <Input value={narrator} onChange={setNarrator} placeholder="예: 원장" />
                </Field>
                <Field label="어조">
                  <Input value={tone} onChange={setTone} placeholder="예: 따뜻하고 신뢰감 있는" />
                </Field>
                <Field label="문장 스타일">
                  <Input value={sentenceStyle} onChange={setSentenceStyle} placeholder="예: 짧고 명확" />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="자주 쓰는 표현 (최대 5개)">
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={signatureInput}
                      onChange={(e) => setSignatureInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSignature();
                        }
                      }}
                      placeholder="표현 입력 후 Enter"
                      style={{ colorScheme: 'light' }}
                      className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={addSignature}
                      className="shrink-0 px-3 py-2 bg-[#ff4628] text-white rounded-lg text-sm font-medium hover:bg-[#e63a1c] transition-colors"
                    >
                      추가
                    </button>
                  </div>
                  {signatures.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {signatures.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#eef2f6] border border-[#b4bfce] rounded-full text-sm text-[#202020]"
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() => removeSignature(s)}
                            className="text-[#5b6573] hover:text-red-600 transition-colors leading-none"
                            aria-label={`${s} 삭제`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
              </div>

              <div className="mt-3">
                <Field label="종합 문체 묘사">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="이 병원의 문체를 한두 문장으로 묘사합니다."
                    rows={3}
                    style={{ colorScheme: 'light' }}
                    className={TEXTAREA_CLASS}
                  />
                </Field>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="w-full sm:w-auto px-6 py-2.5 bg-[#ff4628] text-white rounded-xl font-semibold text-sm hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '저장 중...' : '문체 저장'}
                </button>
              </div>
            </>
          )}
        </Section>

        {/* 네이버 블로그 주소로 학습 (메인 입력) */}
        <Section title="네이버 블로그 주소로 학습 (가장 정확)">
          <p className="text-xs text-[#5b6573] mb-1 leading-relaxed">
            <strong className="text-[#202020]">본인 병원</strong>의 네이버 블로그 주소를 입력하면 최근 글 여러 편을
            자동으로 모아 문체를 학습합니다. 자료가 많아 가장 정확해요.
          </p>
          <p className="text-[11px] text-[#73808f] mb-3 leading-relaxed">
            반드시 본인이 운영하는 공개 블로그 주소만 입력하세요. 수집된 글은 문체 분석에만 사용됩니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAnalyzeBlog();
                }
              }}
              placeholder="blog.naver.com/myclinic"
              disabled={blogLoading}
              style={{ colorScheme: 'light' }}
              className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void handleAnalyzeBlog()}
              disabled={blogLoading || blogUrl.trim().length === 0}
              className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#ff4628] text-white rounded-xl font-semibold text-sm hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {blogLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  수집·분석 중...
                </>
              ) : (
                '이 블로그로 문체 학습하기'
              )}
            </button>
          </div>
        </Section>

        {/* 기존 글 붙여넣기 분석 (보조) */}
        <Section title="또는 글을 직접 붙여넣기">
          <p className="text-xs text-[#5b6573] mb-2 leading-relaxed">
            블로그 주소가 없거나 특정 글의 말투만 쓰고 싶다면, 병원이 직접 쓴(또는 원하는 말투의) 글 1~3편을 붙여넣어
            분석할 수 있습니다. 여러 편은 빈 줄 2번 이상으로 구분해주세요. (의학적 사실·광고 문구가 아니라 말투만
            추출됩니다)
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="여기에 기존 블로그 글을 붙여넣으세요. (각 글은 최소 100자, 여러 편은 빈 줄 2번 이상으로 구분)"
            rows={8}
            style={{ colorScheme: 'light' }}
            className={TEXTAREA_CLASS}
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleAnalyzePaste()}
              disabled={pasteLoading || pasteText.trim().length === 0}
              className="w-full sm:w-auto px-6 py-2.5 bg-white border border-[#ff4628] text-[#ff4628] rounded-xl font-semibold text-sm hover:bg-[#ffece7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pasteLoading ? '분석 중...' : '이 글로 문체 분석하기'}
            </button>
          </div>
        </Section>

        {/* 편집 학습 수동 재분석 */}
        <Section title="편집 학습 다시 분석">
          <p className="text-xs text-[#5b6573] mb-3 leading-relaxed">
            우리 사이트에서 글을 고쳐온 기록을 바탕으로 문체를 다시 학습합니다. (의미 있는 편집이 3건 이상 쌓이면
            반영됩니다)
          </p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshLoading}
            className="w-full sm:w-auto px-6 py-2.5 bg-[#eef2f6] border border-[#b4bfce] text-[#202020] rounded-xl font-semibold text-sm hover:bg-[#e3e9f0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {refreshLoading ? '분석 중...' : '🔄 편집 학습 다시 분석'}
          </button>
        </Section>
      </div>
    </div>
  );
}

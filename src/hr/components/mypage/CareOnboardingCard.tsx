'use client';

// 케어 플랜 발행 대행 온보딩 카드 — 구독·결제 탭에서 케어 구독자에게만 노출.
// 채널 계정 위임 정보를 온라인으로 제출한다(서버에서 암호화 저장, 약관 제8조의2).
// 비밀번호는 제출 후 다시 표시하지 않는다(존재 여부만).

import { useCallback, useEffect, useState } from 'react';

interface OnboardingView {
  blogId: string;
  hasBlogPassword: boolean;
  instaId: string | null;
  hasInstaPassword: boolean;
  publishMode: string;
  note: string | null;
  status: string;
  updatedAt: string;
}

interface Props {
  /** 올인원 케어 여부 — true 면 인스타그램 위임 입력을 함께 받는다 */
  includeInsta: boolean;
}

export default function CareOnboardingCard({ includeInsta }: Props) {
  const [current, setCurrent] = useState<OnboardingView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [blogId, setBlogId] = useState('');
  const [blogPw, setBlogPw] = useState('');
  const [instaId, setInstaId] = useState('');
  const [instaPw, setInstaPw] = useState('');
  const [publishMode, setPublishMode] = useState<'approve_each' | 'auto'>('approve_each');
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/care-onboarding')
      .then(async (res) => {
        const json = (await res.json()) as { onboarding?: OnboardingView | null; error?: string };
        if (!res.ok) throw new Error(json.error ?? '불러오기 실패');
        if (!cancelled) setCurrent(json.onboarding ?? null);
      })
      .catch(() => {
        // 조회 실패 시에도 카드 자체는 제출 폼으로 성립한다
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/care-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogId,
          blogPw,
          instaId: includeInsta ? instaId : '',
          instaPw: includeInsta ? instaPw : '',
          publishMode,
          note,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? '제출에 실패했습니다');
      setDone(true);
      setEditing(false);
      setBlogPw('');
      setInstaPw('');
      setCurrent({
        blogId,
        hasBlogPassword: true,
        instaId: includeInsta && instaId ? instaId : null,
        hasInstaPassword: includeInsta && Boolean(instaPw),
        publishMode,
        note: note || null,
        status: 'submitted',
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '제출에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }, [blogId, blogPw, instaId, instaPw, publishMode, note, includeInsta]);

  const revoke = useCallback(async () => {
    if (!window.confirm('발행 대행 위임을 철회할까요? 저장된 비밀번호는 즉시 파기됩니다.')) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/care-onboarding', { method: 'DELETE' });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? '철회에 실패했습니다');
      setCurrent((prev) =>
        prev ? { ...prev, status: 'revoked', hasBlogPassword: false, hasInstaPassword: false } : prev,
      );
      setDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '철회에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }, []);

  const showForm = editing || (loaded && (!current || current.status === 'revoked'));

  const inputCls =
    'w-full rounded-lg border border-[#b4bfce] px-3 py-2 text-sm text-[#202020] bg-white focus:outline-none focus:border-[#ff4628]';

  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-4 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h2 className="text-base sm:text-lg font-semibold text-[#202020] mb-1">발행 대행 온보딩</h2>
      <p className="text-xs text-[#5b6573] leading-relaxed mb-4">
        케어 플랜의 발행 대행을 시작하려면 발행할 채널 계정을 위임해 주세요. 비밀번호는{' '}
        <strong className="text-[#202020]">암호화되어 저장</strong>되며, 검수를 통과한 콘텐츠의 발행
        목적에만 사용됩니다(이용약관 제8조의2). 위임은 언제든 철회할 수 있습니다.
      </p>

      {!loaded ? (
        <p className="text-sm text-[#5b6573]">불러오는 중...</p>
      ) : showForm ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[#202020] mb-1">
              네이버 블로그 아이디 <span className="text-red-600">*</span>
            </label>
            <input
              className={inputCls}
              value={blogId}
              onChange={(e) => setBlogId(e.target.value)}
              placeholder="naver_id"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#202020] mb-1">
              네이버 비밀번호 <span className="text-red-600">*</span>
            </label>
            <input
              className={inputCls}
              type="password"
              value={blogPw}
              onChange={(e) => setBlogPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {includeInsta && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#202020] mb-1">
                  인스타그램 아이디 (선택)
                </label>
                <input
                  className={inputCls}
                  value={instaId}
                  onChange={(e) => setInstaId(e.target.value)}
                  placeholder="instagram_id"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#202020] mb-1">
                  인스타그램 비밀번호 {instaId ? <span className="text-red-600">*</span> : '(선택)'}
                </label>
                <input
                  className={inputCls}
                  type="password"
                  value={instaPw}
                  onChange={(e) => setInstaPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          <div>
            <p className="text-xs font-semibold text-[#202020] mb-1.5">발행 방식</p>
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="care-publish-mode"
                  checked={publishMode === 'approve_each'}
                  onChange={() => setPublishMode('approve_each')}
                  className="mt-0.5 accent-[#ff4628]"
                />
                <span className="text-sm text-[#4a4f55]">
                  매 편 승인 후 발행 <span className="text-xs text-[#5b6573]">— 발행 전 확인 요청을 드립니다</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="care-publish-mode"
                  checked={publishMode === 'auto'}
                  onChange={() => setPublishMode('auto')}
                  className="mt-0.5 accent-[#ff4628]"
                />
                <span className="text-sm text-[#4a4f55]">
                  검수 통과 시 발행 <span className="text-xs text-[#5b6573]">— 별도 확인 없이 발행합니다</span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#202020] mb-1">
              요청사항 (선택)
            </label>
            <textarea
              className={`${inputCls} min-h-[64px]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 발행은 평일 오전으로 부탁드립니다"
              maxLength={1000}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !blogId || !blogPw}
            className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[#ff4628] hover:bg-[#e63a1c] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '제출 중...' : '계정 위임 제출'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="w-full py-2 rounded-lg text-sm text-[#5b6573] hover:text-[#202020]"
            >
              취소
            </button>
          )}
        </div>
      ) : current ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#5b6573]">상태</span>
            <span className="font-semibold text-[#202020]">
              {current.status === 'submitted'
                ? '제출됨 — 대행 준비 중'
                : current.status === 'active'
                  ? '발행 대행 중'
                  : '철회됨'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#5b6573]">네이버 블로그</span>
            <span className="font-medium text-[#202020]">{current.blogId}</span>
          </div>
          {current.instaId && (
            <div className="flex justify-between">
              <span className="text-[#5b6573]">인스타그램</span>
              <span className="font-medium text-[#202020]">{current.instaId}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#5b6573]">발행 방식</span>
            <span className="font-medium text-[#202020]">
              {current.publishMode === 'auto' ? '검수 통과 시 발행' : '매 편 승인 후 발행'}
            </span>
          </div>
          {done && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              제출되었습니다. 확인 후 발행 대행을 시작하며, 시작되면 알려드립니다.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setBlogId(current.blogId);
                setInstaId(current.instaId ?? '');
                setPublishMode(current.publishMode === 'auto' ? 'auto' : 'approve_each');
                setNote(current.note ?? '');
                setEditing(true);
                setDone(false);
              }}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-[#eef2f6] text-[#202020] hover:bg-[#dbe2ea]"
            >
              정보 수정
            </button>
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={submitting}
              className="flex-1 py-2 rounded-lg text-sm font-medium border border-[#b4bfce] text-[#5b6573] hover:text-red-600 hover:border-red-300 disabled:opacity-50"
            >
              위임 철회
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

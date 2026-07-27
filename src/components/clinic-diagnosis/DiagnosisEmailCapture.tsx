'use client';

import { useCallback, useId, useState } from 'react';

/**
 * 진단 결과를 메일로 보내드릴까요 — **이 개편의 1순위 동선**.
 *
 * 원장이 성적표만 보고 닫으면 우리는 무료 봉사를 한 것이다. 그렇다고 가입을 목표로
 * 잡으면 전환은 0이다(처음 온 원장은 가입을 안 누른다). 자기 성적표를 메일로 받는
 * 건 거절할 이유가 없고, 그 순간 연락처와 그 병원의 구체적 문제 목록이 함께 들어온다.
 *
 * 화면 규칙:
 *  · 라이트 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *  · 입력창 colorScheme:'light' — 다크 OS 에서 흰 글자로 사라지는 회귀 방지.
 *  · 모바일 우선(터치 타깃 44px, 세로 스택 → sm 부터 가로).
 *  · 개인정보 고지는 **한 줄**. 마케팅 수신 동의를 슬쩍 끼워 넣지 않는다.
 *  · 진단의 중립적인 톤을 깨지 않는다 — 파는 문장이 아니라 "보내드릴까요"다.
 */

interface DiagnosisEmailCaptureProps {
  /** 공유 리포트 토큰 — 서버가 이 토큰으로 리포트를 다시 읽어 메일을 만든다. */
  readonly shareToken: string;
  /**
   * 배치 위치.
   * top    = 요약 바로 아래(결과를 다 읽기 전에도 남길 수 있게)
   * bottom = 결과 맨 아래(다 읽고 나서)
   */
  readonly placement: 'top' | 'bottom';
}

type Status = 'idle' | 'sending' | 'sent' | 'queued' | 'error';

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px] min-h-[44px]';

export default function DiagnosisEmailCapture({ shareToken, placement }: DiagnosisEmailCaptureProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const submit = useCallback(async () => {
    const value = email.trim();
    if (value.length === 0) {
      setError('이메일 주소를 입력해 주세요.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/clinic-diagnosis/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: shareToken, email: value }),
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; sent?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? '메일 발송에 실패했어요. 잠시 후 다시 시도해 주세요.');
        setStatus('error');
        return;
      }
      // 발송 인프라가 없으면 접수만 된다 — 사용자에게 사실대로 알린다.
      setStatus(data.sent ? 'sent' : 'queued');
    } catch {
      setError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      setStatus('error');
    }
  }, [email, shareToken]);

  if (status === 'sent' || status === 'queued') {
    return (
      <div className="bg-white border border-emerald-200 rounded-2xl px-4 py-4 sm:px-5 text-[#202020]">
        <p className="text-[14px] font-extrabold text-emerald-700">
          {status === 'sent' ? '메일로 보내드렸어요.' : '요청을 접수했어요.'}
        </p>
        <p className="text-[12.5px] text-[#4a4f55] mt-1 leading-relaxed">
          {status === 'sent'
            ? '몇 분 안에 도착하지 않으면 스팸함도 한 번 확인해 주세요.'
            : '확인 후 보내드릴게요. 시간이 조금 걸릴 수 있어요.'}
        </p>
      </div>
    );
  }

  const busy = status === 'sending';

  return (
    <div
      className={`bg-white text-[#202020] rounded-2xl px-4 py-4 sm:px-5 sm:py-5 border ${
        placement === 'top'
          ? 'border-[#ffd0c4] bg-[#fffaf8]'
          : 'border-[#dbe2ea]'
      }`}
    >
      <label htmlFor={inputId} className="block text-[14px] sm:text-[15px] font-extrabold">
        이 결과를 메일로 보내드릴까요?
      </label>
      <p className="text-[12.5px] text-[#4a4f55] mt-1 leading-relaxed">
        {placement === 'top'
          ? '지금 다 못 보셔도 괜찮아요. 주소를 남겨 주시면 결과 링크를 그대로 보내드릴게요.'
          : '나중에 다시 보시거나 원장님께 그대로 전달하실 수 있게 결과 링크를 보내드릴게요.'}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col sm:flex-row gap-2.5 mt-3"
      >
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="원장님 이메일 주소"
          className={INPUT_CLASS}
          style={{ colorScheme: 'light' }}
          maxLength={254}
          disabled={busy}
          required
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="flex-shrink-0 px-6 py-3 min-h-[44px] bg-[#ff4628] text-white font-bold rounded-xl transition-all hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed text-[15px]"
        >
          {busy ? '보내는 중…' : '결과 받기'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-[12.5px] text-[#c3341a] mt-2 leading-relaxed">
          {error}
        </p>
      )}

      <p className="text-[11px] text-[#8a93a0] mt-2.5 leading-relaxed">
        입력하신 주소는 이 진단 결과를 보내드리고 그 결과에 대해 안내드리는 데만 사용합니다. 광고성 메일은 보내지 않습니다.
      </p>
    </div>
  );
}

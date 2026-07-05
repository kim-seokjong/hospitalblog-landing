'use client';

import { useCallback, useState } from 'react';
import BlogAuditResultView from '@/hr/components/mypage/BlogAuditResultView';
import type { BlogAuditResults } from '@/types';

/**
 * admin — 임의 네이버 블로그 소급 진단 패널 (영업 시연용).
 *
 * POST /api/blog-audit 에 blogUrl 을 전달한다(서버가 admin 이메일 검증 —
 * 일반 유저는 body 주소가 무시되고 본인 프로필 주소만 사용됨).
 * admin 은 24시간 쿨다운 예외.
 */
export default function BlogAuditPanel() {
  const [blogUrl, setBlogUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<BlogAuditResults | null>(null);

  const handleRun = useCallback(async () => {
    const input = blogUrl.trim();
    if (!input) {
      setError('진단할 네이버 블로그 주소를 입력해주세요. 예: blog.naver.com/myclinic');
      return;
    }
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/blog-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogUrl: input }),
      });
      const json = await res.json().catch(() => ({})) as {
        audit?: BlogAuditResults;
        error?: string;
      };
      if (!res.ok || !json.audit) {
        throw new Error(json.error ?? '진단 실행에 실패했습니다.');
      }
      setAudit(json.audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : '진단 실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  }, [blogUrl]);

  return (
    <section className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <h2 className="text-base font-bold text-[#202020] mb-1">
        블로그 소급 진단 <span className="text-xs font-normal text-[#5b6573]">(영업 시연 — 임의 주소 허용)</span>
      </h2>
      <p className="text-xs text-[#5b6573] mb-4">
        타겟 병원의 네이버 블로그 주소를 입력하면 최근 20편의 의료광고법 위반 소지를 스캔합니다.
        결과 문구는 &ldquo;위반 소지·심의 필요&rdquo; 톤으로만 안내하세요(단정 금지).
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={blogUrl}
          onChange={(e) => setBlogUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !running) void handleRun(); }}
          placeholder="blog.naver.com/타겟병원ID"
          className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
          aria-label="진단할 네이버 블로그 주소"
        />
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="px-5 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {running ? '진단 중… (수십 초 소요)' : '진단 실행'}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

      {audit && <BlogAuditResultView audit={audit} />}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import BlogAuditResultView from './BlogAuditResultView';
import type { BlogAuditResults } from '@/types';

/**
 * 마이페이지 — 블로그 진단 탭.
 *
 * 프로필의 '내 블로그 주소'(naver_blog_url)로 기존 네이버 블로그 최근 20편을
 * 소급 진단한다(A층 전건 + A층 위험점수 상위 5편 B층 AI 심의).
 * 재실행 쿨다운 24시간. 최신 결과는 GET /api/blog-audit 캐시로 즉시 표시.
 */

type FetchState = 'loading' | 'ready' | 'error';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function BlogAuditTab() {
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [fetchError, setFetchError] = useState('');
  const [audit, setAudit] = useState<BlogAuditResults | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);

  // 최신 캐시 로드
  const loadLatest = useCallback(async () => {
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await fetch('/api/blog-audit');
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '진단 이력을 불러오지 못했습니다.');
      }
      const json = await res.json() as {
        audit: BlogAuditResults | null;
        nextAvailableAt?: string | null;
      };
      setAudit(json.audit);
      setCooldownUntil(json.nextAvailableAt ?? null);
      setFetchState('ready');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '진단 이력을 불러오지 못했습니다.');
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setRunError('');
    try {
      const res = await fetch('/api/blog-audit', { method: 'POST' });
      const json = await res.json().catch(() => ({})) as {
        audit?: BlogAuditResults;
        error?: string;
        nextAvailableAt?: string | null;
      };
      if (!res.ok) {
        if (res.status === 429 && json.nextAvailableAt) {
          setCooldownUntil(json.nextAvailableAt);
        }
        throw new Error(json.error ?? '진단 실행에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      if (json.audit) {
        setAudit(json.audit);
        setCooldownUntil(null);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : '진단 실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  }, []);

  const cooldownActive = !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();

  return (
    <div>
      {/* 안내 + 실행 */}
      <div className="bg-white border border-[#b4bfce] rounded-xl p-4 sm:p-5 mb-4 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
        <h3 className="text-sm font-bold text-[#202020] mb-1.5">기존 블로그 의료광고법 소급 진단</h3>
        <p className="text-xs text-[#5b6573] leading-relaxed mb-3">
          프로필에 등록한 <span className="font-medium text-[#202020]">내 블로그 주소</span>의 최근
          20편을 수집해 의료광고법 위반 소지 표현을 스캔합니다. 위험도가 높은 상위 5편은 AI
          심의관이 추가 검토합니다. 진단은 24시간에 1회 실행할 수 있습니다.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || cooldownActive}
            className="px-4 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#b4bfce] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {running ? '진단 중… (수십 초 소요)' : audit ? '다시 진단하기' : '진단 실행'}
          </button>
          {running && (
            <span className="text-xs text-[#5b6573]">
              블로그 글을 수집하고 검사하는 중입니다. 페이지를 벗어나지 마세요.
            </span>
          )}
          {!running && cooldownActive && cooldownUntil && (
            <span className="text-xs text-[#5b6573]">
              다음 진단 가능: {formatDateTime(cooldownUntil)}
            </span>
          )}
        </div>
        {runError && <p className="mt-2 text-xs text-red-600">{runError}</p>}
      </div>

      {/* 로딩 */}
      {fetchState === 'loading' && (
        <div className="py-12 text-center text-[#5b6573] text-sm">진단 이력을 불러오는 중...</div>
      )}

      {/* 에러 */}
      {fetchState === 'error' && (
        <div className="py-12 text-center">
          <p className="text-red-600 text-sm mb-4">{fetchError}</p>
          <button
            type="button"
            onClick={() => void loadLatest()}
            className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 빈 상태 */}
      {fetchState === 'ready' && !audit && !running && (
        <div className="py-12 text-center bg-white border border-[#b4bfce] rounded-xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-[#202020] font-semibold mb-1">아직 진단 이력이 없습니다</p>
          <p className="text-sm text-[#5b6573]">
            위 &ldquo;진단 실행&rdquo; 버튼을 눌러 기존 블로그 글의 위험 표현을 확인해보세요.
          </p>
        </div>
      )}

      {/* 결과 */}
      {fetchState === 'ready' && audit && <BlogAuditResultView audit={audit} showRewriteCta />}
    </div>
  );
}

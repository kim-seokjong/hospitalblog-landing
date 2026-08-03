'use client';

// 관리자 — 케어 플랜 발행 대행 온보딩 현황 + 계정 정보 열람(요청 시 복호화).
// 비밀번호는 목록에 싣지 않고, "계정 보기"를 눌렀을 때만 서버에서 복호화해 온다.

import { useCallback, useEffect, useState } from 'react';

interface OnboardingItem {
  userId: string;
  hospitalName: string;
  blogId: string;
  hasBlogPassword: boolean;
  instaId: string | null;
  hasInstaPassword: boolean;
  publishMode: string;
  note: string | null;
  status: string;
  updatedAt: string;
  /** 위임 근거(활성 케어 구독)가 아직 살아 있는가. */
  entitled: boolean;
  /** 구독은 끝났는데 자격증명이 남아 있다 — 파기 대상. */
  needsPurge: boolean;
  currentPlan: string | null;
  planExpiresAt: string | null;
}

interface Credentials {
  blogId: string;
  blogPassword: string | null;
  instaId: string | null;
  instaPassword: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: '제출됨',
  active: '대행 중',
  revoked: '철회됨',
};

const MODE_LABEL: Record<string, string> = {
  approve_each: '매 편 승인',
  auto: '검수 후 자동',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function CareOnboardingPanel() {
  const [items, setItems] = useState<OnboardingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, Credentials>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  // 구독 상태를 못 읽은 화면에서 "구독 종료" 표시를 사실처럼 보여주면 안 된다.
  const [statusKnown, setStatusKnown] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/care-onboarding')
      .then(async (res) => {
        const json = (await res.json()) as {
          items?: OnboardingItem[];
          subscriptionStatusKnown?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? '조회 실패');
        if (!cancelled) {
          setItems(json.items ?? []);
          setStatusKnown(json.subscriptionStatusKnown !== false);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reveal = useCallback(async (userId: string) => {
    setRevealing(userId);
    setError(null);
    try {
      const res = await fetch('/api/admin/care-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = (await res.json()) as Credentials & { error?: string };
      if (!res.ok) throw new Error(json.error ?? '열람 실패');
      setRevealed((prev) => ({ ...prev, [userId]: json }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '열람 실패');
    } finally {
      setRevealing(null);
    }
  }, []);

  const hide = useCallback((userId: string) => {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  return (
    <section className="bg-white rounded-2xl border border-[#b4bfce] p-5 md:p-6">
      <h2 className="text-lg font-bold text-[#202020] mb-1">케어 플랜 발행 대행 온보딩</h2>
      <p className="text-xs text-[#5b6573] mb-4">
        케어 구독자가 제출한 계정 위임 정보입니다. 비밀번호는 발행 작업 직전에만 &quot;계정
        보기&quot;로 열람하세요(열람 기록이 서버 로그에 남습니다).
      </p>

      {!statusKnown && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          구독 상태를 확인하지 못했습니다. 아래 구독/파기 표시는 신뢰할 수 없으니 새로고침 후
          확인해 주세요. (계정 열람은 서버에서 다시 검증합니다)
        </p>
      )}

      {!loaded ? (
        <p className="text-sm text-[#5b6573]">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#5b6573]">아직 제출된 온보딩이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#eef2f6] text-left">
                <th className="px-3 py-2 border border-[#b4bfce]">병원</th>
                <th className="px-3 py-2 border border-[#b4bfce]">블로그</th>
                <th className="px-3 py-2 border border-[#b4bfce]">인스타</th>
                <th className="px-3 py-2 border border-[#b4bfce]">발행 방식</th>
                <th className="px-3 py-2 border border-[#b4bfce]">상태</th>
                <th className="px-3 py-2 border border-[#b4bfce]">제출/수정일</th>
                <th className="px-3 py-2 border border-[#b4bfce]">계정</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const creds = revealed[item.userId];
                return (
                  <tr key={item.userId} className="align-top">
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {item.hospitalName}
                      {item.note && (
                        <p className="text-xs text-[#5b6573] mt-1">요청: {item.note}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {item.blogId}
                      {creds?.blogPassword && (
                        <p className="text-xs font-mono bg-[#fff3cd] rounded px-1.5 py-0.5 mt-1 break-all">
                          {creds.blogPassword}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {item.instaId ?? '-'}
                      {creds?.instaPassword && (
                        <p className="text-xs font-mono bg-[#fff3cd] rounded px-1.5 py-0.5 mt-1 break-all">
                          {creds.instaPassword}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {MODE_LABEL[item.publishMode] ?? item.publishMode}
                    </td>
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {STATUS_LABEL[item.status] ?? item.status}
                      {item.needsPurge && (
                        <p className="text-xs font-semibold text-red-600 mt-1">
                          구독 종료 — 자격증명 파기 필요
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-[#b4bfce]">{formatDate(item.updatedAt)}</td>
                    <td className="px-3 py-2 border border-[#b4bfce]">
                      {item.status === 'revoked' ? (
                        <span className="text-xs text-[#5b6573]">파기됨</span>
                      ) : !item.entitled ? (
                        // 구독이 끝나면 위임 근거도 끝난다 — 서버도 403 으로 막는다.
                        <span className="text-xs text-[#5b6573]">열람 불가 (구독 종료)</span>
                      ) : creds ? (
                        <button
                          type="button"
                          onClick={() => hide(item.userId)}
                          className="text-xs px-2 py-1 rounded bg-[#eef2f6] text-[#202020] hover:bg-[#dbe2ea]"
                        >
                          숨기기
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void reveal(item.userId)}
                          disabled={revealing === item.userId}
                          className="text-xs px-2 py-1 rounded bg-[#202020] text-white hover:opacity-85 disabled:opacity-50"
                        >
                          {revealing === item.userId ? '여는 중...' : '계정 보기'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </section>
  );
}

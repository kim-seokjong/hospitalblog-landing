'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  basic: '베이직',
  standard: '스탠다드',
  pro: '프로',
};

const PLAN_COLOR: Record<string, string> = {
  free: 'text-gray-400',
  basic: 'text-blue-400',
  standard: 'text-purple-400',
  pro: 'text-yellow-400',
};

interface Stats {
  totalUsers: number;
  newUsersThisMonth: number;
  planCounts: Record<string, number>;
  totalRevenue: number;
  monthlyRevenue: number;
  recentPayments: {
    id: string;
    plan: string;
    amount: number;
    paid_at: string;
    card_name: string | null;
    pg_provider: string;
    receipt_url: string | null;
  }[];
  topUsers: { email: string; plan: string; usage_count: number }[];
}

function formatKRW(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats');
      if (res.status === 403) {
        router.replace('/');
        return;
      }
      if (!res.ok) throw new Error('데이터 로딩 실패');
      const data = await res.json() as Stats;
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const now = new Date();
  const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-300 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">관리자 대시보드</h1>
            <p className="text-sm text-gray-500 mt-1">닥터포스트 운영 현황</p>
          </div>
          <button
            onClick={fetchStats}
            className="text-xs px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            새로고침
          </button>
        </div>

        {/* 핵심 지표 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '총 가입자', value: `${stats.totalUsers}명`, sub: '전체' },
            { label: `${monthLabel} 신규`, value: `${stats.newUsersThisMonth}명`, sub: '이번달 가입' },
            { label: `${monthLabel} 매출`, value: formatKRW(stats.monthlyRevenue), sub: '결제 완료 기준' },
            { label: '누적 매출', value: formatKRW(stats.totalRevenue), sub: '전체 기간' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-gray-600 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* 플랜별 분포 */}
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-white mb-4">플랜별 가입자</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['free', 'basic', 'standard', 'pro'].map(plan => (
              <div key={plan} className="text-center">
                <p className={`text-3xl font-bold ${PLAN_COLOR[plan]}`}>
                  {stats.planCounts[plan] ?? 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">{PLAN_LABEL[plan]}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">

          {/* 최근 결제 */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-4">최근 결제 내역</h2>
            {stats.recentPayments.length === 0 ? (
              <p className="text-sm text-gray-600">결제 내역이 없습니다.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {stats.recentPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div>
                      <p className={`text-xs font-semibold ${PLAN_COLOR[p.plan] ?? 'text-gray-300'}`}>
                        {PLAN_LABEL[p.plan] ?? p.plan} 플랜
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {p.card_name ?? p.pg_provider} · {formatDate(p.paid_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white">{formatKRW(p.amount)}</p>
                      {p.receipt_url && (
                        <a
                          href={p.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          영수증
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 사용량 상위 유저 */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-4">사용량 상위 유저</h2>
            {stats.topUsers.length === 0 ? (
              <p className="text-sm text-gray-600">사용 내역이 없습니다.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {stats.topUsers.map((u, i) => (
                  <div key={u.email} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                    <span className="text-xs text-gray-600 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 truncate">{u.email}</p>
                      <p className={`text-[11px] mt-0.5 ${PLAN_COLOR[u.plan] ?? 'text-gray-500'}`}>
                        {PLAN_LABEL[u.plan] ?? u.plan}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-white">{u.usage_count}회</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}

'use client';

import { Fragment, useMemo, useState } from 'react';
import type { MemberRow, PlanType } from '@/types/admin';

type FilterKey = 'all' | 'basic' | 'standard' | 'pro' | 'expired';

interface MemberTableProps {
  members: MemberRow[];
}

const PLAN_LABEL: Record<PlanType, string> = {
  free: '무료',
  basic: '베이직',
  standard: '스탠다드',
  pro: '프로',
};

const PLAN_BADGE: Record<PlanType, string> = {
  free: 'bg-gray-700 text-gray-300',
  basic: 'bg-blue-500/20 text-blue-300',
  standard: 'bg-violet-500/20 text-violet-300',
  pro: 'bg-emerald-500/20 text-emerald-300',
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'basic', label: '베이직' },
  { key: 'standard', label: '스탠다드' },
  { key: 'pro', label: '프로' },
  { key: 'expired', label: '만료' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function MemberTable({ members }: MemberTableProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 사용량 조정 상태
  const [deltaInputs, setDeltaInputs] = useState<Record<string, string>>({});
  const [adjusting, setAdjusting] = useState<Record<string, boolean>>({});
  const [adjustResults, setAdjustResults] = useState<Record<string, { newCount: number; delta: number } | null>>({});
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string | null>>({});

  const handleAdjust = async (userId: string) => {
    const rawDelta = parseInt(deltaInputs[userId] ?? '', 10);
    if (Number.isNaN(rawDelta) || rawDelta === 0) {
      setAdjustErrors((prev) => ({ ...prev, [userId]: '0이 아닌 정수를 입력하세요.' }));
      return;
    }
    setAdjusting((prev) => ({ ...prev, [userId]: true }));
    setAdjustErrors((prev) => ({ ...prev, [userId]: null }));
    setAdjustResults((prev) => ({ ...prev, [userId]: null }));
    try {
      const res = await fetch('/api/admin/adjust-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, delta: rawDelta }),
      });
      const data = await res.json() as { newCount?: number; delta?: number; error?: string };
      if (!res.ok) {
        setAdjustErrors((prev) => ({ ...prev, [userId]: data.error ?? '오류가 발생했습니다.' }));
      } else {
        setAdjustResults((prev) => ({ ...prev, [userId]: { newCount: data.newCount!, delta: data.delta! } }));
        setDeltaInputs((prev) => ({ ...prev, [userId]: '' }));
      }
    } catch {
      setAdjustErrors((prev) => ({ ...prev, [userId]: '네트워크 오류가 발생했습니다.' }));
    } finally {
      setAdjusting((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      // 필터
      if (filter === 'expired') {
        if (m.isActive) return false;
      } else if (filter !== 'all') {
        if (m.plan !== filter) return false;
      }

      // 검색
      if (q) {
        const haystack = [
          m.email ?? '',
          m.hospital_name ?? '',
          m.specialty ?? '',
          m.full_name ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [members, filter, query]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-100">
          회원 목록 ({filtered.length}명)
        </h3>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded text-xs transition-colors ${
                  filter === f.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이메일·병원명·진료과 검색"
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500 min-w-[200px]"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-800/50 text-xs text-gray-400 uppercase">
            <tr>
              <th className="px-4 py-3 text-left font-medium">병원·이름</th>
              <th className="px-4 py-3 text-left font-medium">플랜</th>
              <th className="px-4 py-3 text-left font-medium">이메일</th>
              <th className="px-4 py-3 text-left font-medium">진료과</th>
              <th className="px-4 py-3 text-left font-medium">가입일</th>
              <th className="px-4 py-3 text-right font-medium">사용량</th>
              <th className="px-4 py-3 text-left font-medium">만료일</th>
              <th className="px-4 py-3 text-left font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-gray-500 text-sm"
                >
                  검색 결과 없음
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const plan = (m.plan ?? 'free') as PlanType;
                const isExpanded = expandedId === m.id;
                const rowBg = m.isExpiringSoon
                  ? 'bg-amber-900/20'
                  : 'hover:bg-gray-800/40';
                return (
                  <Fragment key={m.id}>
                  <tr
                    onClick={() => toggleExpand(m.id)}
                    className={`border-t border-gray-800 cursor-pointer ${rowBg}`}
                  >
                    <td className="px-4 py-3 text-gray-100">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-gray-500 text-xs select-none"
                          aria-hidden="true"
                        >
                          {isExpanded ? '▲' : '▼'}
                        </span>
                        <div>
                          <div className="font-medium">
                            {m.hospital_name ?? '-'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {m.full_name ?? '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${PLAN_BADGE[plan]}`}
                      >
                        {PLAN_LABEL[plan]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {m.email ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {m.specialty ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {(adjustResults[m.id]?.newCount ?? m.usage_count ?? 0).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(m.plan_expires_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          m.isActive ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {m.isActive ? '활성' : '만료'}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-gray-800 bg-gray-800/30">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="space-y-4">
                          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                            <div>
                              <dt className="text-xs uppercase text-gray-500">연락처</dt>
                              <dd className="mt-0.5 text-gray-200 break-words">{m.phone ?? '-'}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase text-gray-500">직책</dt>
                              <dd className="mt-0.5 text-gray-200 break-words">{m.position ?? '-'}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase text-gray-500">병원유형</dt>
                              <dd className="mt-0.5 text-gray-200 break-words">{m.hospital_type ?? '-'}</dd>
                            </div>
                            <div className="sm:col-span-2 lg:col-span-1">
                              <dt className="text-xs uppercase text-gray-500">주소</dt>
                              <dd className="mt-0.5 text-gray-200 break-words">{m.hospital_address ?? '-'}</dd>
                            </div>
                          </dl>

                          {/* 사용량 조정 */}
                          <div className="border-t border-gray-700 pt-3">
                            <p className="text-xs font-semibold text-gray-400 mb-2">사용량 조정</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-gray-400">
                                현재:{' '}
                                <span className="text-gray-200 font-bold">
                                  {(adjustResults[m.id]?.newCount ?? m.usage_count ?? 0).toLocaleString('ko-KR')}회
                                </span>
                              </span>
                              {/* 빠른 조정 버튼 */}
                              {[-5, -2, -1, +1, +2, +5].map((v) => (
                                <button
                                  key={v}
                                  onClick={() => setDeltaInputs((prev) => ({ ...prev, [m.id]: String(v) }))}
                                  className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
                                    v < 0
                                      ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/40'
                                      : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40'
                                  }`}
                                >
                                  {v > 0 ? `+${v}` : v}
                                </button>
                              ))}
                              <input
                                type="number"
                                value={deltaInputs[m.id] ?? ''}
                                onChange={(e) =>
                                  setDeltaInputs((prev) => ({ ...prev, [m.id]: e.target.value }))
                                }
                                placeholder="직접입력"
                                className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-center"
                              />
                              <button
                                onClick={() => handleAdjust(m.id)}
                                disabled={adjusting[m.id] || !deltaInputs[m.id]}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold rounded transition-colors"
                              >
                                {adjusting[m.id] ? '처리 중...' : '적용'}
                              </button>
                            </div>
                            {adjustResults[m.id] && (
                              <p className="mt-1.5 text-xs text-emerald-400">
                                ✓ 조정 완료 — {adjustResults[m.id]!.delta > 0 ? '+' : ''}{adjustResults[m.id]!.delta}회 적용,
                                현재 {adjustResults[m.id]!.newCount.toLocaleString('ko-KR')}회
                              </p>
                            )}
                            {adjustErrors[m.id] && (
                              <p className="mt-1.5 text-xs text-rose-400">✕ {adjustErrors[m.id]}</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

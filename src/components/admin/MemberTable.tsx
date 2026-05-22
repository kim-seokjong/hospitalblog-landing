'use client';

import { useMemo, useState } from 'react';
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
                const rowBg = m.isExpiringSoon
                  ? 'bg-amber-900/20'
                  : 'hover:bg-gray-800/40';
                return (
                  <tr
                    key={m.id}
                    className={`border-t border-gray-800 ${rowBg}`}
                  >
                    <td className="px-4 py-3 text-gray-100">
                      <div className="font-medium">
                        {m.hospital_name ?? '-'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {m.full_name ?? '-'}
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
                      {(m.usage_count ?? 0).toLocaleString('ko-KR')}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { Fragment, useMemo, useState } from 'react';
import type { MemberRow, PlanType } from '@/types/admin';

type FilterKey =
  | 'all'
  | 'basic'
  | 'standard'
  | 'standard_care'
  | 'pro'
  | 'growth8_standard'
  | 'growth_care'
  | 'pro12_pro'
  | 'expired';

interface MemberTableProps {
  members: MemberRow[];
}

const PLAN_LABEL: Record<PlanType, string> = {
  free: '무료',
  basic: '베이직', // 레거시
  standard: '스탠다드',
  standard_care: '스탠다드 케어',
  pro: '프로', // 레거시
  growth8_standard: '올인원 그로스',
  growth_care: '올인원 케어',
  pro12_pro: '올인원 프로', // 레거시
};

const PLAN_BADGE: Record<PlanType, string> = {
  free: 'bg-[#eef2f6] text-[#4a4f55]',
  basic: 'bg-blue-50 text-blue-600',
  standard: 'bg-violet-50 text-violet-600',
  standard_care: 'bg-teal-50 text-teal-700',
  pro: 'bg-emerald-50 text-emerald-700',
  growth8_standard: 'bg-amber-50 text-amber-700',
  growth_care: 'bg-orange-50 text-orange-700',
  pro12_pro: 'bg-rose-50 text-rose-700',
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'basic', label: '베이직' },
  { key: 'standard', label: '스탠다드' },
  { key: 'standard_care', label: '스탠다드 케어' },
  { key: 'pro', label: '프로' },
  { key: 'growth8_standard', label: '올인원 그로스' },
  { key: 'growth_care', label: '올인원 케어' },
  { key: 'pro12_pro', label: '올인원 프로' },
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
    <div className="bg-white border border-[#b4bfce] rounded-xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="p-4 border-b border-[#b4bfce] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#202020]">
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
                    : 'bg-[#eef2f6] text-[#4a4f55] hover:bg-[#b4bfce]'
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
            className="px-3 py-1.5 bg-white border border-[#b4bfce] rounded text-xs text-[#202020] placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] min-w-[200px]"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#eef2f6] text-xs text-[#5b6573] uppercase">
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
                  className="px-4 py-8 text-center text-[#5b6573] text-sm"
                >
                  검색 결과 없음
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const plan = (m.plan ?? 'free') as PlanType;
                const isExpanded = expandedId === m.id;
                const rowBg = m.isExpiringSoon
                  ? 'bg-amber-50'
                  : 'hover:bg-[#eef2f6]';
                return (
                  <Fragment key={m.id}>
                  <tr
                    onClick={() => toggleExpand(m.id)}
                    className={`border-t border-[#b4bfce] cursor-pointer ${rowBg}`}
                  >
                    <td className="px-4 py-3 text-[#202020]">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[#5b6573] text-xs select-none"
                          aria-hidden="true"
                        >
                          {isExpanded ? '▲' : '▼'}
                        </span>
                        <div>
                          <div className="font-medium">
                            {m.hospital_name || '-'}
                          </div>
                          <div className="text-xs text-[#5b6573]">
                            {m.full_name || '-'}
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
                    <td className="px-4 py-3 text-[#4a4f55]">
                      {m.email ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-[#4a4f55]">
                      {m.specialty ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-[#5b6573]">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-[#4a4f55]">
                      {(adjustResults[m.id]?.newCount ?? m.usage_count ?? 0).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-[#5b6573]">
                      {formatDate(m.plan_expires_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          m.isActive ? 'text-emerald-600' : 'text-rose-600'
                        }
                      >
                        {m.isActive ? '활성' : '만료'}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-[#b4bfce] bg-[#eef2f6]">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="space-y-4">
                          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                            <div>
                              <dt className="text-xs uppercase text-[#5b6573]">연락처</dt>
                              <dd className="mt-0.5 text-[#202020] break-words">{m.phone || '-'}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase text-[#5b6573]">직책</dt>
                              <dd className="mt-0.5 text-[#202020] break-words">{m.position || '-'}</dd>
                            </div>
                            <div>
                              <dt className="text-xs uppercase text-[#5b6573]">병원유형</dt>
                              <dd className="mt-0.5 text-[#202020] break-words">{m.hospital_type || '-'}</dd>
                            </div>
                            <div className="sm:col-span-2 lg:col-span-1">
                              <dt className="text-xs uppercase text-[#5b6573]">주소</dt>
                              <dd className="mt-0.5 text-[#202020] break-words">{m.hospital_address ?? '-'}</dd>
                            </div>
                          </dl>

                          {/* 사용량 조정 */}
                          <div className="border-t border-[#b4bfce] pt-3">
                            <p className="text-xs font-semibold text-[#4a4f55] mb-2">사용량 조정</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-[#5b6573]">
                                현재:{' '}
                                <span className="text-[#202020] font-bold">
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
                                      ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
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
                                className="w-24 px-2 py-1 bg-white border border-[#b4bfce] rounded text-xs text-[#202020] placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] text-center"
                              />
                              <button
                                onClick={() => handleAdjust(m.id)}
                                disabled={adjusting[m.id] || !deltaInputs[m.id]}
                                className="px-3 py-1 bg-[#ff4628] hover:bg-[#e63a1c] disabled:bg-[#eef2f6] disabled:text-[#5b6573] text-white text-xs font-bold rounded transition-colors"
                              >
                                {adjusting[m.id] ? '처리 중...' : '적용'}
                              </button>
                            </div>
                            {adjustResults[m.id] && (
                              <p className="mt-1.5 text-xs text-emerald-600">
                                ✓ 조정 완료 — {adjustResults[m.id]!.delta > 0 ? '+' : ''}{adjustResults[m.id]!.delta}회 적용,
                                현재 {adjustResults[m.id]!.newCount.toLocaleString('ko-KR')}회
                              </p>
                            )}
                            {adjustErrors[m.id] && (
                              <p className="mt-1.5 text-xs text-rose-600">✕ {adjustErrors[m.id]}</p>
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

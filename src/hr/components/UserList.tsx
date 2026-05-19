'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  hospital_name: string | null;
  hospital_address: string | null;
  position: string | null;
  hospital_type: string | null;
  plan: string | null;
  plan_expires_at: string | null;
  usage_count: number | null;
  created_at: string | null;
}

interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  basic: '베이직',
  standard: '스탠다드',
  pro: '프로',
};

const PLAN_BADGE: Record<string, string> = {
  free: 'bg-gray-700 text-gray-300',
  basic: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  standard: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  pro: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) <= new Date();
}

export default function UserList() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // 검색어 디바운스 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const fetchUsers = useCallback(async (q: string, p: number, append: boolean) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(p));

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '회원 정보를 불러올 수 없습니다.');
      }
      const data = (await res.json()) as AdminUsersResponse;
      setUsers(prev => (append ? [...prev, ...data.users] : data.users));
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(debouncedQuery, 1, false);
  }, [debouncedQuery, fetchUsers]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchUsers(debouncedQuery, next, true);
  };

  return (
    <div className="bg-gray-900 rounded-2xl p-5 sm:p-6 border border-gray-800">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white">회원 목록</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            전체 {total.toLocaleString('ko-KR')}명{debouncedQuery && ` · 검색결과`}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="이메일·이름·병원명 검색"
          className="w-full sm:w-72 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {loading && users.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-600 text-center py-8">
          {debouncedQuery ? '검색 결과가 없습니다.' : '가입한 회원이 없습니다.'}
        </p>
      ) : (
        <div className="space-y-3">
          {users.map(u => {
            const plan = u.plan ?? 'free';
            const expired = isExpired(u.plan_expires_at);
            return (
              <div
                key={u.id}
                className="border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-sm font-semibold text-white">
                    {u.full_name ?? '(이름 미입력)'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PLAN_BADGE[plan] ?? PLAN_BADGE.free}`}
                  >
                    {PLAN_LABEL[plan] ?? plan}
                    {expired && plan !== 'free' && ' · 만료'}
                  </span>
                  {u.hospital_type && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                      {u.hospital_type}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                  <div>
                    <span className="text-gray-600">이메일:</span> {u.email ?? '-'}
                  </div>
                  <div>
                    <span className="text-gray-600">연락처:</span> {u.phone ?? '-'}
                  </div>
                  <div>
                    <span className="text-gray-600">병원:</span> {u.hospital_name ?? '-'}
                    {u.position && <span className="text-gray-600"> · {u.position}</span>}
                  </div>
                  <div>
                    <span className="text-gray-600">주소:</span> {u.hospital_address ?? '-'}
                  </div>
                  <div>
                    <span className="text-gray-600">가입:</span> {formatDate(u.created_at)}
                  </div>
                  <div>
                    <span className="text-gray-600">사용량:</span> {u.usage_count ?? 0}건
                    {u.plan_expires_at && plan !== 'free' && (
                      <span className="text-gray-600"> · 만료: {formatDate(u.plan_expires_at)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={handleLoadMore}
          className="w-full mt-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
        >
          더 보기 ({users.length}/{total.toLocaleString('ko-KR')})
        </button>
      )}

      {loading && users.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

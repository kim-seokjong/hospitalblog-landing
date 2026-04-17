'use client';

import { useState, useEffect } from 'react';

interface NaverCredentialSetupProps {
  onSaved: () => void;
}

export default function NaverCredentialSetup({ onSaved }: NaverCredentialSetupProps) {
  const [naverId, setNaverId] = useState('');
  const [naverPw, setNaverPw] = useState('');
  const [blogCategory, setBlogCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState<{ exists: boolean; maskedId?: string; blogCategory?: string } | null>(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetch('/api/credentials')
      .then((r) => r.json())
      .then((d) => {
        setExisting(d);
        if (d.exists) setBlogCategory(d.blogCategory ?? '');
        else setShowForm(true);
      })
      .catch(() => setShowForm(true))
      .finally(() => setChecking(false));
  }, []);

  const handleSave = async () => {
    if (!naverId || !naverPw) {
      setError('아이디와 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naverId, naverPw, blogCategory }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '저장 실패'); return; }

      setExisting({ exists: true, maskedId: naverId.slice(0, 2) + '***' + naverId.slice(-1), blogCategory });
      setShowForm(false);
      setNaverId('');
      setNaverPw('');
      onSaved();
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('네이버 계정 정보를 삭제하시겠습니까?')) return;
    await fetch('/api/credentials', { method: 'DELETE' });
    setExisting({ exists: false });
    setBlogCategory('');
    setShowForm(true);
  };

  if (checking) {
    return (
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-200 rounded-xl" />
          <div className="h-4 bg-gray-200 rounded w-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${existing?.exists ? 'bg-green-500' : 'bg-orange-400'}`}>
            <span className="text-white text-base font-bold">N</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">네이버 계정 연동</h3>
            <p className="text-xs text-gray-500">
              {existing?.exists
                ? `연동됨: ${existing.maskedId}${existing.blogCategory ? ` · 카테고리: ${existing.blogCategory}` : ' · 카테고리 미설정'}`
                : '계정을 연동하면 발행 시 자동 로그인됩니다'}
            </p>
          </div>
        </div>
        {existing?.exists && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm((v) => !v)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              변경
            </button>
            <button
              onClick={handleDelete}
              className="text-xs text-red-500 hover:text-red-600 font-medium"
            >
              삭제
            </button>
          </div>
        )}
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-700">
              비밀번호는 AES-256 암호화되어 저장됩니다. 서버에서 복호화 후 즉시 사용하며 로그로 남기지 않습니다.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">네이버 아이디</label>
            <input
              type="text"
              value={naverId}
              onChange={(e) => setNaverId(e.target.value)}
              placeholder="네이버 아이디"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">비밀번호</label>
            <input
              type="password"
              value={naverPw}
              onChange={(e) => setNaverPw(e.target.value)}
              placeholder="비밀번호"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">
              블로그 카테고리명 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              type="text"
              value={blogCategory}
              onChange={(e) => setBlogCategory(e.target.value)}
              placeholder="예: 건강정보, 의료칼럼"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <p className="text-xs text-gray-400">
              네이버 블로그에 설정된 카테고리 이름을 정확히 입력하세요. 비워두면 기본 카테고리로 발행됩니다.
            </p>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm transition-colors"
            >
              {loading ? '저장 중...' : '저장하기'}
            </button>
            {existing?.exists && (
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50"
              >
                취소
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

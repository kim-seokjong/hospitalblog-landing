'use client';

import { useState, useEffect } from 'react';

const LS_CATEGORY_KEY = 'naver_blog_category';

interface NaverCredentialSetupProps {
  onSaved: () => void;
}

export default function NaverCredentialSetup({ onSaved }: NaverCredentialSetupProps) {
  const [naverId, setNaverId] = useState('');
  const [naverCookie, setNaverCookie] = useState('');
  const [naverSes, setNaverSes] = useState('');
  const [blogCategory, setBlogCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState<{ exists: boolean; maskedId?: string } | null>(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    // localStorage에서 카테고리 복원
    setBlogCategory(localStorage.getItem(LS_CATEGORY_KEY) ?? '');

    fetch('/api/credentials')
      .then((r) => r.json())
      .then((d) => {
        setExisting(d);
        if (!d.exists) setShowForm(true);
      })
      .catch(() => setShowForm(true))
      .finally(() => setChecking(false));
  }, []);

  const handleSave = async () => {
    if (!naverId || !naverCookie) {
      setError('아이디와 NID_AUT 쿠키를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naverId, naverPw: naverCookie, naverSes, blogCategory }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '저장 실패'); return; }

      // 카테고리는 localStorage에도 항상 저장
      localStorage.setItem(LS_CATEGORY_KEY, blogCategory);

      setExisting({ exists: true, maskedId: naverId.slice(0, 2) + '***' + naverId.slice(-1) });
      setShowForm(false);
      setNaverId('');
      setNaverCookie('');
      setNaverSes('');
      onSaved();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySave = () => {
    localStorage.setItem(LS_CATEGORY_KEY, blogCategory);
    alert('카테고리가 저장되었습니다.');
  };

  const handleDelete = async () => {
    if (!confirm('네이버 계정 정보를 삭제하시겠습니까?')) return;
    await fetch('/api/credentials', { method: 'DELETE' });
    localStorage.removeItem(LS_CATEGORY_KEY);
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
                ? `연동됨: ${existing.maskedId}`
                : '계정을 연동하면 발행 시 자동 로그인됩니다'}
            </p>
          </div>
        </div>
        {existing?.exists && (
          <div className="flex gap-2">
            <button onClick={() => setShowForm((v) => !v)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">변경</button>
            <button onClick={handleDelete} className="text-xs text-red-500 hover:text-red-600 font-medium">삭제</button>
          </div>
        )}
      </div>

      {/* 카테고리 (항상 표시) */}
      {existing?.exists && !showForm && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4">
          <label className="text-xs font-semibold text-gray-700 block mb-1">
            블로그 카테고리명
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={blogCategory}
              onChange={(e) => setBlogCategory(e.target.value)}
              placeholder="예: 건강정보, 의료칼럼 (네이버에 있는 카테고리명 그대로)"
              className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
              onKeyDown={(e) => e.key === 'Enter' && handleCategorySave()}
            />
            <button
              onClick={handleCategorySave}
              className="px-3 py-2.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg"
            >
              저장
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            비워두면 기본 카테고리로 발행됩니다.
          </p>
        </div>
      )}

      {/* 계정 입력 폼 */}
      {showForm && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1">
            <p className="text-xs font-semibold text-blue-800">쿠키 가져오는 방법</p>
            <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
              <li>Chrome에서 naver.com 로그인 (로그인 상태 유지 체크)</li>
              <li>F12 → Application 탭 → Cookies → .naver.com</li>
              <li>NID_AUT, NID_SES 값 각각 복사</li>
            </ol>
            <p className="text-xs text-blue-500 mt-1">쿠키는 AES-256 암호화되어 저장됩니다.</p>
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
            <label className="text-xs font-semibold text-gray-700">NID_AUT 쿠키값</label>
            <input
              type="password"
              value={naverCookie}
              onChange={(e) => setNaverCookie(e.target.value)}
              placeholder="NID_AUT 쿠키값 붙여넣기"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">NID_SES 쿠키값</label>
            <input
              type="password"
              value={naverSes}
              onChange={(e) => setNaverSes(e.target.value)}
              placeholder="NID_SES 쿠키값 붙여넣기"
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
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                취소
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

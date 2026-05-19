'use client';

import { useState, useEffect } from 'react';

interface NaverCredentialSetupProps {
  onSaved: () => void;
}

export default function NaverCredentialSetup({ onSaved }: NaverCredentialSetupProps) {
  const [naverId, setNaverId] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState<{ exists: boolean; maskedId?: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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
    if (!naverId.trim()) {
      setError('네이버 아이디를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naverId: naverId.trim(), naverPw: '-', naverSes: '' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '저장 실패'); return; }
      setExisting({ exists: true, maskedId: naverId.slice(0, 2) + '***' + naverId.slice(-1) });
      setShowForm(false);
      setNaverId('');
      onSaved();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('네이버 계정 정보를 삭제하시겠습니까?')) return;
    await fetch('/api/credentials', { method: 'DELETE' });
    setExisting({ exists: false });
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
                : '아이디를 저장하면 글쓰기 페이지가 바로 열립니다'}
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

      {showForm && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">네이버 아이디</label>
            <input
              type="text"
              value={naverId}
              onChange={(e) => setNaverId(e.target.value)}
              placeholder="네이버 아이디 입력"
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

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
}

type Mode = 'login' | 'signup';

export default function AuthModal({ onClose, onSuccess, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const supabase = createClient();

  const handleSubmit = async () => {
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/api/auth/callback` },
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage('가입 확인 이메일을 보냈습니다. 메일함을 확인해주세요.');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else {
        onSuccess();
        onClose();
      }
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="bg-blue-600 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">병원 블로그 자동화</h2>
              <p className="text-blue-100 text-xs">
                {mode === 'login' ? '로그인하여 계속하세요' : '새 계정을 만드세요'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl">×</button>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setMessage(''); }}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === m
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {m === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        {/* 폼 */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? '최소 6자리' : '비밀번호 입력'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
          {message && (
            <p className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">{message}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </div>
      </div>
    </div>
  );
}

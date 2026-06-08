'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import { trackEvent } from '@/dev/lib/meta-pixel';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
  closable?: boolean;
}

type Mode = 'login' | 'signup';

const POSITIONS = ['원장', '부원장', '간호사', '원무', '마케터', '기타'] as const;

const HOSPITAL_TYPES = [
  '내과', '외과', '피부과', '성형외과', '정형외과', '안과',
  '이비인후과', '치과', '한의원', '산부인과', '소아과', '신경과',
  '정신건강의학과', '재활의학과', '가정의학과', '비뇨기과', '기타',
] as const;

const SAVED_EMAIL_KEY = 'dp_saved_email';
const LEGACY_SAVED_PW_KEY = 'dp_saved_pw';

export default function AuthModal({ onClose, onSuccess, initialMode = 'login', closable = true }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);

  // 로그인 필드
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saveCredentials, setSaveCredentials] = useState(false);

  // 회원가입 추가 필드
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [hospitalAddress, setHospitalAddress] = useState('');
  const [position, setPosition] = useState('');
  const [hospitalType, setHospitalType] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const supabase = createClient();

  // 저장된 이메일 불러오기 + 레거시 평문 비밀번호 정리
  useEffect(() => {
    localStorage.removeItem(LEGACY_SAVED_PW_KEY);
    const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY);
    if (savedEmail) { setEmail(savedEmail); setSaveCredentials(true); }
  }, []);

  const resetFields = () => {
    setEmail(''); setPassword(''); setFullName(''); setPhone('');
    setHospitalName(''); setHospitalAddress(''); setPosition('');
    setHospitalType(''); setConfirmPassword('');
    setAgreeTerms(false); setAgreePrivacy(false);
    setError(''); setMessage('');
  };

  const handleLogin = async () => {
    if (!email || !password) { setError('이메일과 비밀번호를 입력해주세요.'); return; }
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    } else {
      if (saveCredentials) {
        localStorage.setItem(SAVED_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
      localStorage.removeItem(LEGACY_SAVED_PW_KEY);
      localStorage.removeItem('dp_contact_dismissed');
      onSuccess(); onClose();
    }
    setLoading(false);
  };

  const handleSignup = async () => {
    if (!fullName || !phone || !hospitalName || !position || !hospitalType) {
      setError('필수 항목을 모두 입력해주세요.'); return;
    }
    if (!email) { setError('이메일을 입력해주세요.'); return; }
    if (password.length < 6) { setError('비밀번호는 최소 6자리입니다.'); return; }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
    if (!agreeTerms || !agreePrivacy) { setError('이용약관 및 개인정보처리방침에 동의해주세요.'); return; }

    setLoading(true); setError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // 이미 가입된 이메일로 재가입 시 Supabase는 보안상(이메일 열거 방지) 에러 대신
    // identities가 빈 배열인 더미 user를 반환한다. 신규 가입이면 길이 >= 1.
    const identities = data.user?.identities;
    if (data.user && Array.isArray(identities) && identities.length === 0) {
      setError('이미 가입된 이메일입니다. 로그인해 주세요.');
      setLoading(false);
      return;
    }

    trackEvent('CompleteRegistration', { content_name: 'signup', status: 'complete' });
    trackEvent('Lead', { content_name: 'signup', content_category: 'subscribe_required' });

    const userId = data.user?.id;
    if (!userId) {
      setError('가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      setLoading(false);
      return;
    }

    const registerRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, fullName, phone, hospitalName, hospitalAddress, position, hospitalType }),
    });

    if (!registerRes.ok) {
      // 서버가 프로필 저장 실패 시 방금 만든 auth 계정을 롤백 삭제하므로,
      // 사용자에게 "가입이 완료되지 않았음"을 명확히 안내한다.
      const detail = await registerRes.json().catch(() => null);
      const serverMsg = detail && typeof detail.error === 'string' ? detail.error : null;
      setError(serverMsg ?? '가입에 실패했습니다. 처음부터 다시 시도해주세요.');
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(`로그인 실패: ${signInError.message}`);
      setLoading(false);
      return;
    }

    onSuccess();
    onClose();
    setLoading(false);
  };

  const inputClass = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white !text-gray-900 placeholder:!text-gray-400 caret-blue-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
  const labelClass = 'text-xs font-bold !text-gray-900';
  const requiredMark = <span className="text-red-500 ml-0.5">*</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="auth-modal-light bg-white text-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-auto overflow-hidden max-h-[92dvh] flex flex-col"
        style={{ colorScheme: 'light' }}
      >
        {/* 헤더 */}
        <div className="bg-blue-600 px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">닥터포스트</h2>
              <p className="text-blue-100 text-xs">
                {mode === 'login' ? '로그인하여 계속하세요' : '병원 관계자 전용 서비스입니다'}
              </p>
            </div>
          </div>
          {closable && (
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl">×</button>
          )}
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200 shrink-0">
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); resetFields(); }}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === m ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {m === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        {/* 스크롤 영역 */}
        <div className="overflow-y-auto flex-1 min-h-0">
          <div className="px-6 py-5 space-y-3">

            {mode === 'login' ? (
              <>
                <div className="space-y-2">
                  <label className={labelClass}>이메일</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com" className={inputClass}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>비밀번호</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호 입력" className={inputClass}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveCredentials}
                    onChange={(e) => setSaveCredentials(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-600">이메일 저장</span>
                </label>
              </>
            ) : (
              <>
                {/* 첫 달 0원 무료 체험 안내 */}
                <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg px-4 py-2.5">
                  <p className="text-sm font-bold text-emerald-700">
                    🎁 첫 달 0원 무료 체험
                  </p>
                  <p className="text-[11px] text-emerald-700/80 mt-1 leading-relaxed">
                    가입 후 30일 동안 무료 이용 · <strong>30일 후부터</strong> 선택한 플랜 금액으로 매월 자동결제됩니다. 무료 기간 중 해지 시 청구 없이 즉시 종료.
                  </p>
                </div>

                {/* 안내 문구 */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-xs text-blue-700">
                  병원 관계자 확인을 위한 정보를 입력해주세요. <span className="text-red-500">*</span> 표시는 필수 항목입니다.
                </div>

                {/* 성함 */}
                <div className="space-y-2">
                  <label className={labelClass}>성함{requiredMark}</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="홍길동" className={inputClass} />
                </div>

                {/* 연락처 */}
                <div className="space-y-2">
                  <label className={labelClass}>연락처{requiredMark}</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000" className={inputClass} />
                </div>

                {/* 병원명 + 직책 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className={labelClass}>병원명{requiredMark}</label>
                    <input type="text" value={hospitalName} onChange={(e) => setHospitalName(e.target.value)}
                      placeholder="○○병원" className={inputClass} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelClass}>직책{requiredMark}</label>
                    <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass}>
                      <option value="">선택</option>
                      {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                {/* 병원 유형 */}
                <div className="space-y-2">
                  <label className={labelClass}>병원 유형{requiredMark}</label>
                  <select value={hospitalType} onChange={(e) => setHospitalType(e.target.value)} className={inputClass}>
                    <option value="">선택</option>
                    {HOSPITAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <p className="text-[10px] text-gray-400">글 작성 시 이 유형으로 고정됩니다.</p>
                </div>

                {/* 병원 주소 */}
                <div className="space-y-2">
                  <label className={labelClass}>병원 주소</label>
                  <input type="text" value={hospitalAddress} onChange={(e) => setHospitalAddress(e.target.value)}
                    placeholder="서울특별시 강남구 테헤란로 123" className={inputClass} />
                </div>

                {/* 구분선 */}
                <div className="border-t border-gray-100 pt-2">
                  <p className="text-xs text-gray-400 mb-3">로그인 계정 정보</p>
                </div>

                {/* 이메일 */}
                <div className="space-y-2">
                  <label className={labelClass}>이메일{requiredMark}</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com" className={inputClass} />
                </div>

                {/* 비밀번호 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className={labelClass}>비밀번호{requiredMark}</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="최소 6자리" className={inputClass} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelClass}>비밀번호 확인{requiredMark}</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="동일하게 입력" className={inputClass} />
                  </div>
                </div>

              </>
            )}

          </div>
        </div>

        {/* 하단 고정 푸터 */}
        <div className="shrink-0 border-t border-gray-200 px-6 py-4 space-y-3">
          {mode === 'signup' && (
            <div className="space-y-2.5">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <span className="text-xs text-gray-600">
                  (필수){' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-700">이용약관</a>
                  {' '}및{' '}
                  <a href="/refund" target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-700">환불정책</a>
                  에 동의합니다.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreePrivacy}
                  onChange={(e) => setAgreePrivacy(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <span className="text-xs text-gray-600">
                  (필수){' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-700">개인정보처리방침</a>
                  에 동의합니다.
                </span>
              </label>
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          {message && <p className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">{message}</p>}

          <button
            onClick={mode === 'login' ? handleLogin : handleSignup}
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '가입 신청하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

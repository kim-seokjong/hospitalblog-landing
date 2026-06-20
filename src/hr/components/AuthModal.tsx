'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/dev/lib/supabase/client';
import { trackEvent } from '@/dev/lib/meta-pixel';
import { getIdentityChannelKey } from '@/hr/lib/identity-channel';

// 본인인증 시도마다 고유한 식별자 생성(포트원 identityVerificationId).
function makeIdentityVerificationId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `idv_${rand}`;
}

// 010XXXXXXXX → 010-XXXX-XXXX 표기(본인인증 결과는 숫자만 내려옴).
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

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

  // 휴대폰 본인인증 상태
  const [identityVerificationId, setIdentityVerificationId] = useState('');
  const [identityVerified, setIdentityVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

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
    setIdentityVerificationId(''); setIdentityVerified(false); setVerifying(false);
    setError(''); setMessage('');
  };

  // 휴대폰 본인인증 — 포트원 SDK 호출 → 서버 검증 → 성함/연락처 자동완성 + 잠금.
  const handleIdentityVerify = async () => {
    setError(''); setMessage('');

    if (!window.PortOne || typeof window.PortOne.requestIdentityVerification !== 'function') {
      setError('본인인증 모듈이 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도해주세요.');
      return;
    }

    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    if (!storeId) { setError('본인인증 설정 오류가 발생했습니다.'); return; }

    let channelKey: string;
    try {
      channelKey = getIdentityChannelKey();
    } catch {
      setError('본인인증 설정 오류가 발생했습니다.');
      return;
    }

    setVerifying(true);
    try {
      const newId = makeIdentityVerificationId();
      const result = await window.PortOne.requestIdentityVerification({
        storeId,
        identityVerificationId: newId,
        channelKey,
      });

      // code 가 있으면 실패/취소. 사용자가 인증창을 닫은 경우도 여기로 들어온다.
      if (result.code) {
        setError(result.message ?? '본인인증이 취소되었습니다.');
        setVerifying(false);
        return;
      }

      const verifyId = result.identityVerificationId ?? newId;

      // 서버에서 포트원 결과 재검증 + DI 중복가입 차단.
      const res = await fetch('/api/auth/identity-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityVerificationId: verifyId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError((data && typeof data.error === 'string') ? data.error : '본인인증에 실패했습니다.');
        setVerifying(false);
        return;
      }

      // 검증된 성함/연락처로 자동완성 + 읽기전용 처리.
      setFullName(typeof data?.name === 'string' ? data.name : '');
      setPhone(typeof data?.phoneNumber === 'string' ? formatPhone(data.phoneNumber) : '');
      setIdentityVerificationId(verifyId);
      setIdentityVerified(true);
      setMessage('✅ 본인인증이 완료되었습니다.');
    } catch {
      setError('본인인증 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setVerifying(false);
    }
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
    if (!identityVerified || !identityVerificationId) {
      setError('휴대폰 본인인증을 먼저 완료해주세요.'); return;
    }
    if (!hospitalName || !position || !hospitalType) {
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
      body: JSON.stringify({ userId, identityVerificationId, hospitalName, hospitalAddress, position, hospitalType }),
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
      // 가입은 완료됐지만 자동 로그인 실패 → 로그인 탭으로 안내
      setMode('login');
      setPassword('');
      setError('가입이 완료됐습니다. 아래에서 로그인해주세요.');
      setLoading(false);
      return;
    }

    onSuccess();
    onClose();
    setLoading(false);
  };

  const inputClass = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white !text-gray-900 placeholder:!text-gray-400 caret-blue-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
  // 본인인증으로 잠긴 읽기전용 입력 — 흰글자 회귀 방지를 위해 !text-gray-900 유지(연한 회색 배경).
  const readonlyInputClass = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-100 !text-gray-900 cursor-not-allowed focus:outline-none';
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

                {/* 휴대폰 본인인증 */}
                <div className="space-y-2">
                  <label className={labelClass}>휴대폰 본인인증{requiredMark}</label>
                  {identityVerified ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                      <span className="text-emerald-600 text-sm font-bold">✅ 본인인증 완료</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleIdentityVerify}
                      disabled={verifying}
                      className="w-full py-2.5 border border-blue-600 text-blue-600 font-bold rounded-lg text-sm bg-white hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {verifying ? '본인인증 진행 중...' : '📱 휴대폰 본인인증 하기'}
                    </button>
                  )}
                  {!identityVerified && (
                    <p className="text-[10px] text-gray-400">본인인증 후 성함·연락처가 자동 입력됩니다.</p>
                  )}
                </div>

                {/* 성함 (본인인증 결과로 자동완성·읽기전용) */}
                <div className="space-y-2">
                  <label className={labelClass}>성함{requiredMark}</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="본인인증 후 자동 입력" readOnly={identityVerified}
                    className={identityVerified ? readonlyInputClass : inputClass} />
                </div>

                {/* 연락처 (본인인증 결과로 자동완성·읽기전용) */}
                <div className="space-y-2">
                  <label className={labelClass}>연락처{requiredMark}</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="본인인증 후 자동 입력" readOnly={identityVerified}
                    className={identityVerified ? readonlyInputClass : inputClass} />
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

          {mode === 'signup' && !identityVerified && (
            <p className="text-[11px] text-gray-400 text-center">휴대폰 본인인증 완료 후 가입 신청이 가능합니다.</p>
          )}

          <button
            onClick={mode === 'login' ? handleLogin : handleSignup}
            disabled={loading || (mode === 'signup' && !identityVerified)}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
          >
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '가입 신청하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

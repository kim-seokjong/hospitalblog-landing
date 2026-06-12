'use client';

import { useEffect, useState, useCallback } from 'react';
import { Section, Field, Input, Select, ToggleRow } from '@/hr/components/form-controls';

interface ProfileData {
  full_name: string;
  phone: string;
  hospital_name: string;
  hospital_address: string;
  position: string;
  specialty: string;
  specialty_detail: string;
  hospital_desc: string;
  hospital_keywords: string[];
  region: string;
  sms_enabled: boolean;
  sms_phone: string;
  notify_expiry: boolean;
  notify_usage: boolean;
}

const DEFAULT_PROFILE: ProfileData = {
  full_name: '',
  phone: '',
  hospital_name: '',
  hospital_address: '',
  position: '',
  specialty: '',
  specialty_detail: '',
  hospital_desc: '',
  hospital_keywords: [],
  region: '',
  sms_enabled: false,
  sms_phone: '',
  notify_expiry: true,
  notify_usage: true,
};

const POSITIONS = ['원장', '부원장', '간호사', '원무', '마케터', '기타'];

const SPECIALTIES = [
  '내과', '외과', '정형외과', '신경외과', '피부과', '성형외과',
  '안과', '이비인후과', '치과', '한의원', '산부인과', '소아청소년과',
  '비뇨의학과', '정신건강의학과', '재활의학과', '가정의학과',
  '응급의학과', '기타',
];

const REGIONS = [
  '서울 강남구', '서울 서초구', '서울 송파구', '서울 강동구', '서울 마포구',
  '서울 용산구', '서울 종로구', '서울 중구', '서울 강서구', '서울 양천구',
  '서울 영등포구', '서울 동작구', '서울 관악구', '서울 성동구', '서울 광진구',
  '서울 중랑구', '서울 노원구', '서울 도봉구', '서울 강북구', '서울 성북구',
  '서울 은평구', '서울 서대문구', '부산', '대구', '인천', '광주', '대전',
  '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북',
  '경남', '제주', '기타',
];

/**
 * 마이페이지 — 내 정보 탭.
 * 기존 /settings/profile 페이지의 폼을 탭 컴포넌트로 이전 (API는 /api/profile 그대로 사용).
 */
export default function ProfileTab() {
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [keywordInput, setKeywordInput] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) throw new Error('프로필 조회 실패');
      const json = await res.json() as { profile: Partial<ProfileData> };
      setProfile({ ...DEFAULT_PROFILE, ...json.profile });
    } catch {
      setProfile(DEFAULT_PROFILE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? '저장 실패');
      }
      setSaveMsg({ type: 'success', text: '프로필이 저장되었습니다.' });
    } catch (e) {
      setSaveMsg({ type: 'error', text: e instanceof Error ? e.message : '저장 실패' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || profile.hospital_keywords.includes(kw)) return;
    if (profile.hospital_keywords.length >= 10) return;
    setProfile(prev => ({ ...prev, hospital_keywords: [...prev.hospital_keywords, kw] }));
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    setProfile(prev => ({
      ...prev,
      hospital_keywords: prev.hospital_keywords.filter(k => k !== kw),
    }));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-gray-400 text-sm">프로필을 불러오는 중...</div>
    );
  }

  return (
    <div>
      {/* 저장 메시지 */}
      {saveMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          saveMsg.type === 'success'
            ? 'bg-green-900/50 border border-green-700 text-green-300'
            : 'bg-red-900/50 border border-red-700 text-red-300'
        }`}>
          {saveMsg.text}
        </div>
      )}

      <div className="space-y-4">

        {/* 1. 기본 정보 */}
        <Section title="기본 정보">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="이름">
              <Input
                value={profile.full_name}
                onChange={v => setProfile(p => ({ ...p, full_name: v }))}
                placeholder="홍길동"
              />
            </Field>
            <Field label="전화번호">
              <Input
                value={profile.phone}
                onChange={v => setProfile(p => ({ ...p, phone: v }))}
                placeholder="010-0000-0000"
                type="tel"
              />
            </Field>
          </div>
          <Field label="직책">
            <Select
              value={profile.position}
              onChange={v => setProfile(p => ({ ...p, position: v }))}
              options={[{ value: '', label: '직책 선택' }, ...POSITIONS.map(pos => ({ value: pos, label: pos }))]}
            />
          </Field>
        </Section>

        {/* 2. 병원 정보 */}
        <Section title="병원 정보">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="병원명">
              <Input
                value={profile.hospital_name}
                onChange={v => setProfile(p => ({ ...p, hospital_name: v }))}
                placeholder="닥터포스트 의원"
              />
            </Field>
            <Field label="지역">
              <Select
                value={profile.region}
                onChange={v => setProfile(p => ({ ...p, region: v }))}
                options={[{ value: '', label: '지역 선택' }, ...REGIONS.map(r => ({ value: r, label: r }))]}
              />
            </Field>
          </div>
          <Field label="병원 주소">
            <Input
              value={profile.hospital_address}
              onChange={v => setProfile(p => ({ ...p, hospital_address: v }))}
              placeholder="서울시 강남구 테헤란로 123"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="진료과목">
              <Select
                value={profile.specialty}
                onChange={v => setProfile(p => ({ ...p, specialty: v }))}
                options={[{ value: '', label: '진료과목 선택' }, ...SPECIALTIES.map(s => ({ value: s, label: s }))]}
              />
            </Field>
            <Field label="세부 진료과목">
              <Input
                value={profile.specialty_detail}
                onChange={v => setProfile(p => ({ ...p, specialty_detail: v }))}
                placeholder="예: 관절·척추 전문"
              />
            </Field>
          </div>
        </Section>

        {/* 3. 병원 소개 */}
        <Section title="병원 소개">
          <p className="text-xs text-blue-400 mb-2 bg-blue-900/30 border border-blue-800 rounded-lg px-3 py-2">
            입력한 병원 소개는 AI 블로그 글 생성 시 자동으로 반영됩니다.
          </p>
          <Field label="병원 소개">
            <textarea
              value={profile.hospital_desc}
              onChange={e => setProfile(p => ({ ...p, hospital_desc: e.target.value }))}
              placeholder="병원의 특징, 진료 철학, 차별화 포인트 등을 입력해주세요."
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
            />
          </Field>
        </Section>

        {/* 4. 자주 쓰는 키워드 */}
        <Section title="자주 쓰는 키워드">
          <p className="text-xs text-gray-500 mb-3">
            Enter 키로 추가 · 최대 10개 · 글 생성 시 키워드로 자동 활용됩니다
          </p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={keywordInput}
              onChange={e => setKeywordInput(e.target.value)}
              onKeyDown={handleKeywordKeyDown}
              placeholder="키워드 입력 후 Enter"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="button"
              onClick={addKeyword}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              추가
            </button>
          </div>
          {profile.hospital_keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.hospital_keywords.map(kw => (
                <span key={kw} className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-800 border border-gray-700 rounded-full text-sm text-gray-200">
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="text-gray-500 hover:text-red-400 transition-colors leading-none"
                    aria-label={`${kw} 삭제`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 5. 알림 설정 */}
        <Section title="알림 설정">
          <div className="space-y-3">
            <ToggleRow
              label="플랜 만료 알림"
              description="플랜 만료 3일 전 이메일 알림"
              checked={profile.notify_expiry}
              onChange={v => setProfile(p => ({ ...p, notify_expiry: v }))}
            />
            <ToggleRow
              label="사용량 임박 알림"
              description="월 사용량 90% 초과 시 이메일 알림"
              checked={profile.notify_usage}
              onChange={v => setProfile(p => ({ ...p, notify_usage: v }))}
            />
          </div>
        </Section>

        {/* 6. 문자 알림 */}
        <Section title="문자 알림">
          <ToggleRow
            label="문자 수신"
            description="이메일 대신 문자로 알림 수신"
            checked={profile.sms_enabled}
            onChange={v => setProfile(p => ({ ...p, sms_enabled: v }))}
          />
          {profile.sms_enabled && (
            <div className="mt-3">
              <Field label="수신 번호">
                <Input
                  value={profile.sms_phone}
                  onChange={v => setProfile(p => ({ ...p, sms_phone: v }))}
                  placeholder="010-0000-0000"
                  type="tel"
                />
              </Field>
            </div>
          )}
        </Section>
      </div>

      {/* 저장 버튼 */}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="w-full sm:w-auto px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>
    </div>
  );
}

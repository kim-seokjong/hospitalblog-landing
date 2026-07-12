'use client';

import { useEffect, useState, useCallback } from 'react';
import { Section, Field, Input, Select, ToggleRow } from '@/hr/components/form-controls';
import { extractNaverBlogId } from '@/content/lib/rank-tracking';
import { sanitizeHandle } from '@/content/lib/scoreboard/social';
import { isValidChannelId } from '@/content/lib/scoreboard/youtube';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';

interface NaverLocalResult {
  name: string;
  category: string;
  specialty: string;
  address: string;
  roadAddress: string;
  region: string;
  link: string;
}

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
  naver_blog_url: string;
  instagram_handle: string;
  threads_handle: string;
  youtube_channel_id: string;
  site_slug: string;
  site_publish_cadence: string;
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
  naver_blog_url: '',
  instagram_handle: '',
  threads_handle: '',
  youtube_channel_id: '',
  site_slug: '',
  site_publish_cadence: 'off',
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
 * 네이버 지역명(구/군 또는 시)을 REGIONS 목록에 best-effort 매칭한다.
 * 매칭 실패 시 '' 반환(사용자가 직접 선택).
 */
function matchRegion(region: string, fullAddress: string): string {
  if (!region && !fullAddress) return '';
  // 1) "서울 강남구" 같은 정확/부분 매칭 — 구/군 단위
  const byGu = REGIONS.find(r => region && r.endsWith(region));
  if (byGu) return byGu;
  // 2) 주소 전체에 REGIONS 토큰이 포함되는지 (서울 구 단위 우선)
  const seoulGu = REGIONS.find(r => r.startsWith('서울 ') && fullAddress.includes(r.replace('서울 ', '')));
  if (seoulGu && fullAddress.includes('서울')) return seoulGu;
  // 3) 광역시·도 단위 단순 매칭
  const wide = REGIONS.find(r => !r.includes(' ') && r !== '기타' && fullAddress.includes(r));
  if (wide) return wide;
  return '';
}

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

  // 병원명으로 자동 채우기 상태
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupResults, setLookupResults] = useState<NaverLocalResult[] | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) throw new Error('프로필 조회 실패');
      const json = await res.json() as { profile: Partial<ProfileData> };
      // DB의 null 값(미설정 hospital_keywords 등)이 기본값을 덮어쓰면 렌더링 중 크래시 발생
      // (null.length) — null/undefined 필드는 제거하고 DEFAULT_PROFILE 기본값을 유지한다.
      const incoming = Object.fromEntries(
        Object.entries(json.profile ?? {}).filter(([, v]) => v !== null && v !== undefined)
      ) as Partial<ProfileData>;
      const next = { ...DEFAULT_PROFILE, ...incoming };
      setProfile(next);
      setLookupQuery(next.hospital_name);
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

  const handleLookup = async () => {
    const q = lookupQuery.trim();
    if (!q) {
      setLookupError('병원명을 입력해주세요.');
      return;
    }
    setLookupLoading(true);
    setLookupError('');
    setLookupResults(null);
    try {
      const res = await fetch(`/api/clinic/lookup?query=${encodeURIComponent(q)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '검색에 실패했습니다.');
      }
      const json = await res.json() as { results: NaverLocalResult[] };
      setLookupResults(json.results ?? []);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : '검색에 실패했습니다.');
    } finally {
      setLookupLoading(false);
    }
  };

  const applyCandidate = (c: NaverLocalResult) => {
    const matchedRegion = matchRegion(c.region, c.roadAddress || c.address);
    setProfile(prev => ({
      ...prev,
      hospital_name: c.name || prev.hospital_name,
      specialty: c.specialty || prev.specialty,
      hospital_address: c.roadAddress || c.address || prev.hospital_address,
      region: matchedRegion || prev.region,
    }));
    setLookupResults(null);
    setAutoFilled(true);
    setSuggestMsg('');
    setSaveMsg({ type: 'success', text: '자동 입력됨 — 확인 후 저장하세요.' });
    setTimeout(() => setSaveMsg(null), 3000);
  };

  const handleSuggest = async () => {
    if (!profile.hospital_name || !profile.specialty) {
      setSuggestMsg('병원명과 진료과목을 먼저 입력해주세요.');
      return;
    }
    setSuggestLoading(true);
    setSuggestMsg('');
    try {
      const res = await fetch('/api/clinic/profile-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospital_name: profile.hospital_name,
          specialty: profile.specialty,
          specialty_detail: profile.specialty_detail,
          region: profile.region,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '생성에 실패했습니다.');
      }
      const json = await res.json() as { hospital_desc: string; keywords: string[] };
      setProfile(prev => {
        const merged = [...prev.hospital_keywords];
        for (const kw of (json.keywords ?? [])) {
          const t = kw.trim();
          if (t && !merged.includes(t) && merged.length < 10) merged.push(t);
        }
        return {
          ...prev,
          hospital_desc: json.hospital_desc?.trim() ? json.hospital_desc.trim() : prev.hospital_desc,
          hospital_keywords: merged,
        };
      });
      setSuggestMsg('AI 초안이 채워졌습니다 — 수정 가능합니다. 확인 후 저장하세요.');
    } catch (e) {
      setSuggestMsg(e instanceof Error ? e.message : '생성에 실패했습니다.');
    } finally {
      setSuggestLoading(false);
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
      <div className="py-16 text-center text-[#5b6573] text-sm">프로필을 불러오는 중...</div>
    );
  }

  return (
    <div>
      {/* 저장 메시지 */}
      {saveMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          saveMsg.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-600'
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
          {/* 병원명으로 자동 채우기 */}
          <div className="mb-4 rounded-lg border border-[#ff4628]/30 bg-[#ffece7] px-3 py-3">
            <p className="text-xs text-[#ff4628] mb-2 font-medium">
              병원명으로 자동 채우기
            </p>
            <p className="text-xs text-[#5b6573] mb-2.5">
              병원명을 입력하고 버튼을 누르면 네이버 등록 정보로 병원명·진료과목·주소·지역을 자동 입력합니다. (전화번호는 직접 입력)
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={lookupQuery}
                onChange={e => setLookupQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder="병원명 검색어"
                className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
              />
              <button
                type="button"
                onClick={() => void handleLookup()}
                disabled={lookupLoading}
                className="shrink-0 px-3 py-2 bg-[#ff4628] text-white rounded-lg text-sm font-medium hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {lookupLoading ? '검색 중...' : '자동 채우기'}
              </button>
            </div>

            {lookupError && (
              <p className="mt-2 text-xs text-red-600">{lookupError}</p>
            )}

            {lookupResults !== null && lookupResults.length === 0 && !lookupError && (
              <p className="mt-2 text-xs text-[#5b6573]">
                검색 결과가 없습니다. 병원명을 다시 확인해주세요.
              </p>
            )}

            {lookupResults && lookupResults.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {lookupResults.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => applyCandidate(c)}
                      className="w-full text-left bg-white border border-[#b4bfce] rounded-lg px-3 py-2 hover:border-[#ff4628] transition-colors"
                    >
                      <span className="block text-sm font-medium text-[#202020]">{c.name}</span>
                      <span className="block text-xs text-[#5b6573]">
                        {c.category}
                        {c.roadAddress ? ` · ${c.roadAddress}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {autoFilled && (
              <div className="mt-3 border-t border-[#ff4628]/20 pt-3">
                <button
                  type="button"
                  onClick={() => void handleSuggest()}
                  disabled={suggestLoading}
                  className="px-3 py-2 bg-white border border-[#ff4628] text-[#ff4628] rounded-lg text-sm font-medium hover:bg-[#ffece7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {suggestLoading ? '생성 중...' : '강점·키워드 자동 생성'}
                </button>
                {suggestMsg && (
                  <p className="mt-2 text-xs text-[#5b6573]">{suggestMsg}</p>
                )}
              </div>
            )}
          </div>

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
          <p className="text-xs text-[#ff4628] mb-2 bg-[#ffece7] border border-[#ff4628]/30 rounded-lg px-3 py-2">
            입력한 병원 소개는 AI 블로그 글 생성 시 자동으로 반영됩니다.
          </p>
          <Field label="병원 소개">
            <textarea
              value={profile.hospital_desc}
              onChange={e => setProfile(p => ({ ...p, hospital_desc: e.target.value }))}
              placeholder="병원의 특징, 진료 철학, 차별화 포인트 등을 입력해주세요."
              rows={4}
              className="w-full bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] resize-none focus:outline-none focus:border-[#ff4628] transition-colors"
            />
          </Field>
        </Section>

        {/* 3.5 순위 추적용 블로그 주소 */}
        <Section title="순위 추적 블로그">
          <p className="text-xs text-[#5b6573] mb-2 leading-relaxed">
            공개 블로그 주소만 있으면 발행글의 네이버 검색 순위가 자동 추적됩니다. 자동발행 연동과는 무관합니다.
          </p>
          <Field label="내 네이버 블로그 주소">
            <Input
              value={profile.naver_blog_url}
              onChange={v => setProfile(p => ({ ...p, naver_blog_url: v }))}
              placeholder="blog.naver.com/myclinic"
            />
          </Field>
          {(() => {
            const v = profile.naver_blog_url.trim();
            if (!v) {
              return (
                <p className="mt-1.5 text-xs text-[#5b6573]">
                  주소 또는 블로그 아이디를 입력하세요.
                </p>
              );
            }
            const id = extractNaverBlogId(v);
            if (id) {
              return (
                <p className="mt-1.5 text-xs text-green-700">
                  추적 대상 블로그: <strong>{id}</strong>
                </p>
              );
            }
            return (
              <p className="mt-1.5 text-xs text-red-600">
                네이버 블로그 주소 형식이 아닙니다. 예: blog.naver.com/myclinic
              </p>
            );
          })()}
        </Section>

        {/* 3.6 자사 채널 (내 채널 통합 뷰) */}
        <Section title="자사 채널">
          <p className="text-xs text-[#5b6573] mb-3 leading-relaxed">
            핸들을 등록하면 마이페이지 &lsquo;내 채널&rsquo;에서 공개 팔로워·게시물·구독자·발행량을 한눈에 확인할 수 있습니다. 모두 선택 입력이며, 공개 계정만 조회됩니다.
          </p>

          <Field label="인스타그램 핸들 (선택)">
            <Input
              value={profile.instagram_handle}
              onChange={v => setProfile(p => ({ ...p, instagram_handle: v }))}
              placeholder="@myclinic (@ 제외 가능)"
            />
          </Field>
          {(() => {
            const v = profile.instagram_handle.trim();
            if (!v) return null;
            const h = sanitizeHandle(v);
            return h ? (
              <p className="mt-1 mb-2 text-xs text-green-700">조회 대상: <strong>@{h}</strong></p>
            ) : (
              <p className="mt-1 mb-2 text-xs text-red-600">핸들 형식이 아닙니다. 영문·숫자·밑줄·마침표 30자 이하로 입력하세요.</p>
            );
          })()}

          <Field label="쓰레드 핸들 (선택)">
            <Input
              value={profile.threads_handle}
              onChange={v => setProfile(p => ({ ...p, threads_handle: v }))}
              placeholder="@myclinic (@ 제외 가능)"
            />
          </Field>
          {(() => {
            const v = profile.threads_handle.trim();
            if (!v) return null;
            const h = sanitizeHandle(v);
            return h ? (
              <p className="mt-1 mb-2 text-xs text-green-700">조회 대상: <strong>@{h}</strong></p>
            ) : (
              <p className="mt-1 mb-2 text-xs text-red-600">핸들 형식이 아닙니다. 영문·숫자·밑줄·마침표 30자 이하로 입력하세요.</p>
            );
          })()}

          <Field label="유튜브 채널 ID (선택)">
            <Input
              value={profile.youtube_channel_id}
              onChange={v => setProfile(p => ({ ...p, youtube_channel_id: v }))}
              placeholder="UC로 시작하는 채널 ID"
            />
          </Field>
          {(() => {
            const v = profile.youtube_channel_id.trim();
            if (!v) return null;
            return isValidChannelId(v) ? (
              <p className="mt-1 text-xs text-green-700">조회 대상 채널: <strong>{v}</strong></p>
            ) : (
              <p className="mt-1 text-xs text-red-600">채널 ID 형식이 아닙니다. UC로 시작하는 24자여야 합니다. (채널 URL의 /channel/UC… 부분)</p>
            );
          })()}
        </Section>

        {/* 3.7 내 블로그 주소 (서브도메인 공개 블로그) */}
        <Section title="내 블로그 주소">
          <p className="text-xs text-[#5b6573] mb-3 leading-relaxed">
            주소를 설정하면 내 병원 전용 공개 블로그가 열립니다. 콘텐츠 보관함에서 검수를
            통과한 글만 발행할 수 있고, 발행된 글은 ChatGPT·Gemini 같은 AI 검색이
            크롤링·인용할 수 있습니다.
          </p>
          <Field label="블로그 주소 (선택)">
            <Input
              value={profile.site_slug}
              onChange={v => setProfile(p => ({ ...p, site_slug: v }))}
              placeholder="myclinic (소문자 영문·숫자·하이픈 3~30자)"
            />
          </Field>
          {(() => {
            const v = profile.site_slug.trim();
            if (!v) {
              return (
                <p className="mt-1.5 text-xs text-[#5b6573]">
                  예: myclinic 을 입력하면 https://myclinic.hospitalblog.kr 이 됩니다.
                </p>
              );
            }
            const validated = validateSlug(v);
            if (validated.ok) {
              return (
                <p className="mt-1.5 text-xs text-green-700">
                  내 블로그 주소: <strong>{clinicSiteUrl(validated.slug)}</strong>
                  <span className="block mt-0.5 text-[#5b6573]">
                    저장하면 위 주소로 공개 블로그가 열립니다.
                  </span>
                </p>
              );
            }
            return <p className="mt-1.5 text-xs text-red-600">{validated.reason}</p>;
          })()}

          {/* 정기 자동발행 스케줄 — 주소가 유효하게 설정됐을 때만 노출 */}
          {validateSlug(profile.site_slug.trim()).ok && (
            <div className="mt-4 pt-4 border-t border-[#e5e9ef]">
              <Field label="정기 자동발행">
                <Select
                  value={profile.site_publish_cadence}
                  onChange={v => setProfile(p => ({ ...p, site_publish_cadence: v }))}
                  options={[
                    { value: 'off', label: '사용 안 함' },
                    { value: 'weekly', label: '주 1회' },
                    { value: 'biweekly', label: '격주 1회' },
                  ]}
                />
              </Field>
              <p className="mt-1.5 text-xs text-[#5b6573] leading-relaxed">
                검수를 통과한 글 중 아직 발행 안 된 글을 설정 주기로 하나씩 자동 발행합니다.
                새 글을 만들지 않으며, 검수 통과 글만 대상입니다. 발행할 글이 없으면 아무 일도
                일어나지 않습니다.
              </p>
            </div>
          )}
        </Section>

        {/* 4. 자주 쓰는 키워드 */}
        <Section title="자주 쓰는 키워드">
          <p className="text-xs text-[#5b6573] mb-3">
            Enter 키로 추가 · 최대 10개 · 글 생성 시 키워드로 자동 활용됩니다
          </p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={keywordInput}
              onChange={e => setKeywordInput(e.target.value)}
              onKeyDown={handleKeywordKeyDown}
              placeholder="키워드 입력 후 Enter"
              className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
            />
            <button
              type="button"
              onClick={addKeyword}
              className="px-3 py-2 bg-[#ff4628] text-white rounded-lg text-sm font-medium hover:bg-[#e63a1c] transition-colors"
            >
              추가
            </button>
          </div>
          {profile.hospital_keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.hospital_keywords.map(kw => (
                <span key={kw} className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#eef2f6] border border-[#b4bfce] rounded-full text-sm text-[#202020]">
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="text-[#5b6573] hover:text-red-600 transition-colors leading-none"
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
          className="w-full sm:w-auto px-8 py-3 bg-[#ff4628] text-white rounded-xl font-semibold text-sm hover:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>
    </div>
  );
}

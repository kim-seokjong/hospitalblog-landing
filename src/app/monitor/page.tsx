'use client';

export const dynamic = 'force-dynamic';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/dev/lib/supabase/client';
import RoiSimulator from '@/content/components/RoiSimulator';

interface NaverPost {
  title: string;
  description: string;
  link: string;
  postdate: string;
  bloggername: string;
}

interface Insights {
  topics: string[];
  keywords: string[];
}

interface KeywordVolume {
  pc: number;
  mobile: number;
  total: number;
  compIdx: string;
}

interface GapCandidate {
  text: string;
  keyword: string;
  volume: KeywordVolume | null;
}

interface PlanResult {
  posts: NaverPost[];
  insights: Insights;
  gaps: GapCandidate[];
  volumes: Record<string, KeywordVolume>;
  volumeAvailable: boolean;
  naverError?: string;
}

const TOPIC_PREFILL_KEY = 'dp_topic_prefill';

const SPECIALTIES = [
  '내과', '외과', '정형외과', '신경외과', '피부과', '성형외과', '안과',
  '이비인후과', '치과', '한의원', '산부인과', '소아청소년과', '비뇨의학과',
  '정신건강의학과', '재활의학과', '가정의학과', '기타',
];

function formatPostDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr;
  return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
}

function formatVolume(total: number): string {
  if (total >= 10000) return `${Math.round(total / 1000)}천+`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}천`;
  return String(total);
}

/** 검색량/경쟁강도 배지 (데이터 있을 때만) */
function VolumeBadge({ volume }: { volume: KeywordVolume | null }) {
  if (!volume) return null;
  const compColor =
    volume.compIdx === '높음'
      ? 'text-red-600 bg-red-50 border-red-200'
      : volume.compIdx === '중간'
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-green-700 bg-green-50 border-green-200';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[10px] font-semibold text-[#5b6573] bg-[#eef2f6] border border-[#b4bfce] px-1.5 py-0.5 rounded-full">
        월 {formatVolume(volume.total)}
      </span>
      {volume.compIdx !== '-' && (
        <span className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full ${compColor}`}>
          경쟁 {volume.compIdx}
        </span>
      )}
    </span>
  );
}

export default function MonitorPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [specialty, setSpecialty] = useState('');
  const [region, setRegion] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profilePrefilled, setProfilePrefilled] = useState(false);

  // 프로필 region/hospital_type 자동 채움 (있으면). 없으면 수동 입력 유지.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      supabase
        .from('profiles')
        .select('hospital_type, hospital_address')
        .eq('id', user.id)
        .single()
        .then(({ data: profile }) => {
          if (cancelled || !profile) return;
          const p = profile as { hospital_type?: string | null; hospital_address?: string | null };
          if (p.hospital_type && SPECIALTIES.includes(p.hospital_type)) {
            setSpecialty((prev) => prev || p.hospital_type!);
          }
          if (p.hospital_address) {
            const parts = p.hospital_address.trim().split(/\s+/);
            const gu = parts.find((x) => x.endsWith('구') || x.endsWith('군'));
            const si = parts.find((x) => x.endsWith('시') && x !== '광역시');
            const r = gu || si || '';
            if (r) setRegion((prev) => prev || r);
          }
          setProfilePrefilled(Boolean(p.hospital_type || p.hospital_address));
        });
    });
    return () => { cancelled = true; };
  }, [supabase]);

  const handleAnalyze = useCallback(async () => {
    if (!specialty) {
      setError('진료과목을 선택해주세요.');
      return;
    }
    if (!region.trim()) {
      setError('지역을 입력해주세요.');
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch('/api/content-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialty,
          region: region.trim(),
          keyword: keyword.trim() || undefined,
        }),
      });

      const data = (await res.json()) as PlanResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? '분석 중 오류가 발생했습니다.');
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [specialty, region, keyword]);

  /** 추천 키워드 검색량 합 → ROI 시뮬레이터 prefill (데이터 없으면 0) */
  const roiVolumePrefill = useMemo(() => {
    if (!result) return 0;
    const sum = Object.values(result.volumes).reduce(
      (acc, v) => acc + (Number.isFinite(v.total) && v.total > 0 ? v.total : 0),
      0
    );
    return Math.round(sum);
  }, [result]);

  /** 추천 주제/키워드로 글쓰기 → prefill 후 /app 이동 */
  const writeWithTopic = useCallback((topic: string, kw: string) => {
    try {
      localStorage.setItem(
        TOPIC_PREFILL_KEY,
        JSON.stringify({ topic, keyword: kw })
      );
    } catch {
      // 저장 실패해도 이동은 시도 (입력란만 비어 있게 됨)
    }
    router.push('/app');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#eef2f6] text-[#202020]">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#b4bfce] bg-white/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a href="/app" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-xl bg-[#eef2f6] border border-[#ff4628]/30 flex items-center justify-center">
              <span className="text-base">🏥</span>
            </div>
            <span className="font-bold text-[#202020] text-lg">닥터포스트</span>
          </a>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-2.5 py-1 rounded-full hidden sm:inline-flex">
              경쟁 분석 · 기획
            </span>
            <a
              href="/app"
              className="px-3 py-1.5 text-xs border border-[#b4bfce] rounded-lg text-[#4a4f55] hover:bg-[#eef2f6] hover:text-[#202020] transition-colors"
            >
              ← 앱으로
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
        {/* 타이틀 */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#202020] mb-2" style={{ letterSpacing: '-0.02em' }}>
            경쟁 분석 · 콘텐츠 기획
          </h1>
          <p className="text-sm text-[#5b6573]">
            경쟁 블로그를 분석해 추천 주제·검색량을 받고, 내가 아직 안 쓴 주제로 바로 글을 쓰세요.
          </p>
        </div>

        {/* 검색 폼 */}
        <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 mb-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          {profilePrefilled && (
            <p className="text-[11px] text-[#5b6573] mb-3 flex items-center gap-1">
              <span>✓</span> 프로필 정보로 진료과목·지역을 자동 채웠습니다 (수정 가능)
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#5b6573]">
                진료과목 <span className="text-red-500">*</span>
              </label>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] transition-colors appearance-none"
              >
                <option value="">선택하세요</option>
                {SPECIALTIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#5b6573]">
                지역 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="예) 강남구, 수원, 부산"
                className="bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] placeholder-[#73808f] transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#5b6573]">
                키워드 <span className="text-[#73808f] font-normal">(선택)</span>
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="예) 리프팅, 보톡스"
                className="bg-white border border-[#b4bfce] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] placeholder-[#73808f] transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
              />
            </div>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full sm:w-auto px-8 py-3 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                경쟁 블로그 분석 + 기획 중...
              </span>
            ) : (
              '분석 · 기획 시작'
            )}
          </button>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-600 flex-shrink-0 mt-0.5">✕</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">오류 발생</p>
              <p className="text-xs text-red-600 mt-0.5 break-words">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-600 hover:text-red-800 text-lg leading-none flex-shrink-0"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        )}

        {/* 네이버 API 오류 경고 */}
        {result?.naverError && (
          <div className="mb-6 bg-yellow-50 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
            <span className="text-yellow-600 flex-shrink-0 mt-0.5">⚠</span>
            <p className="text-xs text-yellow-700 leading-relaxed">
              네이버 블로그 검색 API 오류: {result.naverError}
            </p>
          </div>
        )}

        {/* 결과 */}
        {result ? (
          <div className="space-y-6">
            {/* ── 콘텐츠 기획서 (갭 우선순위) ── */}
            <div className="bg-white border border-[#ff4628]/30 rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">📋</span>
                </div>
                <h2 className="text-sm font-bold text-[#202020]">콘텐츠 기획서</h2>
                <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] px-2 py-0.5 rounded-full border border-[#ff4628]/30">
                  {specialty} · {region}
                </span>
                {result.volumeAvailable && (
                  <span className="text-[10px] font-semibold text-[#5b6573] bg-[#eef2f6] px-2 py-0.5 rounded-full border border-[#b4bfce]">
                    검색량 기준 우선순위
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5b6573] mb-4">
                경쟁사는 다루는데 <strong className="text-[#202020]">아직 내가 안 쓴 주제</strong>입니다. 바로 글로 만들어보세요.
              </p>

              {result.gaps.length > 0 ? (
                <ol className="space-y-2.5">
                  {result.gaps.map((gap, i) => (
                    <li
                      key={`${gap.text}-${i}`}
                      className="flex items-start gap-3 bg-[#eef2f6] rounded-xl px-4 py-3"
                    >
                      <span className="text-[#ff4628] font-bold text-sm flex-shrink-0 mt-0.5 w-5 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#202020] leading-relaxed mb-1.5">{gap.text}</p>
                        <VolumeBadge volume={gap.volume} />
                      </div>
                      <button
                        onClick={() => writeWithTopic(gap.text, gap.keyword)}
                        className="flex-shrink-0 px-3 py-1.5 bg-[#ff4628] hover:bg-[#e63a1c] active:bg-[#e63a1c] text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        ✍️ 이 주제로 글쓰기
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-[#73808f] bg-[#eef2f6] rounded-xl px-4 py-6 text-center">
                  경쟁자 주제를 이미 충분히 다루고 계시거나, 분석 가능한 주제가 없습니다.
                </p>
              )}
            </div>

            {/* ── 마케팅 ROI 추정 시뮬레이터 (계획용·추정) ── */}
            <RoiSimulator initialMonthlyVolume={roiVolumePrefill} />

            {/* ── Claude 인사이트 (주제 + 키워드) ── */}
            <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">🤖</span>
                </div>
                <h2 className="text-sm font-bold text-[#202020]">Claude AI 인사이트</h2>
              </div>

              {result.insights.topics.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-semibold text-[#5b6573] mb-3">경쟁자 주요 주제</p>
                  <ul className="space-y-2">
                    {result.insights.topics.map((topic, i) => (
                      <li key={i} className="flex items-start gap-2.5 bg-[#eef2f6] rounded-xl px-4 py-3">
                        <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 mt-0.5">{i + 1}.</span>
                        <span className="flex-1 text-sm text-[#202020] leading-relaxed">{topic}</span>
                        <button
                          onClick={() => writeWithTopic(topic, topic)}
                          className="flex-shrink-0 px-2.5 py-1 border border-[#b4bfce] hover:border-[#ff4628]/50 text-[#4a4f55] hover:text-[#202020] text-[11px] font-semibold rounded-lg transition-colors"
                        >
                          ✍️ 글쓰기
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-[#5b6573] mb-2">추천 키워드</p>
                {result.insights.keywords.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {result.insights.keywords.map((kw) => {
                      const vol = result.volumes[kw] ?? null;
                      return (
                        <div
                          key={kw}
                          className="flex items-center gap-2 flex-wrap bg-[#eef2f6] border border-[#b4bfce] rounded-xl px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-[#202020]"># {kw}</span>
                          <VolumeBadge volume={vol} />
                          <button
                            onClick={() => writeWithTopic(kw, kw)}
                            className="ml-auto px-2.5 py-1 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-[11px] font-bold rounded-lg transition-colors"
                          >
                            ✍️ 이 키워드로 글쓰기
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[#73808f]">키워드 추천 결과가 없습니다.</p>
                )}
              </div>
            </div>

            {/* ── 최근 경쟁 블로그 목록 ── */}
            {result.posts.length > 0 ? (
              <div className="bg-white border border-[#b4bfce] rounded-2xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <div className="px-5 py-4 border-b border-[#b4bfce] flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#202020]">최근 경쟁 블로그 글</h2>
                  <span className="text-xs text-[#5b6573]">{result.posts.length}건</span>
                </div>
                <ul className="divide-y divide-[#b4bfce]">
                  {result.posts.map((post, idx) => (
                    <li key={idx}>
                      <a
                        href={post.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 px-5 py-4 hover:bg-[#eef2f6] active:bg-[#eef2f6] transition-colors group"
                      >
                        <span className="text-[#73808f] text-xs mt-0.5 flex-shrink-0 w-5 text-right">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#202020] group-hover:text-[#ff4628] transition-colors line-clamp-1 mb-0.5">
                            {post.title}
                          </p>
                          <p className="text-xs text-[#5b6573] line-clamp-2 leading-relaxed mb-1.5">{post.description}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-[#5b6573] bg-[#eef2f6] px-2 py-0.5 rounded-full border border-[#b4bfce]">
                              {post.bloggername}
                            </span>
                            <span className="text-[10px] text-[#73808f]">{formatPostDate(post.postdate)}</span>
                          </div>
                        </div>
                        <span className="text-[#73808f] group-hover:text-[#ff4628] flex-shrink-0 text-sm transition-colors">→</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !result.naverError && (
                <div className="bg-white border border-[#b4bfce] rounded-2xl p-8 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                  <p className="text-2xl mb-2">🔍</p>
                  <p className="text-sm text-[#5b6573]">검색된 블로그 글이 없습니다.</p>
                  <p className="text-xs text-[#73808f] mt-1">검색어를 변경해보세요.</p>
                </div>
              )
            )}
          </div>
        ) : (
          !loading && !error && (
            <div className="bg-white border border-[#b4bfce] border-dashed rounded-2xl p-10 sm:p-16 text-center">
              <p className="text-3xl mb-3">🏥</p>
              <p className="text-sm font-semibold text-[#5b6573] mb-1">
                진료과목과 지역을 선택해서 경쟁 분석·콘텐츠 기획을 시작하세요
              </p>
              <p className="text-xs text-[#73808f]">
                경쟁 주제 · 검색량 · 내가 안 쓴 주제 우선순위를 한 번에 받아볼 수 있습니다.
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

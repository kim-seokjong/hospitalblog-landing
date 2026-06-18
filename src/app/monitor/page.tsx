'use client';

import { useState, useCallback } from 'react';

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

interface MonitorResult {
  posts: NaverPost[];
  insights: Insights;
  naverError?: string;
}

const SPECIALTIES = [
  '내과',
  '외과',
  '정형외과',
  '신경외과',
  '피부과',
  '성형외과',
  '안과',
  '이비인후과',
  '치과',
  '한의원',
  '산부인과',
  '소아청소년과',
  '비뇨의학과',
  '정신건강의학과',
  '재활의학과',
  '가정의학과',
  '기타',
];

function formatPostDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr;
  return `${dateStr.slice(0, 4)}.${dateStr.slice(4, 6)}.${dateStr.slice(6, 8)}`;
}

function KeywordChip({ keyword }: { keyword: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(keyword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API not available — fail silently
    }
  }, [keyword]);

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
        copied
          ? 'bg-green-50 border-green-500/50 text-green-700'
          : 'bg-[#eef2f6] border-[#dbe2ea] text-[#4a4f55] hover:border-[#ff4628]/50 hover:text-[#202020] hover:bg-[#ffece7] active:bg-[#ffece7]'
      }`}
    >
      {copied ? '✓ 복사됨' : `# ${keyword}`}
    </button>
  );
}

export default function MonitorPage() {
  const [specialty, setSpecialty] = useState('');
  const [region, setRegion] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MonitorResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch('/api/competitor-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialty,
          region: region.trim(),
          keyword: keyword.trim() || undefined,
        }),
      });

      const data = await res.json() as MonitorResult & { error?: string };

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

  return (
    <div className="min-h-screen bg-[#eef2f6] text-[#202020]">
      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <a
            href="/app"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-xl bg-[#eef2f6] border border-[#ff4628]/30 flex items-center justify-center">
              <span className="text-base">🏥</span>
            </div>
            <span className="font-bold text-[#202020] text-lg">닥터포스트</span>
          </a>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-2.5 py-1 rounded-full hidden sm:inline-flex">
              경쟁 분석
            </span>
            <a
              href="/app"
              className="px-3 py-1.5 text-xs border border-[#dbe2ea] rounded-lg text-[#4a4f55] hover:bg-[#eef2f6] hover:text-[#202020] transition-colors"
            >
              ← 앱으로
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-10">
        {/* 타이틀 */}
        <div className="mb-8 text-center">
          <h1
            className="text-2xl sm:text-3xl font-extrabold text-[#202020] mb-2"
            style={{ letterSpacing: '-0.02em' }}
          >
            경쟁 병원 모니터링
          </h1>
          <p className="text-sm text-[#8a93a0]">
            같은 진료과목·지역의 최신 블로그를 분석하고 추천 키워드를 받아보세요.
          </p>
        </div>

        {/* 검색 폼 */}
        <div className="bg-white border border-[#dbe2ea] rounded-2xl p-5 sm:p-6 mb-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {/* 진료과목 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8a93a0]">
                진료과목 <span className="text-red-500">*</span>
              </label>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="bg-white border border-[#dbe2ea] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] transition-colors appearance-none"
              >
                <option value="">선택하세요</option>
                {SPECIALTIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* 지역 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8a93a0]">
                지역 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="예) 강남구, 수원, 부산"
                className="bg-white border border-[#dbe2ea] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] placeholder-[#b8c8d7] transition-colors"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
              />
            </div>

            {/* 추가 키워드 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8a93a0]">
                키워드{' '}
                <span className="text-[#b8c8d7] font-normal">(선택)</span>
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="예) 리프팅, 보톡스"
                className="bg-white border border-[#dbe2ea] text-[#202020] text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#ff4628] placeholder-[#b8c8d7] transition-colors"
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
                경쟁 병원 블로그 분석 중...
              </span>
            ) : (
              '분석 시작'
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

        {/* 결과 섹션 */}
        {result ? (
          <div className="space-y-6">
            {/* Claude 인사이트 카드 */}
            <div className="bg-white border border-[#ff4628]/30 rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">🤖</span>
                </div>
                <h2 className="text-sm font-bold text-[#202020]">Claude AI 인사이트</h2>
                <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] px-2 py-0.5 rounded-full border border-[#ff4628]/30 hidden sm:inline-flex">
                  {specialty} · {region}
                </span>
              </div>

              {/* 경쟁자 주요 주제 */}
              {result.insights.topics.length > 0 ? (
                <div className="mb-5">
                  <p className="text-xs font-semibold text-[#8a93a0] mb-3">
                    경쟁자 주요 주제
                  </p>
                  <ul className="space-y-2">
                    {result.insights.topics.map((topic, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 bg-[#eef2f6] rounded-xl px-4 py-3"
                      >
                        <span className="text-[#ff4628] font-bold text-xs flex-shrink-0 mt-0.5">
                          {i + 1}.
                        </span>
                        <span className="text-sm text-[#202020] leading-relaxed">
                          {topic}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-[#b8c8d7] mb-5">
                  주제 분석 결과가 없습니다.
                </p>
              )}

              {/* 추천 키워드 */}
              <div>
                <p className="text-xs font-semibold text-[#8a93a0] mb-2">
                  추천 키워드{' '}
                  <span className="font-normal text-[#b8c8d7]">(클릭하여 복사)</span>
                </p>
                {result.insights.keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {result.insights.keywords.map((kw) => (
                      <KeywordChip key={kw} keyword={kw} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#b8c8d7]">키워드 추천 결과가 없습니다.</p>
                )}
              </div>
            </div>

            {/* 최근 경쟁 블로그 목록 */}
            {result.posts.length > 0 ? (
              <div className="bg-white border border-[#dbe2ea] rounded-2xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                <div className="px-5 py-4 border-b border-[#dbe2ea] flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#202020]">최근 경쟁 블로그 글</h2>
                  <span className="text-xs text-[#8a93a0]">{result.posts.length}건</span>
                </div>
                <ul className="divide-y divide-[#dbe2ea]">
                  {result.posts.map((post, idx) => (
                    <li key={idx}>
                      <a
                        href={post.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 px-5 py-4 hover:bg-[#eef2f6] active:bg-[#eef2f6] transition-colors group"
                      >
                        <span className="text-[#b8c8d7] text-xs mt-0.5 flex-shrink-0 w-5 text-right">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#202020] group-hover:text-[#ff4628] transition-colors line-clamp-1 mb-0.5">
                            {post.title}
                          </p>
                          <p className="text-xs text-[#8a93a0] line-clamp-2 leading-relaxed mb-1.5">
                            {post.description}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-[#8a93a0] bg-[#eef2f6] px-2 py-0.5 rounded-full border border-[#dbe2ea]">
                              {post.bloggername}
                            </span>
                            <span className="text-[10px] text-[#b8c8d7]">
                              {formatPostDate(post.postdate)}
                            </span>
                          </div>
                        </div>
                        <span className="text-[#b8c8d7] group-hover:text-[#ff4628] flex-shrink-0 text-sm transition-colors">
                          →
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !result.naverError && (
                <div className="bg-white border border-[#dbe2ea] rounded-2xl p-8 text-center shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
                  <p className="text-2xl mb-2">🔍</p>
                  <p className="text-sm text-[#8a93a0]">검색된 블로그 글이 없습니다.</p>
                  <p className="text-xs text-[#b8c8d7] mt-1">검색어를 변경해보세요.</p>
                </div>
              )
            )}
          </div>
        ) : (
          /* 빈 상태 */
          !loading && !error && (
            <div className="bg-white border border-[#dbe2ea] border-dashed rounded-2xl p-10 sm:p-16 text-center">
              <p className="text-3xl mb-3">🏥</p>
              <p className="text-sm font-semibold text-[#8a93a0] mb-1">
                진료과목과 지역을 선택해서 경쟁 병원 블로그를 분석하세요
              </p>
              <p className="text-xs text-[#b8c8d7]">
                최근 블로그 글과 Claude AI 인사이트를 함께 확인할 수 있습니다.
              </p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

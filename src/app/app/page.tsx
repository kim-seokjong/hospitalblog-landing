'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import KeywordInput from '@/components/KeywordInput';
import KeywordTrend from '@/components/KeywordTrend';
import TitleSelector from '@/components/TitleSelector';
import ContentPreview from '@/components/ContentPreview';
import ImageGallery from '@/components/ImageGallery';
import CardNewsDesigner from '@/components/CardNewsDesigner';
import SeoAnalysis from '@/components/SeoAnalysis';
import OriginalityChecker from '@/components/OriginalityChecker';
import TagPanel from '@/components/TagPanel';
import NaverPreview from '@/components/NaverPreview';
import NaverPublisher from '@/components/NaverPublisher';
import AuthModal from '@/components/AuthModal';
import SnsCopyPanel from '@/components/SnsCopyPanel';
import SmsCopyPanel from '@/components/SmsCopyPanel';
import type { BlogTitle, BlogContent, GeneratedImage, TagResult, CardNewsData, WritingStyle } from '@/types';

type ViewStep = 'input' | 'content';

function AdBanner({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`hidden xl:flex flex-col w-36 flex-shrink-0 ${side === 'left' ? 'mr-4' : 'ml-4'}`}>
      <div className="sticky top-24 space-y-4">
        <div className="w-full h-64" />
        <div className="w-full h-56" />
      </div>
    </div>
  );
}

export default function AppPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewStep, setViewStep] = useState<ViewStep>('input');

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const [keyword, setKeyword] = useState('');
  const [hospitalType, setHospitalType] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [writingStyle, setWritingStyle] = useState<WritingStyle>('전문가');

  const [titles, setTitles] = useState<BlogTitle[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<BlogTitle | null>(null);
  const [content, setContent] = useState<BlogContent | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [tags, setTags] = useState<TagResult | null>(null);

  const [loadingTitles, setLoadingTitles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [lastImageCount] = useState(6);
  const [imageStyle, setImageStyle] = useState<'photo' | 'cardnews' | 'upload'>('cardnews');
  const [cardNewsData, setCardNewsData] = useState<CardNewsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleKeywordSubmit = async (kw: string, ht: string, ai: string, ws: WritingStyle) => {
    setKeyword(kw);
    setHospitalType(ht);
    setAdditionalInfo(ai);
    setWritingStyle(ws);
    setTitles([]);
    setSelectedTitle(null);
    setContent(null);
    setImages([]);
    setTags(null);
    setError(null);
    setViewStep('input');
    setLoadingTitles(true);

    try {
      const res = await fetch('/api/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, hospitalType: ht }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '제목 생성에 실패했습니다.');
      setTitles(data.titles);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingTitles(false);
    }
  };

  const handleGenerateContent = async () => {
    if (!selectedTitle) return;
    setContent(null);
    setImages([]);
    setTags(null);
    setCardNewsData(null);
    setError(null);
    setLoadingContent(true);

    try {
      const [contentRes, tagRes] = await Promise.all([
        fetch('/api/generate-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: selectedTitle.title, keyword, hospitalType, additionalInfo,
            titleFormat: selectedTitle.seoDetails?.format, writingStyle,
          }),
        }),
        fetch('/api/generate-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, title: selectedTitle.title, hospitalType }),
        }),
      ]);

      const [contentData, tagData] = await Promise.all([contentRes.json(), tagRes.json()]);
      if (!contentRes.ok) throw new Error(contentData.error || '본문 생성에 실패했습니다.');
      setContent(contentData);
      if (tagRes.ok) setTags(tagData);
      setViewStep('content');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleGenerateTags = async () => {
    if (!selectedTitle) return;
    setLoadingTags(true);
    try {
      const res = await fetch('/api/generate-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, hospitalType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '태그 생성에 실패했습니다.');
      setTags(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '태그 생성 오류가 발생했습니다.');
    } finally {
      setLoadingTags(false);
    }
  };

  const handleGenerateImages = async (count: number, style?: 'photo' | 'cardnews') => {
    if (!selectedTitle) return;
    const activeStyle = style ?? imageStyle;
    setError(null);
    setLoadingImages(true);
    try {
      const res = await fetch('/api/generate-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, body: content?.body ?? '', count, style: activeStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '이미지 생성에 실패했습니다.');
      setImages(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingImages(false);
    }
  };

  const handleGenerateSlides = async () => {
    if (!selectedTitle || !content) return;
    setCardNewsData(null);
    setError(null);
    setLoadingSlides(true);
    try {
      const res = await fetch('/api/generate-cardnews-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, title: selectedTitle.title, body: content.body, hospitalType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '카드뉴스 생성에 실패했습니다.');
      setCardNewsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingSlides(false);
    }
  };

  const handleImagesUploaded = (files: File[]) => {
    const readers = files.map(file => new Promise<GeneratedImage>(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url: e.target?.result as string,
        prompt: file.name,
        revised_prompt: file.name,
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers)
      .then(newImages => setImages(prev => [...prev, ...newImages]))
      .catch(() => setError('이미지 파일을 읽는 데 실패했습니다.'));
  };

  const STYLE_LABEL: Record<WritingStyle, string> = {
    '전문가': '🩺 전문가시점',
    '고객이해': '👥 고객이해시점',
    '사무장': '🏥 사무장시점',
  };

  return (
    <div className="min-h-screen bg-[#0b0d2b] text-white">
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={() => setShowAuthModal(false)} />
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-40 border-b border-[#2a2b6e] bg-[#0b0d2b]/95 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 h-13 sm:h-14 flex items-center justify-between gap-2 sm:gap-4" style={{ minHeight: '52px' }}>
          {/* 로고 + 회사명 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-[#191970] border border-[#4f6ef7]/30 flex items-center justify-center shadow-lg shadow-[#4f6ef7]/10">
              <span className="text-base">🏥</span>
            </div>
            <span className="font-bold text-white text-lg">닥터포스트</span>
          </div>

          {/* 단계 표시 — 모바일: 간략, 데스크탑: 상세 */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-center">
            {viewStep === 'input' ? (
              <>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-[#4f6ef7]/10 text-[#4f6ef7] border border-[#4f6ef7]/20 text-[10px] sm:text-xs font-semibold">
                  <span className="w-1.5 h-1.5 bg-[#4f6ef7] rounded-full animate-pulse flex-shrink-0" />
                  <span className="sm:hidden">Step 1</span>
                  <span className="hidden sm:inline">Step 1 · 키워드 → 제목 선택</span>
                </div>
                <span className="text-[#555d8a] text-xs hidden sm:block">→</span>
                <div className="hidden sm:block px-2.5 py-1 rounded-full bg-[#2a2b6e]/40 text-[#555d8a] border border-[#2a2b6e] text-xs font-semibold">
                  Step 2 · 본문 · 이미지
                </div>
              </>
            ) : selectedTitle ? (
              <>
                <button
                  onClick={() => setViewStep('input')}
                  className="flex items-center gap-1 text-[#8891bd] hover:text-white active:text-white transition-colors flex-shrink-0 text-xs min-h-[36px] px-1"
                >
                  ← 뒤로
                </button>
                <span className="text-[#555d8a] text-xs">·</span>
                <span className="text-[#c5caf0] truncate text-[10px] sm:text-xs">{selectedTitle.title}</span>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-[#191970] text-[9px] text-[#8891bd] border border-[#2a2b6e] hidden sm:block">
                  {STYLE_LABEL[writingStyle]}
                </span>
              </>
            ) : null}
          </div>

          {/* 인증 */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {authChecked && (
              user ? (
                <>
                  <span className="text-xs text-[#8891bd] hidden lg:block max-w-[120px] truncate">{user.email}</span>
                  {user.email === 'terro6936@naver.com' && (
                    <Link
                      href="/admin"
                      className="px-2.5 sm:px-3 py-1.5 text-xs border border-yellow-500/40 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors min-h-[36px] flex items-center gap-1"
                    >
                      <span>⚙️</span>
                      <span className="hidden sm:inline">관리자</span>
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="px-2.5 sm:px-3 py-1.5 text-xs border border-[#2a2b6e] rounded-lg text-[#8891bd] hover:bg-[#191970] hover:text-white active:bg-[#191970] transition-colors min-h-[36px]"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-2.5 sm:px-3 py-1.5 bg-[#4f6ef7] hover:bg-[#3d5ef0] active:bg-[#2d4ee0] text-white text-xs font-bold rounded-lg transition-colors min-h-[36px]"
                >
                  로그인
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* 에러 */}
      {error && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-3">
            <span className="text-red-400 text-lg flex-shrink-0">❌</span>
            <div className="flex-1">
              <p className="font-semibold text-red-300 text-sm">오류 발생</p>
              <p className="text-xs text-red-400 mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-lg">×</button>
          </div>
        </div>
      )}

      {/* 본문 */}
      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex">
          <AdBanner side="left" />

          <div className="flex-1 min-w-0 overflow-hidden">

            {/* ── STEP 1: 키워드 입력 + 제목 선택 ── */}
            {viewStep === 'input' && (
              <>
                {loadingContent && (
                  <div className="flex items-center justify-center py-16 sm:py-24">
                    <div className="text-center">
                      <div className="w-12 h-12 border-4 border-[#4f6ef7] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-white font-semibold">본문 + 태그 생성 중...</p>
                      <p className="text-xs text-[#8891bd] mt-1">Claude AI가 작성하고 있습니다</p>
                    </div>
                  </div>
                )}

                {!loadingContent && (
                  <div className={`grid gap-4 sm:gap-5 ${titles.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-full sm:max-w-md mx-auto'}`}>
                    {/* 왼쪽: 키워드 입력 */}
                    <div className="space-y-4">
                      <KeywordInput onSubmit={handleKeywordSubmit} isLoading={loadingTitles} />
                    </div>

                    {/* 오른쪽: 검색 트렌드 + 제목 선택 */}
                    {titles.length > 0 && (
                      <div className="space-y-4">
                        {keyword && <KeywordTrend mainKeyword={keyword} />}
                        <TitleSelector
                          titles={titles}
                          selectedTitle={selectedTitle}
                          onSelect={setSelectedTitle}
                          onGenerate={handleGenerateContent}
                          isLoading={loadingContent}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 빈 상태 */}
                {titles.length === 0 && !loadingTitles && !loadingContent && (
                  <div className="mt-8 sm:mt-12 text-center px-4">
                    <div className="text-4xl sm:text-5xl mb-3">✍️</div>
                    <p className="text-base font-semibold text-white mb-1">키워드를 입력하여 시작하세요</p>
                    <p className="text-xs text-[#8891bd] mb-5">
                      네이버 C-Rank · D.I.A+ 알고리즘 기반 SEO 최적화 블로그 자동 생성
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {['레이저 토닝', '보톡스 시술', '도수치료', '허리디스크', '임플란트', '라식 수술'].map((kw) => (
                        <span key={kw} className="bg-[#191970]/50 text-[#8891bd] text-xs px-3 py-1.5 rounded-full border border-[#2a2b6e]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── STEP 2: 본문 + 이미지 ── */}
            {viewStep === 'content' && (
              <>
                {loadingContent && (
                  <div className="flex items-center justify-center py-16 sm:py-24">
                    <div className="text-center">
                      <div className="w-12 h-12 border-4 border-[#4f6ef7] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-white font-semibold">본문 + 태그 생성 중...</p>
                    </div>
                  </div>
                )}

                {content && !loadingContent && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                    {/* 왼쪽: 본문 + SEO + 독창성 */}
                    <div className="space-y-5">
                      <ContentPreview
                        content={content}
                        onGenerateImages={handleGenerateImages}
                        onImagesUploaded={handleImagesUploaded}
                        isLoadingImages={loadingImages}
                        imageStyle={imageStyle}
                        onImageStyleChange={setImageStyle}
                        onGenerateSlides={handleGenerateSlides}
                        isLoadingSlides={loadingSlides}
                      />
                      <SeoAnalysis content={content} />
                      <OriginalityChecker
                        title={content.title}
                        body={content.body}
                        keyword={keyword}
                      />
                    </div>

                    {/* 오른쪽: 네이버 미리보기 + 태그 + 이미지 + 발행 */}
                    <div className="space-y-5">
                      {selectedTitle && (
                        <NaverPreview
                          title={selectedTitle.title}
                          body={content.body}
                          keyword={keyword}
                        />
                      )}

                      {tags && (
                        <TagPanel
                          tags={tags}
                          onRegenerate={handleGenerateTags}
                          isLoading={loadingTags}
                        />
                      )}

                      {images.length > 0 && (
                        <ImageGallery
                          images={images}
                          keyword={keyword}
                          title={selectedTitle?.title || keyword}
                          style={imageStyle}
                          onRegenerate={() => handleGenerateImages(lastImageCount)}
                          isLoading={loadingImages}
                          onImagesUpdate={setImages}
                        />
                      )}

                      {cardNewsData && (
                        <CardNewsDesigner data={cardNewsData} keyword={keyword} />
                      )}

                      {user && selectedTitle && (
                        <NaverPublisher
                          title={selectedTitle.title}
                          content={content}
                          tags={tags}
                          images={images}
                        />
                      )}

                      {!user && authChecked && (
                        <div className="rounded-2xl border border-[#2a2b6e] bg-[#12153d] p-5 text-center">
                          <p className="text-sm font-semibold text-white mb-1">발행 도우미는 로그인 후 사용 가능합니다</p>
                          <p className="text-xs text-[#8891bd] mb-4">로그인하고 네이버 블로그에 바로 발행하세요</p>
                          <button
                            onClick={() => setShowAuthModal(true)}
                            className="px-5 py-2 bg-[#4f6ef7] hover:bg-[#3d5ef0] text-white text-sm font-bold rounded-xl transition-colors"
                          >
                            로그인 / 회원가입
                          </button>
                        </div>
                      )}

                      {selectedTitle && content && (
                        <SnsCopyPanel
                          title={selectedTitle.title}
                          content={content.body}
                          keyword={keyword}
                        />
                      )}

                      {selectedTitle && content && (
                        <SmsCopyPanel
                          title={selectedTitle.title}
                          content={content.body}
                          keyword={keyword}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <AdBanner side="right" />
        </div>
      </main>

      <footer className="mt-16 border-t border-[#2a2b6e] bg-[#0b0d2b]">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-[10px] text-[#555d8a]">
            본 서비스는 의료광고법(의료법 제56조) 준수를 지원합니다. 최종 광고 심의는 의료광고 심의기관을 통해 확인하시기 바랍니다.
          </p>
          <p className="text-[10px] text-[#555d8a] flex-shrink-0">닥터포스트 © 2026 · Claude AI · 네이버 C-Rank · D.I.A+ 최적화</p>
        </div>
      </footer>
    </div>
  );
}

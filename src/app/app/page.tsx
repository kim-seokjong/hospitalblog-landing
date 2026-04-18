'use client';

import { useState, useEffect, useMemo } from 'react';
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
import type { BlogTitle, BlogContent, GeneratedImage, TagResult, CardNewsData } from '@/types';

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

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
  const [lastImageCount, setLastImageCount] = useState(6);
  const [imageStyle, setImageStyle] = useState<'photo' | 'cardnews' | 'upload'>('cardnews');
  const [cardNewsData, setCardNewsData] = useState<CardNewsData | null>(null);

  const [error, setError] = useState<string | null>(null);

  const handleKeywordSubmit = async (kw: string, ht: string, ai: string) => {
    setKeyword(kw);
    setHospitalType(ht);
    setAdditionalInfo(ai);
    setTitles([]);
    setSelectedTitle(null);
    setContent(null);
    setImages([]);
    setTags(null);
    setError(null);
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
      // 본문 + 태그 병렬 생성
      const [contentRes, tagRes] = await Promise.all([
        fetch('/api/generate-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: selectedTitle.title, keyword, hospitalType, additionalInfo, titleFormat: selectedTitle.seoDetails?.format }),
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
      if (res.ok) setTags(data);
    } catch {
      // 태그 재생성 실패는 무시
    } finally {
      setLoadingTags(false);
    }
  };

  const handleGenerateImages = async (count: number, style?: 'photo' | 'cardnews') => {
    if (!selectedTitle) return;
    setLastImageCount(count);
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
        body: JSON.stringify({
          keyword,
          title: selectedTitle.title,
          body: content.body,
          hospitalType,
        }),
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
    const readers = files.map(file => new Promise<import('@/types').GeneratedImage>(resolve => {
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

  const stepDone = {
    keyword: titles.length > 0,
    title: selectedTitle !== null,
    content: content !== null,
    image: images.length > 0,
  };

  const stepActive = [true, titles.length > 0, selectedTitle !== null, content !== null];

  return (
    <div className="min-h-screen">
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}

      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">병원 블로그 자동화</h1>
              <p className="text-xs text-gray-500">네이버 SEO 최적화 · 의료광고법 준수 · Claude AI · DALL-E 3</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3">
            {[
              { n: 1, label: '키워드', done: stepDone.keyword },
              { n: 2, label: '제목', done: stepDone.title },
              { n: 3, label: '본문', done: stepDone.content },
              { n: 4, label: '이미지', done: stepDone.image },
            ].map(({ n, label, done }, i) => (
              <div key={n} className="flex items-center">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                  done ? 'bg-green-100 text-green-700' :
                  stepActive[n - 1] ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                }`}>
                  <span>{done ? '✓' : n}</span>
                  <span>{label}</span>
                </div>
                {i < 3 && <span className="text-gray-300 mx-1 text-xs">→</span>}
              </div>
            ))}

            {/* 인증 버튼 */}
            {authChecked && (
              user ? (
                <div className="flex items-center gap-2 ml-2">
                  <span className="text-xs text-gray-500 hidden lg:block">{user.email}</span>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    로그아웃
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="ml-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  로그인
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-500 text-xl flex-shrink-0">❌</span>
            <div className="flex-1">
              <p className="font-semibold text-red-800">오류 발생</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xl">×</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽: 입력 영역 */}
          <div className="lg:col-span-1 space-y-6">
            <KeywordInput onSubmit={handleKeywordSubmit} isLoading={loadingTitles} />
            {keyword && <KeywordTrend mainKeyword={keyword} />}
            {keyword && (
              <TitleSelector
                titles={titles}
                selectedTitle={selectedTitle}
                onSelect={setSelectedTitle}
                onGenerate={handleGenerateContent}
                isLoading={loadingContent}
              />
            )}
          </div>

          {/* 중간: 본문 + SEO */}
          <div className="lg:col-span-1 space-y-6">
            {loadingContent && (
              <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 animate-pulse">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gray-200 rounded-xl" />
                  <div className="space-y-2 flex-1">
                    <div className="h-5 bg-gray-200 rounded w-32" />
                    <div className="h-3 bg-gray-200 rounded w-48" />
                  </div>
                </div>
                <div className="space-y-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className={`h-3 bg-gray-200 rounded ${i % 3 === 2 ? 'w-3/4' : 'w-full'}`} />
                  ))}
                </div>
              </div>
            )}

            {content && !loadingContent && (
              <>
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
              </>
            )}
          </div>

          {/* 오른쪽: 미리보기 + 태그 + 이미지 */}
          <div className="lg:col-span-1 space-y-6">
            {selectedTitle && (
              <NaverPreview
                title={selectedTitle.title}
                body={content?.body || ''}
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
              />
            )}

            {cardNewsData && (
              <CardNewsDesigner
                data={cardNewsData}
                keyword={keyword}
              />
            )}

            {user && content && selectedTitle && (
              <NaverPublisher
                title={selectedTitle.title}
                content={content}
                tags={tags}
                images={images}
              />
            )}

            {!user && authChecked && content && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                <p className="text-sm font-semibold text-blue-800 mb-2">발행 도우미는 로그인 후 사용할 수 있습니다</p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl"
                >
                  로그인 / 회원가입
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 빈 상태 */}
        {titles.length === 0 && !loadingTitles && (
          <div className="mt-8 text-center py-16 text-gray-400">
            <div className="text-6xl mb-4">📝</div>
            <p className="text-lg font-semibold text-gray-500">키워드를 입력하여 시작하세요</p>
            <p className="text-sm mt-2 text-gray-400">
              네이버 C-Rank · D.I.A+ 알고리즘 기반 상위노출 최적화 콘텐츠를 자동 생성합니다
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['레이저 토닝', '보톡스 시술', '도수치료', '허리디스크', '임플란트', '라식 수술'].map((kw) => (
                <span key={kw} className="bg-blue-50 text-blue-600 text-sm px-3 py-1.5 rounded-full border border-blue-200">
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-5 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            본 서비스는 의료광고법(의료법 제56조) 준수를 지원합니다. 최종 광고 심의는 의료광고 심의기관을 통해 확인하시기 바랍니다.
          </p>
          <p className="text-xs text-gray-400 flex-shrink-0">Claude AI + DALL-E 3 · 네이버 C-Rank · D.I.A+ 최적화</p>
        </div>
      </footer>
    </div>
  );
}

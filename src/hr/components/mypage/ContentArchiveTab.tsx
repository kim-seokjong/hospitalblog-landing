'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import PostEditor from '@/content/components/PostEditor';
import { publishBlockReason } from '@/content/lib/clinic-site/publish-gate';
import { clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import type { SavedPost } from '@/types';

type FetchState = 'loading' | 'ready' | 'error';
type StatusFilter = 'all' | SavedPost['status'];

const ARCHIVE_MONTHS = 6;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusBadge(status: SavedPost['status']): { text: string; className: string } {
  switch (status) {
    case 'published':
      return { text: '발행됨', className: 'bg-green-50 text-green-700 border border-green-200' };
    case 'scheduled':
      return { text: '예약됨', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
    default:
      return { text: '임시저장', className: 'bg-[#eef2f6] text-[#5b6573] border border-[#b4bfce]' };
  }
}

function siteBadge(targetSite: SavedPost['target_site']): { text: string; className: string } {
  if (targetSite === 'google') {
    return { text: '구글', className: 'bg-blue-50 text-blue-600 border border-blue-200' };
  }
  return { text: '네이버', className: 'bg-green-50 text-green-700 border border-green-200' };
}

/** GEO 발행본 안내 문구 — 버튼 툴팁 공용 */
const GEO_EXPORT_TOOLTIP =
  '네이버 블로그=환자 유입, 홈페이지 발행=AI 검색 인용. 같은 글로 둘 다 준비하세요.';

/**
 * 홈페이지용 HTML(GEO 발행본) 다운로드 가능 여부 — 서버 게이트와 동일 기준.
 * 검수(의료광고법) 통과 글만 허용: 검사 스냅샷 존재 + HIGH/CRITICAL·검수필요 아님.
 */
function geoExportEligibility(post: SavedPost): { ok: boolean; reason: string } {
  const report = post.compliance_report;
  if (!report) {
    return {
      ok: false,
      reason: '의료광고법 검사 기록이 없습니다. 검사 리포트에서 검사를 먼저 완료해주세요.',
    };
  }
  if (report.needsManualReview || report.grade === 'HIGH' || report.grade === 'CRITICAL') {
    return {
      ok: false,
      reason: '의료광고법 검수가 필요한 글입니다. 표현 수정 후 재검사를 통과하면 다운로드할 수 있습니다.',
    };
  }
  return { ok: true, reason: '' };
}

/** 내 블로그 발행 안내 문구 — 버튼 툴팁 공용 */
const SITE_PUBLISH_TOOLTIP =
  '검수 통과 글을 내 병원 공개 블로그({주소}.hospitalblog.kr)에 발행합니다. AI 검색(ChatGPT·Gemini) 인용 대상이 됩니다.';

/**
 * 내 블로그 발행 가능 여부 — 서버 게이트(/api/mypage/site-publish)와 동일 기준.
 * 검수 게이트(publishBlockReason) + 프로필 블로그 주소(site_slug) 설정 여부.
 */
function sitePublishEligibility(
  post: SavedPost,
  siteSlug: string | null,
): { ok: boolean; reason: string } {
  const gateReason = publishBlockReason(post.compliance_report ?? null);
  if (gateReason) return { ok: false, reason: gateReason };
  if (!siteSlug) {
    return { ok: false, reason: '마이페이지 내 정보에서 블로그 주소를 먼저 설정해주세요.' };
  }
  return { ok: true, reason: '' };
}

/** 내 블로그 발행 토글 API 호출 — 실패 시 서버의 한국어 사유를 담아 throw. */
async function toggleSitePublish(postId: string, publish: boolean): Promise<void> {
  const res = await fetch('/api/mypage/site-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, publish }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(json.error ?? '발행 처리에 실패했습니다.');
  }
}

/** GEO 발행본 다운로드 — 실패 시 서버의 한국어 사유를 담아 throw. */
async function downloadGeoExportFile(post: SavedPost): Promise<void> {
  const res = await fetch(`/api/mypage/geo-export?postId=${encodeURIComponent(post.id)}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(json.error ?? '홈페이지용 HTML 다운로드에 실패했습니다.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${post.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'geo-post'}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface DetailModalProps {
  post: SavedPost;
  siteSlug: string | null;
  publishing: boolean;
  onTogglePublish: (post: SavedPost) => void;
  onClose: () => void;
  onEdit: (post: SavedPost) => void;
}

function DetailModal({ post, siteSlug, publishing, onTogglePublish, onClose, onEdit }: DetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const status = statusBadge(post.status);
  const site = siteBadge(post.target_site);
  const geoExport = geoExportEligibility(post);
  const sitePublish = sitePublishEligibility(post, siteSlug);
  const isPublishedToSite = post.published_to_site === true;

  const handleGeoDownload = async () => {
    if (!geoExport.ok || downloading) return;
    setDownloading(true);
    try {
      await downloadGeoExportFile(post);
    } catch (err) {
      alert(err instanceof Error ? err.message : '홈페이지용 HTML 다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(post.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한이 없는 환경 폴백
      const textarea = document.createElement('textarea');
      textarea.value = post.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/80 flex items-start justify-center overflow-y-auto py-4 px-2 sm:px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-modal="true"
      role="dialog"
      aria-label="콘텐츠 상세 보기"
    >
      <div className="relative w-full max-w-3xl bg-white border border-[#b4bfce] rounded-2xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#b4bfce]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.className}`}>{status.text}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>{site.text}</span>
              {post.keyword && <span className="text-xs text-[#ff4628]">#{post.keyword}</span>}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-[#202020] leading-snug">{post.title}</h2>
            <p className="text-xs text-[#5b6573] mt-1">{formatDate(post.published_at ?? post.created_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-[#5b6573] hover:text-[#202020] hover:bg-[#eef2f6] transition-colors"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 본문 전문 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 max-h-[55vh]">
          <pre className="whitespace-pre-wrap break-words text-sm text-[#202020] leading-relaxed font-sans">
            {post.content}
          </pre>
        </div>

        {/* 푸터 */}
        <div className="flex flex-col px-4 sm:px-6 py-4 border-t border-[#b4bfce] gap-2">
          {!geoExport.ok && (
            <p className="text-xs text-[#73808f]" role="note">
              홈페이지용 HTML: {geoExport.reason}
            </p>
          )}
          {!sitePublish.ok && !isPublishedToSite && (
            <p className="text-xs text-[#73808f]" role="note">
              내 블로그 발행: {sitePublish.reason}
            </p>
          )}
          {isPublishedToSite && siteSlug && (
            <p className="text-xs text-green-700" role="note">
              내 블로그에 발행됨 —{' '}
              <a
                href={clinicSiteUrl(siteSlug, `/posts/${post.id}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-green-800"
              >
                {clinicSiteUrl(siteSlug, `/posts/${post.id}`)}
              </a>
            </p>
          )}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => onTogglePublish(post)}
            disabled={publishing || (!isPublishedToSite && !sitePublish.ok)}
            title={isPublishedToSite ? '내 블로그에서 이 글을 내립니다.' : (sitePublish.ok ? SITE_PUBLISH_TOOLTIP : sitePublish.reason)}
            className="px-4 py-2.5 text-sm font-semibold text-[#4a4f55] border border-[#b4bfce] hover:bg-[#eef2f6] rounded-lg transition-colors disabled:text-[#b4bfce] disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            {publishing ? '처리 중...' : (isPublishedToSite ? '내 블로그 발행 취소' : '내 블로그에 발행')}
          </button>
          <button
            type="button"
            onClick={() => void handleGeoDownload()}
            disabled={!geoExport.ok || downloading}
            title={geoExport.ok ? GEO_EXPORT_TOOLTIP : geoExport.reason}
            className="px-4 py-2.5 text-sm font-semibold text-[#4a4f55] border border-[#b4bfce] hover:bg-[#eef2f6] rounded-lg transition-colors disabled:text-[#b4bfce] disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            {downloading ? '다운로드 중...' : '홈페이지용 HTML'}
          </button>
          <a
            href={`/app/report/${post.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 text-center text-sm font-semibold text-[#4a4f55] border border-[#b4bfce] hover:bg-[#eef2f6] rounded-lg transition-colors"
          >
            검사 리포트
          </a>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-[#ff4628] hover:bg-[#e63a1c] text-white'
            }`}
          >
            {copied ? '복사됨 ✓' : '본문 복사'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(post)}
            className="px-4 py-2.5 text-sm font-semibold text-[#4a4f55] border border-[#b4bfce] hover:bg-[#eef2f6] rounded-lg transition-colors"
          >
            수정하기
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 마이페이지 — 콘텐츠 보관함 탭.
 * 기존 /history 페이지 기능 통합: 최근 6개월 목록 + 검색 + 상세(전문·복사) + 수정·삭제.
 * 목록은 기존 /api/posts 사용 (RLS + user_id 필터로 본인 글만).
 */
export default function ContentArchiveTab() {
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailPost, setDetailPost] = useState<SavedPost | null>(null);
  const [editingPost, setEditingPost] = useState<SavedPost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [geoDownloadingId, setGeoDownloadingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [siteSlug, setSiteSlug] = useState<string | null>(null);

  // 내 블로그 주소(site_slug) — 발행 버튼 활성/공개 URL 표시용 (실패해도 목록은 정상)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/profile');
        if (!res.ok) return;
        const json = await res.json() as { profile?: { site_slug?: string | null } };
        const slug = json.profile?.site_slug;
        if (!cancelled && typeof slug === 'string' && slug.trim() !== '') {
          setSiteSlug(slug.trim());
        }
      } catch {
        // 조회 실패 시 미설정으로 간주 — 서버 게이트가 최종 방어
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadPosts = useCallback(async () => {
    setFetchState('loading');
    setFetchError('');
    try {
      const res = await fetch('/api/posts');
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '목록을 불러오지 못했습니다.');
      }
      const json = await res.json() as { posts: SavedPost[] | null };
      setPosts(json.posts ?? []);
      setFetchState('ready');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.');
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  // 최근 6개월 + 검색 + 상태 필터
  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS);
    const q = search.trim().toLowerCase();

    return posts.filter((p) => {
      if (new Date(p.created_at) < cutoff) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const inTitle = p.title.toLowerCase().includes(q);
      const inKeyword = (p.keyword ?? '').toLowerCase().includes(q);
      return inTitle || inKeyword;
    });
  }, [posts, search, statusFilter]);

  const handleEditSave = useCallback((updated: Partial<SavedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setDetailPost((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setEditingPost(null);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const confirmed = window.confirm('이 글을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.');
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? '삭제에 실패했습니다.');
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setDetailPost((prev) => (prev && prev.id === id ? null : prev));
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleGeoDownload = useCallback(async (post: SavedPost) => {
    setGeoDownloadingId(post.id);
    try {
      await downloadGeoExportFile(post);
    } catch (err) {
      alert(err instanceof Error ? err.message : '홈페이지용 HTML 다운로드에 실패했습니다.');
    } finally {
      setGeoDownloadingId(null);
    }
  }, []);

  const handleTogglePublish = useCallback(async (post: SavedPost) => {
    const publish = post.published_to_site !== true;
    setPublishingId(post.id);
    try {
      await toggleSitePublish(post.id, publish);
      const patch: Partial<SavedPost> = {
        published_to_site: publish,
        site_published_at: publish ? new Date().toISOString() : null,
      };
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, ...patch } : p)));
      setDetailPost((prev) => (prev && prev.id === post.id ? { ...prev, ...patch } : prev));
    } catch (err) {
      alert(err instanceof Error ? err.message : '발행 처리에 실패했습니다.');
    } finally {
      setPublishingId(null);
    }
  }, []);

  return (
    <div>
      {/* 에디터 모달 (수정) */}
      {editingPost && (
        <PostEditor
          post={editingPost}
          onSave={handleEditSave}
          onClose={() => setEditingPost(null)}
        />
      )}

      {/* 상세 보기 모달 */}
      {detailPost && !editingPost && (
        <DetailModal
          post={detailPost}
          siteSlug={siteSlug}
          publishing={publishingId === detailPost.id}
          onTogglePublish={(p) => void handleTogglePublish(p)}
          onClose={() => setDetailPost(null)}
          onEdit={(p) => setEditingPost(p)}
        />
      )}

      {/* 검색 + 필터 */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목·키워드 검색"
          className="flex-1 bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm placeholder-[#5b6573] focus:outline-none focus:border-[#ff4628] transition-colors"
          aria-label="제목 또는 키워드 검색"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-white border border-[#b4bfce] rounded-lg px-3 py-2.5 text-[#202020] text-sm focus:outline-none focus:border-[#ff4628] transition-colors appearance-none sm:w-36"
          aria-label="상태 필터"
        >
          <option value="all" className="bg-white text-[#202020]">전체 상태</option>
          <option value="published" className="bg-white text-[#202020]">발행됨</option>
          <option value="scheduled" className="bg-white text-[#202020]">예약됨</option>
          <option value="draft" className="bg-white text-[#202020]">임시저장</option>
        </select>
      </div>

      {/* 로딩 */}
      {fetchState === 'loading' && (
        <div className="py-16 text-center text-[#5b6573] text-sm">콘텐츠를 불러오는 중...</div>
      )}

      {/* 에러 */}
      {fetchState === 'error' && (
        <div className="py-16 text-center">
          <p className="text-red-600 text-sm mb-4">{fetchError}</p>
          <button
            type="button"
            onClick={() => void loadPosts()}
            className="px-4 py-2 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 빈 상태 */}
      {fetchState === 'ready' && filtered.length === 0 && (
        <div className="py-16 text-center bg-white border border-[#b4bfce] rounded-xl shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
          <p className="text-[#202020] font-semibold mb-1">
            {posts.length === 0 ? '아직 저장된 글이 없습니다' : '조건에 맞는 글이 없습니다'}
          </p>
          <p className="text-sm text-[#5b6573] mb-4">
            {posts.length === 0
              ? '글을 작성한 후 저장함에 보관해보세요. (최근 6개월 콘텐츠가 표시됩니다)'
              : '검색어나 상태 필터를 변경해보세요.'}
          </p>
          {posts.length === 0 && (
            <a
              href="/app"
              className="inline-block px-5 py-2.5 bg-[#ff4628] hover:bg-[#e63a1c] text-white text-sm font-semibold rounded-xl transition-colors"
            >
              글 작성하러 가기
            </a>
          )}
        </div>
      )}

      {/* 목록 */}
      {fetchState === 'ready' && filtered.length > 0 && (
        <>
          <p className="text-xs text-[#5b6573] mb-3">최근 6개월 · {filtered.length}편</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((post) => {
              const status = statusBadge(post.status);
              const site = siteBadge(post.target_site);
              return (
                <div
                  key={post.id}
                  className="relative bg-white border border-[#b4bfce] rounded-xl p-4 hover:border-[#ff4628]/40 transition-colors cursor-pointer group shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
                  onClick={() => setDetailPost(post)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDetailPost(post); }}
                  aria-label={`${post.title} 상세 보기`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.className}`}>
                        {status.text}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.className}`}>
                        {site.text}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(post.id); }}
                      disabled={deletingId === post.id}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[#73808f] hover:text-red-600 disabled:text-[#b4bfce] text-xs transition-all px-2 py-1 rounded-lg hover:bg-red-50 disabled:cursor-not-allowed flex-shrink-0"
                      aria-label="글 삭제"
                    >
                      {deletingId === post.id ? '삭제 중...' : '삭제'}
                    </button>
                  </div>

                  <h3 className="font-semibold text-[#202020] text-sm leading-snug mb-2 line-clamp-2">
                    {post.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#5b6573]">
                    {post.keyword && <span className="text-[#ff4628]">#{post.keyword}</span>}
                    <span>{formatDate(post.published_at ?? post.created_at)}</span>
                    <a
                      href={`/app/report/${post.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[#5b6573] hover:text-[#ff4628] underline underline-offset-2 transition-colors"
                      aria-label={`${post.title} 검사 리포트 새 탭에서 열기`}
                    >
                      검사 리포트
                    </a>
                    {(() => {
                      const geoExport = geoExportEligibility(post);
                      if (!geoExport.ok) {
                        return (
                          <span
                            title={geoExport.reason}
                            className="text-[#b4bfce] cursor-not-allowed underline underline-offset-2"
                            aria-disabled="true"
                          >
                            홈페이지 HTML
                          </span>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleGeoDownload(post); }}
                          disabled={geoDownloadingId === post.id}
                          title={GEO_EXPORT_TOOLTIP}
                          className="text-[#5b6573] hover:text-[#ff4628] disabled:text-[#b4bfce] underline underline-offset-2 transition-colors"
                          aria-label={`${post.title} 홈페이지용 HTML 다운로드`}
                        >
                          {geoDownloadingId === post.id ? '다운로드 중...' : '홈페이지 HTML'}
                        </button>
                      );
                    })()}
                    {(() => {
                      const isPublished = post.published_to_site === true;
                      if (isPublished) {
                        return (
                          <>
                            {siteSlug && (
                              <a
                                href={clinicSiteUrl(siteSlug, `/posts/${post.id}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-green-700 hover:text-green-800 underline underline-offset-2 transition-colors"
                                aria-label={`${post.title} 내 블로그에서 열기`}
                              >
                                내 블로그 발행됨 ↗
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void handleTogglePublish(post); }}
                              disabled={publishingId === post.id}
                              title="내 블로그에서 이 글을 내립니다."
                              className="text-[#5b6573] hover:text-[#ff4628] disabled:text-[#b4bfce] underline underline-offset-2 transition-colors"
                              aria-label={`${post.title} 내 블로그 발행 취소`}
                            >
                              {publishingId === post.id ? '처리 중...' : '발행 취소'}
                            </button>
                          </>
                        );
                      }
                      const sitePublish = sitePublishEligibility(post, siteSlug);
                      if (!sitePublish.ok) {
                        return (
                          <span
                            title={sitePublish.reason}
                            className="text-[#b4bfce] cursor-not-allowed underline underline-offset-2"
                            aria-disabled="true"
                          >
                            내 블로그 발행
                          </span>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleTogglePublish(post); }}
                          disabled={publishingId === post.id}
                          title={SITE_PUBLISH_TOOLTIP}
                          className="text-[#5b6573] hover:text-[#ff4628] disabled:text-[#b4bfce] underline underline-offset-2 transition-colors"
                          aria-label={`${post.title} 내 블로그에 발행`}
                        >
                          {publishingId === post.id ? '처리 중...' : '내 블로그 발행'}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

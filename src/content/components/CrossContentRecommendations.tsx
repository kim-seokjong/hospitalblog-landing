'use client';

/**
 * 크로스 콘텐츠 추천 카드 — 블로그 ↔ 영상 선순환 루프.
 *
 * - 영상화 추천: 상위 노출 / 최근 발행 글 → [영상 만들기] → 해당 글이 선택된 멀티채널 변환으로 이동
 *   (번들 미보유 회원은 추천은 보여주되 버튼이 올인원 업그레이드 안내)
 * - 후속 글 추천: 영상으로 다룬 주제 → [이 주제로 글쓰기] → 키워드 프리필
 * - 추천이 없으면 렌더하지 않음 (빈 상태로 자리 차지 금지)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  ToVideoRecommendation,
  ToBlogRecommendation,
} from '@/content/lib/cross-content';
import {
  MULTICHANNEL_SRC_KEY,
  encodeMultichannelSrc,
} from '@/content/lib/multichannel-src';

interface ApiResponse {
  toVideo?: ToVideoRecommendation[];
  toBlog?: ToBlogRecommendation[];
  bundleGated?: boolean;
  noPublishedPosts?: boolean;
}

interface Props {
  /** [이 주제로 글쓰기] — 키워드 입력란 프리필 (경쟁분석·갭 제안과 동일 패턴) */
  onSelectKeyword: (keyword: string) => void;
}

export default function CrossContentRecommendations({ onSelectKeyword }: Props) {
  const router = useRouter();
  const [toVideo, setToVideo] = useState<ToVideoRecommendation[]>([]);
  const [toBlog, setToBlog] = useState<ToBlogRecommendation[]>([]);
  const [bundleGated, setBundleGated] = useState(false);
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recommendations/cross-content')
      .then(async (res) => {
        if (!res.ok) throw new Error('추천 조회 실패');
        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setToVideo(Array.isArray(data.toVideo) ? data.toVideo : []);
        setToBlog(Array.isArray(data.toBlog) ? data.toBlog : []);
        setBundleGated(data.bundleGated === true);
      })
      .catch(() => {
        // 부가 기능 — 실패 시 조용히 숨김 (생성 플로우 방해 금지)
        if (!cancelled) {
          setToVideo([]);
          setToBlog([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** [영상 만들기] — 글 본문을 불러와 멀티채널 변환 소스로 넘긴다 */
  const handleMakeVideo = async (postId: string) => {
    setActionError(null);
    setLoadingPostId(postId);
    try {
      const res = await fetch(`/api/posts/${postId}`);
      if (!res.ok) throw new Error('글을 불러오지 못했습니다.');
      const data = (await res.json()) as { post?: { title?: string; content?: string } };
      const title = data.post?.title ?? '';
      const content = data.post?.content ?? '';
      if (!content.trim()) throw new Error('글 본문이 비어 있습니다.');
      // postId 동반 v2 포맷 — 변환 이력에 원본 글이 연결돼 같은 글 재추천을 막는다 (마이그 038)
      sessionStorage.setItem(
        MULTICHANNEL_SRC_KEY,
        encodeMultichannelSrc({ text: `${title}\n\n${content}`.trim(), postId }),
      );
      router.push('/app/multichannel');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '이동에 실패했습니다.');
      setLoadingPostId(null);
    }
  };

  if (toVideo.length === 0 && toBlog.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#b4bfce] bg-white p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🔁</span>
        <h3 className="text-sm font-bold text-[#202020]">크로스 콘텐츠 추천</h3>
        <span className="text-[10px] font-semibold text-[#ff4628] bg-[#ffece7] border border-[#ff4628]/30 px-2 py-0.5 rounded-full">
          블로그 ↔ 영상
        </span>
      </div>
      <p className="text-[11px] text-[#5b6573] mb-3">
        잘 되는 글은 영상으로, 영상으로 다룬 주제는 후속 글로 — 검색과 인식 채널을 함께 키워보세요.
      </p>

      {actionError && (
        <p className="mb-3 text-xs text-[#ff4628] font-medium">{actionError}</p>
      )}

      <div className="space-y-2.5">
        {/* 영상화 추천 */}
        {toVideo.map((item) => (
          <div
            key={item.postId}
            className="rounded-xl border border-[#dfe6ee] bg-[#f7f9fc] px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.latestRank !== null && (
                  <span className="text-[10px] font-bold text-white bg-[#ff4628] px-1.5 py-0.5 rounded">
                    검색 {item.latestRank}위
                  </span>
                )}
                <p className="text-xs font-semibold text-[#202020] truncate">{item.title}</p>
              </div>
              <p className="text-[11px] text-[#5b6573] mt-1 leading-relaxed">{item.reason}</p>
              {bundleGated && (
                <p className="text-[11px] text-[#ff4628] font-medium mt-1">
                  이 글, 영상이 되면 검색 밖 인식 채널까지 잡습니다.
                </p>
              )}
            </div>
            {bundleGated ? (
              <Link
                href="/pricing"
                className="flex-shrink-0 self-start sm:self-center px-3 py-2 rounded-lg bg-white border border-[#ff4628]/40 text-[#ff4628] text-xs font-bold hover:bg-[#ffece7] transition-colors text-center"
              >
                🚀 올인원으로 영상 만들기
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void handleMakeVideo(item.postId)}
                disabled={loadingPostId !== null}
                className="flex-shrink-0 self-start sm:self-center px-3 py-2 rounded-lg bg-[#ff4628] hover:bg-[#e63a1c] disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                {loadingPostId === item.postId ? '여는 중…' : '🎬 영상 만들기'}
              </button>
            )}
          </div>
        ))}

        {/* 후속 글 추천 */}
        {toBlog.map((item) => (
          <div
            key={item.conversionId}
            className="rounded-xl border border-[#dfe6ee] bg-[#f7f9fc] px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-[#1c7c3d] bg-[#eafaf0] border border-[#c9ead2] px-1.5 py-0.5 rounded">
                  영상 후속
                </span>
                <p className="text-xs font-semibold text-[#202020] truncate">{item.suggestedKeyword}</p>
              </div>
              <p className="text-[11px] text-[#5b6573] mt-1 leading-relaxed">{item.reason}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelectKeyword(item.suggestedKeyword)}
              className="flex-shrink-0 self-start sm:self-center px-3 py-2 rounded-lg bg-white border border-[#b4bfce] text-[#202020] text-xs font-bold hover:border-[#ff4628] hover:bg-[#ffece7] transition-colors"
            >
              ✍️ 이 주제로 글쓰기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

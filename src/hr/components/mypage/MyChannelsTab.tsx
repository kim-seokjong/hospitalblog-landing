'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  MyChannelsData,
  NaverChannelView,
  SocialChannelView,
  YoutubeChannelView,
} from '@/content/lib/scoreboard/my-channels';

/**
 * 마이페이지 — 내 채널 성과 탭.
 *
 * 프로필에 등록한 자사 채널(인스타·쓰레드·유튜브·네이버 블로그)의 공개 사실 지표를
 * 카드 그리드로 보여준다. 경쟁 종합 비교 스코어보드와 동일한 수집기·레이아웃을 재사용한다.
 *
 * 컴플라이언스(회사 규칙): 매출·방문자수 추정치는 절대 표시하지 않는다.
 * 도달·참여·발행량 등 공개 사실 지표만 표시하며, 채널 간 우열 평가를 하지 않는다.
 * 순위·AI 검색(GEO)은 별도 탭으로 안내(중복 구현 금지).
 */

type FetchState = 'loading' | 'ready' | 'error';

const PROFILE_DEEPLINK = '/mypage?tab=profile';

function fmt(n: number | null): string {
  return n === null ? '-' : n.toLocaleString('ko-KR');
}

/** 미등록 채널 안내 — 프로필 딥링크. */
function NotConfigured() {
  return (
    <div className="bg-[#eef2f6] rounded-xl px-4 py-5 text-center">
      <p className="text-xs text-[#73808f] leading-relaxed">
        프로필에서 핸들을 등록하면 표시됩니다.
      </p>
      <a
        href={PROFILE_DEEPLINK}
        className="inline-block mt-2 text-xs font-semibold text-[#ff4628] underline underline-offset-2 hover:text-[#e63a1c]"
      >
        내 정보에서 등록하기 →
      </a>
    </div>
  );
}

/** 확인 불가 안내(입력은 있으나 조회 실패). */
function Unavailable() {
  return (
    <div className="bg-[#eef2f6] rounded-xl px-4 py-5 text-center">
      <p className="text-[11px] text-[#73808f] leading-relaxed">
        일시적으로 확인이 어렵습니다 (비공개 계정이거나 외부 사정으로 접근이 제한될 수 있습니다).
      </p>
    </div>
  );
}

interface CardShellProps {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function CardShell({ icon, title, subtitle, children }: CardShellProps) {
  return (
    <div className="bg-white border border-[#b4bfce] rounded-2xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#ffece7] flex items-center justify-center flex-shrink-0">
          <span className="text-sm">{icon}</span>
        </div>
        <h3 className="text-sm font-bold text-[#202020]">{title}</h3>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

/** 지표 한 줄 (라벨 + 값) */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-[#eef2f6] rounded-xl px-4 py-3 min-h-[44px]">
      <span className="text-xs text-[#5b6573]">{label}</span>
      <span className="text-sm font-bold text-[#202020]">{value}</span>
    </div>
  );
}

function SocialCard({ icon, title, view }: { icon: string; title: string; view: SocialChannelView }) {
  return (
    <CardShell
      icon={icon}
      title={title}
      subtitle={view.handle ? `@${view.handle}` : '공개 프로필의 팔로워·게시물 수'}
    >
      {view.status === 'not_configured' && <NotConfigured />}
      {view.status === 'unavailable' && <Unavailable />}
      {view.status === 'ok' && (
        <div className="space-y-2">
          <Metric label="팔로워" value={fmt(view.followers)} />
          <Metric label="게시물" value={fmt(view.posts)} />
        </div>
      )}
    </CardShell>
  );
}

function YoutubeCard({ view }: { view: YoutubeChannelView }) {
  return (
    <CardShell
      icon="▶️"
      title="유튜브"
      subtitle={view.title ? view.title : '공개 채널의 구독자·조회수·업로드 빈도'}
    >
      {view.status === 'not_configured' && <NotConfigured />}
      {view.status === 'unavailable' && <Unavailable />}
      {view.status === 'ok' && (
        <div className="space-y-2">
          <Metric
            label="구독자"
            value={view.subscriberCount === null ? '비공개' : fmt(view.subscriberCount)}
          />
          <Metric label="총 조회수" value={fmt(view.viewCount)} />
          <Metric label="영상 수" value={fmt(view.videoCount)} />
          <Metric
            label="최근 업로드"
            value={
              view.uploadsPerWeek === null
                ? '-'
                : `주 ${view.uploadsPerWeek}회 (30일 ${fmt(view.uploadsIn30Days)}건)`
            }
          />
        </div>
      )}
    </CardShell>
  );
}

function NaverCard({ view }: { view: NaverChannelView }) {
  return (
    <CardShell
      icon="📝"
      title="네이버 블로그"
      subtitle={view.blogId ? view.blogId : '공개 블로그의 최근 30일 발행 빈도'}
    >
      {view.status === 'not_configured' && <NotConfigured />}
      {view.status === 'unavailable' && <Unavailable />}
      {view.status === 'ok' && (
        <div className="space-y-2">
          <Metric
            label="발행 빈도"
            value={`주 ${view.perWeek ?? 0}회`}
          />
          <Metric label="최근 30일" value={`${fmt(view.postsIn30Days)}건`} />
        </div>
      )}
    </CardShell>
  );
}

export default function MyChannelsTab() {
  const [state, setState] = useState<FetchState>('loading');
  const [data, setData] = useState<MyChannelsData | null>(null);
  const [error, setError] = useState<string>('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/mypage/my-channels');
      const json = (await res.json()) as { success?: boolean; data?: MyChannelsData; error?: string };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? '채널 지표를 불러오지 못했습니다.');
      }
      setData(json.data);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : '채널 지표를 불러오지 못했습니다.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="내 채널 성과">
      <div className="flex items-center gap-2 mb-4 mt-1">
        <h2 className="text-base sm:text-lg font-extrabold text-[#202020]">내 채널 성과</h2>
        <span className="text-[10px] font-semibold text-[#5b6573] bg-[#eef2f6] border border-[#b4bfce] px-2 py-0.5 rounded-full">
          공개 수치 기준
        </span>
      </div>
      <p className="text-[11px] text-[#73808f] mb-4 leading-relaxed">
        프로필에 등록한 자사 채널의 공개 사실 지표(도달·참여·발행량)만 표시합니다. 매출·방문자수 추정치는 제공하지 않으며, 일부 지표는 외부 사정에 따라 일시적으로 확인이 어려울 수 있습니다.
        검색 순위와 AI 검색 노출은{' '}
        <a href="/mypage?tab=rankings" className="text-[#ff4628] underline underline-offset-2 hover:text-[#e63a1c]">성과 리포트</a>
        {' · '}
        <a href="/mypage?tab=geo" className="text-[#ff4628] underline underline-offset-2 hover:text-[#e63a1c]">AI 검색</a>
        {' 탭에서 확인하세요.'}
      </p>

      {state === 'loading' && (
        <div className="py-16 text-center text-[#5b6573] text-sm">채널 지표를 불러오는 중...</div>
      )}

      {state === 'error' && (
        <div className="bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-4">
          <p className="text-sm text-yellow-700 mb-3">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 bg-[#ff4628] text-white rounded-lg text-xs font-semibold hover:bg-[#e63a1c] transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {state === 'ready' && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          <SocialCard icon="📸" title="인스타그램" view={data.instagram} />
          <SocialCard icon="🧵" title="쓰레드" view={data.threads} />
          <YoutubeCard view={data.youtube} />
          <NaverCard view={data.naver} />
        </div>
      )}
    </section>
  );
}

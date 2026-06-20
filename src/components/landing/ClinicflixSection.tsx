'use client';

import { useState } from 'react';
import sampleText from '../../../public/clinicflix-samples/sample-text.json';

/**
 * ClinicflixSection — 닥터포스트 랜딩 내 "클리닉픽스" 상세 쇼케이스 섹션.
 *
 * 블로그 1편 → 영상·카드뉴스·스토리·쓰레드·인스타 피드 멀티채널 산출물을
 * 실제 생성 샘플(public/clinicflix-samples/)로 보여주는 마케팅 섹션이다.
 *
 * 컴플라이언스: 콘텐츠는 "자동 제작/생성"만 한다 (자동 발행 아님).
 * 과장·효과 단정·전후 비교·수치 보장 표현은 사용하지 않는다.
 *
 * plans.ts 는 읽기 전용으로만 소비한다 (가격 하드코딩 금지).
 */

const ACCENT = '#ff4628';

const SAMPLE_BASE = '/clinicflix-samples';

interface SampleText {
  topic: string;
  hospital: string;
  threads: {
    posts: string[];
    hashtags: string[];
  };
  feed: {
    caption: string;
    hashtags: string[];
  };
}

const sample: SampleText = sampleText as SampleText;

const CARDNEWS_IMAGES = [
  `${SAMPLE_BASE}/cardnews-1.png`,
  `${SAMPLE_BASE}/cardnews-2.png`,
  `${SAMPLE_BASE}/cardnews-3.png`,
];

const OUTPUT_KINDS = [
  { icon: '🎬', label: '영상(쇼츠)' },
  { icon: '🗂️', label: '카드뉴스' },
  { icon: '📲', label: '스토리' },
  { icon: '💬', label: '쓰레드' },
  { icon: '📸', label: '인스타 피드' },
];

const STEPS = [
  { step: '1', title: '기획', desc: '블로그 주제·핵심 메시지를 채널별 형식에 맞게 자동 재구성해요.' },
  { step: '2', title: '제작', desc: '영상·카드뉴스·스토리·쓰레드·피드를 한 번에 자동 생성해요.' },
  { step: '3', title: '검수', desc: '의료광고법 검수를 내장해 과장·단정 표현을 자동 점검해요.' },
  { step: '4', title: '다운로드', desc: '완성된 콘텐츠를 받아 원하는 채널에 직접 올리면 끝이에요.' },
];

interface ClinicflixSectionProps {
  /** 가입/문의 CTA (랜딩의 기존 패턴 재사용) */
  onCtaClick: () => void;
}

export default function ClinicflixSection({ onCtaClick }: ClinicflixSectionProps) {
  return (
    <section id="clinicflix" className="py-16 sm:py-[84px] bg-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        {/* ── Hero / intro ── */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 bg-[#fff6f4] border border-[#ffece7] text-[#202020] font-bold text-[12px] sm:text-[13px] px-4 py-1.5 rounded-full">
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: ACCENT }} />
            닥터포스트 × 클리닉픽스 · 멀티채널 콘텐츠 자동 제작
          </span>
          <h2
            className="text-[28px] sm:text-4xl md:text-[44px] font-black text-[#202020] mt-5 leading-[1.18]"
            style={{ letterSpacing: '-0.5px' }}
          >
            <span className="block">블로그 1편이</span>
            <span className="block mt-3 sm:mt-4">
              <span style={{ color: ACCENT }}>영상·카드뉴스·스토리·쓰레드·인스타</span>와 같이 됩니다
            </span>
          </h2>
          <p className="text-base sm:text-lg text-[#4a4f55] max-w-2xl mx-auto mt-5 leading-relaxed">
            닥터포스트로 쓴 블로그 한 편을, 클리닉픽스가 5종 멀티채널 콘텐츠로 자동 제작해드려요.
            <br className="hidden sm:block" />
            채널마다 따로 만들 필요 없이, 원소스 하나로 끝납니다.
          </p>

          {/* 산출물 5종 칩 */}
          <div className="flex flex-wrap justify-center gap-2.5 mt-7">
            {OUTPUT_KINDS.map(({ icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 bg-white border border-[#dbe2ea] text-[#202020] text-[13px] font-bold px-3.5 py-2 rounded-full shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
              >
                <span>{icon}</span>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── How it works ── */}
        <div className="mt-14 sm:mt-16">
          <p className="text-center text-[13px] font-extrabold tracking-[2px] uppercase" style={{ color: ACCENT }}>
            How it works
          </p>
          <h3 className="text-center text-[22px] sm:text-3xl font-black text-[#202020] mt-2 leading-tight">
            원소스 1개 → 멀티채널 산출물
          </h3>
          <p className="text-center text-[#4a4f55] mt-3 text-sm sm:text-base">
            기획부터 검수까지, 의료광고법 검수를 내장한 채로 자동 진행돼요.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-9">
            {STEPS.map(({ step, title, desc }) => (
              <div
                key={step}
                className="bg-white border border-[#dbe2ea] rounded-2xl p-6 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-extrabold mb-4 text-white"
                  style={{ background: ACCENT }}
                >
                  {step}
                </div>
                <h4 className="font-extrabold text-[#202020] text-lg mb-2">{title}</h4>
                <p className="text-sm text-[#4a4f55] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Live sample showcase ── */}
        <div className="mt-16 sm:mt-20">
          <p className="text-center text-[13px] font-extrabold tracking-[2px] uppercase" style={{ color: ACCENT }}>
            Live sample
          </p>
          <h3 className="text-center text-[22px] sm:text-3xl font-black text-[#202020] mt-2 leading-tight">
            이 블로그 1편으로 만든 결과물
          </h3>
          <p className="text-center text-[#4a4f55] mt-3 text-sm sm:text-base">
            예시 주제 <b className="text-[#202020]">‘{sample.topic}’</b> · 예시 병원 {sample.hospital} · 실제 생성 샘플입니다.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-10 items-start">
            {/* 영상 */}
            <SampleVideo />

            {/* 카드뉴스 캐러셀 */}
            <CardnewsCarousel />

            {/* 쓰레드 */}
            <ThreadsSample posts={sample.threads.posts} hashtags={sample.threads.hashtags} />

            {/* 인스타 피드 캡션 */}
            <InstagramCaption
              hospital={sample.hospital}
              caption={sample.feed.caption}
              hashtags={sample.feed.hashtags}
            />
          </div>

          <p className="mt-6 text-center text-xs text-[#8a93a0] leading-relaxed">
            * 위 콘텐츠는 클리닉픽스가 실제 생성한 샘플입니다. 영상·이미지는 AI로 제작되었으며,
            완성된 콘텐츠는 다운로드 후 직접 게시합니다. (자동 발행 기능 아님)
          </p>
        </div>

        {/* ── CTA ── */}
        <div className="mt-16 sm:mt-20 text-center bg-[#eef2f6] border border-[#dbe2ea] rounded-3xl px-6 py-12 sm:py-14">
          <h3 className="text-[24px] sm:text-3xl font-black text-[#202020]" style={{ letterSpacing: '-0.5px' }}>
            블로그 한 편으로 멀티채널까지, 한 번에
          </h3>
          <p className="text-[#4a4f55] mt-3 text-sm sm:text-base">
            닥터포스트 + 클리닉픽스로 병원 콘텐츠 제작을 자동화해보세요.
          </p>
          <button
            onClick={onCtaClick}
            className="mt-7 px-9 sm:px-10 py-3.5 sm:py-4 text-white font-bold text-base sm:text-lg rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.40)] hover:brightness-105 hover:-translate-y-0.5"
            style={{ backgroundImage: `linear-gradient(135deg, ${ACCENT}, #e63a1c)` }}
          >
            시작하기 →
          </button>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── 하위 컴포넌트 ────────────────────────── */

function SampleVideo() {
  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎬</span>
        <span className="font-extrabold text-[#202020]">영상(쇼츠)</span>
        <span className="ml-auto text-[11px] font-bold text-[#8a93a0] bg-[#eef2f6] px-2 py-1 rounded-md">
          9:16 · AI 생성 영상
        </span>
      </figcaption>
      <div className="mx-auto w-full max-w-[280px] rounded-xl overflow-hidden border border-[#dbe2ea] bg-black">
        <video
          src={`${SAMPLE_BASE}/sample-video.mp4`}
          controls
          playsInline
          preload="none"
          className="w-full aspect-[9/16] object-cover"
        />
      </div>
      <p className="mt-3 text-center text-xs text-[#8a93a0]">
        한국어 내레이션 포함 · 소리를 켜고 재생해보세요
      </p>
    </figure>
  );
}

function CardnewsCarousel() {
  const [active, setActive] = useState(0);
  const total = CARDNEWS_IMAGES.length;

  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">🗂️</span>
        <span className="font-extrabold text-[#202020]">카드뉴스</span>
        <span className="ml-auto text-[11px] font-bold text-[#8a93a0] bg-[#eef2f6] px-2 py-1 rounded-md">
          9:16 · 슬라이드 {total}장
        </span>
      </figcaption>

      {/* 가로 스크롤 스냅 캐러셀 (모바일 친화) */}
      <div
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / (el.scrollWidth / total));
          setActive(Math.min(total - 1, Math.max(0, idx)));
        }}
      >
        {CARDNEWS_IMAGES.map((src, i) => (
          <div
            key={src}
            className="snap-center shrink-0 w-[160px] sm:w-[180px] rounded-xl overflow-hidden border border-[#dbe2ea] bg-[#eef2f6]"
          >
            {/* next/image 미사용 리포지토리이므로 native img + lazy load 사용 (PNG ~1.7MB) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`카드뉴스 슬라이드 ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="w-full aspect-[9/16] object-cover"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-2">
        {CARDNEWS_IMAGES.map((src, i) => (
          <span
            key={src}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === active ? 18 : 6,
              background: i === active ? ACCENT : '#dbe2ea',
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-[#8a93a0]">옆으로 넘겨보세요</p>
    </figure>
  );
}

interface ThreadsSampleProps {
  posts: string[];
  hashtags: string[];
}

function ThreadsSample({ posts, hashtags }: ThreadsSampleProps) {
  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">💬</span>
        <span className="font-extrabold text-[#202020]">쓰레드</span>
        <span className="ml-auto text-[11px] font-bold text-[#8a93a0] bg-[#eef2f6] px-2 py-1 rounded-md">
          {posts.length}개 글
        </span>
      </figcaption>

      <div className="space-y-3">
        {posts.map((post, i) => (
          <div key={i} className="flex gap-2.5">
            <div
              className="flex-none w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold"
              style={{ background: ACCENT }}
            >
              {i + 1}
            </div>
            <div className="flex-1 bg-[#f5f7fa] border border-[#e6ebf1] rounded-2xl rounded-tl-md px-4 py-3">
              <p className="text-sm text-[#202020] leading-relaxed whitespace-pre-line">{post}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4 pl-[42px]">
        {hashtags.map((tag) => (
          <span key={tag} className="text-xs font-semibold" style={{ color: ACCENT }}>
            {tag}
          </span>
        ))}
      </div>
    </figure>
  );
}

interface InstagramCaptionProps {
  hospital: string;
  caption: string;
  hashtags: string[];
}

function InstagramCaption({ hospital, caption, hashtags }: InstagramCaptionProps) {
  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)]">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">📸</span>
        <span className="font-extrabold text-[#202020]">인스타 피드 캡션</span>
        <span className="ml-auto text-[11px] font-bold text-[#8a93a0] bg-[#eef2f6] px-2 py-1 rounded-md">
          캡션 + 해시태그
        </span>
      </figcaption>

      <div className="border border-[#e6ebf1] rounded-2xl overflow-hidden">
        {/* 인스타 헤더 모사 */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#e6ebf1]">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold"
            style={{ background: ACCENT }}
          >
            {hospital.slice(0, 1)}
          </div>
          <span className="font-bold text-sm text-[#202020]">{hospital}</span>
        </div>
        <div className="px-4 py-4 max-h-[320px] overflow-y-auto">
          <p className="text-sm text-[#202020] leading-relaxed whitespace-pre-line">{caption}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {hashtags.map((tag) => (
              <span key={tag} className="text-xs font-semibold" style={{ color: ACCENT }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

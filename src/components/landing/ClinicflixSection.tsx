'use client';

import { useEffect, useRef, useState } from 'react';
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

const ACCENT = '#e52000';

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

// 2026-07-10 재제작: 업그레이드 카드뉴스(슬라이드별 다른 실사 장면·검색형 표지·저장유도 엔딩)
// 웹 최적화 JPEG(4:5, 장당 ~60KB) — 6장 전체 캐러셀.
const CARDNEWS_IMAGES = [
  `${SAMPLE_BASE}/cardnews-1.jpg`,
  `${SAMPLE_BASE}/cardnews-2.jpg`,
  `${SAMPLE_BASE}/cardnews-3.jpg`,
  `${SAMPLE_BASE}/cardnews-4.jpg`,
  `${SAMPLE_BASE}/cardnews-5.jpg`,
  `${SAMPLE_BASE}/cardnews-6.jpg`,
];

// 2026-08-16 신설: 블로그 본문에 들어가는 실사 이미지 샘플.
// 시술 장면은 의료법 제56조 제2항 제6호로 노출이 금지되므로 상담·문진·공간 컷만 쓴다.
//
// ★2026-09-06 세 장 모두 교체. 대표가 원본에서 두 가지를 짚었다.
//  ⛔① **계절이 한 화면에서 갈렸다.** 접수 컷은 창밖이 초록인데 접수원은 반팔 스크럽,
//     환자는 코트를 입고 있었다. 진료실 컷도 간호사 반팔 / 환자 긴팔이었다.
//     ⇒ 프롬프트에 **계절이라는 축이 아예 없어서** 인물 복장과 창밖이 따로 놀았다.
//     ⇒ 「초가을·따뜻함」으로 묶고 **화면 안 모두를 같은 계절 복장**으로 못박았다.
//  ⛔② 상담 컷의 종이가 **백지**였다. 문진하는 장면인데 아무것도 안 적혀 있었다.
//     ⇒ 지금까지 "글자는 깨지니 넣지 마라"가 규칙이었는데 그건 `soul_2` 기준이다.
//       **`gpt_image_2` 는 한글을 제대로 그린다**(실측). 다만 글자가 작으면 오타가 난다
//       (「성영」·「생년밀일」·「연악처」). ⇒ **종이를 프레임에서 크게** 잡으면 사라진다.
//       `nano_banana_pro` 는 같은 프롬프트에서 한글이 뭉개졌다 — 쓰지 말 것.
//  화질도 함께 올렸다: 생성 2048×1360(2k/high) → 1350×900 으로 다운스케일(같은 규격, 더 선명).
//  원본은 `바탕 화면\닥포블로그이미지_20260906\원본백업\` 에 있다.
const BLOG_IMAGES = [
  { src: `${SAMPLE_BASE}/blog-image-1.jpg`, alt: '상담실에서 문진표를 함께 보며 설명을 듣는 장면', caption: '상담' },
  { src: `${SAMPLE_BASE}/blog-image-2.jpg`, alt: '접수 데스크에서 안내를 받는 장면', caption: '접수' },
  { src: `${SAMPLE_BASE}/blog-image-3.jpg`, alt: '진료실에서 안내를 받는 장면', caption: '진료실' },
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
                className="inline-flex items-center gap-1.5 bg-white border border-[#dbe2ea] text-[#202020] text-[13px] font-bold px-3.5 py-2 rounded-full"
              >
                <span>{icon}</span>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── How it works ── */}
        <div className="mt-14 sm:mt-16">
          <h3 className="text-center text-[22px] sm:text-3xl font-black text-[#202020] leading-tight">
            원소스 1개 → 멀티채널 산출물
          </h3>
          <p className="text-center text-[#4a4f55] mt-3 text-sm sm:text-base">
            기획부터 검수까지, 의료광고법 검수를 내장한 채로 자동 진행돼요.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-9">
            {STEPS.map(({ step, title, desc }) => (
              <div
                key={step}
                className="bg-white border border-[#dbe2ea] rounded-2xl p-6"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-[26px] font-black leading-none" style={{ color: ACCENT }}>
                    {step}
                  </span>
                  <h4 className="font-extrabold text-[#202020] text-lg">{title}</h4>
                </div>
                <p className="text-sm text-[#4a4f55] leading-relaxed mt-2.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Live sample showcase ── */}
        <div className="mt-16 sm:mt-20">
          <h3 className="text-center text-[22px] sm:text-3xl font-black text-[#202020] leading-tight">
            이 블로그 1편으로 만든 결과물
          </h3>
          <p className="text-center text-[#4a4f55] mt-3 text-sm sm:text-base">
            예시 주제 <b className="text-[#202020]">‘{sample.topic}’</b> · 예시 병원 {sample.hospital} · 실제 생성 샘플입니다.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-10 items-start">
            {/* 영상 */}
            <SampleVideo />

            {/* 오른쪽 열: 카드뉴스 아래에 블로그 실사 이미지를 이어 붙인다.
                영상이 9:16이라 왼쪽 열이 길어지면서 생기던 여백을 채운다.
                ⚠️min-w-0 필수 — grid/flex 아이템의 기본값이 min-width:auto라
                안쪽 overflow-x-auto 캐러셀이 콘텐츠 폭만큼 셀을 밀어내 페이지에
                가로 스크롤이 생긴다(2026-08-16 실측 242px 넘침). */}
            <div className="grid gap-6 min-w-0">
              <CardnewsCarousel />
              <BlogImagesSample />
            </div>

            {/* 쓰레드 */}
            <ThreadsSample posts={sample.threads.posts} hashtags={sample.threads.hashtags} />

            {/* 인스타 피드 캡션 */}
            <InstagramCaption
              hospital={sample.hospital}
              caption={sample.feed.caption}
              hashtags={sample.feed.hashtags}
            />
          </div>

          <p className="mt-6 text-center text-xs text-[#666f7d] leading-relaxed">
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
            style={{ backgroundImage: `linear-gradient(135deg, ${ACCENT}, #c91b00)` }}
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
  const videoRef = useRef<HTMLVideoElement>(null);

  // 스크롤로 화면에 들어오면 자동재생, 벗어나면 일시정지.
  // 브라우저 자동재생 정책상 muted가 필수 — 소리는 컨트롤에서 켤 수 있다.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {
            /* 자동재생이 차단돼도 controls로 수동 재생 가능 — 무시 */
          });
        } else {
          el.pause();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎬</span>
        <span className="font-extrabold text-[#202020]">영상(쇼츠)</span>
        <span className="ml-auto text-[12px] font-bold text-[#666f7d] bg-[#eef2f6] px-2 py-1 rounded-md">
          9:16 · AI 생성 영상
        </span>
      </figcaption>
      <div className="mx-auto w-full max-w-[280px] rounded-xl overflow-hidden border border-[#dbe2ea] bg-black">
        <video
          ref={videoRef}
          src={`${SAMPLE_BASE}/sample-video.mp4`}
          controls
          playsInline
          muted
          loop
          preload="metadata"
          className="w-full aspect-[9/16] object-cover"
        />
      </div>
      <p className="mt-3 text-center text-xs text-[#666f7d]">
        한국어 음성 포함 · 소리를 켜고 재생해보세요
      </p>
    </figure>
  );
}

function CardnewsCarousel() {
  const [active, setActive] = useState(0);
  const total = CARDNEWS_IMAGES.length;

  return (
    // min-w-0: 안쪽 가로 스크롤 캐러셀이 셀을 밀어내지 않게 한다 (위 주석 참조)
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 min-w-0">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">🗂️</span>
        <span className="font-extrabold text-[#202020]">카드뉴스</span>
        <span className="ml-auto text-[12px] font-bold text-[#666f7d] bg-[#eef2f6] px-2 py-1 rounded-md">
          4:5 · 슬라이드 {total}장
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
            {/* 카드 원본은 1080×1350(4:5) — 9:16 프레임에 crop하면 글자가 잘림(2026-07-10 수정) */}
            <img
              src={src}
              alt={`카드뉴스 슬라이드 ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="w-full aspect-[4/5] object-cover"
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
      <p className="mt-2 text-center text-xs text-[#666f7d]">옆으로 넘겨보세요</p>
    </figure>
  );
}

function BlogImagesSample() {
  const [active, setActive] = useState(0);
  const total = BLOG_IMAGES.length;

  // 카드뉴스와 같은 가로 스크롤 캐러셀. 세로로 쌓으면 오른쪽 열이 영상보다 길어져
  // 이번엔 왼쪽 아래가 비어버린다(2026-08-16). 두 칸 높이를 맞추려고 슬라이드로 둔다.
  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5 min-w-0">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">🖼️</span>
        <span className="font-extrabold text-[#202020]">블로그 AI 실사 이미지</span>
        <span className="ml-auto text-[12px] font-bold text-[#666f7d] bg-[#eef2f6] px-2 py-1 rounded-md">
          3:2 · {total}장
        </span>
      </figcaption>

      <div
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / (el.scrollWidth / total));
          setActive(Math.min(total - 1, Math.max(0, idx)));
        }}
      >
        {BLOG_IMAGES.map(({ src, alt, caption }) => (
          <div key={src} className="snap-center shrink-0 w-[220px] sm:w-[240px]">
            <div className="rounded-xl overflow-hidden border border-[#dbe2ea] bg-[#eef2f6]">
              {/* next/image 미사용 리포지토리 — native img + lazy load */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt}
                loading="lazy"
                decoding="async"
                className="w-full aspect-[3/2] object-cover"
              />
            </div>
            <p className="mt-1.5 text-center text-[11px] text-[#666f7d]">{caption}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-2">
        {BLOG_IMAGES.map(({ src }, i) => (
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

      <p className="mt-2 text-center text-xs text-[#666f7d] leading-relaxed">
        옆으로 넘겨보세요 · 상담·접수·진료실 컷을 만들고 시술 장면은 만들지 않습니다.
      </p>
    </figure>
  );
}

interface ThreadsSampleProps {
  posts: string[];
  hashtags: string[];
}

function ThreadsSample({ posts, hashtags }: ThreadsSampleProps) {
  return (
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">💬</span>
        <span className="font-extrabold text-[#202020]">쓰레드</span>
        <span className="ml-auto text-[12px] font-bold text-[#666f7d] bg-[#eef2f6] px-2 py-1 rounded-md">
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
    <figure className="bg-white border border-[#dbe2ea] rounded-2xl p-5">
      <figcaption className="flex items-center gap-2 mb-4">
        <span className="text-lg">📸</span>
        <span className="font-extrabold text-[#202020]">인스타 피드 캡션</span>
        <span className="ml-auto text-[12px] font-bold text-[#666f7d] bg-[#eef2f6] px-2 py-1 rounded-md">
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

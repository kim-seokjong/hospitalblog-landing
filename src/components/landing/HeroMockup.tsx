'use client';

/**
 * HeroMockup — 히어로 우측 "라이브" 제품 목업 (HTML/CSS 재현, AI 이미지 미사용).
 *
 * 정적 목업 → 라이브 데모(2026-07-04 고급화): 키워드가 실시간 타이핑되고,
 * 생성 버튼이 눌리며 글 제목·본문 스켈레톤이 차오르고, 의료광고법 검수 배지가
 * 탁 찍히는 사이클이 반복된다. 제품의 핵심 마법(키워드→60초 글)을 히어로에서
 * 눈앞에 재생하는 것이 목적 (레퍼런스: attio 라이브 데모 + flex 타이핑 인풋).
 *
 * - 모든 글자는 실제 HTML 텍스트 (이미지 텍스트 금지)
 * - prefers-reduced-motion 이면 애니메이션 없이 완성 상태로 정적 렌더
 * - 과장·보장 문구 금지 (순위 보장·완치 등 사용 안 함)
 */

import { useEffect, useRef, useState } from 'react';

interface Demo {
  kw: string;
  title: string;
  s1: string;
  s2: string;
}

const DEMOS: Demo[] = [
  {
    kw: '임플란트 사후관리',
    title: '임플란트 사후관리, 오래 쓰려면 이것부터 챙기세요',
    s1: '임플란트 후 첫 1주일, 관리 포인트',
    s2: '정기 검진이 필요한 이유',
  },
  {
    kw: '도수치료 통증 관리',
    title: '도수치료 후 통증 관리, 순서가 중요합니다',
    s1: '치료 직후 24시간, 이렇게 보내세요',
    s2: '다시 내원이 필요한 신호',
  },
  {
    kw: '라식 수술 전 검사',
    title: '라식 전 검사, 꼼꼼할수록 좋은 이유',
    s1: '수술 전 검사에서 확인하는 것들',
    s2: '검사 결과에 따라 달라지는 선택',
  },
];

// 사이클 단계: 키워드 타이핑 → 생성중 → 제목 등장 → 본문 채움 → 검수 배지 → 유지
type Phase = 'typing' | 'generating' | 'title' | 'body' | 'badge' | 'hold';

const SKELETON_LINES = ['w-full', 'w-[92%]', 'w-[96%]', 'w-[70%]'];

export default function HeroMockup() {
  const [reduced, setReduced] = useState(false);
  const [di, setDi] = useState(0);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('typing');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const demo = DEMOS[di];
    const later = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms));
    };

    if (phase === 'typing') {
      if (typed.length < demo.kw.length) {
        later(() => setTyped(demo.kw.slice(0, typed.length + 1)), 90);
      } else {
        later(() => setPhase('generating'), 450);
      }
    } else if (phase === 'generating') {
      later(() => setPhase('title'), 900);
    } else if (phase === 'title') {
      later(() => setPhase('body'), 550);
    } else if (phase === 'body') {
      later(() => setPhase('badge'), 900);
    } else if (phase === 'badge') {
      later(() => setPhase('hold'), 2600);
    } else {
      later(() => {
        setTyped('');
        setDi((di + 1) % DEMOS.length);
        setPhase('typing');
      }, 400);
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [phase, typed, di, reduced]);

  const demo = DEMOS[di];
  // reduced-motion: 전부 완성된 정적 상태
  const kwText = reduced ? demo.kw : typed;
  const showTitle = reduced || phase === 'title' || phase === 'body' || phase === 'badge' || phase === 'hold';
  const showBody = reduced || phase === 'body' || phase === 'badge' || phase === 'hold';
  const showBadge = reduced || phase === 'badge' || phase === 'hold';
  const generating = phase === 'generating';

  return (
    <div className="relative mx-auto w-full max-w-[480px]" aria-hidden="true">
      {/* 브라우저 창 프레임 */}
      {/* 목업 액자는 '떠 있는 쪽'을 택한다 — 1px 테두리와 넓은 그림자를 겹쳐 쓰지 않는다. */}
      <div className="relative rounded-2xl overflow-hidden bg-white shadow-[0_24px_60px_-24px_rgba(32,32,32,0.28)]">
        {/* 상단 바 — dot 3개 */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#eef2f6] border-b border-[#dbe2ea]">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400" />
            <span className="w-3 h-3 rounded-full bg-yellow-400" />
            <span className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 flex justify-center">
            <span className="px-3 py-1 bg-white rounded-md border border-[#dbe2ea] text-[12px] text-[#8a93a0]">
              hospitalblog.kr
            </span>
          </div>
          <div className="w-12" />
        </div>

        {/* 본문 — 키워드 입력 → 생성된 글 카드 */}
        <div className="p-4 sm:p-5 space-y-4 bg-[#fafbfc] min-h-[300px]">
          {/* 키워드 입력창 (라이브 타이핑) */}
          <div>
            <p className="text-[12px] font-bold text-[#8a93a0] mb-1.5">키워드 입력</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center px-3.5 py-2.5 bg-white border border-[#dbe2ea] rounded-lg text-sm font-semibold text-[#202020] min-h-[42px]">
                {kwText}
                {/* impeccable-disable-next-line blinking-cursor -- 제품 목업의 입력창 타이핑 시연이라
                    캐럿이 있는 쪽이 실제 화면에 가깝다. 히어로 장식용 가짜 프롬프트가 아니다. */}
                <span className="ml-0.5 inline-block w-[2px] h-4 bg-[#e52000] dp-blink" />
              </div>
              <span
                className={`flex-none px-4 py-2.5 text-white text-sm font-bold rounded-lg transition-all bg-gradient-to-br from-[#e52000] to-[#c91b00] ${
                  generating ? 'scale-95 brightness-90' : ''
                }`}
              >
                {generating ? '생성 중…' : '생성'}
              </span>
            </div>
          </div>

          {/* 생성된 글 카드 */}
          <div className="relative bg-white border border-[#dbe2ea] rounded-xl p-4">
            <p
              className={`text-[15px] font-extrabold text-[#202020] leading-snug transition-all duration-500 ${
                showTitle ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'
              }`}
            >
              {demo.title}
            </p>

            <div className="mt-3 space-y-3">
              {[demo.s1, demo.s2].map((sec, si) => (
                <div
                  key={sec}
                  className={`transition-all duration-500 ${
                    showBody ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'
                  }`}
                  style={{ transitionDelay: showBody ? `${si * 220}ms` : '0ms' }}
                >
                  <p className="text-[12px] font-bold text-[#3f5468] flex items-center gap-1.5">
                    <span className={`w-1 h-3 rounded-full ${si === 0 ? 'bg-[#e52000]' : 'bg-[#b8c8d7]'}`} />
                    {sec}
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {SKELETON_LINES.slice(si * 2, si * 2 + 2).map((w, i) => (
                      <div
                        key={i}
                        className={`h-2 rounded-full bg-[#eef2f6] origin-left transition-transform duration-700 ${w} ${
                          showBody ? 'scale-x-100' : 'scale-x-0'
                        }`}
                        style={{ transitionDelay: showBody ? `${si * 220 + i * 140}ms` : '0ms' }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 검수 통과 스탬프 — 생성 마지막에 탁 찍힘 */}
            <span
              className={`absolute -top-2.5 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#eafaf0] border border-[#c9ead2] text-[12px] font-extrabold text-[#1c7c3d] shadow-sm transition-all duration-300 ${
                showBadge ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              }`}
            >
              의료광고법 검수 통과 ✓
            </span>
          </div>
        </div>
      </div>

      {/* 플로팅 배지 칩 — 프레임 위에 겹침 */}
      <span className="dp-float-a absolute -top-3 -left-2 sm:-left-5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-[#c9ead2] text-[12px] font-extrabold text-[#1c7c3d] shadow-[0_10px_26px_-12px_rgba(28,124,61,0.35)]">
        의료광고법 준수 ✓
      </span>
      <span className="dp-float-b absolute top-[52%] -right-2 sm:-right-5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gradient-to-br from-[#e52000] to-[#c91b00] text-[12px] font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(255,70,40,0.5)]">
        ⚡ 60초 생성
      </span>
      <span className="dp-float-c absolute -bottom-3 left-4 sm:left-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#202020] text-[12px] font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(32,32,32,0.5)]">
        네이버·구글·AI 최적화
      </span>
    </div>
  );
}

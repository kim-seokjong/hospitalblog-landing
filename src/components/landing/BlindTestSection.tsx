/**
 * BlindTestSection — "같은 주제로 써서 가리고 비교했습니다" 신뢰 섹션.
 *
 * 검증된 실데이터만 사용:
 * - 동일 주제·동일 조건 1:1 블라인드 자체 평가(2026-06): 닥터포스트 4.5/5 vs 타 AI 블로그 툴 3.0/5
 * - 우위 포인트: SEO 구조(소제목·이미지) / GEO(요약·FAQ) / 의료광고법 안전
 *
 * 고객 후기는 아직 없으므로 넣지 않는다 (지어내기 금지).
 * 다크 섹션 — 내부 요소는 전부 명시적 다크 스타일 지정 (흰 카드 회귀 버그 방지).
 */

const SCORES = [
  { name: '닥터포스트', score: 4.5, max: 5, highlight: true },
  { name: '타 AI 블로그 툴', score: 3.0, max: 5, highlight: false },
];

const ADVANTAGES = [
  {
    icon: '🧱',
    title: 'SEO 구조',
    desc: '소제목·이미지 배치까지 검색 노출에 유리한 글 구조로 작성해요.',
  },
  {
    icon: '🤖',
    title: 'GEO (AI 검색)',
    desc: '요약·FAQ 블록을 갖춰 AI 검색이 인용하기 좋은 형태로 만들어요.',
  },
  {
    icon: '🛡️',
    title: '의료광고법 안전',
    desc: '과장·단정 표현을 생성 단계에서 자동 점검해 위험 문구를 걸러내요.',
  },
];

export default function BlindTestSection() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-[110px] bg-[#161616]">
      {/* 은은한 코랄 앰비언트 글로우 (Linear 문법 — 다크 위 광원 한 점) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(640px 320px at 50% 0%, rgba(255,70,40,0.14), transparent 70%)',
        }}
      />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-6">
        <p className="text-center text-[13px] font-extrabold text-[#ff6a52] tracking-[2px]">블라인드 비교</p>
        <h2 className="text-center text-[30px] sm:text-[44px] font-black text-white mt-2.5 leading-tight" style={{ letterSpacing: '-1px' }}>
          같은 주제로 써서, 가리고 비교했습니다
        </h2>
        <p className="text-center text-[#b9bdc2] mt-3 text-base">
          어느 쪽이 만든 글인지 가린 채, 동일 주제·동일 조건으로 1:1 평가했어요.
        </p>

        {/* 스코어 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 max-w-3xl mx-auto mt-10 sm:mt-12">
          {SCORES.map(({ name, score, max, highlight }) => (
            <div
              key={name}
              className={`rounded-2xl p-6 sm:p-7 ${
                highlight
                  ? 'bg-[#2b2320] border-2 border-[#e52000] shadow-[0_20px_46px_-16px_rgba(255,70,40,0.35)]'
                  : 'bg-[#2a2a2a] border border-[#3a3a3a]'
              }`}
            >
              <p className={`text-sm font-extrabold ${highlight ? 'text-[#ff6a52]' : 'text-[#8a93a0]'}`}>{name}</p>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className={`text-5xl sm:text-[64px] leading-none font-black ${highlight ? 'text-white' : 'text-[#b9bdc2]'}`} style={{ letterSpacing: '-2px' }}>
                  {score.toFixed(1)}
                </span>
                <span className="text-sm font-bold text-[#8a93a0]">/ {max}</span>
              </p>
              {/* 스코어 바 */}
              <div className="mt-4 h-2.5 rounded-full bg-[#3a3a3a] overflow-hidden">
                <div
                  className={`h-full rounded-full ${highlight ? 'bg-gradient-to-r from-[#e52000] to-[#ff6a52]' : 'bg-[#5a6470]'}`}
                  style={{ width: `${(score / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 우위 포인트 3 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mt-8 sm:mt-10">
          {ADVANTAGES.map(({ icon, title, desc }) => (
            <div key={title} className="dp-lift bg-white/[0.045] border border-white/[0.09] rounded-2xl p-6">
              <div className="flex items-center gap-2.5">
                <span className="text-xl leading-none" aria-hidden>{icon}</span>
                <h3 className="font-extrabold text-white text-lg">{title}</h3>
              </div>
              <p className="text-sm text-[#b9bdc2] leading-relaxed mt-2.5">{desc}</p>
            </div>
          ))}
        </div>

        {/* 각주 (필수) */}
        <p className="text-center text-xs text-[#8a93a0] mt-8 leading-relaxed">
          ※ 동일 주제·동일 조건 생성물 1:1 블라인드 자체 평가(2026-06) · 특정 업체 비방 목적 아님
        </p>
      </div>
    </section>
  );
}

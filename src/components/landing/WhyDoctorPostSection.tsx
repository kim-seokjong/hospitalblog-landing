/**
 * WhyDoctorPostSection — "왜 닥터포스트인가" 이유 응집 섹션.
 *
 * 기능 그리드와 일부 겹쳐도 되는, '선택의 이유' 4가지를 한곳에 모은 섹션.
 * 과장·보장·단정 표현 금지 (처분 위험은 "줄인다"로만 표현, "없앤다" 금지).
 */

const REASONS = [
  {
    icon: '🛡️',
    title: '의료광고법 3중 검수',
    desc: '금지 표현 필터와 AI 검사가 글 쓰는 단계에서 위험 표현을 잡고, 발행 후에도 주간 점검으로 다시 확인해요. 행정처분으로 이어질 수 있는 위험을 줄여요.',
    iconClass: 'bg-[#ffece7] text-[#ff4628]',
  },
  {
    icon: '🔭',
    title: '전 검색 표면 최적화',
    desc: '네이버·구글은 물론 AI 검색(GEO·AEO)까지 대응하고, 상위 노출 글의 구조를 역분석해 생성에 반영해요.',
    iconClass: 'bg-[#eef2f6] text-[#3f5468]',
  },
  {
    icon: '🎬',
    title: '블로그 1편 → 5종 자동 확장',
    desc: '클리닉픽스로 블로그 1편을 영상·카드뉴스·스토리·쓰레드·인스타 피드 5종 콘텐츠로 자동 확장해요.',
    iconClass: 'bg-[#ffece7] text-[#ff4628]',
  },
  {
    icon: '📊',
    title: '발행 후 성과는 서버가 자동 추적',
    desc: '검색 순위는 매일, AI 검색 인용은 매주 — PC를 꺼두셔도 서버가 알아서 추적해 리포트로 정리해요. ROI 시뮬레이터로 성과 흐름도 확인할 수 있어요.',
    iconClass: 'bg-[#eef2f6] text-[#3f5468]',
  },
];

export default function WhyDoctorPostSection() {
  return (
    <section className="py-16 sm:py-[84px] bg-[#eef2f6]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        <p className="text-center text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">WHY DOCTORPOST</p>
        <h2 className="text-center text-[28px] sm:text-4xl font-black text-[#202020] mt-2.5 leading-tight" style={{ letterSpacing: '-0.5px' }}>
          왜 닥터포스트인가
        </h2>
        <p className="text-center text-[#4a4f55] mt-3 text-base">
          글 생성부터 검수·확장·성과 확인까지, 한곳에서 끝나는 이유입니다.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-10 sm:mt-12">
          {REASONS.map(({ icon, title, desc, iconClass }) => (
            <div
              key={title}
              className="bg-white border border-[#dbe2ea] rounded-2xl p-6 sm:p-7 shadow-[0_8px_24px_-12px_rgba(32,32,32,0.16)] transition-transform hover:-translate-y-0.5"
            >
              <div className={`w-11 h-11 rounded-xl ${iconClass} flex items-center justify-center text-xl mb-4`}>{icon}</div>
              <h3 className="font-extrabold text-[#202020] text-lg">{title}</h3>
              <p className="text-sm text-[#4a4f55] leading-relaxed mt-2">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

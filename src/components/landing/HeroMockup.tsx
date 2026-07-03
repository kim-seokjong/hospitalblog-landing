/**
 * HeroMockup — 히어로 우측 제품 미니 목업 (HTML/CSS 재현, AI 이미지 미사용).
 *
 * 브라우저 창 프레임 안에 "키워드 입력 → 글 생성" 흐름을 축소 재현하고,
 * 그 위에 플로팅 배지 칩 3개가 떠 있는 비주얼.
 *
 * - 모든 글자는 실제 HTML 텍스트 (이미지 텍스트 금지)
 * - 애니메이션은 globals.css 의 dp-float-* 클래스 사용 (prefers-reduced-motion 존중)
 * - 과장·보장 문구 금지 (순위 보장·완치 등 사용 안 함)
 */

const SKELETON_LINES = ['w-full', 'w-[92%]', 'w-[96%]', 'w-[70%]'];

export default function HeroMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[480px]" aria-hidden="true">
      {/* 브라우저 창 프레임 */}
      <div className="relative rounded-2xl overflow-hidden border border-[#dbe2ea] bg-white shadow-[0_24px_60px_-24px_rgba(32,32,32,0.28)]">
        {/* 상단 바 — dot 3개 */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#eef2f6] border-b border-[#dbe2ea]">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-400" />
            <span className="w-3 h-3 rounded-full bg-yellow-400" />
            <span className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 flex justify-center">
            <span className="px-3 py-1 bg-white rounded-md border border-[#dbe2ea] text-[11px] text-[#8a93a0]">
              hospitalblog.kr
            </span>
          </div>
          <div className="w-12" />
        </div>

        {/* 본문 — 키워드 입력 → 생성된 글 카드 */}
        <div className="p-4 sm:p-5 space-y-4 bg-[#fafbfc]">
          {/* 키워드 입력창 */}
          <div>
            <p className="text-[11px] font-bold text-[#8a93a0] mb-1.5">키워드 입력</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center px-3.5 py-2.5 bg-white border border-[#dbe2ea] rounded-lg text-sm font-semibold text-[#202020]">
                임플란트 사후관리
                <span className="ml-0.5 inline-block w-[2px] h-4 bg-[#ff4628] dp-blink" />
              </div>
              <span className="flex-none px-4 py-2.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white text-sm font-bold rounded-lg">
                생성
              </span>
            </div>
          </div>

          {/* 생성된 글 카드 */}
          <div className="bg-white border border-[#dbe2ea] rounded-xl p-4 shadow-[0_8px_24px_-16px_rgba(32,32,32,0.20)]">
            <p className="text-[15px] font-extrabold text-[#202020] leading-snug">
              임플란트 사후관리, 오래 쓰려면 이것부터 챙기세요
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[12px] font-bold text-[#3f5468] flex items-center gap-1.5">
                  <span className="w-1 h-3 rounded-full bg-[#ff4628]" />
                  임플란트 후 첫 1주일, 관리 포인트
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {SKELETON_LINES.slice(0, 2).map((w, i) => (
                    <div key={i} className={`h-2 rounded-full bg-[#eef2f6] ${w}`} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[12px] font-bold text-[#3f5468] flex items-center gap-1.5">
                  <span className="w-1 h-3 rounded-full bg-[#b8c8d7]" />
                  정기 검진이 필요한 이유
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {SKELETON_LINES.slice(2).map((w, i) => (
                    <div key={i} className={`h-2 rounded-full bg-[#eef2f6] ${w}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 플로팅 배지 칩 — 프레임 위에 겹침 */}
      <span className="dp-float-a absolute -top-3 -left-2 sm:-left-5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-[#c9ead2] text-[12px] font-extrabold text-[#1c7c3d] shadow-[0_10px_26px_-12px_rgba(28,124,61,0.35)]">
        의료광고법 준수 ✓
      </span>
      <span className="dp-float-b absolute top-[52%] -right-2 sm:-right-5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-[12px] font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(255,70,40,0.5)]">
        ⚡ 60초 생성
      </span>
      <span className="dp-float-c absolute -bottom-3 left-4 sm:left-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#202020] text-[12px] font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(32,32,32,0.5)]">
        네이버·구글·AI 최적화
      </span>
    </div>
  );
}

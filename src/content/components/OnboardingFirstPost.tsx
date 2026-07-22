'use client';

/**
 * 온보딩 첫 글 — 원클릭 시작 카드.
 *
 * 가입 직후 "빈 화면" 대신 "우리 병원 주제로 첫 글 바로 시작"을 첫 경험으로 준다.
 * 진료과(hospital_type) 기반 추천 키워드(칩)를 누르면 키워드가 채워지고 제목 생성이
 * 자동 실행된다(onStart). 제목 생성은 무료(크레딧 미차감) — 본문 생성 시 무료 2회 중
 * 1회가 차감되는 기존 흐름을 그대로 따른다(크레딧 로직 불변).
 *
 * UI 규칙: 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속/흰카드 회귀 가드.
 * 모바일 최적화(칩 wrap·최소 44px 터치 타깃).
 */

interface OnboardingFirstPostProps {
  /** 진료과 기반 추천 시작 키워드 (최대 3개, 첫 항목 = 대표) */
  keywords: string[];
  /** 병원명 (개인화 문구용, 없으면 생략) */
  hospitalName?: string;
  /** 남은 무료 크레딧 (안내 문구용) */
  freeCredits: number | null;
  /** 키워드 선택 시 — 키워드를 채우고 제목 생성을 자동 실행한다 */
  onStart: (keyword: string) => void;
  /** 닫기(넛지 접기) */
  onDismiss: () => void;
}

export default function OnboardingFirstPost({
  keywords,
  hospitalName,
  freeCredits,
  onStart,
  onDismiss,
}: OnboardingFirstPostProps) {
  if (keywords.length === 0) return null;
  const [primary, ...rest] = keywords;

  return (
    <div className="mb-4 sm:mb-5 max-w-full sm:max-w-md mx-auto bg-white text-[#202020] border border-[#ffd9cf] rounded-2xl p-5 shadow-[0_8px_24px_-12px_rgba(255,70,40,0.28)] relative">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-[#b4bfce] hover:text-[#5b6573] text-xl leading-none"
        aria-label="시작 가이드 닫기"
      >
        ×
      </button>

      <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[1.5px]">START HERE</p>
      <h3 className="text-lg font-black mt-1 leading-snug">
        {hospitalName ? `${hospitalName}의 ` : '우리 병원 '}첫 글, 지금 바로 시작해보세요
      </h3>
      <p className="text-[13px] text-[#5b6573] mt-1.5 leading-relaxed">
        진료과에 맞는 주제를 골라드렸어요. 하나만 누르면 제목 5개가 자동으로 만들어져요.
        <br className="hidden sm:block" />
        마음에 드는 제목을 고르면 본문까지 완성됩니다.
      </p>

      <div className="mt-4">
        <button
          onClick={() => onStart(primary)}
          className="w-full py-3.5 px-4 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.40)] hover:brightness-105 min-h-[44px] flex items-center justify-center gap-2"
        >
          <span aria-hidden="true">✍️</span>
          <span>“{primary}”로 첫 글 시작하기 →</span>
        </button>

        {rest.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-[#8a93a0] mb-2">다른 주제로 시작할래요</p>
            <div className="flex flex-wrap gap-2">
              {rest.map((kw) => (
                <button
                  key={kw}
                  onClick={() => onStart(kw)}
                  className="px-3.5 py-2 min-h-[40px] text-[13px] font-semibold text-[#3f5468] bg-[#eef2f6] hover:bg-[#e2e9f0] border border-[#dbe2ea] rounded-full transition-colors"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {freeCredits !== null && freeCredits > 0 && (
        <p className="text-[11px] text-[#8a93a0] mt-3.5 leading-relaxed">
          🎁 무료 체험 {freeCredits}회로 지금 첫 글을 완성할 수 있어요 · 제목 생성은 무료예요
        </p>
      )}
    </div>
  );
}

/**
 * 닥터포스트 브랜드 로고 (컨셉 C — ㄷ / D 모노그램 + 코랄 도트)
 *
 * - 순수 인라인 SVG 벡터 (무한 확대 · 한글 깨짐 없음 · AI 이미지 미사용)
 * - 코랄 #ff4628 / Ink #202020 (Dark 배경에서는 흰색) / Soft #ffece7
 * - 브랜드 그래픽 전용. 의료 효과·전후 비교 등 어떤 의료광고 메시지도 결합 금지.
 */

type LogoVariant = 'light' | 'dark';

interface LogoProps {
  /** 배경 밝기에 따른 잉크 색. light=어두운 글자(밝은 배경), dark=흰 글자(어두운 배경) */
  variant?: LogoVariant;
  /** 추가 클래스 (크기 제어는 height 기준으로 className에 h-* 지정) */
  className?: string;
}

const CORAL = '#ff4628';

const INK: Record<LogoVariant, string> = {
  light: '#202020',
  dark: '#ffffff',
};

const SUBTEXT: Record<LogoVariant, string> = {
  light: '#8a93a0',
  dark: '#b8c8d7',
};

/** 'ㄷ'(=D) 모노그램 심볼 단독 — 파비콘/모바일 축소용 */
export function LogoSymbol({ variant = 'light', className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="닥터포스트"
      className={className}
    >
      <path
        d="M16 14h30a4 4 0 0 1 4 4v6H26v24h24v6a4 4 0 0 1-4 4H16z"
        fill={INK[variant]}
      />
      <circle cx="42" cy="36" r="7" fill={CORAL} />
    </svg>
  );
}

/** 가로 조합형 (심볼 + '닥터포스트' 워드마크) */
export function LogoLockup({ variant = 'light', className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 270 64"
      role="img"
      aria-label="닥터포스트"
      className={className}
    >
      <path
        d="M8 16h26a3.5 3.5 0 0 1 3.5 3.5V25H17v20h20.5v5.5A3.5 3.5 0 0 1 34 54H8z"
        fill={INK[variant]}
      />
      <circle cx="31" cy="35" r="6" fill={CORAL} />
      <text
        x="56"
        y="34"
        fontFamily="Pretendard,'Malgun Gothic',sans-serif"
        fontSize="26"
        fontWeight="800"
        fill={INK[variant]}
        letterSpacing="-1"
      >
        닥터포스트
      </text>
      <text
        x="57"
        y="51"
        fontFamily="Inter,Pretendard,sans-serif"
        fontSize="11"
        fontWeight="700"
        fill={SUBTEXT[variant]}
        letterSpacing="2"
      >
        DOCTORPOST
      </text>
    </svg>
  );
}

/**
 * 반응형 로고: 좁은 화면에서는 심볼 단독, md 이상에서는 가로 조합형으로 표시.
 * 헤더 등 네비게이션에 사용.
 */
export default function Logo({ variant = 'light', className }: LogoProps) {
  return (
    <span className={`inline-flex items-center ${className ?? ''}`}>
      {/* 모바일: 심볼 단독 (워드마크 생략) */}
      <LogoSymbol variant={variant} className="h-8 w-8 md:hidden" />
      {/* 데스크톱: 가로 조합형 */}
      <LogoLockup variant={variant} className="hidden md:block h-9 w-auto" />
    </span>
  );
}

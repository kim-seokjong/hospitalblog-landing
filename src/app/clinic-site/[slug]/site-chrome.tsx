/**
 * 병원 서브도메인 블로그 — 공용 푸터·날짜 포맷 (서버 컴포넌트).
 * 공개 블로그는 라이트 톤 고정(정적 블로그 스타일) — 다크모드 미적용.
 */

/** 공개 페이지 날짜 표기 — 'YYYY년 M월 D일'. 파싱 불가 시 빈 문자열. */
export function formatClinicDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface ClinicSiteFooterProps {
  hospitalName: string;
}

export default function ClinicSiteFooter({ hospitalName }: ClinicSiteFooterProps) {
  return (
    <footer className="mt-14 pt-6 border-t border-[#e5e9ef]">
      <p className="text-xs text-[#73808f] leading-relaxed">
        본 콘텐츠는 {hospitalName}이 발행했습니다. 의료 상담은 병원에 직접 문의하세요.
      </p>
    </footer>
  );
}

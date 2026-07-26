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

/** 전화 링크용 — 다이얼 가능한 문자만 남긴다. 남는 게 없으면 빈 문자열. */
export function toTelHref(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^0-9+]/g, '');
}

interface ClinicInfoListProps {
  address: string | null;
  phone: string | null;
}

/**
 * 병원 공개 사실정보 목록 — 주소 · 대표번호.
 * 홈과 병원 소개 페이지가 같은 마크업을 쓰도록 여기 한 곳에 둔다.
 * 값이 하나도 없으면 아무것도 그리지 않는다(빈 라벨이 남지 않게).
 */
export function ClinicInfoList({ address, phone }: ClinicInfoListProps) {
  const addressText = address?.trim() ?? '';
  const phoneText = phone?.trim() ?? '';
  const telHref = toTelHref(phoneText);
  const showPhone = phoneText !== '' && telHref !== '';

  if (addressText === '' && !showPhone) return null;

  return (
    <dl className="mt-4 space-y-1.5 text-sm text-[#3d4551]">
      {addressText !== '' && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-[#73808f]">주소</dt>
          <dd className="break-keep">{addressText}</dd>
        </div>
      )}
      {showPhone && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-[#73808f]">전화</dt>
          <dd>
            <a
              href={`tel:${telHref}`}
              className="font-medium underline underline-offset-4 hover:text-[#202020]"
            >
              {phoneText}
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
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

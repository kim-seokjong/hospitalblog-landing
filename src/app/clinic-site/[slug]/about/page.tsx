import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug } from '@/content/lib/clinic-site/data';
import { getClinicTheme } from '@/content/lib/clinic-site/theme-data';
import { buildMedicalClinicSchema, serializeJsonLd } from '@/content/lib/geo-schema';
import {
  buildOpeningHoursSpecification,
  formatClinicHoursRows,
  isEmptyClinicHours,
} from '@/content/lib/clinic-site/hours';
import { hasClinicAboutContent } from '@/content/lib/clinic-site/about';
import ClinicSiteFooter, { ClinicInfoList } from '../site-chrome';

/**
 * 병원 서브도메인 블로그 — 병원 소개 (공개, 인증 없음).
 * {slug}.hospitalblog.kr/about → 미들웨어 rewrite → 이 페이지. ISR 1시간.
 *
 * 담는 정보는 전부 회원이 마이페이지에 이미 입력한 공개 사실정보다
 * (소개문 · 진료시간 · 진료과 · 주소 · 대표번호 · 병원 사진).
 * 새 정보를 만들지 않으므로 의료광고법 검수 대상 콘텐츠가 아니다 —
 * 효과·후기·비교 표현이 들어갈 자리를 애초에 두지 않는다.
 *
 * 보여줄 내용이 없으면 404 다(hasClinicAboutContent) — 홈 링크·sitemap 과 같은 기준.
 */

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface AboutData {
  /** 정규화된 슬러그 — canonical URL 은 반드시 이 값으로 만든다. */
  slug: string;
  clinic: NonNullable<Awaited<ReturnType<typeof getClinicBySlug>>>;
  theme: Awaited<ReturnType<typeof getClinicTheme>>;
}

/** 페이지·메타데이터가 같은 조회·판정을 쓰도록 한 곳에 모은다. */
async function loadAbout(rawSlug: string): Promise<AboutData | null> {
  const validated = validateSlug(rawSlug);
  if (!validated.ok) return null;

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) return null;

  const theme = await getClinicTheme(clinic.userId);

  const available = hasClinicAboutContent({
    description: theme.description,
    hasHours: !isEmptyClinicHours(clinic.hours),
    address: clinic.address,
    phone: clinic.phone,
    galleryCount: theme.galleryUrls.length,
  });
  if (!available) return null;

  return { slug: validated.slug, clinic, theme };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadAbout(slug);
  if (!data) return {};

  const { clinic } = data;
  const title = `${clinic.hospitalName} 병원 소개`;
  const facts = [clinic.hospitalType, clinic.region]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(' · ');
  const description = facts
    ? `${facts} ${clinic.hospitalName}의 진료 안내와 오시는 길입니다.`
    : `${clinic.hospitalName}의 진료 안내와 오시는 길입니다.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: clinicSiteUrl(data.slug, '/about') },
    openGraph: {
      title,
      description,
      url: clinicSiteUrl(data.slug, '/about'),
      type: 'website',
      locale: 'ko_KR',
    },
  };
}

export default async function ClinicSiteAboutPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await loadAbout(slug);
  if (!data) notFound();

  const { clinic, theme } = data;

  const clinicSchema = buildMedicalClinicSchema({
    hospitalName: clinic.hospitalName,
    specialty: clinic.hospitalType,
    region: clinic.region,
    address: clinic.address,
    telephone: clinic.phone,
    openingHours: buildOpeningHoursSpecification(clinic.hours),
    logoUrl: theme.logoUrl,
  });

  const facts = [clinic.hospitalType, clinic.region].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  const hoursRows = formatClinicHoursRows(clinic.hours);
  const hoursNote = clinic.hours?.note.trim() ?? '';

  const accentStyle: CSSProperties | undefined = theme.hasBrandColor
    ? ({ '--clinic-accent': theme.accentColor } as CSSProperties)
    : undefined;

  return (
    <div className="min-h-screen bg-white text-[#202020]" style={accentStyle}>
      {clinicSchema && (
        <script
          type="application/ld+json"
          // 프로필 공개 사실정보에서 파생만 하는 스키마 + "</" 이스케이프 직렬화 (geo-schema)
          dangerouslySetInnerHTML={{ __html: serializeJsonLd([clinicSchema]) }}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <header
          className={`mb-8 pb-8 ${theme.hasBrandColor ? 'border-b-2' : 'border-b border-[#e5e9ef]'}`}
          style={theme.hasBrandColor ? { borderColor: theme.accentColor } : undefined}
        >
          <div className="flex items-center gap-3">
            {theme.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={theme.logoUrl}
                alt={`${clinic.hospitalName} 로고`}
                className="h-10 sm:h-12 w-auto max-w-[160px] object-contain shrink-0"
              />
            )}
            <h1 className="text-2xl sm:text-3xl font-bold leading-snug break-keep">
              {clinic.hospitalName}
            </h1>
          </div>
          {facts.length > 0 && (
            <p className="mt-2 text-sm text-[#5b6573]">{facts.join(' · ')}</p>
          )}

          <ClinicInfoList address={clinic.address} phone={clinic.phone} />
        </header>

        <main>
          {/* 병원 소개 — profiles.hospital_desc */}
          {theme.description && (
            <section aria-label="병원 소개" className="mb-10">
              <h2 className="text-base font-semibold mb-3 text-[#202020]">병원 소개</h2>
              <p className="text-sm text-[#3d4551] leading-relaxed whitespace-pre-line break-keep">
                {theme.description}
              </p>
            </section>
          )}

          {/* 진료시간 — 미설정 구간은 줄 자체가 없다.
              요일을 하나도 채우지 않고 안내 문구만 남긴 경우에도 그 문구는 보여야 한다
              (저장은 됐는데 화면에서 사라지면 사용자가 원인을 알 수 없다.
               노출 판정 hasClinicAboutContent 도 "문구만 있어도 내용 있음"으로 센다). */}
          {(hoursRows.length > 0 || hoursNote !== '') && (
            <section aria-label="진료시간" className="mb-10">
              <h2 className="text-base font-semibold mb-3 text-[#202020]">진료시간</h2>
              {hoursRows.length > 0 && (
              <dl className="rounded-xl border border-[#e5e9ef] divide-y divide-[#e5e9ef] overflow-hidden">
                {hoursRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <dt className="text-[#5b6573]">{row.label}</dt>
                    <dd className="font-medium tabular-nums text-[#202020]">{row.value}</dd>
                  </div>
                ))}
              </dl>
              )}
              {hoursNote !== '' && (
                <p className={`${hoursRows.length > 0 ? 'mt-2.5 text-xs text-[#5b6573]' : 'text-sm text-[#3d4551]'} leading-relaxed break-keep`}>
                  {hoursNote}
                </p>
              )}
              {hoursRows.length > 0 && (
                <p className="mt-2 text-xs text-[#73808f] leading-relaxed">
                  진료시간은 사정에 따라 변경될 수 있습니다. 방문 전 전화로 확인해주세요.
                </p>
              )}
            </section>
          )}

          {/* 병원 둘러보기 — 등록 사진 (동의·URL 검증 통과분만) */}
          {theme.galleryUrls.length > 0 && (
            <section aria-label="병원 둘러보기" className="mb-10">
              <h2 className="text-base font-semibold mb-4 text-[#202020]">병원 둘러보기</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                {theme.galleryUrls.map((url, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt={`${clinic.hospitalName} 사진 ${index + 1}`}
                    loading="lazy"
                    className="w-full aspect-[4/3] object-cover rounded-lg"
                  />
                ))}
              </div>
            </section>
          )}

          <p>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-medium text-[#3d4551] underline underline-offset-4 hover:text-[#202020]"
            >
              <span aria-hidden="true">←</span>
              건강정보 글 보기
            </Link>
          </p>
        </main>

        <ClinicSiteFooter hospitalName={clinic.hospitalName} />
      </div>
    </div>
  );
}

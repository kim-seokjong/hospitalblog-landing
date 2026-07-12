import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPosts } from '@/content/lib/clinic-site/data';
import { getClinicTheme } from '@/content/lib/clinic-site/theme-data';
import { buildMedicalClinicSchema, buildMetaDescription, serializeJsonLd } from '@/content/lib/geo-schema';
import ClinicSiteFooter, { formatClinicDate } from './site-chrome';

/**
 * 병원 서브도메인 블로그 — 홈 (공개, 인증 없음).
 * {slug}.hospitalblog.kr → 미들웨어 rewrite → 이 페이지.
 * 병원 소개(공개 사실정보만) + 발행 확정 글 목록. ISR 1시간.
 *
 * 브랜드킷 자동 테마: 회원이 마이페이지에 이미 등록한 로고·브랜드 컬러·병원 사진·
 * 병원 소개(theme-data.ts, 동의·URL 검증 통과분만)를 읽어 병원마다 다른 디자인으로
 * 렌더한다. 미등록 항목은 각각 독립적으로 생략 → 전부 미등록이면 기본 디자인 그대로.
 */

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) return {};

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) return {};

  const title = `${clinic.hospitalName} 공식 블로그`;
  const description = [clinic.hospitalName, clinic.hospitalType, clinic.region]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(' · ');

  return {
    title: { absolute: title },
    description: `${description} 건강정보 블로그입니다.`,
    alternates: { canonical: clinicSiteUrl(validated.slug) },
    openGraph: {
      title,
      description: `${description} 건강정보 블로그입니다.`,
      url: clinicSiteUrl(validated.slug),
      type: 'website',
      locale: 'ko_KR',
    },
  };
}

export default async function ClinicSiteHomePage({ params }: PageProps) {
  const { slug } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) notFound();

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) notFound();

  const [posts, theme] = await Promise.all([
    getPublishedPosts(clinic.userId),
    getClinicTheme(clinic.userId),
  ]);

  const clinicSchema = buildMedicalClinicSchema({
    hospitalName: clinic.hospitalName,
    specialty: clinic.hospitalType,
    region: clinic.region,
    address: clinic.address,
    logoUrl: theme.logoUrl,
  });

  const facts = [clinic.hospitalType, clinic.region].filter(
    (v): v is string => Boolean(v && v.trim()),
  );

  // 브랜드 컬러 — 검증 통과(hasBrandColor)시에만 적용. CSS 변수는 hex 검증 완료값만 주입.
  const accentStyle: CSSProperties | undefined = theme.hasBrandColor
    ? ({ '--clinic-accent': theme.accentColor } as CSSProperties)
    : undefined;
  const titleHoverClass = theme.hasBrandColor
    ? ' group-hover:text-[color:var(--clinic-accent)]'
    : '';

  return (
    <div className="min-h-screen bg-white text-[#202020]" style={accentStyle}>
      {clinicSchema && (
        <script
          type="application/ld+json"
          // 본문·프로필에서 파생만 하는 스키마 + "</" 이스케이프 직렬화 (geo-schema)
          dangerouslySetInnerHTML={{ __html: serializeJsonLd([clinicSchema]) }}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* 병원 소개 — 공개 사실정보만. 브랜드 컬러는 헤더 하단 보더에만 절제 적용 */}
        <header
          className={`mb-10 pb-8 ${theme.hasBrandColor ? 'border-b-2' : 'border-b border-[#e5e9ef]'}`}
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
          <p className="mt-3 text-sm text-[#5b6573] leading-relaxed">
            {clinic.hospitalName}의 공식 건강정보 블로그입니다.
          </p>
        </header>

        {/* 히어로 — 시설/대표 사진 (동의·URL 검증 통과분만, LCP 후보라 lazy 미적용) */}
        {theme.heroUrl && (
          <div className="mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={theme.heroUrl}
              alt={`${clinic.hospitalName} 전경`}
              className="w-full max-h-64 sm:max-h-80 object-cover rounded-2xl"
            />
          </div>
        )}

        {/* 병원 소개 문단 — profiles.hospital_desc (있을 때만) */}
        {theme.description && (
          <section
            aria-label="병원 소개"
            className={`mb-10 bg-[#f6f7f9] rounded-xl px-5 py-4 ${theme.hasBrandColor ? 'border-l-4' : ''}`}
            style={theme.hasBrandColor ? { borderLeftColor: theme.accentColor } : undefined}
          >
            <p className="text-sm text-[#3d4551] leading-relaxed line-clamp-3">
              {theme.description}
            </p>
          </section>
        )}

        {/* 발행글 목록 */}
        <main>
          <h2 className="text-base font-semibold mb-5 text-[#202020]">건강정보 글</h2>
          {posts.length === 0 ? (
            <p className="py-12 text-center text-sm text-[#73808f]">
              아직 발행된 글이 없습니다.
            </p>
          ) : (
            <ul className="space-y-6">
              {posts.map((post) => (
                <li key={post.id} className="group">
                  <Link href={`/posts/${post.id}`} className="block">
                    <h3
                      className={`text-lg font-semibold leading-snug break-keep group-hover:underline underline-offset-4${titleHoverClass}`}
                    >
                      {post.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-[#5b6573] leading-relaxed line-clamp-2">
                      {buildMetaDescription(post.content)}
                    </p>
                    {post.publishedAt &&
                      (theme.hasBrandColor ? (
                        <p className="mt-2">
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full border"
                            style={{
                              borderColor: theme.accentColor,
                              // 밝은 브랜드 컬러는 흰 배경 텍스트 가독성이 낮아 보더 포인트만 쓴다
                              color: theme.accentTextSafe ? theme.accentColor : '#5b6573',
                            }}
                          >
                            {formatClinicDate(post.publishedAt)}
                          </span>
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs text-[#73808f]">
                          {formatClinicDate(post.publishedAt)}
                        </p>
                      ))}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>

        {/* 병원 둘러보기 — 등록 사진 그리드 (최대 6장, 동의·URL 검증 통과분만) */}
        {theme.galleryUrls.length > 0 && (
          <section aria-label="병원 둘러보기" className="mt-12">
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

        <ClinicSiteFooter hospitalName={clinic.hospitalName} />
      </div>
    </div>
  );
}

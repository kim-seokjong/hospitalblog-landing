import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPosts } from '@/content/lib/clinic-site/data';
import { buildMedicalClinicSchema, buildMetaDescription, serializeJsonLd } from '@/content/lib/geo-schema';
import ClinicSiteFooter, { formatClinicDate } from './site-chrome';

/**
 * 병원 서브도메인 블로그 — 홈 (공개, 인증 없음).
 * {slug}.hospitalblog.kr → 미들웨어 rewrite → 이 페이지.
 * 병원 소개(공개 사실정보만) + 발행 확정 글 목록. ISR 1시간.
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

  const posts = await getPublishedPosts(clinic.userId);

  const clinicSchema = buildMedicalClinicSchema({
    hospitalName: clinic.hospitalName,
    specialty: clinic.hospitalType,
    region: clinic.region,
    address: clinic.address,
  });

  const facts = [clinic.hospitalType, clinic.region].filter(
    (v): v is string => Boolean(v && v.trim()),
  );

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      {clinicSchema && (
        <script
          type="application/ld+json"
          // 본문·프로필에서 파생만 하는 스키마 + "</" 이스케이프 직렬화 (geo-schema)
          dangerouslySetInnerHTML={{ __html: serializeJsonLd([clinicSchema]) }}
        />
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* 병원 소개 — 공개 사실정보만 */}
        <header className="mb-10 pb-8 border-b border-[#e5e9ef]">
          <h1 className="text-2xl sm:text-3xl font-bold leading-snug break-keep">
            {clinic.hospitalName}
          </h1>
          {facts.length > 0 && (
            <p className="mt-2 text-sm text-[#5b6573]">{facts.join(' · ')}</p>
          )}
          <p className="mt-3 text-sm text-[#5b6573] leading-relaxed">
            {clinic.hospitalName}의 공식 건강정보 블로그입니다.
          </p>
        </header>

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
                    <h3 className="text-lg font-semibold leading-snug break-keep group-hover:underline underline-offset-4">
                      {post.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-[#5b6573] leading-relaxed line-clamp-2">
                      {buildMetaDescription(post.content)}
                    </p>
                    {post.publishedAt && (
                      <p className="mt-1.5 text-xs text-[#73808f]">
                        {formatClinicDate(post.publishedAt)}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </main>

        <ClinicSiteFooter hospitalName={clinic.hospitalName} />
      </div>
    </div>
  );
}

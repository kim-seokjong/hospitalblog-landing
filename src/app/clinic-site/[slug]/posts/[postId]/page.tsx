import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPost } from '@/content/lib/clinic-site/data';
import {
  buildGeoSchemas,
  buildMetaDescription,
  extractFaqItems,
  extractSummaryLines,
  serializeJsonLd,
  stripStructureBlocks,
} from '@/content/lib/geo-schema';
import { renderBodyHtml } from '@/content/lib/geo-export';
import ClinicSiteFooter, { formatClinicDate } from '../../site-chrome';

/**
 * 병원 서브도메인 블로그 — 글 본문 (공개, 인증 없음).
 * {slug}.hospitalblog.kr/posts/{postId} → 미들웨어 rewrite → 이 페이지.
 *
 * - 발행 확정(published_to_site=true) 글만 — 아니면 404 (검수 게이트는 발행 API가 담당)
 * - 본문 렌더·JSON-LD 는 geo-export/geo-schema 재사용 (직렬화 이스케이프 그대로)
 * - canonical = 서브도메인 절대 URL. ISR 1시간.
 */

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string; postId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, postId } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) return {};

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) return {};
  const post = await getPublishedPost(clinic.userId, postId);
  if (!post) return {};

  const canonical = clinicSiteUrl(validated.slug, `/posts/${post.id}`);
  const description = buildMetaDescription(post.content);

  return {
    title: { absolute: post.title },
    description,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description,
      url: canonical,
      type: 'article',
      locale: 'ko_KR',
    },
  };
}

export default async function ClinicSitePostPage({ params }: PageProps) {
  const { slug, postId } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) notFound();

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) notFound();

  const post = await getPublishedPost(clinic.userId, postId);
  if (!post) notFound();

  const schemas = buildGeoSchemas(
    { title: post.title, content: post.content, publishedAt: post.publishedAt },
    {
      hospitalName: clinic.hospitalName,
      specialty: clinic.hospitalType,
      region: clinic.region,
      address: clinic.address,
    },
  );

  const summaryLines = extractSummaryLines(post.content);
  const faqItems = extractFaqItems(post.content);
  // renderBodyHtml 은 모든 텍스트를 escapeHtml 처리한 시맨틱 HTML 문자열을 만든다
  const bodyHtml = renderBodyHtml(stripStructureBlocks(post.content));

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <script
        type="application/ld+json"
        // serializeJsonLd 가 "</" 를 "<\/" 로 이스케이프 (geo-schema — XSS 가드)
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemas) }}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <nav className="mb-8">
          <Link
            href="/"
            className="text-sm text-[#5b6573] hover:text-[#202020] hover:underline underline-offset-4"
          >
            ← {clinic.hospitalName} 블로그
          </Link>
        </nav>

        <article className="leading-[1.75] break-keep">
          <header className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold leading-snug">{post.title}</h1>
            <p className="mt-3 text-xs text-[#73808f]">
              {clinic.hospitalName}
              {post.publishedAt ? ` · ${formatClinicDate(post.publishedAt)}` : ''}
            </p>
          </header>

          {/* 핵심 요약 — 본문 [핵심 요약] 블록에서 파생 (없으면 생략) */}
          {summaryLines.length > 0 && (
            <section aria-label="핵심 요약" className="mb-8 bg-[#f6f7f9] rounded-xl px-5 py-4">
              <h2 className="text-sm font-semibold mb-2">핵심 요약</h2>
              <ul className="list-disc pl-5 space-y-1 text-sm text-[#3d4551]">
                {summaryLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          {/* 본문 — geo-export renderBodyHtml (전 텍스트 이스케이프 완료) */}
          <div
            className="clinic-post-body space-y-4 text-[15px] sm:text-base
              [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-9 [&_h2]:mb-2
              [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-7 [&_h3]:mb-1.5
              [&_p]:leading-[1.8]"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />

          {/* 자주 묻는 질문 — 본문 [자주 묻는 질문] 블록에서 파생 (없으면 생략) */}
          {faqItems.length > 0 && (
            <section aria-label="자주 묻는 질문" className="mt-10">
              <h2 className="text-xl font-bold mb-4">자주 묻는 질문</h2>
              <dl className="space-y-4">
                {faqItems.map((item, i) => (
                  <div key={i}>
                    <dt className="font-semibold text-[15px] sm:text-base">
                      {item.question}
                    </dt>
                    <dd className="mt-1 text-sm sm:text-[15px] text-[#3d4551] leading-relaxed">
                      {item.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </article>

        <ClinicSiteFooter hospitalName={clinic.hospitalName} />
      </div>
    </div>
  );
}

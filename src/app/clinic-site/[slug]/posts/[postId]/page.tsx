import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateSlug, clinicSiteUrl } from '@/content/lib/clinic-site/slug';
import { getClinicBySlug, getPublishedPost, getPublishedPosts } from '@/content/lib/clinic-site/data';
import { getClinicTheme } from '@/content/lib/clinic-site/theme-data';
import {
  buildGeoSchemas,
  buildMetaDescription,
  extractFaqItems,
  extractSummaryLines,
  serializeJsonLd,
  stripSummaryAndFaqBlocks,
} from '@/content/lib/geo-schema';
import { renderBodyHtml } from '@/content/lib/geo-export';
import {
  buildClinicPostImages,
  pickLeadImageUrl,
  toImageUrlList,
} from '@/content/lib/clinic-site/post-images';
import { buildOpeningHoursSpecification } from '@/content/lib/clinic-site/hours';
import { formatBylineText, resolveAuthorAttribution } from '@/content/lib/clinic-site/byline';
import { rankRelatedPosts, RELATED_POSTS_LIMIT } from '@/content/lib/clinic-site/related-posts';
import ClinicSiteFooter, { formatClinicDate } from '../../site-chrome';
import AiReferralBeacon from '../../ai-referral-beacon';

/**
 * 병원 서브도메인 블로그 — 글 본문 (공개, 인증 없음).
 * {slug}.hospitalblog.kr/posts/{postId} → 미들웨어 rewrite → 이 페이지.
 *
 * - 발행 확정(published_to_site=true) 글만 — 아니면 404 (검수 게이트는 발행 API가 담당)
 * - 본문 렌더·JSON-LD 는 geo-export/geo-schema 재사용 (직렬화 이스케이프 그대로)
 * - 본문 이미지: `[이미지 N: 설명]` 마커 위치에 image_urls[N-1] 을 렌더한다
 *   (clinic-site/post-images.ts — 자체 Storage 화이트리스트 통과분만). 이미지가
 *   없으면 마커는 사라지고 기존과 완전히 동일한 텍스트 본문이 된다.
 * - canonical = 서브도메인 절대 URL. ISR 1시간.
 * - 브랜드킷 자동 테마: 로고(헤더)·브랜드 컬러(h2 보더·홈 링크 hover) 절제 적용.
 *   미등록이면 기본 디자인 그대로 (theme-data.ts graceful).
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

  // 대표 이미지 = 본문 첫 이미지. 화이트리스트 통과분만(외부 URL 은 OG 에도 안 나간다).
  const leadImageUrl = pickLeadImageUrl(
    buildClinicPostImages(
      post.content,
      post.imageUrls,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
      post.title,
    ),
  );

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
      ...(leadImageUrl ? { images: [{ url: leadImageUrl, alt: post.title }] } : {}),
    },
    ...(leadImageUrl
      ? { twitter: { card: 'summary_large_image' as const, images: [leadImageUrl] } }
      : {}),
  };
}

export default async function ClinicSitePostPage({ params }: PageProps) {
  const { slug, postId } = await params;
  const validated = validateSlug(slug);
  if (!validated.ok) notFound();

  const clinic = await getClinicBySlug(validated.slug);
  if (!clinic) notFound();

  const [post, allPosts, theme] = await Promise.all([
    getPublishedPost(clinic.userId, postId),
    getPublishedPosts(clinic.userId),
    getClinicTheme(clinic.userId),
  ]);
  if (!post) notFound();

  // 주제 기반 관련 글 — 태그/키워드 겹침 순, 부족하면 최신순 보충 (현재 글 제외)
  const relatedPosts = rankRelatedPosts(
    { id: post.id, title: post.title, tags: post.tags, keyword: post.keyword },
    allPosts,
    RELATED_POSTS_LIMIT,
  );

  // 본문 이미지 — 마커(N) ↔ image_urls[N-1] 매핑. 화이트리스트 탈락분은 전부 제외된다.
  const bodyImages = buildClinicPostImages(
    post.content,
    post.imageUrls,
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    post.title,
  );

  const schemas = buildGeoSchemas(
    {
      title: post.title,
      content: post.content,
      publishedAt: post.publishedAt,
      imageUrls: toImageUrlList(bodyImages),
    },
    {
      hospitalName: clinic.hospitalName,
      specialty: clinic.hospitalType,
      region: clinic.region,
      address: clinic.address,
      telephone: clinic.phone,
      openingHours: buildOpeningHoursSpecification(clinic.hours),
      logoUrl: theme.logoUrl,
      authorFullName: clinic.authorFullName,
      authorPosition: clinic.authorPosition,
    },
  );

  // 저자 바이라인 — 임상 역할(원장·부원장)+이름이면 인물, 아니면 병원(조직). 없으면 생략.
  const bylineText = formatBylineText(
    resolveAuthorAttribution({
      fullName: clinic.authorFullName,
      position: clinic.authorPosition,
      hospitalName: clinic.hospitalName,
      specialty: clinic.hospitalType,
    }),
  );

  const summaryLines = extractSummaryLines(post.content);
  const faqItems = extractFaqItems(post.content);
  // renderBodyHtml 은 모든 텍스트를 escapeHtml 처리한 시맨틱 HTML 문자열을 만든다.
  // 이미지 마커를 남긴 본문을 넘겨야 마커 위치에 이미지가 들어간다 —
  // bodyImages 가 비어 있으면 마커는 그대로 사라져 기존 렌더와 동일하다.
  const bodyHtml = renderBodyHtml(stripSummaryAndFaqBlocks(post.content), bodyImages);

  // 브랜드 컬러 — 검증 통과(hasBrandColor)시에만. CSS 변수는 hex 검증 완료값만 주입.
  const accentStyle: CSSProperties | undefined = theme.hasBrandColor
    ? ({ '--clinic-accent': theme.accentColor } as CSSProperties)
    : undefined;
  const navHoverClass = theme.hasBrandColor
    ? 'hover:text-[color:var(--clinic-accent)]'
    : 'hover:text-[#202020]';
  const bodyAccentClass = theme.hasBrandColor
    ? ' [&_h2]:pl-3 [&_h2]:border-l-4 [&_h2]:border-[color:var(--clinic-accent)] [&_a]:text-[color:var(--clinic-accent)]'
    : '';

  return (
    <div className="min-h-screen bg-white text-[#202020]" style={accentStyle}>
      {/* AI 검색 유입 집계 — 렌더 경로 밖(브라우저 백그라운드 전송). 화면에 아무것도 그리지 않는다. */}
      <AiReferralBeacon slug={validated.slug} postId={post.id} />

      <script
        type="application/ld+json"
        // serializeJsonLd 가 "</" 를 "<\/" 로 이스케이프 (geo-schema — XSS 가드)
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schemas) }}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <nav className="mb-8 flex items-center gap-2">
          {theme.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={theme.logoUrl}
              alt={`${clinic.hospitalName} 로고`}
              className="h-6 w-auto max-w-[96px] object-contain shrink-0"
            />
          )}
          <Link
            href="/"
            className={`text-sm text-[#5b6573] ${navHoverClass} hover:underline underline-offset-4`}
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
            className={`clinic-post-body space-y-4 text-[15px] sm:text-base
              [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-9 [&_h2]:mb-2
              [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-7 [&_h3]:mb-1.5
              [&_p]:leading-[1.8]
              [&_figure]:my-7
              [&_figure_img]:block [&_figure_img]:w-full [&_figure_img]:h-auto
              [&_figure_img]:rounded-xl [&_figure_img]:bg-[#f1f3f6]${bodyAccentClass}`}
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

          {/* 저자 바이라인 — 프로필 사실정보 기반 (임상 역할=인물 / 그 외=병원, 없으면 생략) */}
          {bylineText && (
            <p className="mt-10 pt-4 border-t border-[#eef1f5] text-xs text-[#73808f]">
              {bylineText}
            </p>
          )}
        </article>

        {/* 관련 글 — 같은 진료과·주제 연관도 순 (현재 글 제외, 없으면 생략) */}
        {relatedPosts.length > 0 && (
          <section aria-label="관련 글" className="mt-12 pt-8 border-t border-[#e5e9ef]">
            <h2 className="text-base font-semibold mb-4 text-[#202020]">관련 글</h2>
            <ul className="space-y-3">
              {relatedPosts.map((other) => (
                <li key={other.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/posts/${other.id}`}
                    className={`text-[15px] font-medium break-keep hover:underline underline-offset-4 ${theme.hasBrandColor ? 'hover:text-[color:var(--clinic-accent)]' : ''}`}
                  >
                    {other.title}
                  </Link>
                  {other.publishedAt && (
                    <span className="text-xs text-[#73808f]">
                      {formatClinicDate(other.publishedAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <ClinicSiteFooter hospitalName={clinic.hospitalName} />
      </div>
    </div>
  );
}

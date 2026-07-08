/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  experimental: {
    serverComponentsExternalPackages: ['playwright-core'],
  },
  async redirects() {
    return [
      // 전자책(크몽) 독자용 단축 경로 — 인쇄물에는 깔끔한 주소만 노출하고 UTM은 여기서 부착
      {
        source: '/ebook',
        destination: '/?utm_source=ebook&utm_medium=referral&utm_campaign=medical_ad_guide',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;

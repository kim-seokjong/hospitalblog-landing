/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  experimental: {
    // Next.js 14에서 playwright-core를 번들링하지 않도록 external 처리
    serverComponentsExternalPackages: ['playwright-core'],
    // Lambda에 playwright 브라우저 바이너리 파일을 명시적으로 포함
    outputFileTracingIncludes: {
      '/api/publish-naver': [
        './node_modules/playwright-core/.local-browsers/**/*',
      ],
    },
  },
};

module.exports = nextConfig;

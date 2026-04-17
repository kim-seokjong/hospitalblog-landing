/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  experimental: {
    // playwright-core 를 webpack 번들링에서 제외 (Node.js 런타임에서 직접 require)
    serverComponentsExternalPackages: ['playwright-core'],
    // PLAYWRIGHT_BROWSERS_PATH=0 으로 설치된 브라우저 바이너리를 Lambda에 포함
    outputFileTracingIncludes: {
      '/api/publish-naver': [
        './node_modules/playwright-core/.local-browsers/**/*',
      ],
    },
  },
};

module.exports = nextConfig;

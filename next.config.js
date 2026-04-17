/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  experimental: {
    serverComponentsExternalPackages: ['playwright-core'],
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['oaidalleapiprodscus.blob.core.windows.net', 'image.pollinations.ai', 'images.pexels.com'],
  },
  serverExternalPackages: ['playwright'],
};

module.exports = nextConfig;

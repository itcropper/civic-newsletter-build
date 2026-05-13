/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Routing is request-time and data-driven: the Host header maps to a
  // cities row via lib/city.ts. No build-time city baked into the bundle.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
    ],
  },
};

module.exports = nextConfig;

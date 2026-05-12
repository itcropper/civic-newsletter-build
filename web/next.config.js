/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Each Vercel deployment is bound to exactly one city via CITY_SUBDOMAIN.
  // Exposing it publicly so client components can read it for analytics, etc.
  env: {
    NEXT_PUBLIC_CITY_SUBDOMAIN: process.env.CITY_SUBDOMAIN || 'birmingham',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
    ],
  },
};

module.exports = nextConfig;

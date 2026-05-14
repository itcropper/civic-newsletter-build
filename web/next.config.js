/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Routing is path-based: `/` is the splash, `/{cities.subdomain}` is each
  // city. The slug comes from `params.city` in the route segment; no Host
  // header parsing, no build-time city baked into the bundle.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
    ],
  },
};

module.exports = nextConfig;

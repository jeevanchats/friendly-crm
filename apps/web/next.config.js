const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@friendly-crm/shared'],
  // The image optimizer is not used by this app; keeping it off means it cannot be switched on by accident.
  images: { unoptimized: true },
  // In production the reverse proxy (nginx / Caddy) should send /api/* straight to the API, so the web server does not
  // forward requests itself. Set API_PROXY=external there to turn this rewrite off. Local development keeps it.
  async rewrites() {
    if (process.env.API_PROXY === 'external') return [];
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
      ],
    },
  ],
};

module.exports = nextConfig;

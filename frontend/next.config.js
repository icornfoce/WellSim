/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy API calls to the Express backend during development
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

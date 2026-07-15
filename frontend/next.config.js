/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force Next.js to compile as a static HTML/JS website
  output: 'export',
  // Disable image optimization server requirement for static export
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;


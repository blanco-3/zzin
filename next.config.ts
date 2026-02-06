import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['static.usernames.app-backend.toolsforhumanity.com'],
  },
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://801e-125-180-167-179.ngrok-free.app',
    'https://801e-125-180-167-179.ngrok-free.app',
  ],
  reactStrictMode: false,
};

export default nextConfig;

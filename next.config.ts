import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    domains: ['static.usernames.app-backend.toolsforhumanity.com'],
  },
  allowedDevOrigins: [
    'delilah-waterless-electroacoustically.ngrok-free.dev',
    'https://delilah-waterless-electroacoustically.ngrok-free.dev',
    'http://delilah-waterless-electroacoustically.ngrok-free.dev',
  ],
  reactStrictMode: false,
};

export default nextConfig;

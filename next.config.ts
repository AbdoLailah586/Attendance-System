import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/api/:path*', headers: [{key:'Cache-Control', value:'private, no-store'}] },
      { source: '/sw.js', headers: [{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}] },
      { source: '/:path*', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'}] },
    ];
  },
};

export default nextConfig;

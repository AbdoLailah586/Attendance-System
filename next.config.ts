import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium ships its Chromium binary as package assets that Next.js's automatic
  // output-file tracing does not always pick up for a route that only requires the package
  // dynamically at runtime. Without this, the two PDF routes crash on Vercel with an immediate
  // 500 (module load failure) despite building and working fine locally.
  outputFileTracingIncludes: {
    '/api/attendance/export': ['./node_modules/@sparticuz/chromium/**/*', './src/lib/fonts/*.ttf'],
    '/api/attendance/daily-pdf': ['./node_modules/@sparticuz/chromium/**/*', './src/lib/fonts/*.ttf'],
  },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{key:'Cache-Control', value:'private, no-store'}] },
      { source: '/sw.js', headers: [{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}] },
      { source: '/:path*', headers: [{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'}] },
    ];
  },
};

export default nextConfig;

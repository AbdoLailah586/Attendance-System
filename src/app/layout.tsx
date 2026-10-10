import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import AppInstall from '@/components/AppInstall';

export const metadata: Metadata = {
  title: 'نظام الحضور والانصراف الذكي | تتبع الفروع والموظفين',
  description: 'حضور وانصراف بالكارت، ومتابعة التاج بالبلوتوث أو الموقع أثناء الشيفت، مع تقارير الفروع وفترات الرصد والمراجعة.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'نظام الحضور',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body>{children}<div style={{position:'fixed',bottom:16,left:16,zIndex:1100}}><AppInstall /></div></body>
    </html>
  );
}

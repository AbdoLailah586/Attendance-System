'use client';
import { useEffect, useState } from 'react';

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export default function AppInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
    const handler = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  if (!prompt) return null;
  return <button className="btn btn-secondary" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>إضافة لوحة الحضور للهاتف</button>;
}

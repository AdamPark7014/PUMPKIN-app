import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { InstallAppPrompt } from '@/components/InstallAppPrompt';
import './globals.scss';

const body = Space_Grotesk({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Pumpkin Zone · Taquilla',
  description: 'POS de taquilla Pumpkin Zone',
  applicationName: 'Pumpkin Zone Taquilla',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Taquilla',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    },
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#ff6a13',
  width: 'device-width',
  initialScale: 1,
};

export default function TaquillaLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={body.variable}>
        <ServiceWorkerRegister />
        <InstallAppPrompt appLabel="Taquilla" />
        {children}
      </body>
    </html>
  );
}

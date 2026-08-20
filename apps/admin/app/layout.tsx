import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Space_Grotesk } from 'next/font/google';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { InstallAppPrompt } from '@/components/InstallAppPrompt';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { Providers } from './providers';
import '@boletera/ui/src/styles/theme.scss';
import './globals.scss';

const heading = Bebas_Neue({ subsets: ['latin'], variable: '--font-heading', weight: '400' });
const body = Space_Grotesk({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Pumpkin Zone · Panel',
  description: 'Backoffice y escáner de acceso Pumpkin Zone',
  applicationName: 'Pumpkin Zone Panel',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pumpkin',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#ff6a13',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Inline boot: sets data-theme on <html> before paint to avoid FOUC.
 * Key/resolution must stay aligned with components/shell/storage.ts.
 */
const themeBootScript = `(function(){try{var k='pumpkin.admin.theme';var p=localStorage.getItem(k);var pref=p==='light'||p==='dark'||p==='system'?p:'light';var dark=pref==='dark'||(pref==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=dark?'dark':'light';var r=document.documentElement;r.setAttribute('data-theme',t);r.setAttribute('data-theme-preference',pref);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={`${heading.variable} ${body.variable}`}>
        <ServiceWorkerRegister />
        <Providers>
          <ToastProvider>
            <InstallAppPrompt appLabel="Pumpkin Panel" />
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}

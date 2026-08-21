import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Great_Vibes, Space_Grotesk } from 'next/font/google';
import { CartBar } from '@/components/CartBar';
import { SiteFooterHost } from '@/components/SiteFooterHost';
import { SITE_NAME, SITE_URL, absoluteUrl } from '@/lib/seo';
import './globals.css';

const headingFont = Bebas_Neue({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: '400',
  display: 'swap',
});

const bodyFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const scriptFont = Great_Vibes({
  subsets: ['latin'],
  variable: '--font-script',
  weight: '400',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Boletos oficiales`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Boletos oficiales para Pumpkin Zone en Puebla. Compra segura y acceso con código QR.',
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Boletos oficiales`,
    description:
      'El festival de otoño y Halloween más grande de Puebla. Boletos oficiales.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} | Boletos oficiales`,
    description: 'Boletos oficiales · Compra segura · Acceso con QR.',
  },
  alternates: { canonical: SITE_URL },
  icons: {
    icon: absoluteUrl('/favicon.ico'),
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX">
      <body className={`${headingFont.variable} ${bodyFont.variable} ${scriptFont.variable}`}>
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div id="contenido" style={{ flex: 1 }}>
            {children}
          </div>
          <SiteFooterHost />
        </div>
        <CartBar />
      </body>
    </html>
  );
}

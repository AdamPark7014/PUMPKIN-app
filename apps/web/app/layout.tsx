import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Space_Grotesk } from 'next/font/google';
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Boletos oficiales`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    'Compra boletos oficiales con inventario real, mapa de asientos y pagos Banorte. México.',
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'es_MX',
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Boletos oficiales`,
    description:
      'Cartelera oficial con inventario real, selección de asientos y liquidación Banorte.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} | Boletos oficiales`,
    description: 'Boletos oficiales · Inventario real · Pago Banorte.',
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
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
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

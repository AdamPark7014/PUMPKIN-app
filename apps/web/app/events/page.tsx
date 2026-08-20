import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { canonical, SITE_NAME } from '@/lib/seo';

/**
 * La cartelera vive en `/`. Conservamos `/events` como alias estable
 * para enlaces antiguos y sitemaps.
 */
export const metadata: Metadata = {
  title: 'Cartelera',
  description: `Cartelera oficial de ${SITE_NAME}. Boletos con inventario real y pago Mercado Pago.`,
  alternates: { canonical: canonical('/') },
  robots: { index: false, follow: true },
};

export default function EventsPage() {
  redirect('/');
}

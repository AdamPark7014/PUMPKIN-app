import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import './globals.scss';

const body = Space_Grotesk({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Pumpkin Zone · Taquilla',
  description: 'POS de taquilla',
  manifest: '/manifest.json',
};

export default function TaquillaLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={body.variable}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

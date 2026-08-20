import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../legal.module.scss';

export const metadata: Metadata = { title: 'Términos' };

export default function TerminosPage() {
  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <h1>Términos de uso</h1>
        <p className={styles.updated}>Última actualización: julio 2026</p>
        <p>
          Pumpkin Zone es el sitio oficial de boletos del evento. Al usar el sitio web, el
          panel admin o la taquilla aceptas estos términos.
        </p>
        <h2>Compras</h2>
        <p>
          Los precios y disponibilidad los define el organizador. El pago se procesa vía Mercado Pago
          (tarjeta, SPEI u OXXO según el flujo del evento). La confirmación genera boletos con QR
          de acceso.
        </p>
        <h2>Reembolsos</h2>
        <p>
          Las políticas de reembolso las define el promotor. Cuando apliquen, el personal puede
          iniciar el reembolso desde el panel; la liquidación final depende de Mercado Pago.
        </p>
        <h2>Cuentas</h2>
        <p>
          Eres responsable de la confidencialidad de tu contraseña. Puedes restablecerla desde el
          enlace de recuperación.
        </p>
        <p>
          <Link href="/ayuda">Ayuda</Link> · <Link href="/privacidad">Privacidad</Link>
        </p>
      </main>
    </>
  );
}

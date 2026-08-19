import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../legal.module.scss';

export const metadata: Metadata = { title: 'Ayuda' };

export default function AyudaPage() {
  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <h1>Ayuda</h1>
        <p className={styles.updated}>Guía rápida del producto actual</p>

        <h2>Comprar boletos</h2>
        <p>
          Elige un evento, selecciona asientos o zona, completa el checkout y paga con Banorte
          (CARD / SPEI / OXXO según disponibilidad). Al confirmar verás la orden y podrás descargar
          el PDF con QR.
        </p>

        <h2>Mi cuenta</h2>
        <ul>
          <li>
            <Link href="/login/forgot">Recuperar contraseña</Link>
          </li>
          <li>
            <Link href="/cuenta">Ver órdenes, transferir boletos y solicitar CFDI sandbox</Link>
          </li>
        </ul>

        <h2>Acceso al evento</h2>
        <p>
          Presenta el QR del PDF o de la pantalla de orden. El personal escanea el código; no hay
          app móvil nativa todavía.
        </p>

        <h2>Organizadores</h2>
        <p>
          Usa el panel Admin para crear eventos, ver órdenes y solicitar reembolsos. Taquilla está
          pensada para venta presencial.
        </p>

        <p>
          <Link href="/terminos">Términos</Link> · <Link href="/privacidad">Privacidad</Link>
        </p>
      </main>
    </>
  );
}

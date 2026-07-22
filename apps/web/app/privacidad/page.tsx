import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../legal.module.scss';

export const metadata: Metadata = { title: 'Privacidad — Boletera' };

export default function PrivacidadPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <h1>Aviso de privacidad</h1>
        <p className={styles.updated}>Última actualización: julio 2026</p>
        <p>
          Tratamos datos personales para vender boletos, autenticar cuentas, enviar confirmaciones y
          cumplir obligaciones fiscales (CFDI) cuando lo solicitas.
        </p>
        <h2>Datos que usamos</h2>
        <ul>
          <li>Identificación y contacto (nombre, email, teléfono opcional)</li>
          <li>Datos de compra y asientos</li>
          <li>Datos de pago procesados por Banorte (no almacenamos PAN completo)</li>
          <li>RFC y razón social solo si pides factura</li>
        </ul>
        <h2>Derechos</h2>
        <p>
          Puedes solicitar acceso, corrección o eliminación contactando al organizador del evento o
          a soporte vía <Link href="/ayuda">Ayuda</Link>.
        </p>
        <p>
          <Link href="/terminos">Términos</Link>
        </p>
      </main>
    </>
  );
}

import styles from './TrustRow.module.scss';

export type TrustItem = {
  title: string;
  detail: string;
};

/** Garantías de compra reutilizadas en evento, carrito, checkout y orden. */
export const TRUST_OFFICIAL: TrustItem = {
  title: 'Boletos oficiales',
  detail: 'Inventario emitido directamente por el promotor',
};

export const TRUST_QR: TrustItem = {
  title: 'Acceso con QR',
  detail: 'En tu celular o en PDF, listo para escanear en puerta',
};

export function trustPayment(demo: boolean): TrustItem {
  return demo
    ? {
        title: 'Modo demo',
        detail: 'Entorno de prueba: no se realiza ningún cargo real',
      }
    : {
        title: 'Pago Banorte',
        detail: 'Cobro cifrado y liquidado a la cuenta del organizador',
      };
}

export function trustTransfer(allowed: boolean): TrustItem {
  return allowed
    ? {
        title: 'Transferible',
        detail: 'Cede boletos desde tu cuenta cuando lo necesites',
      }
    : {
        title: 'No transferible',
        detail: 'Este evento no permite ceder boletos a otra persona',
      };
}

export function TrustRow({
  items,
  tone = 'light',
  label = 'Garantías de compra',
}: {
  items: readonly TrustItem[];
  tone?: 'light' | 'dark';
  label?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      className={`${styles.row} ${tone === 'dark' ? styles.dark : ''}`}
      aria-label={label}
    >
      {items.map((item) => (
        <li key={item.title}>
          <strong>{item.title}</strong>
          <span>{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

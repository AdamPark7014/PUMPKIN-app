import Link from 'next/link';
import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { OrderQrCards } from '@/components/OrderQrCards';
import styles from './order.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export default async function OrderPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  let order: {
    publicId: string;
    status: string;
    totalAmount: string;
    currency: string;
    items: { tickets: { code: string }[] }[];
  } | null = null;
  try {
    order = await api(`/orders/${publicId}`);
  } catch {
    order = null;
  }

  if (!order) {
    return (
      <main className={styles.page}>
        <p>Orden no encontrada.</p>
        <Link href="/events">Ver eventos</Link>
      </main>
    );
  }

  const tickets = order.items.flatMap((i) => i.tickets);

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        {order.status === 'COMPLETED' ? (
          <p className={styles.ok}>Compra confirmada</p>
        ) : (
          <p className={styles.pending}>Pago pendiente — completa tu pago Banorte</p>
        )}
        <h1>Orden {order.publicId}</h1>
        <p className={styles.total}>
          Total: ${order.totalAmount} {order.currency}
        </p>
        {order.status === 'COMPLETED' && (
          <p>
            <a className={styles.link} href={`${API}/orders/${publicId}/tickets.pdf`}>
              Descargar / imprimir PDF de boletos
            </a>
          </p>
        )}
        <section>
          <h2>Tus boletos</h2>
          <ul>
            {tickets.map((t) => (
              <li key={t.code}>
                <code>{t.code}</code>
              </li>
            ))}
          </ul>
        </section>
        {order.status === 'COMPLETED' && <OrderQrCards publicId={order.publicId} />}
        <Link href="/events" className={styles.link}>
          Ver más eventos
        </Link>
      </main>
    </>
  );
}

import Link from 'next/link';
import { api } from '@/lib/api';
import { WaitlistSignup } from '@/components/WaitlistSignup';
import { EventPurchaseClient } from './EventPurchaseClient';
import styles from './event.module.scss';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await api<{
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    seatMap: { snapshotData: unknown } | null;
    offers: { id: string; zone: string; basePrice: string }[];
  }>(`/discovery/events/${slug}`);

  return (
    <main className={styles.page}>
      <Link href="/events" className={styles.back}>
        ← Eventos
      </Link>
      <div className={styles.split}>
        <section>
          <h1>{event.title}</h1>
          <p className={styles.meta}>{new Date(event.startsAt).toLocaleString('es-MX')}</p>
          {event.description && <p className={styles.desc}>{event.description}</p>}
          {event.offers.length > 0 ? (
            <EventPurchaseClient
              eventId={event.id}
              eventTitle={event.title}
              mapData={event.seatMap?.snapshotData}
              offers={event.offers}
            />
          ) : (
            <WaitlistSignup eventId={event.id} eventTitle={event.title} />
          )}
        </section>
      </div>
    </main>
  );
}

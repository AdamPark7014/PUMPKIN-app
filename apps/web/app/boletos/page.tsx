import type { Metadata } from 'next';
import Link from 'next/link';
import { TicketPicker } from '@/components/TicketPicker';
import { EVENT } from '@/lib/event-config';
import { api } from '@/lib/api';
import styles from './boletos.module.scss';

export const metadata: Metadata = {
  title: 'Boletos',
  description: `Compra tus accesos para ${EVENT.name} · ${EVENT.scheduleLabel} en ${EVENT.venue.name}.`,
};

// El inventario cambia con cada venta: nunca servir esta página cacheada.
export const dynamic = 'force-dynamic';

type OfferHit = {
  id: string;
  name: string;
  zone: string;
  basePrice: string;
  remainingQuantity: number;
  maxPerOrder?: number;
  isAvailable?: boolean;
};

type EventHit = {
  id: string;
  slug: string;
  offers?: OfferHit[];
  sale?: { canPurchase?: boolean; state?: string };
};

export default async function BoletosPage() {
  let event: EventHit | null = null;
  let loadError = false;

  try {
    event = await api<EventHit>(`/discovery/events/${EVENT.slug}`);
  } catch {
    loadError = true;
  }

  const offers = (event?.offers ?? []).filter((o) => o.isAvailable !== false);
  const canPurchase = event?.sale?.canPurchase !== false;

  // El orden y el copy vienen de la config; el precio y el cupo, del inventario
  // real. Así el sitio nunca anuncia un precio que la API no respalda.
  const tiers = EVENT.tickets
    .map((tier) => {
      const offer = offers.find((o) => o.zone === tier.zone);
      return offer ? { ...tier, offer } : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <div className={styles.shell}>
          <Link href="/" className={styles.back}>
            ← Volver al inicio
          </Link>
          <p className={styles.kicker}>Boletos oficiales</p>
          <h1 className={styles.title}>Elige tus accesos</h1>
          <p className={styles.sub}>
            <strong>{EVENT.scheduleLabel}</strong>
            <span aria-hidden="true">·</span>
            {EVENT.hoursLabel}
            <span aria-hidden="true">·</span>
            {EVENT.venue.name}
          </p>
        </div>
      </header>

      <main className={styles.shell}>
        {loadError || tiers.length === 0 ? (
          <div className={styles.empty} role="alert">
            <h2>No pudimos cargar los boletos</h2>
            <p>
              Vuelve a intentarlo en un momento. Si el problema sigue, escríbenos y te
              ayudamos a completar tu compra.
            </p>
            <Link href="/" className={styles.emptyCta}>
              Volver al inicio
            </Link>
          </div>
        ) : (
          <TicketPicker
            eventId={event!.id}
            canPurchase={canPurchase}
            tiers={tiers.map((t) => ({
              id: t.id,
              name: t.name,
              blurb: t.blurb,
              perks: [...t.perks],
              featured: Boolean(t.featured),
              offerId: t.offer.id,
              price: Number(t.offer.basePrice),
              remaining: t.offer.remainingQuantity,
              maxPerOrder: t.offer.maxPerOrder ?? 10,
            }))}
          />
        )}
      </main>
    </div>
  );
}

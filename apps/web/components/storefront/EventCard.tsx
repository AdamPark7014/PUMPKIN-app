import Link from 'next/link';
import { EventPosterArt } from '@/components/EventPosterArt';
import { dateTime, money } from '@/lib/format';
import type { EventListItem } from '@/lib/storefront-types';
import styles from './EventCard.module.scss';

/**
 * Tarjeta de evento reutilizable en hubs (categoría, ciudad, venue, relacionados).
 * Server Component: sólo un `<Link>` y markup estático.
 */
export function EventCard({
  event,
  showVenue = true,
}: {
  event: EventListItem;
  showVenue?: boolean;
}) {
  const price = Number(event.minPrice);
  const currency = event.currency || 'MXN';
  const meta = [
    dateTime(event.startsAt),
    showVenue ? event.venue?.name : null,
    !showVenue ? event.venue?.city : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={`/events/${event.slug}`} className={styles.card}>
      <div className={styles.art}>
        <EventPosterArt event={event} size="sm" showDate />
      </div>
      <div className={styles.body}>
        <strong className={styles.title}>{event.title}</strong>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      <em className={styles.price} aria-label={price > 0 ? `Desde ${money(price, currency)}` : undefined}>
        {price > 0 ? (
          <>
            {money(price, currency)}
            <span className={styles.from}>desde</span>
          </>
        ) : (
          '—'
        )}
      </em>
    </Link>
  );
}

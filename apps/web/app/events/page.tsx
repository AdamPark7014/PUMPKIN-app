import { api } from '@/lib/api';
import { SiteHeader } from '@/components/SiteHeader';
import { EventDiscoveryPanel } from '@/components/EventDiscoveryPanel';
import styles from './events.module.scss';

interface EventRow {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: string;
  currency: string;
  venue: { name: string; city: string };
}

export default async function EventsPage() {
  let events: EventRow[] = [];
  try {
    events = await api<EventRow[]>('/discovery/events');
  } catch {
    events = [];
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <h1>Eventos</h1>
        <EventDiscoveryPanel initial={events} />
      </main>
    </>
  );
}

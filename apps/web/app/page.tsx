import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { EventDiscoveryPanel, type EventHit } from "@/components/EventDiscoveryPanel";
import { DiscoverySkeleton } from "@/components/DiscoverySkeleton";
import { HomeModules } from "@/components/HomeModules";
import { api } from "@/lib/api";
import styles from "./page.module.scss";

type Facets = {
  cities: { name: string; count: number }[];
  categories: { key: string; count: number }[];
};

type VenueHit = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string;
  image?: string | null;
  eventCount: number;
};

export default async function Home() {
  let events: EventHit[] = [];
  let facets: Facets = { cities: [], categories: [] };
  let venues: VenueHit[] = [];

  try {
    events = await api<EventHit[]>("/discovery/events?limit=40");
  } catch {
    events = [];
  }
  try {
    facets = await api<Facets>("/discovery/facets");
  } catch {
    facets = { cities: [], categories: [] };
  }
  try {
    venues = await api<VenueHit[]>("/discovery/venues?limit=8");
  } catch {
    venues = [];
  }

  const trending = [...events]
    .sort((a, b) => Number(b.offerCount ?? 0) - Number(a.offerCount ?? 0))
    .slice(0, 8);

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <section className={styles.board} aria-label="Cartelera">
          <Suspense fallback={<DiscoverySkeleton />}>
            <EventDiscoveryPanel initial={events} />
          </Suspense>
        </section>

        <HomeModules
          trending={trending.slice(0, 4)}
          cities={facets.cities.slice(0, 8)}
          venues={venues.slice(0, 4)}
        />
      </main>
    </>
  );
}

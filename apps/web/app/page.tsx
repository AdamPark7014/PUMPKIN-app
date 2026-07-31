import { Suspense } from "react";
import dynamic from "next/dynamic";
import { SiteHeader } from "@/components/SiteHeader";
import { type EventHit } from "@/components/EventDiscoveryPanel";
import { DiscoverySkeleton } from "@/components/DiscoverySkeleton";
import { HomeModules } from "@/components/HomeModules";
import { api } from "@/lib/api";
import styles from "./page.module.scss";

const EventDiscoveryPanel = dynamic(
  () =>
    import("@/components/EventDiscoveryPanel").then((mod) => mod.EventDiscoveryPanel),
  { loading: () => <DiscoverySkeleton /> },
);

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

export default function Home() {
  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#discovery-main">
        Saltar a la cartelera
      </a>
      <SiteHeader theme="dark" />
      <main id="discovery-main" className={styles.page}>
        <Suspense fallback={<DiscoverySkeleton />}>
          <DiscoveryContent />
        </Suspense>
      </main>
    </div>
  );
}

async function DiscoveryContent() {
  const [eventsResult, facetsResult, venuesResult] = await Promise.allSettled([
    api<EventHit[]>("/discovery/events?limit=40"),
    api<Facets>("/discovery/facets"),
    api<VenueHit[]>("/discovery/venues?limit=8"),
  ]);

  const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
  const facets =
    facetsResult.status === "fulfilled"
      ? facetsResult.value
      : { cities: [], categories: [] };
  const venues = venuesResult.status === "fulfilled" ? venuesResult.value : [];

  // HomeModules still accepts trending, but we only pass real inventory-backed
  // cities/venues. Empty trending avoids inventing popularity metrics.
  return (
    <>
      <section className={styles.board} aria-label="Descubre eventos">
        <EventDiscoveryPanel
          initial={events}
          initialError={eventsResult.status === "rejected"}
          availableCities={facets.cities}
          availableCategories={facets.categories}
        />
      </section>

      <HomeModules
        trending={[]}
        cities={facets.cities.slice(0, 8)}
        venues={venues.slice(0, 4)}
      />
    </>
  );
}

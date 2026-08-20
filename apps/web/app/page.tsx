import Link from 'next/link';
import type { Metadata } from 'next';
import { AttractionIcon } from '@/components/AttractionIcon';
import { EVENT, formatPrice } from '@/lib/event-config';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: `${EVENT.name} ${EVENT.edition} · ${EVENT.venue.city}`,
  description: `${EVENT.tagline}. ${EVENT.scheduleLabel} en ${EVENT.venue.name}, ${EVENT.venue.city}.`,
  openGraph: {
    title: `${EVENT.name} · ${EVENT.edition}`,
    description: EVENT.tagline,
    type: 'website',
    locale: 'es_MX',
  },
};

export default function Home() {
  return (
    <div className={styles.root}>
      <a className={styles.skipLink} href="#boletos">
        Saltar a boletos
      </a>

      <Hero />

      <main>
        <Attractions />
        <Tickets />
        <PracticalInfo />
      </main>

      <Footer />
    </div>
  );
}

/**
 * Hero = video full-bleed. Tipografía y CTAs van embebidos en el MP4;
 * encima solo hay hotspots transparentes alineados a esos botones.
 */
function Hero() {
  return (
    <header className={styles.hero}>
      <video
        className={styles.heroVideo}
        src="/pumpkin/hero.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label={`${EVENT.name} ${EVENT.edition}`}
      />

      <nav className={styles.heroHotspots} aria-label="Acciones">
        <Link href="/boletos" className={styles.hotspotTickets}>
          <span className={styles.hotspotLabel}>Comprar boletos</span>
        </Link>
        <a
          href={EVENT.venue.mapsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.hotspotMaps}
        >
          <span className={styles.hotspotLabel}>Cómo llegar</span>
        </a>
      </nav>
    </header>
  );
}

function Attractions() {
  return (
    <section id="atracciones" className={styles.attractions} aria-labelledby="atracciones-h">
      <div className={styles.shell}>
        <SectionHead
          id="atracciones-h"
          kicker="Qué vas a encontrar"
          title="Ocho razones para quedarte hasta que apaguen las luces"
        />

        <ul className={styles.attractionGrid}>
          {EVENT.attractions.map((item) => (
            <li key={item.id} className={styles.attractionCard}>
              <span className={styles.attractionIcon}>
                <AttractionIcon name={item.icon} />
              </span>
              <h3>{item.name}</h3>
              <p>{item.blurb}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Tickets() {
  return (
    <section id="boletos" className={styles.tickets} aria-labelledby="boletos-h">
      <div className={styles.shell}>
        <SectionHead
          id="boletos-h"
          kicker="Boletos"
          title="Un boleto, todo el festival"
          note="Entrada general para todas las edades. Pasaje Siniestro, talleres de tallado y juegos mecánicos se pagan dentro del festival."
        />

        <ul className={styles.tierGrid}>
          {EVENT.tickets.map((tier) => (
            <li
              key={tier.id}
              className={`${styles.tier} ${tier.featured ? styles.tierFeatured : ''}`}
            >
              {tier.featured && <span className={styles.tierFlag}>El más elegido</span>}

              <h3 className={styles.tierName}>{tier.name}</h3>
              <p className={styles.tierPrice}>
                {formatPrice(tier.price)}
                <span className={styles.tierPer}>por persona</span>
              </p>
              <p className={styles.tierBlurb}>{tier.blurb}</p>

              <ul className={styles.perks}>
                {tier.perks.map((perk) => (
                  <li key={perk}>
                    <Check />
                    {perk}
                  </li>
                ))}
              </ul>

              <Link
                href="/boletos"
                className={tier.featured ? styles.tierCtaPrimary : styles.tierCta}
                aria-label={`Comprar ${tier.name}`}
              >
                Comprar
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PracticalInfo() {
  return (
    <section className={styles.info} aria-labelledby="info-h">
      <div className={`${styles.shell} ${styles.infoGrid}`}>
        <div>
          <SectionHead id="info-h" kicker="Antes de venir" title="Lo práctico" />
          <dl className={styles.infoList}>
            <div>
              <dt>Dónde</dt>
              <dd>
                {EVENT.venue.name}
                <br />
                {EVENT.venue.city}, {EVENT.venue.state}
              </dd>
            </div>
            <div>
              <dt>Cuándo</dt>
              <dd>
                {EVENT.scheduleLabel}
                <br />
                {EVENT.hoursLabel}
              </dd>
            </div>
            <div>
              <dt>Producen</dt>
              <dd>{EVENT.producers.join(' · ')}</dd>
            </div>
          </dl>
        </div>

        {/* El aviso de sede única es anti-fraude: cada año aparecen eventos que
            se cuelgan del nombre. Va destacado a propósito. */}
        <aside className={styles.notice}>
          <span className={styles.noticeTag}>Aviso oficial</span>
          <p>{EVENT.venue.exclusivityNote}</p>
          <a href={EVENT.venue.mapsUrl} target="_blank" rel="noreferrer noopener">
            Ver la sede en el mapa →
          </a>
        </aside>
      </div>
    </section>
  );
}

function SectionHead({
  id,
  kicker,
  title,
  note,
}: {
  id: string;
  kicker: string;
  title: string;
  note?: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <p className={styles.kicker}>{kicker}</p>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {note && <p className={styles.sectionNote}>{note}</p>}
    </div>
  );
}

function Check() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.shell} ${styles.footerInner}`}>
        <p className={styles.footerBrand}>
          {EVENT.name} <span>{EVENT.edition}</span>
        </p>
        <nav className={styles.footerNav} aria-label="Enlaces del sitio">
          <Link href="/ayuda">Ayuda</Link>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
        <p className={styles.footerNote}>
          Boletos oficiales. Comprar fuera de este sitio no garantiza tu acceso.
        </p>
      </div>
    </footer>
  );
}

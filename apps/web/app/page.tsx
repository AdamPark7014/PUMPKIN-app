import Link from 'next/link';
import type { Metadata } from 'next';
import { AttractionIcon } from '@/components/AttractionIcon';
import { EventCountdown } from '@/components/EventCountdown';
import { HeroCarousel } from '@/components/HeroCarousel';
import { EVENT, GALLERY, formatPrice } from '@/lib/event-config';
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

function Hero() {
  return (
    <header className={styles.hero}>
      {/* Fondo: las escenas del evento rotando. El scrim de abajo garantiza
          el contraste del texto sobre cualquier escena. */}
      <HeroCarousel slides={GALLERY} />
      <div className={styles.heroScrim} aria-hidden="true" />
      {/* Capas de ambiente: resplandor, niebla y viñeta. Puramente decorativas,
          fuera del árbol de accesibilidad. */}
      <div className={styles.heroGlow} aria-hidden="true" />
      <div className={styles.heroFog} aria-hidden="true" />
      <div className={styles.heroVignette} aria-hidden="true" />

      <div className={`${styles.shell} ${styles.heroInner}`}>
        <p className={styles.eyebrow}>
          <span className={styles.edition}>{EVENT.edition}</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          {EVENT.venue.city}
        </p>

        <h1 className={styles.title}>
          <span>Pumpkin </span>
          <span className={styles.titleAccent}>Zone</span>
        </h1>

        <p className={styles.tagline}>{EVENT.tagline}</p>

        {/* Los tres datos en una línea: ocupan un tercio de lo que ocupaban
            apilados y se leen de un golpe. */}
        <p className={styles.facts}>
          <strong>{EVENT.scheduleLabel}</strong>
          <span aria-hidden="true">·</span>
          {EVENT.hoursLabel}
          <span aria-hidden="true">·</span>
          {EVENT.venue.name}
        </p>

        <div className={styles.ctaRow}>
          <Link href="/boletos" className={styles.ctaPrimary}>
            Comprar boletos
          </Link>
          <a
            href={EVENT.venue.mapsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.ctaGhost}
          >
            Cómo llegar
          </a>
          {/* El contador vive junto a los CTAs, no en su propia fila. */}
          <div className={styles.countdownWrap}>
            <p className={styles.countdownLabel}>Abren en</p>
            <EventCountdown target={EVENT.startsAt} />
          </div>
        </div>

        {/* Accesos con precio dentro del hero: la decisión de compra se toma
            aquí, sin obligar a nadie a desplazarse. */}
        <ul className={styles.tierStrip} aria-label="Tipos de acceso">
          {EVENT.tickets.map((tier) => (
            <li key={tier.id}>
              <Link
                href="/boletos"
                className={`${styles.tierPill} ${tier.featured ? styles.tierPillHot : ''}`}
              >
                <span className={styles.tierPillName}>{tier.name}</span>
                <span className={styles.tierPillPrice}>{formatPrice(tier.price)}</span>
                {tier.featured && <span className={styles.tierPillTag}>Popular</span>}
              </Link>
            </li>
          ))}
          <li className={styles.tierStripNote}>
            Impuestos incluidos · Sin cargos ocultos · Acceso con código QR
          </li>
        </ul>

      </div>

      <PumpkinMark />
    </header>
  );
}

/** Calabaza tallada del hero. Dibujada, no fotográfica: escala sin perder nitidez. */
function PumpkinMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 200 170" aria-hidden="true">
      <defs>
        <radialGradient id="pzFlesh" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#ff9a3c" />
          <stop offset="58%" stopColor="#f2701a" />
          <stop offset="100%" stopColor="#9c3c08" />
        </radialGradient>
        <filter id="pzGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M100 40c-5-12 2-21 15-24"
        fill="none"
        stroke="#4f7a2a"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <ellipse cx="100" cy="103" rx="82" ry="62" fill="url(#pzFlesh)" />
      <ellipse cx="100" cy="103" rx="50" ry="62" fill="#000" opacity=".1" />
      <ellipse cx="100" cy="103" rx="21" ry="62" fill="#000" opacity=".08" />

      {/* Cara tallada: la luz sale de adentro. */}
      <g fill="#ffd9a0" filter="url(#pzGlow)">
        <path d="M62 92l25-14 3 21-27 4z" />
        <path d="M138 92l-25-14-3 21 27 4z" />
        <path d="M64 122c12 14 60 14 72 0-6 3-16 2-20-3-5 6-13 6-18 1-5 5-14 5-19-1-4 5-10 6-15 3z" />
      </g>
    </svg>
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
          title="Elige cómo quieres vivirlo"
          note="Precios en pesos mexicanos, impuestos incluidos. Sin cargos por servicio sorpresa en el checkout."
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

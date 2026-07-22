import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { EventDiscoveryPanel } from "@/components/EventDiscoveryPanel";
import { api } from "@/lib/api";
import styles from "./page.module.scss";

interface EventRow {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice: string | number;
  currency: string;
  venue: { name: string; city: string };
}

const faqs = [
  {
    q: "¿Los boletos son oficiales?",
    a: "Sí. Se emiten desde el inventario del promotor en Boletera, con código QR firmado para acceso.",
  },
  {
    q: "¿Cómo pago?",
    a: "Tarjeta (Banorte Payworks), SPEI u OXXO según el evento. En desarrollo local puede operar en modo demo.",
  },
  {
    q: "¿Qué pasa si cancelan el evento?",
    a: "El promotor gestiona reembolsos desde el panel. Te avisamos por correo cuando haya resolución.",
  },
  {
    q: "¿Puedo transferir mi boleto?",
    a: "Sí, desde Mi cuenta, si el evento permite transferencias.",
  },
];

const steps = [
  { n: "01", title: "Elige el evento", text: "Catálogo en vivo desde la API del promotor." },
  { n: "02", title: "Selecciona asientos", text: "Mapa con disponibilidad en tiempo real y hold temporal." },
  { n: "03", title: "Paga", text: "Banorte CARD / SPEI / OXXO — o demo si no hay credenciales." },
  { n: "04", title: "Entra con QR", text: "Boleto digital e impresión PDF desde tu orden." },
];

export default async function Home() {
  let events: EventRow[] = [];
  try {
    events = await api<EventRow[]>("/discovery/events");
  } catch {
    events = [];
  }

  const featured = events.slice(0, 1);

  return (
    <>
      <SiteHeader theme="dark" />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden />
          <div className={styles.heroInner}>
            <p className={styles.brandMark}>BOLETERA</p>
            <h1>
              Boletos oficiales.
              <br />
              <span className={styles.heroAccent}>Sin ruido.</span>
            </h1>
            <p className={styles.lead}>
              Compra asientos con inventario real, paga con Banorte y entra con QR firmado.
            </p>
            <div className={styles.actions}>
              <Link href="/events" className={styles.btnPrimary}>
                Ver eventos
              </Link>
              <Link href="/cuenta" className={styles.btnGhost}>
                Mi cuenta
              </Link>
            </div>
          </div>
          <div className={styles.heroVisual} aria-hidden>
            <div className={styles.ticketStack}>
              <article className={styles.ticketCard}>
                <span className={styles.ticketTag}>Inventario vivo</span>
                <p className={styles.ticketTitle}>
                  {featured[0]?.title ?? "Próximo evento"}
                </p>
                <p className={styles.ticketMeta}>
                  {featured[0]
                    ? `${featured[0].venue.city} · desde $${Number(featured[0].minPrice).toLocaleString("es-MX")}`
                    : "Publica un evento desde Admin para verlo aquí"}
                </p>
                <div className={styles.ticketQr} />
              </article>
            </div>
          </div>
        </section>

        <section className={styles.discovery} id="eventos">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>Cartelera</p>
              <h2>Eventos publicados</h2>
              <p className={styles.sectionLead}>
                {events.length
                  ? `${events.length} evento${events.length === 1 ? "" : "s"} disponibles ahora.`
                  : "Aún no hay eventos publicados. El seed demo crea «Concierto Demo 2026»."}
              </p>
            </div>
            <Link href="/events" className={styles.linkAll}>
              Ver todos
            </Link>
          </div>
          <EventDiscoveryPanel initial={events} />
        </section>

        <section className={styles.steps}>
          <div className={styles.stepsCopy}>
            <p className={styles.sectionEyebrow}>Cómo funciona</p>
            <h2>De la compra a la puerta</h2>
          </div>
          <ol className={styles.stepsList}>
            {steps.map((step) => (
              <li key={step.n}>
                <span className={styles.stepNum}>{step.n}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.faqs}>
          <div className={styles.sectionHeadCentered}>
            <p className={styles.sectionEyebrow}>Preguntas</p>
            <h2>Respuestas claras</h2>
          </div>
          <div className={styles.faqsList}>
            {faqs.map((faq) => (
              <article key={faq.q} className={styles.faqItem}>
                <h4>{faq.q}</h4>
                <p>{faq.a}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.ctaBand}>
          <div className={styles.ctaInner}>
            <h2>Listo para el siguiente show</h2>
            <p>Explora la cartelera o inicia sesión para ver tus boletos.</p>
            <div className={styles.ctaActions}>
              <Link href="/events" className={styles.btnPrimary}>
                Ver eventos
              </Link>
              <Link href="/login" className={styles.btnOutlineLight}>
                Entrar
              </Link>
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerContent}>
            <div className={styles.footerBrand}>
              <p className={styles.footerBrandName}>BOLETERA</p>
              <p className={styles.footerTagline}>Taquilla digital para México.</p>
            </div>
            <nav className={styles.footerNav}>
              <div>
                <h4>Plataforma</h4>
                <Link href="/events">Eventos</Link>
                <Link href="/resale">Reventa</Link>
                <Link href="/cart">Carrito</Link>
              </div>
              <div>
                <h4>Cuenta</h4>
                <Link href="/cuenta">Mis boletos</Link>
                <Link href="/login">Entrar</Link>
                <Link href="/login/forgot">Recuperar contraseña</Link>
              </div>
              <div>
                <h4>Legal</h4>
                <Link href="/ayuda">Ayuda</Link>
                <Link href="/terminos">Términos</Link>
                <Link href="/privacidad">Privacidad</Link>
              </div>
            </nav>
          </div>
          <div className={styles.footerBottom}>
            <p>© {new Date().getFullYear()} Boletera. Pagos vía Banorte.</p>
          </div>
        </footer>
      </main>
    </>
  );
}

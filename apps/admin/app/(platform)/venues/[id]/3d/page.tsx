'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState, PageHeader, Skeleton } from '@boletera/ui';
import { Venue3DStudio } from '@/components/venue-3d-studio';
import { useVenueLayout } from '@/lib/queries/venues';
import styles from '../../venues.module.scss';

export default function Venue3DPage() {
  const { id } = useParams<{ id: string }>();
  const venueId = String(id ?? '');
  const layoutQuery = useVenueLayout(venueId);

  const venueName = layoutQuery.data?.venue.name ?? 'Venue';
  const hasMap = Boolean(layoutQuery.data?.layout.mapData);

  if (layoutQuery.isPending) {
    return (
      <div className={styles.studioPage} aria-busy="true" aria-label="Cargando vista 3D">
        <Skeleton shape="text" width="36%" height={28} />
        <Skeleton shape="rect" height={520} delay={60} />
      </div>
    );
  }

  if (layoutQuery.error) {
    return (
      <div className={styles.studioPage}>
        <PageHeader
          eyebrow="Venues · 3D"
          title="Vista 3D"
          description="No se pudo cargar el layout del recinto."
          breadcrumbs={[
            { label: 'Venues', href: '/venues' },
            { label: '3D' },
          ]}
        />
        <EmptyState
          title="Layout no disponible"
          description={
            layoutQuery.error instanceof Error
              ? layoutQuery.error.message
              : 'Revisa el portafolio e intenta de nuevo.'
          }
          illustration="error"
          tone="danger"
          action={
            <Link href="/venues" className={styles.secondaryLink}>
              Volver al portafolio
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.studioPage}>
      <PageHeader
        eyebrow="Venues · 3D"
        title={venueName}
        description={
          hasMap
            ? 'Exploración espacial del layout activo. Edita asientos y zonas en el constructor 2D.'
            : 'Sin layout activo todavía. Abre el constructor para configurar el mapa.'
        }
        breadcrumbs={[
          { label: 'Venues', href: '/venues' },
          { label: venueName, href: `/venues?venue=${venueId}` },
          { label: '3D' },
        ]}
        actions={
          <div className={styles.studioActions}>
            <Link href={`/venues/${venueId}/map`} className={styles.primaryLink}>
              Abrir constructor
            </Link>
            <Link href="/venues" className={styles.secondaryLink}>
              Portafolio
            </Link>
          </div>
        }
      />

      {!hasMap ? (
        <EmptyState
          title="Sin mapa para renderizar"
          description="Crea o activa un layout en el constructor antes de explorar en 3D."
          illustration="seats"
          action={
            <Link href={`/venues/${venueId}/map`} className={styles.primaryLink}>
              Ir al constructor
            </Link>
          }
        />
      ) : (
        <div className={styles.studioFrame}>
          <Venue3DStudio venueId={venueId} />
        </div>
      )}
    </div>
  );
}

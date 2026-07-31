'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@boletera/ui';
import { SeatMapEditor } from '@/components/SeatMapEditor';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { useEvents } from '@/lib/queries/events';
import {
  useApplyLayoutTemplate,
  useSaveVenueLayout,
  useSuggestLayout,
  useVenueLayout,
} from '@/lib/queries/venues';
import { getTokenStorage } from '@/lib/session';
import { useSession } from '@/lib/use-session';
import styles from '../../venues.module.scss';

type PublishResult = {
  totalSeats: number;
  sections: number;
};

export default function VenueMapEditorPage() {
  const { id } = useParams<{ id: string }>();
  const venueId = String(id ?? '');
  const toast = useToast();
  const { can } = useSession();
  const canWriteEvent = can('event:write');

  const layoutQuery = useVenueLayout(venueId);
  const eventsQuery = useEvents();
  const saveLayout = useSaveVenueLayout(venueId);
  const applyTemplate = useApplyLayoutTemplate(venueId);
  const suggestLayout = useSuggestLayout(venueId);

  const venueEvents = useMemo(
    () => (eventsQuery.data ?? []).filter((event) => event.venueId === venueId),
    [eventsQuery.data, venueId],
  );

  const [publishEventId, setPublishEventId] = useState('');
  const [publishing, setPublishing] = useState(false);

  const selectedPublishId = publishEventId || venueEvents[0]?.id || '';
  const mapData = layoutQuery.data?.layout.mapData ?? null;
  const venueName = layoutQuery.data?.venue.name ?? 'Venue';

  async function handlePublish() {
    if (!canWriteEvent || !selectedPublishId) return;
    setPublishing(true);
    try {
      const result = await http<PublishResult>(`/events/${selectedPublishId}/publish`, {
        method: 'POST',
      });
      toast.success(
        `Publicado: ${result.totalSeats.toLocaleString('es-MX')} boletos en ${result.sections.toLocaleString('es-MX')} zonas`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo publicar');
    } finally {
      setPublishing(false);
    }
  }

  if (layoutQuery.isPending) {
    return (
      <div className={styles.studioPage} aria-busy="true" aria-label="Cargando layout">
        <Skeleton shape="text" width="40%" height={28} />
        <Skeleton shape="rect" height={480} delay={60} />
      </div>
    );
  }

  if (layoutQuery.error || !mapData) {
    return (
      <div className={styles.studioPage}>
        <PageHeader
          eyebrow="Venues"
          title="Layout del recinto"
          description="No se pudo cargar el mapa activo."
          breadcrumbs={[
            { label: 'Venues', href: '/venues' },
            { label: 'Layout' },
          ]}
        />
        <EmptyState
          title="Layout no disponible"
          description={
            layoutQuery.error instanceof Error
              ? layoutQuery.error.message
              : 'Este venue aún no tiene un layout activo.'
          }
          illustration="error"
          tone="danger"
          action={
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={() => void layoutQuery.refetch()}>
                Reintentar
              </Button>
              <Link href="/venues" className={styles.secondaryLink}>
                Volver al portafolio
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.studioPage}>
      <PageHeader
        eyebrow="Layout · 2D"
        title={venueName}
        description="Constructor de mapa · misma geometría que la vista 3D · Ctrl/⌘+S para guardar"
        breadcrumbs={[
          { label: 'Venues', href: '/venues' },
          { label: venueName, href: `/venues?venue=${venueId}` },
          { label: 'Layout' },
        ]}
        actions={
          <div className={styles.studioActions}>
            {canWriteEvent && venueEvents.length > 0 ? (
              <>
                <label className={styles.selectField}>
                  <span className={styles.srOnly}>Evento para publicar</span>
                  <select
                    value={selectedPublishId}
                    onChange={(event) => setPublishEventId(event.target.value)}
                    aria-label="Evento para publicar inventario"
                  >
                    {venueEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={!selectedPublishId || publishing}
                  onClick={() => void handlePublish()}
                >
                  {publishing ? 'Publicando…' : 'Publicar en evento'}
                </Button>
              </>
            ) : null}
            <Link href={`/venues/${venueId}/3d`} className={styles.secondaryLink}>
              Vista 3D
            </Link>
            <Link href="/venues" className={styles.mapLink}>
              Portafolio
            </Link>
          </div>
        }
      />

      <div className={styles.studioFrame}>
        <SeatMapEditor
          initial={mapData}
          venueId={venueId}
          getAuthToken={() => getTokenStorage().getToken()}
          onSave={async (nextMap) => {
            await saveLayout.mutateAsync(nextMap);
            toast.success('Layout guardado');
          }}
          onApplyTemplate={async (template) => {
            const result = await applyTemplate.mutateAsync({ template });
            toast.success('Plantilla aplicada');
            return result.layout.mapData;
          }}
          onAiSuggest={async (description) => {
            const result = await suggestLayout.mutateAsync(description);
            return result.layout.mapData;
          }}
        />
      </div>
    </div>
  );
}

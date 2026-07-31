'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Tabs,
  type TabItem,
} from '@boletera/ui';
import type {
  EventSalesPaceRow,
  MetricsAlert,
  MetricsTimePoint,
} from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useAccessMetrics,
  useAuditLog,
  useCampaignMetrics,
  useCampaigns,
  useChannelHealth,
  useConfigureChannels,
  useEventHub,
  useEventSalesPace,
  useInventoryMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
  usePublishEvent,
  useSetEventPricing,
  useUpdateOffer,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { AccessPanel } from './AccessPanel';
import { ActivityPanel } from './ActivityPanel';
import { ChannelsPanel, type ChannelPct } from './ChannelsPanel';
import { InventoryPanel } from './InventoryPanel';
import { MarketingPanel } from './MarketingPanel';
import { OverviewPanel } from './OverviewPanel';
import { PricingPanel } from './PricingPanel';
import { ScheduleTab } from './ScheduleTab';
import { formatDateTime, formatPercentPoints, riskLabel, riskTone, statusTone } from './format';
import { buildHubMetricsRange } from './range';
import { HUB_TAB_LABELS, type HubTab } from './tabs';
import { useHubTab } from './use-hub-tab';
import styles from './event-hub.module.scss';

function parseChannelAllocation(metadata: Record<string, unknown>): ChannelPct {
  const raw = metadata.channels ?? metadata.channelAllocation;
  if (!raw || typeof raw !== 'object') {
    return { web: 50, taquilla: 35, api: 15 };
  }

  const readAllocation = (key: string): number | null => {
    if (!(key in raw)) return null;
    const entry = (raw as Record<string, unknown>)[key];
    if (!entry || typeof entry !== 'object' || !('allocation' in entry)) return null;
    const value = (entry as { allocation?: unknown }).allocation;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  return {
    web: readAllocation('web') ?? 50,
    taquilla: readAllocation('taquilla') ?? 35,
    api: readAllocation('api') ?? 15,
  };
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

export default function EventHubPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = String(id ?? '');
  const [tab, setTab] = useHubTab();
  const toast = useToast();
  const session = useSession();

  const canWriteEvent = session.can('event:write');
  const canWritePrice = session.can('price:write');
  const canReadAudit = session.can('audit:read');
  const canManageVenue = session.can('venue:manage');
  const canReadAnalytics = session.can('analytics:read');

  const range = useMemo(() => buildHubMetricsRange(), []);
  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      eventId,
      organizationId: session.organizationId ?? undefined,
    }),
    [eventId, range.from, range.to, session.organizationId],
  );

  const hubQuery = useEventHub(eventId);
  const healthQuery = useChannelHealth(eventId);
  const paceQuery = useEventSalesPace(metricsParams);
  const inventoryQuery = useInventoryMetrics(metricsParams);
  const timeseriesQuery = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'revenue',
  });
  const alertsQuery = useMetricsAlerts(metricsParams);
  const accessQuery = useAccessMetrics(metricsParams);
  const campaignMetricsQuery = useCampaignMetrics(metricsParams);
  const campaignsQuery = useCampaigns(eventId);
  const auditQuery = useAuditLog(canReadAudit ? session.organizationId : null, 120);

  const publishMutation = usePublishEvent(eventId);
  const updateOfferMutation = useUpdateOffer(eventId);
  const setPricingMutation = useSetEventPricing(eventId);
  const configureChannelsMutation = useConfigureChannels(eventId);

  const [pricingSaving, setPricingSaving] = useState<string | null>(null);

  const hub = hubQuery.data;
  const initialChannels = useMemo(
    () => parseChannelAllocation(hub?.metadata ?? {}),
    [hub?.metadata],
  );

  const paceRow = useMemo((): EventSalesPaceRow | null => {
    const rows = paceQuery.data?.events ?? [];
    return rows.find((row) => row.eventId === eventId) ?? null;
  }, [paceQuery.data?.events, eventId]);

  const curvePoints = useMemo(
    (): readonly MetricsTimePoint[] => timeseriesQuery.data?.series?.[0]?.points ?? [],
    [timeseriesQuery.data?.series],
  );

  const eventAlerts = useMemo((): readonly MetricsAlert[] => {
    const list = alertsQuery.data?.alerts ?? [];
    return list.filter(
      (alert) => alert.entityId === eventId || alert.entityType === 'event',
    );
  }, [alertsQuery.data?.alerts, eventId]);

  const tabItems: TabItem[] = useMemo(
    () =>
      (Object.keys(HUB_TAB_LABELS) as HubTab[]).map((key) => ({
        id: key,
        label: HUB_TAB_LABELS[key],
      })),
    [],
  );

  async function handlePublish() {
    if (!canWriteEvent) {
      toast.error('No tienes permiso event:write');
      return;
    }
    if (
      !confirm(
        '¿Publicar el inventario de este evento? Esto genera los boletos vendibles a partir del mapa guardado.',
      )
    ) {
      return;
    }
    try {
      const result = await publishMutation.mutateAsync();
      toast.success(`Publicado: ${result.totalSeats} boletos en ${result.sections} zonas`);
      void hubQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al publicar');
    }
  }

  async function handleSaveOffer(offerId: string, price: number) {
    setPricingSaving(offerId);
    try {
      await updateOfferMutation.mutateAsync({ offerId, basePrice: price });
      toast.success('Precio actualizado');
      void hubQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el precio');
    } finally {
      setPricingSaving(null);
    }
  }

  async function handleSaveDynamic(enabled: boolean, basePrice: number) {
    try {
      await setPricingMutation.mutateAsync({
        basePrice,
        dynamicPricingEnabled: enabled,
      });
      toast.success('Pricing dinámico actualizado');
      void hubQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al guardar el pricing dinámico',
      );
    }
  }

  async function handleSaveChannels(channels: ChannelPct) {
    try {
      await configureChannelsMutation.mutateAsync({
        web: { enabled: true, allocation: channels.web },
        taquilla: { enabled: true, allocation: channels.taquilla, locations: [] },
        api: { enabled: true, allocation: channels.api },
      });
      toast.success('Canales guardados');
      void hubQuery.refetch();
      void healthQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar');
    }
  }

  if (hubQuery.isPending) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Cargando centro de mando…"
          description="Obteniendo el hub del evento."
          illustration="inbox"
        />
      </div>
    );
  }

  if (hubQuery.error || !hub) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="No se pudo cargar el evento"
          description={
            hubQuery.error instanceof Error
              ? hubQuery.error.message
              : 'El evento no existe o no tienes acceso.'
          }
          illustration="error"
          tone="danger"
          action={
            <Link href="/events">
              <Button type="button" variant="secondary" size="sm">
                Volver a eventos
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { event, inventory } = hub;
  const venueId = event.venue?.id ?? event.venueId ?? '';
  const metricsErrorBanner = Boolean(
    paceQuery.error || timeseriesQuery.error || alertsQuery.error || inventoryQuery.error,
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Centro de mando"
        title={event.title}
        description={`${event.venue?.name ?? 'Sin venue'} · ${formatDateTime(event.startsAt)} · ${formatPercentPoints(inventory.occupancyPercent)} ocupación`}
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Eventos', href: '/events' },
          { label: event.title },
        ]}
        actions={
          <div className={styles.headerActions}>
            {canWriteEvent ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={publishMutation.isPending}
                onClick={() => void handlePublish()}
              >
                {publishMutation.isPending ? 'Publicando…' : 'Publicar inventario'}
              </Button>
            ) : null}
            {venueId && canManageVenue ? (
              <>
                <Link href={`/venues/${venueId}/map`}>
                  <Button type="button" variant="outline" size="sm">
                    Layout
                  </Button>
                </Link>
                <Link href={`/venues/${venueId}/3d`}>
                  <Button type="button" variant="ghost" size="sm">
                    Vista 3D
                  </Button>
                </Link>
              </>
            ) : null}
            <Link href="/events">
              <Button type="button" variant="ghost" size="sm">
                ← Eventos
              </Button>
            </Link>
          </div>
        }
      >
        <div className={styles.statusRow}>
          <Badge tone={statusTone(event.status)} variant="soft" size="sm" dot>
            {event.status}
          </Badge>
          {paceRow ? (
            <Badge
              tone={riskTone(paceRow.riskLevel)}
              variant="outline"
              size="sm"
            >
              Ritmo: {riskLabel(paceRow.riskLevel)}
            </Badge>
          ) : null}
          {!canReadAnalytics ? (
            <Badge tone="neutral" variant="outline" size="sm">
              Sin analytics:read — métricas pueden fallar
            </Badge>
          ) : null}
        </div>
      </PageHeader>

      {metricsErrorBanner ? (
        <div className={styles.errorBanner} role="alert">
          <div>
            <strong>No se pudieron cargar algunas métricas</strong>
            <p>El hub del evento sigue disponible. Reintenta las series y alertas.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void paceQuery.refetch();
              void timeseriesQuery.refetch();
              void alertsQuery.refetch();
              void inventoryQuery.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      <Tabs
        items={tabItems}
        value={tab}
        onValueChange={(id) => setTab(id as HubTab)}
        label="Secciones del evento"
        fullWidth
      />

      {tab === 'overview' ? (
        <OverviewPanel
          hub={hub}
          pace={paceRow}
          paceLoading={paceQuery.isPending}
          paceError={errorMessage(paceQuery.error)}
          curvePoints={curvePoints}
          curveLoading={timeseriesQuery.isPending}
          curveError={errorMessage(timeseriesQuery.error)}
          alerts={eventAlerts}
          alertsLoading={alertsQuery.isPending}
          alertsError={errorMessage(alertsQuery.error)}
        />
      ) : null}

      {tab === 'inventory' ? (
        <InventoryPanel
          eventId={eventId}
          hub={hub}
          inventoryMetrics={inventoryQuery.data}
          inventoryLoading={inventoryQuery.isPending}
          inventoryError={errorMessage(inventoryQuery.error)}
          canManageVenue={canManageVenue}
        />
      ) : null}

      {tab === 'pricing' ? (
        <PricingPanel
          hub={hub}
          canWritePrice={canWritePrice}
          pricingSaving={pricingSaving}
          dynamicSaving={setPricingMutation.isPending}
          onSaveOffer={handleSaveOffer}
          onSaveDynamic={handleSaveDynamic}
        />
      ) : null}

      {tab === 'schedule' ? (
        <div
          className={styles.tabPanel}
          role="tabpanel"
          id="hub-panel-schedule"
          aria-labelledby="hub-tab-schedule"
        >
          <ScheduleTab
            eventId={eventId}
            onChanged={() => void hubQuery.refetch()}
            canWrite={canWriteEvent}
          />
        </div>
      ) : null}

      {tab === 'channels' ? (
        <ChannelsPanel
          initialChannels={initialChannels}
          health={healthQuery.data}
          healthLoading={healthQuery.isPending}
          healthError={errorMessage(healthQuery.error)}
          canWrite={canWriteEvent}
          saving={configureChannelsMutation.isPending}
          onSave={handleSaveChannels}
        />
      ) : null}

      {tab === 'marketing' ? (
        <MarketingPanel
          campaigns={campaignsQuery.data}
          campaignsLoading={campaignsQuery.isPending}
          campaignsError={errorMessage(campaignsQuery.error)}
          funnel={campaignMetricsQuery.data}
          funnelLoading={campaignMetricsQuery.isPending}
          funnelError={errorMessage(campaignMetricsQuery.error)}
        />
      ) : null}

      {tab === 'access' ? (
        <AccessPanel
          access={accessQuery.data}
          loading={accessQuery.isPending}
          error={errorMessage(accessQuery.error)}
        />
      ) : null}

      {tab === 'activity' ? (
        <ActivityPanel
          eventId={eventId}
          entries={auditQuery.data}
          loading={auditQuery.isPending}
          error={errorMessage(auditQuery.error)}
          canReadAudit={canReadAudit}
        />
      ) : null}
    </div>
  );
}

'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { Badge } from '@boletera/ui/src/components/Badge';
import { Button } from '@boletera/ui/src/components/Button';
import { PageHeader } from '@boletera/ui/src/components/PageHeader';
import {
  useAccessMetrics,
  useCampaignMetrics,
  useEventSalesPace,
  useExecutiveMetrics,
  useFraudMetrics,
  useInventoryMetrics,
  useMetricsAlerts,
  useMetricsTimeseries,
  useOrdersMetrics,
  useResaleMetrics,
  useSettlementsMetrics,
  useWaitlistMetrics,
} from '@/lib/queries';
import { AccessSection } from './_components/AccessSection';
import { AlertsPanel } from './_components/AlertsPanel';
import { AnalyticsToolbar } from './_components/AnalyticsToolbar';
import { FunnelsSection } from './_components/FunnelsSection';
import { InsightsPanel } from './_components/InsightsPanel';
import { InventorySection } from './_components/InventorySection';
import { OrdersSection } from './_components/OrdersSection';
import { OverviewSection } from './_components/OverviewSection';
import { RiskSection } from './_components/RiskSection';
import { SalesPaceSection } from './_components/SalesPaceSection';
import { SettlementsSection } from './_components/SettlementsSection';
import { formatTimestamp } from './_lib/format';
import { buildInsights } from './_lib/insights';
import {
  COMPARISON_MODES,
  RANGE_PRESETS,
  coerceGranularity,
  comparisonRange,
  formatRangeLabel,
} from './_lib/range';
import { useAnalyticsUrlState } from './_lib/use-analytics-url-state';
import styles from './analytics.module.scss';

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.workspace} aria-busy="true">
          <PageHeader
            eyebrow="Business Intelligence"
            title="Analítica"
            description="Cargando panel…"
            breadcrumbs={[
              { label: 'Plataforma', href: '/dashboard' },
              { label: 'Analítica' },
            ]}
            bordered
          />
        </div>
      }
    >
      <AnalyticsPageContent />
    </Suspense>
  );
}

function AnalyticsPageContent() {
  const {
    view,
    preset,
    range,
    comparison,
    metric,
    granularity,
    eventId,
    setView,
    setPreset,
    setCustomRange,
    setComparison,
    setMetric,
    setGranularity,
    setEventId,
  } = useAnalyticsUrlState();

  const effectiveGranularity = coerceGranularity(granularity, range);

  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      eventId: eventId || undefined,
    }),
    [eventId, range.from, range.to],
  );

  const previousRange = useMemo(
    () => comparisonRange(range, comparison),
    [comparison, range],
  );

  const comparisonLabel =
    COMPARISON_MODES.find((mode) => mode.id === comparison)?.label ?? 'Periodo anterior';

  const executive = useExecutiveMetrics(metricsParams);
  const timeseries = useMetricsTimeseries({
    ...metricsParams,
    granularity: effectiveGranularity,
    metric,
  });
  const comparisonTimeseries = useMetricsTimeseries({
    from: previousRange?.from,
    to: previousRange?.to,
    eventId: metricsParams.eventId,
    granularity: effectiveGranularity,
    metric,
  });
  const salesPace = useEventSalesPace(metricsParams);
  const inventory = useInventoryMetrics(metricsParams);
  const orders = useOrdersMetrics(metricsParams);
  const access = useAccessMetrics(metricsParams);
  const resale = useResaleMetrics(metricsParams);
  const waitlist = useWaitlistMetrics(metricsParams);
  const campaigns = useCampaignMetrics(metricsParams);
  const fraud = useFraudMetrics(metricsParams);
  const settlements = useSettlementsMetrics(metricsParams);
  const alerts = useMetricsAlerts(metricsParams);

  const eventOptions = useMemo(
    () =>
      (salesPace.data?.events ?? []).map((event) => ({
        id: event.eventId,
        title: event.title,
      })),
    [salesPace.data?.events],
  );

  const insights = useMemo(
    () =>
      buildInsights({
        executive: executive.data,
        pace: salesPace.data,
        inventory: inventory.data,
        orders: orders.data,
        campaigns: campaigns.data,
        waitlist: waitlist.data,
        access: access.data,
        comparisonLabel,
      }),
    [
      access.data,
      campaigns.data,
      comparisonLabel,
      executive.data,
      inventory.data,
      orders.data,
      salesPace.data,
      waitlist.data,
    ],
  );

  const generatedAt =
    executive.data?.generatedAt ??
    timeseries.data?.generatedAt ??
    alerts.data?.generatedAt ??
    null;

  const refetchAll = useCallback(() => {
    void executive.refetch();
    void timeseries.refetch();
    void comparisonTimeseries.refetch();
    void salesPace.refetch();
    void inventory.refetch();
    void orders.refetch();
    void access.refetch();
    void resale.refetch();
    void waitlist.refetch();
    void campaigns.refetch();
    void fraud.refetch();
    void settlements.refetch();
    void alerts.refetch();
  }, [
    access,
    alerts,
    campaigns,
    comparisonTimeseries,
    executive,
    fraud,
    inventory,
    orders,
    resale,
    salesPace,
    settlements,
    timeseries,
    waitlist,
  ]);

  const presetLabel =
    RANGE_PRESETS.find((item) => item.id === preset)?.label ?? formatRangeLabel(range);

  return (
    <div className={styles.workspace}>
      <PageHeader
        eyebrow="Business Intelligence"
        title="Analítica"
        description="KPIs, series, embudos, inventario, riesgo y liquidaciones · MXN · America/Mexico_City"
        breadcrumbs={[
          { label: 'Plataforma', href: '/dashboard' },
          { label: 'Analítica' },
        ]}
        actions={
          <div className={styles.headerActions}>
            {generatedAt ? (
              <Badge tone="neutral" variant="outline" size="sm" dot>
                Actualizado {formatTimestamp(generatedAt)}
              </Badge>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={refetchAll}>
              Actualizar
            </Button>
          </div>
        }
        bordered
      >
        <div className={styles.headerMeta} role="status">
          <span>{presetLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRangeLabel(range)}</span>
          {comparison !== 'none' ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Comparando con {comparisonLabel.toLowerCase()}</span>
            </>
          ) : null}
          {eventId ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Filtrado por evento</span>
            </>
          ) : null}
        </div>

        <AnalyticsToolbar
          view={view}
          onViewChange={setView}
          preset={preset}
          onPresetChange={setPreset}
          range={range}
          onCustomRangeChange={setCustomRange}
          comparison={comparison}
          onComparisonChange={setComparison}
          metric={metric}
          onMetricChange={setMetric}
          granularity={effectiveGranularity}
          onGranularityChange={setGranularity}
          eventId={eventId}
          onEventChange={setEventId}
          events={eventOptions}
          eventsLoading={salesPace.isPending}
        />
      </PageHeader>

      {view === 'overview' ? (
        <OverviewSection
          executive={executive.data}
          executivePending={executive.isPending}
          executiveError={executive.error}
          onRetryExecutive={() => void executive.refetch()}
          timeseries={timeseries.data}
          timeseriesPending={timeseries.isPending}
          timeseriesError={timeseries.error}
          onRetryTimeseries={() => void timeseries.refetch()}
          comparisonTimeseries={
            comparison === 'none' ? undefined : comparisonTimeseries.data
          }
          metric={metric}
          granularity={effectiveGranularity}
          comparisonLabel={comparisonLabel}
          showComparison={comparison !== 'none'}
        />
      ) : null}

      {view === 'sales' ? (
        <SalesPaceSection
          data={salesPace.data}
          isPending={salesPace.isPending}
          error={salesPace.error}
          onRetry={() => void salesPace.refetch()}
        />
      ) : null}

      {view === 'inventory' ? (
        <InventorySection
          data={inventory.data}
          isPending={inventory.isPending}
          error={inventory.error}
          onRetry={() => void inventory.refetch()}
        />
      ) : null}

      {view === 'orders' ? (
        <OrdersSection
          data={orders.data}
          isPending={orders.isPending}
          error={orders.error}
          onRetry={() => void orders.refetch()}
          comparisonLabel={comparisonLabel}
        />
      ) : null}

      {view === 'access' ? (
        <AccessSection
          data={access.data}
          isPending={access.isPending}
          error={access.error}
          onRetry={() => void access.refetch()}
        />
      ) : null}

      {view === 'funnels' ? (
        <FunnelsSection
          waitlist={waitlist.data}
          waitlistPending={waitlist.isPending}
          waitlistError={waitlist.error}
          onRetryWaitlist={() => void waitlist.refetch()}
          campaigns={campaigns.data}
          campaignsPending={campaigns.isPending}
          campaignsError={campaigns.error}
          onRetryCampaigns={() => void campaigns.refetch()}
        />
      ) : null}

      {view === 'risk' ? (
        <RiskSection
          fraud={fraud.data}
          fraudPending={fraud.isPending}
          fraudError={fraud.error}
          onRetryFraud={() => void fraud.refetch()}
          resale={resale.data}
          resalePending={resale.isPending}
          resaleError={resale.error}
          onRetryResale={() => void resale.refetch()}
        />
      ) : null}

      {view === 'settlements' ? (
        <SettlementsSection
          data={settlements.data}
          isPending={settlements.isPending}
          error={settlements.error}
          onRetry={() => void settlements.refetch()}
        />
      ) : null}

      {view === 'overview' || view === 'risk' ? (
        <div className={styles.grid}>
          <div className={styles.span6}>
            <InsightsPanel insights={insights} />
          </div>
          <div className={styles.span6}>
            <AlertsPanel
              alerts={alerts.data?.alerts}
              counts={alerts.data?.countsBySeverity}
              isPending={alerts.isPending}
              error={alerts.error}
              onRetry={() => void alerts.refetch()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AreaChart,
  Badge,
  Button,
  EmptyState,
  FunnelChart,
  KpiCard,
  SegmentedControl,
} from '@boletera/ui';
import { formatCurrency, formatNumber } from '@boletera/ui';
import {
  useCampaignAnalytics,
  useCampaignMetrics,
  useCampaigns,
  useCreateCampaign,
  useEvents,
  useExportPresaleCodes,
  useMetricsAlerts,
  useMetricsTimeseries,
  usePublishCampaign,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { CampaignComposer, type ComposerPayload } from './CampaignComposer';
import {
  RANGE_KEYS,
  buildCalendar,
  buildRecommendations,
  buildRange,
  campaignStatusMeta,
  campaignTypeLabel,
  discountLabel,
  formatCount,
  formatDateShort,
  formatDateTime,
  formatMxn,
  formatPercentPoints,
  formatRatio,
  formatRelative,
  parseCampaignAnalytics,
  performanceMeta,
  severityMeta,
  summarizeAllocation,
  summarizeRevenue,
  toCampaignView,
  type CampaignView,
  type RangeKey,
  type Recommendation,
} from './model';
import styles from './campaigns.module.scss';

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function CampaignsPage() {
  const { organizationId } = useSession();
  const eventsQuery = useEvents();
  const [eventId, setEventId] = useState('');
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const range = useMemo(() => buildRange(rangeKey), [rangeKey]);
  const metricsParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      organizationId: organizationId ?? undefined,
      eventId: eventId || undefined,
    }),
    [eventId, organizationId, range.from, range.to],
  );

  useEffect(() => {
    if (!eventId && eventsQuery.data?.[0]) {
      setEventId(eventsQuery.data[0].id);
    }
  }, [eventId, eventsQuery.data]);

  const campaignsQuery = useCampaigns(eventId);
  const campaignMetrics = useCampaignMetrics(metricsParams);
  const timeseries = useMetricsTimeseries({
    ...metricsParams,
    granularity: range.granularity,
    metric: 'revenue',
  });
  const alerts = useMetricsAlerts(metricsParams);

  const createCampaign = useCreateCampaign(organizationId ?? '', eventId);
  const publishCampaign = usePublishCampaign(eventId);
  const exportCodes = useExportPresaleCodes();

  const campaigns = useMemo(
    () => (campaignsQuery.data ?? []).map((item) => toCampaignView(item)),
    [campaignsQuery.data],
  );

  useEffect(() => {
    if (!selectedId && campaigns[0]) setSelectedId(campaigns[0].id);
    if (selectedId && !campaigns.some((item) => item.id === selectedId)) {
      setSelectedId(campaigns[0]?.id ?? null);
    }
  }, [campaigns, selectedId]);

  const selected = campaigns.find((item) => item.id === selectedId) ?? null;
  const analyticsQuery = useCampaignAnalytics(selected?.id ?? '');
  const analytics = useMemo(
    () => parseCampaignAnalytics(analyticsQuery.data),
    [analyticsQuery.data],
  );

  const allocation = useMemo(() => summarizeAllocation(campaigns), [campaigns]);
  const promotions = campaignMetrics.data?.promotions ?? [];
  const revenue = useMemo(() => summarizeRevenue(promotions), [promotions]);
  const calendar = useMemo(() => buildCalendar(campaigns), [campaigns]);
  const recommendations = useMemo(
    () => buildRecommendations(campaigns, promotions, revenue),
    [campaigns, promotions, revenue],
  );

  const funnelStages = useMemo(() => {
    const stages = campaignMetrics.data?.funnel.stages ?? [];
    return stages.map((stage) => ({
      id: stage.key,
      label: stage.label,
      value: stage.count,
    }));
  }, [campaignMetrics.data?.funnel.stages]);

  const revenueSeries = useMemo(() => {
    const points = timeseries.data?.series?.[0]?.points ?? [];
    return [
      {
        id: 'revenue',
        name: 'Ingreso',
        data: points.map((point) => ({
          label:
            range.granularity === 'week'
              ? formatDateShort(point.bucket)
              : formatDateShort(point.bucket),
          value: point.value,
        })),
      },
    ];
  }, [range.granularity, timeseries.data?.series]);

  const selectedEvent = eventsQuery.data?.find((event) => event.id === eventId);
  const anyError =
    campaignsQuery.error ||
    campaignMetrics.error ||
    timeseries.error ||
    eventsQuery.error ||
    actionError;
  const generatedAt =
    campaignMetrics.data?.generatedAt ??
    timeseries.data?.generatedAt ??
    alerts.data?.generatedAt ??
    null;

  async function handleCreate(payload: ComposerPayload) {
    if (!organizationId || !eventId) {
      setComposerError('Selecciona un evento e inicia sesión con una organización.');
      return;
    }
    setComposerError(null);
    try {
      const created = await createCampaign.mutateAsync({ ...payload });
      setComposerOpen(false);
      setSelectedId(created.id);
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : 'No se pudo crear la campaña.',
      );
    }
  }

  async function handlePublish(campaignId: string) {
    setActionError(null);
    try {
      await publishCampaign.mutateAsync(campaignId);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'No se pudo publicar la campaña.',
      );
    }
  }

  async function handleExport(campaign: CampaignView) {
    setActionError(null);
    try {
      const csv = await exportCodes.mutateAsync(campaign.id);
      downloadCsv(`presale-${campaign.id}.csv`, csv);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'No se pudieron exportar los códigos.',
      );
    }
  }

  async function runRecommendation(recommendation: Recommendation) {
    const action = recommendation.action;
    if (!action) return;
    if (action.kind === 'compose') {
      setComposerOpen(true);
      return;
    }
    if (action.kind === 'publish') {
      await handlePublish(action.campaignId);
      return;
    }
    const target = campaigns.find((item) => item.id === action.campaignId);
    if (target) await handleExport(target);
  }

  const noEvents = !eventsQuery.isPending && (eventsQuery.data?.length ?? 0) === 0;

  return (
    <div className={styles.wrap}>
      <header className={styles.pageHeader}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrowRow}>
            <p className={styles.eyebrow}>Revenue · Marketing</p>
            {generatedAt ? (
              <Badge tone="neutral" variant="outline" size="sm" dot>
                Actualizado {formatRelative(generatedAt)}
              </Badge>
            ) : null}
          </div>
          <h1>Campañas y atribución</h1>
          <p className={styles.lead}>
            Embudo, ROAS, cupos y códigos de preventa por evento · MXN · Ciudad de México
          </p>
        </div>

        <div className={styles.headerControls}>
          <label className={styles.srOnly} htmlFor="campaign-event">
            Evento
          </label>
          <select
            id="campaign-event"
            className={styles.eventSelect}
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            disabled={eventsQuery.isPending || noEvents}
          >
            {noEvents ? <option value="">Sin eventos</option> : null}
            {(eventsQuery.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>

          <SegmentedControl
            label="Rango temporal"
            size="sm"
            value={rangeKey}
            onValueChange={(value) => setRangeKey(value)}
            options={RANGE_KEYS.map((key) => ({
              value: key,
              label: buildRange(key).label.replace(' días', 'd').replace('días', 'd'),
            }))}
          />

          <Button
            type="button"
            onClick={() => {
              setComposerError(null);
              setComposerOpen(true);
            }}
            disabled={!eventId || !organizationId}
          >
            Nueva campaña
          </Button>
        </div>
      </header>

      {anyError ? (
        <div className={styles.errorBanner} role="alert">
          <div>
            <strong>No se pudieron cargar o actualizar algunos datos</strong>
            <p>
              {typeof anyError === 'string'
                ? anyError
                : anyError instanceof Error
                  ? anyError.message
                  : 'Revisa la conexión o reintenta. El resto del panel sigue disponible.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setActionError(null);
              void eventsQuery.refetch();
              void campaignsQuery.refetch();
              void campaignMetrics.refetch();
              void timeseries.refetch();
              void alerts.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {noEvents ? (
        <section className={styles.panel}>
          <EmptyState
            title="Necesitas un evento para operar campañas"
            description="Las campañas, códigos y el embudo se anclan a un evento publicado. Crea uno y vuelve aquí."
            illustration="inbox"
            action={
              <Link href="/events/new">
                <Button type="button">Crear evento</Button>
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <section className={styles.kpiGrid} aria-label="Indicadores de campañas">
            <KpiCard
              label="Ingreso atribuido"
              value={campaignMetrics.isPending ? '—' : formatMxn(revenue.revenueAttributed)}
              unit="MXN"
              hint={range.comparisonLabel}
              loading={campaignMetrics.isPending}
              tone="accent"
            />
            <KpiCard
              label="ROAS del descuento"
              value={
                campaignMetrics.isPending
                  ? '—'
                  : revenue.roas === null
                    ? 'n/d'
                    : formatRatio(revenue.roas)
              }
              hint="Ingreso / descuento otorgado"
              loading={campaignMetrics.isPending}
              tone={
                revenue.roas === null
                  ? 'neutral'
                  : revenue.roas >= 3
                    ? 'success'
                    : revenue.roas >= 1.5
                      ? 'warning'
                      : 'danger'
              }
            />
            <KpiCard
              label="Órdenes atribuidas"
              value={campaignMetrics.isPending ? '—' : formatCount(revenue.ordersAttributed)}
              hint={`${formatMxn(revenue.discountGiven)} en descuentos`}
              loading={campaignMetrics.isPending}
            />
            <KpiCard
              label="Campañas activas"
              value={campaignsQuery.isPending ? '—' : formatCount(allocation.activeCount)}
              hint={`${formatCount(allocation.draftCount)} en borrador`}
              loading={campaignsQuery.isPending}
              tone="success"
            />
            <KpiCard
              label="Redención de cupo"
              value={
                campaignsQuery.isPending
                  ? '—'
                  : formatPercentPoints(allocation.redemptionRate)
              }
              hint={`${formatCount(allocation.redeemed)} / ${formatCount(allocation.allocation)}`}
              loading={campaignsQuery.isPending}
            />
            <KpiCard
              label="Códigos emitidos"
              value={campaignsQuery.isPending ? '—' : formatCount(allocation.codesIssued)}
              hint="Preventas con CSV disponible"
              loading={campaignsQuery.isPending}
              tone="info"
            />
          </section>

          <div className={styles.twoCol}>
            <section className={styles.panel} aria-labelledby="funnel-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="funnel-heading">Embudo de campañas</h2>
                  <p>
                    {campaignMetrics.data?.funnel.label ??
                      'Conversión desde exposición hasta orden atribuida'}
                  </p>
                </div>
                {revenue.averageConversion !== null ? (
                  <Badge tone="accent" variant="soft" size="sm">
                    Conv. media {formatPercentPoints(revenue.averageConversion)}
                  </Badge>
                ) : null}
              </div>

              {campaignMetrics.isPending ? (
                <div className={styles.skeleton} aria-busy="true" />
              ) : funnelStages.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin embudo en este rango"
                  description="Cuando haya actividad de códigos o promociones, verás la caída etapa a etapa."
                />
              ) : (
                <div className={styles.chartBlock}>
                  <FunnelChart
                    label="Embudo de campañas"
                    stages={funnelStages}
                    conversionBase="previous"
                    formatValue={(value) => formatNumber(value)}
                  />
                </div>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="series-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="series-heading">Ingreso en el tiempo</h2>
                  <p>
                    Serie {range.label.toLowerCase()} · granularidad{' '}
                    {range.granularity === 'week' ? 'semanal' : 'diaria'}
                  </p>
                </div>
              </div>
              {timeseries.isPending ? (
                <div className={styles.skeleton} aria-busy="true" />
              ) : revenueSeries[0]!.data.length < 2 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin serie suficiente"
                  description="Se necesitan al menos dos puntos del periodo para dibujar la tendencia."
                />
              ) : (
                <AreaChart
                  label="Ingreso atribuible en el periodo"
                  series={revenueSeries}
                  formatValue={(value) => formatCurrency(value, 0)}
                  height={220}
                />
              )}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="active-heading">
            <div className={styles.panelHead}>
              <div>
                <h2 id="active-heading">Campañas del evento</h2>
                <p>
                  {selectedEvent
                    ? `${selectedEvent.title} · publicar, exportar códigos y revisar cupo`
                    : 'Publicar, exportar códigos y revisar cupo'}
                </p>
              </div>
              {eventId ? (
                <Link href={`/events/${eventId}`}>
                  <Button type="button" variant="ghost" size="sm">
                    Hub del evento
                  </Button>
                </Link>
              ) : null}
            </div>

            {campaignsQuery.isPending ? (
              <div className={styles.listSkeleton} aria-busy="true">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={styles.skeletonRow} />
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <EmptyState
                size="sm"
                tone="neutral"
                illustration="inbox"
                title="Sin campañas para este evento"
                description="Crea una preventa o early bird en borrador. Solo se hace pública cuando tú lo indiques."
                action={
                  <Button type="button" onClick={() => setComposerOpen(true)}>
                    Crear campaña
                  </Button>
                }
              />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Campaña</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Ventana</th>
                      <th scope="col">Desc.</th>
                      <th scope="col">Cupo</th>
                      <th scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => {
                      const status = campaignStatusMeta(campaign.status);
                      const selectedRow = campaign.id === selectedId;
                      return (
                        <tr
                          key={campaign.id}
                          data-selected={selectedRow || undefined}
                          onClick={() => setSelectedId(campaign.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <div className={styles.rowTitle}>
                              <strong>{campaign.name}</strong>
                              <span>
                                {campaignTypeLabel(campaign.type)}
                                {campaign.codes.length > 0
                                  ? ` · ${formatCount(campaign.codes.length)} códigos`
                                  : ''}
                                {campaign.live ? ' · en vivo' : ''}
                              </span>
                            </div>
                          </td>
                          <td>
                            <Badge tone={status.tone} size="sm" variant="soft" dot>
                              {status.label}
                            </Badge>
                          </td>
                          <td>
                            {formatDateShort(campaign.startsAt)} →{' '}
                            {formatDateShort(campaign.endsAt)}
                          </td>
                          <td>{discountLabel(campaign)}</td>
                          <td>
                            <div className={styles.progressCell}>
                              <div className={styles.progressMeta}>
                                <span>
                                  {formatCount(campaign.redeemed)}/
                                  {formatCount(campaign.allocation)}
                                </span>
                                <span>{formatPercentPoints(campaign.redemptionRate)}</span>
                              </div>
                              <div
                                className={styles.track}
                                role="meter"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(campaign.redemptionRate)}
                                aria-label={`Redención de ${campaign.name}`}
                              >
                                <div
                                  className={styles.fill}
                                  style={{
                                    width: `${Math.min(100, Math.max(0, campaign.redemptionRate))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.actions}>
                              {campaign.status === 'DRAFT' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  loading={
                                    publishCampaign.isPending &&
                                    publishCampaign.variables === campaign.id
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handlePublish(campaign.id);
                                  }}
                                >
                                  Publicar
                                </Button>
                              ) : null}
                              {campaign.type === 'presale' && campaign.codes.length > 0 ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  loading={
                                    exportCodes.isPending &&
                                    exportCodes.variables === campaign.id
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleExport(campaign);
                                  }}
                                >
                                  CSV códigos
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className={styles.twoCol}>
            <section className={styles.panel} aria-labelledby="calendar-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="calendar-heading">Calendario de ventanas</h2>
                  <p>Línea temporal de campañas programadas para el evento</p>
                </div>
              </div>
              {!calendar ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="chart"
                  title="Sin ventanas calendarizadas"
                  description="Cuando las campañas tengan fecha de inicio y fin, aparecerán aquí."
                />
              ) : (
                <div className={styles.calendar} role="img" aria-label="Calendario de campañas">
                  <div className={styles.calendarAxis}>
                    {calendar.ticks.map((tick) => (
                      <span
                        key={tick.iso}
                        className={styles.calendarTick}
                        style={{ left: `${tick.percent}%` }}
                      >
                        {formatDateShort(tick.iso)}
                      </span>
                    ))}
                  </div>
                  <div className={styles.calendarRows}>
                    {calendar.bars.map((bar) => {
                      const barClass =
                        bar.status === 'ACTIVE'
                          ? styles.calendarBarActive
                          : bar.status === 'DRAFT'
                            ? styles.calendarBarDraft
                            : bar.status === 'PAUSED'
                              ? styles.calendarBarPaused
                              : styles.calendarBarEnded;
                      return (
                        <div key={bar.id} className={styles.calendarRow}>
                          <div className={styles.calendarLabel}>
                            <strong>{bar.name}</strong>
                            <span>
                              {formatDateShort(bar.startsAt)} – {formatDateShort(bar.endsAt)}
                            </span>
                          </div>
                          <div className={styles.calendarTrack}>
                            {calendar.todayPercent !== null ? (
                              <span
                                className={styles.calendarToday}
                                style={{ left: `${calendar.todayPercent}%` }}
                                title="Hoy"
                              />
                            ) : null}
                            <span
                              className={`${styles.calendarBar} ${barClass}`}
                              style={{
                                left: `${bar.offsetPercent}%`,
                                width: `${bar.widthPercent}%`,
                              }}
                              title={`${bar.name}: ${formatDateTime(bar.startsAt)} → ${formatDateTime(bar.endsAt)}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="audiences-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="audiences-heading">Audiencias y códigos</h2>
                  <p>Promociones con uso e ingreso atribuido en el periodo</p>
                </div>
              </div>
              {campaignMetrics.isPending ? (
                <div className={styles.listSkeleton} aria-busy="true">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className={styles.skeletonRow} />
                  ))}
                </div>
              ) : promotions.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="inbox"
                  title="Sin códigos con actividad"
                  description="Los códigos de preventa y early bird aparecerán cuando generen órdenes."
                />
              ) : (
                <ul className={styles.promoList}>
                  {promotions.slice(0, 8).map((promo) => {
                    const performance = performanceMeta(promo.performance);
                    return (
                      <li key={promo.promotionId} className={styles.promoItem}>
                        <div className={styles.promoTop}>
                          <strong className={styles.promoTitle}>{promo.name}</strong>
                          <Badge tone={performance.tone} size="sm" variant="soft">
                            {performance.label}
                          </Badge>
                        </div>
                        <p className={styles.promoMeta}>
                          Código <strong>{promo.code}</strong> · {formatCount(promo.usageCount)}
                          {promo.usageLimit !== null
                            ? ` / ${formatCount(promo.usageLimit)} usos`
                            : ' usos'}{' '}
                          · conv. {formatPercentPoints(promo.conversionRate)}
                        </p>
                        <p className={styles.promoMeta}>
                          {formatMxn(promo.revenueAttributed)} ingreso ·{' '}
                          {formatMxn(promo.discountGiven)} descuento ·{' '}
                          {formatCount(promo.ordersAttributed)} órdenes
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className={styles.twoCol}>
            <section className={styles.panel} aria-labelledby="reco-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="reco-heading">Recomendaciones</h2>
                  <p>Acciones seguras derivadas del cupo, la ventana y el ROAS</p>
                </div>
              </div>
              {recommendations.length === 0 ? (
                <EmptyState
                  size="sm"
                  tone="success"
                  illustration="success"
                  title="Todo en orden"
                  description="No hay borradores urgentes, cupos críticos ni ROAS bajo en este evento."
                />
              ) : (
                <ul className={styles.recoList}>
                  {recommendations.slice(0, 6).map((item) => {
                    const meta = severityMeta(item.severity);
                    return (
                      <li key={item.id} className={styles.recoItem}>
                        <div className={styles.recoTop}>
                          <Badge tone={meta.tone} size="sm" variant="soft" dot>
                            {meta.label}
                          </Badge>
                        </div>
                        <strong className={styles.recoTitle}>{item.title}</strong>
                        <p className={styles.recoBody}>{item.explanation}</p>
                        <p className={styles.recoAction}>{item.suggestion}</p>
                        {item.action ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={item.severity === 'critical' ? 'primary' : 'outline'}
                            onClick={() => void runRecommendation(item)}
                          >
                            {item.action.label}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="detail-heading">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="detail-heading">Detalle de campaña</h2>
                  <p>Analítica operativa del registro seleccionado</p>
                </div>
              </div>

              {!selected ? (
                <EmptyState
                  size="sm"
                  tone="neutral"
                  illustration="search"
                  title="Selecciona una campaña"
                  description="Haz clic en una fila de la tabla para ver redención y ventana."
                />
              ) : (
                <div
                  className={`${styles.detailCard} ${styles.detailCardSelected}`}
                  aria-live="polite"
                >
                  <div className={styles.detailHead}>
                    <div>
                      <strong>{selected.name}</strong>
                      <p className={styles.promoMeta}>
                        {campaignTypeLabel(selected.type)} · {discountLabel(selected)}
                      </p>
                    </div>
                    <Badge
                      tone={campaignStatusMeta(selected.status).tone}
                      size="sm"
                      variant="soft"
                      dot
                    >
                      {campaignStatusMeta(selected.status).label}
                    </Badge>
                  </div>

                  {analyticsQuery.isPending ? (
                    <div className={styles.skeleton} aria-busy="true" style={{ minHeight: 4 }} />
                  ) : (
                    <dl className={styles.detailDl}>
                      <dt>Cupo</dt>
                      <dd>
                        {formatCount(analytics?.allocation ?? selected.allocation)}
                      </dd>
                      <dt>Redimidos</dt>
                      <dd>{formatCount(analytics?.redeemed ?? selected.redeemed)}</dd>
                      <dt>Restantes</dt>
                      <dd>{formatCount(analytics?.remaining ?? selected.remaining)}</dd>
                      <dt>Tasa</dt>
                      <dd>
                        {formatPercentPoints(
                          analytics?.redemptionRate ?? selected.redemptionRate,
                        )}
                      </dd>
                      <dt>Abre</dt>
                      <dd>
                        {formatDateTime(analytics?.startDate ?? selected.startsAt)}
                      </dd>
                      <dt>Cierra</dt>
                      <dd>{formatDateTime(analytics?.endDate ?? selected.endsAt)}</dd>
                    </dl>
                  )}

                  <div className={styles.callout}>
                    Las acciones destructivas (pausar o cerrar) no se disparan desde aquí sin
                    confirmación explícita en el hub del evento. Publicar y exportar CSV son las
                    únicas mutaciones disponibles en esta suite.
                  </div>

                  <div className={styles.actions}>
                    {selected.status === 'DRAFT' ? (
                      <Button
                        type="button"
                        size="sm"
                        loading={publishCampaign.isPending}
                        onClick={() => void handlePublish(selected.id)}
                      >
                        Publicar
                      </Button>
                    ) : null}
                    {selected.type === 'presale' && selected.codes.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        loading={exportCodes.isPending}
                        onClick={() => void handleExport(selected)}
                      >
                        Exportar códigos
                      </Button>
                    ) : null}
                    <Link href={`/events/${eventId}`}>
                      <Button type="button" size="sm" variant="ghost">
                        Abrir hub
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <CampaignComposer
        open={composerOpen}
        eventTitle={selectedEvent?.title ?? 'el evento seleccionado'}
        submitting={createCampaign.isPending}
        error={composerError}
        onClose={() => setComposerOpen(false)}
        onSubmit={(payload) => void handleCreate(payload)}
      />
    </div>
  );
}

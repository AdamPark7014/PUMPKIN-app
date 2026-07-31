'use client';

import { Suspense, useDeferredValue, useMemo } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
  formatNumber,
} from '@boletera/ui';
import type { FilterDefinition, SegmentedOption } from '@boletera/ui';
import { PermissionError } from '@/lib/http';
import { useSaasCapabilities } from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { CapabilityGroupCard } from './_components/CapabilityGroupCard';
import { ConsumptionCard } from './_components/ConsumptionCard';
import { DeliveriesCard } from './_components/DeliveriesCard';
import { Meter } from './_components/Meter';
import { PlanLegend } from './_components/PlanLegend';
import { PlanSkeleton } from './_components/PlanSkeleton';
import {
  CAPABILITY_GROUPS,
  buildCapabilityGroups,
  summarizeCapabilities,
} from './_lib/catalog';
import { buildConsumptionRows } from './_lib/consumption';
import { buildDeliveries, summarizeDeliveries } from './_lib/deliveries';
import {
  countVisibleCapabilities,
  filterCapabilityGroups,
  type CapabilityStateFilter,
} from './_lib/filters';
import { canManagePlan } from './_lib/permissions';
import { ratioOf } from './_lib/progress';
import { usePlanUrlState } from './_lib/use-plan-url-state';
import styles from './platform.module.scss';

const STATE_OPTIONS: readonly SegmentedOption<CapabilityStateFilter>[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'activas', label: 'Activas' },
  { value: 'sin-uso', label: 'Sin uso' },
  { value: 'inactivas', label: 'Inactivas' },
];

function PlatformPlanPage() {
  const { organizationId, role } = useSession();
  const canManage = canManagePlan(role);
  const url = usePlanUrlState();
  const deferredQuery = useDeferredValue(url.query);
  const capabilities = useSaasCapabilities(organizationId);
  // Capture before QueryResult narrowing; after error/empty branches `.refetch` can become `never`.
  const refetchCapabilities = capabilities.refetch;
  const refetch = () => {
    void refetchCapabilities();
  };

  const groups = useMemo(
    () => (capabilities.data ? buildCapabilityGroups(capabilities.data) : []),
    [capabilities.data],
  );
  const summary = useMemo(() => summarizeCapabilities(groups), [groups]);
  const consumption = useMemo(
    () => (capabilities.data ? buildConsumptionRows(capabilities.data.metrics) : []),
    [capabilities.data],
  );
  const deliveries = useMemo(
    () => (capabilities.data ? buildDeliveries(capabilities.data.roadmap) : []),
    [capabilities.data],
  );
  const deliverySummary = useMemo(() => summarizeDeliveries(deliveries), [deliveries]);
  const coverageRatio = ratioOf(summary.active, summary.total);
  const deliveryRatio = ratioOf(deliverySummary.done, deliverySummary.total);

  const visibleGroups = useMemo(
    () =>
      filterCapabilityGroups(groups, {
        query: deferredQuery,
        groupIds: url.groupIds,
        state: url.state,
      }),
    [deferredQuery, groups, url.groupIds, url.state],
  );
  const visibleCount = countVisibleCapabilities(visibleGroups);

  const groupFilterDefs = useMemo<FilterDefinition[]>(() => {
    const options = CAPABILITY_GROUPS.flatMap((meta) => {
      const match = groups.find((group) => group.id === meta.id);
      if (!match) return [];
      return [
        {
          value: meta.id,
          label: meta.label,
          count: match.items.length,
        },
      ];
    });
    return [{ id: 'grupo', label: 'Área', multiple: true, options }];
  }, [groups]);

  const org = capabilities.data?.organization;
  const forbidden = capabilities.error instanceof PermissionError;
  const errorMessage =
    capabilities.error instanceof Error
      ? capabilities.error.message
      : 'Ocurrió un error inesperado al consultar el plan contratado.';

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Organización"
        title="Tu plan contratado"
        description="Qué incluye tu SaaS, qué está operando, cuánto consumes y qué entregas siguen abiertas. Solo se muestra lo que la API reporta para esta organización."
        breadcrumbs={[
          { label: 'Panel', href: '/dashboard' },
          { label: 'Organización', href: '/settings/organization' },
          { label: 'Plan contratado' },
        ]}
        actions={
          <div className={styles.actions}>
            {org ? (
              <StatusDot
                tone={org.verified ? 'success' : 'warning'}
                pulse={org.verified}
                label={org.verified ? 'Organización verificada' : 'Verificación pendiente'}
              />
            ) : null}
            {org ? (
              <Badge tone="neutral" variant="outline">
                {org.slug}
              </Badge>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={capabilities.isFetching}
              disabled={!organizationId || capabilities.isFetching}
              onClick={refetch}
            >
              Actualizar
            </Button>
          </div>
        }
      />

      {!organizationId ? (
        <EmptyState
          illustration="search"
          title="Selecciona una organización"
          description="El plan, el consumo y el estado de las entregas se evalúan por tenant. Inicia sesión con una organización activa para ver tu contrato."
        />
      ) : capabilities.isPending ? (
        <PlanSkeleton />
      ) : capabilities.error ? (
        <EmptyState
          illustration="error"
          tone="danger"
          title={forbidden ? 'Sin permiso para ver el plan' : 'No pudimos cargar tu plan'}
          description={
            forbidden
              ? 'Tu rol no tiene acceso al endpoint de capacidades de la organización. Pide a un administrador que te otorgue lectura del plan.'
              : errorMessage
          }
          action={
            forbidden ? undefined : (
              <Button variant="primary" onClick={refetch}>
                Reintentar
              </Button>
            )
          }
        />
      ) : !capabilities.data || groups.length === 0 ? (
        <EmptyState
          illustration="inbox"
          title="Sin datos del plan"
          description="El endpoint de capacidades no devolvió módulos para esta organización."
          action={
            <Button variant="outline" onClick={refetch}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <>
          <Section columns={4} gap="md" aria-label="Resumen del plan">
            <KpiCard
              label="Capacidades activas"
              value={formatNumber(summary.active)}
              hint={`de ${formatNumber(summary.total)} reportadas`}
              tone="success"
            />
            <KpiCard
              label="Contratadas sin uso"
              value={formatNumber(summary.idle)}
              hint="Se encienden con el primer uso"
              tone={summary.idle > 0 ? 'warning' : 'neutral'}
            />
            <KpiCard
              label="Desactivadas"
              value={formatNumber(summary.off)}
              hint="Ajuste o módulo apagado"
              tone={summary.off > 0 ? 'warning' : 'neutral'}
            />
            <KpiCard
              label="Entregas pendientes"
              value={formatNumber(deliverySummary.pending)}
              hint={
                deliverySummary.highPending > 0
                  ? `${formatNumber(deliverySummary.highPending)} de prioridad alta`
                  : `${formatNumber(deliverySummary.done)} ya entregadas`
              }
              tone={deliverySummary.highPending > 0 ? 'danger' : 'neutral'}
            />
          </Section>

          <section className={styles.intro} aria-labelledby="plan-org-title">
            <div className={styles.introMain}>
              <div>
                <h2 id="plan-org-title" className={styles.introTitle}>
                  {org?.name ?? 'Organización'}
                </h2>
                <p className={styles.introLead}>
                  Resumen del SaaS contratado: capacidades por área, consumo real del tenant y
                  estado de las entregas. No inventamos cupos ni topes: las barras solo aparecen
                  cuando hay numerador y denominador reales.
                </p>
              </div>
              {!canManage ? (
                <p className={styles.permissionNote} role="note">
                  Tu rol puede consultar el plan, pero no cambiar ajustes de la organización. Los
                  accesos de configuración aparecen bloqueados.
                </p>
              ) : null}
            </div>

            <div className={styles.coverageMeters}>
              {coverageRatio === null ? null : (
                <div className={styles.coverageMeter}>
                  <div className={styles.coverageMeterHead}>
                    <span>Capacidades en operación</span>
                    <strong>
                      {formatNumber(summary.active)} / {formatNumber(summary.total)}
                    </strong>
                  </div>
                  <Meter
                    label="Cobertura de capacidades activas"
                    value={summary.active}
                    max={summary.total}
                    ratio={coverageRatio}
                    tone={summary.active === summary.total ? 'success' : 'accent'}
                  />
                </div>
              )}
              {deliveryRatio === null ? null : (
                <div className={styles.coverageMeter}>
                  <div className={styles.coverageMeterHead}>
                    <span>Entregas del plan</span>
                    <strong>
                      {formatNumber(deliverySummary.done)} /{' '}
                      {formatNumber(deliverySummary.total)}
                    </strong>
                  </div>
                  <Meter
                    label="Entregas completadas del plan"
                    value={deliverySummary.done}
                    max={deliverySummary.total}
                    ratio={deliveryRatio}
                    tone={deliverySummary.pending === 0 ? 'success' : 'warning'}
                  />
                </div>
              )}
            </div>
          </section>

          <div className={styles.filters}>
            <FilterBar
              filters={groupFilterDefs}
              value={url.filterSelection}
              onChange={url.setFilterSelection}
              search={{
                value: url.query,
                onChange: url.setQuery,
                placeholder: 'Buscar capacidad…',
              }}
            >
              <SegmentedControl
                size="sm"
                label="Filtrar por estado de capacidad"
                options={STATE_OPTIONS}
                value={url.state}
                onValueChange={url.setState}
              />
              {url.hasFilters ? (
                <Button variant="ghost" size="sm" onClick={url.clearFilters}>
                  Limpiar filtros
                </Button>
              ) : null}
            </FilterBar>
            <p className={styles.toolbarMeta}>
              Mostrando {formatNumber(visibleCount)} de {formatNumber(summary.total)} capacidades
              {!canManage ? ' · vista de solo lectura' : null}
            </p>
          </div>

          <div className={styles.layout}>
            <div className={styles.column}>
              <section className={styles.sectionBlock} aria-labelledby="capacidades-title">
                <div className={styles.sectionHead}>
                  <div>
                    <h2 id="capacidades-title">Capacidades por área</h2>
                    <p>
                      Agrupadas como las opera el plan: núcleo, venta, ingresos, cobros, riesgo e
                      integraciones.
                    </p>
                  </div>
                </div>

                {visibleGroups.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="search"
                    title="Ninguna capacidad coincide"
                    description="Prueba otra búsqueda, quita el filtro de estado o limpia el área seleccionada."
                    action={
                      <Button variant="outline" size="sm" onClick={url.clearFilters}>
                        Quitar filtros
                      </Button>
                    }
                  />
                ) : (
                  <div className={styles.groupStack}>
                    {visibleGroups.map((group) => (
                      <CapabilityGroupCard
                        key={group.id}
                        group={group}
                        canManage={canManage}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className={styles.column} aria-label="Consumo y entregas">
              <PlanLegend summary={summary} />
              <ConsumptionCard rows={consumption} />
              <DeliveriesCard
                deliveries={deliveries}
                summary={deliverySummary}
                filter={url.deliveries}
                onFilterChange={url.setDeliveries}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

export default function PlatformPage() {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <PlatformPlanPage />
    </Suspense>
  );
}

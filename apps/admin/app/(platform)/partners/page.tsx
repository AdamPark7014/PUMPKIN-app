'use client';

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  KpiCard,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  StatusDot,
  formatDateTime,
  formatNumber,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
} from '@/lib/queries/partners';
import { useSession } from '@/lib/use-session';
import { CreateKeyModal, type CreateKeyPayload } from './_components/CreateKeyModal';
import { KeyDetailDrawer } from './_components/KeyDetailDrawer';
import { formatCount, relativePast } from './_lib/format';
import {
  buildKeyAlerts,
  classifyKey,
  computePartnerKpis,
  HEALTH_FILTER_OPTIONS,
  keyHealthMeta,
  matchesHealth,
  matchesQuery,
  scopeDistribution,
} from './_lib/keys';
import { isGrantableScope, isWriteScope, scopeLabel } from './_lib/scopes';
import { usePartnersUrlState } from './_lib/use-partners-url-state';
import styles from './partners.module.scss';

function auditLabel(action: string): { verb: string; detail?: string } {
  switch (action) {
    case 'API_KEY_CREATED':
      return { verb: 'creó la clave', detail: 'API key' };
    case 'API_KEY_REVOKED':
      return { verb: 'revocó la clave', detail: 'API key' };
    default:
      return { verb: action.toLowerCase().replaceAll('_', ' ') };
  }
}

function PartnersCockpit() {
  const { organizationId } = useSession();
  const toast = useToast();
  const url = usePartnersUrlState();
  const deferredQ = useDeferredValue(url.q);

  const keysQuery = useApiKeys(organizationId);
  const auditQuery = useAuditLog(organizationId, 40);
  const createKey = useCreateApiKey(organizationId ?? '');
  const revokeKey = useRevokeApiKey(organizationId ?? '');

  const [now, setNow] = useState(() => Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ value: string; name: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const keys = keysQuery.data ?? [];
  const kpis = useMemo(() => computePartnerKpis(keys, now), [keys, now]);
  const alerts = useMemo(() => buildKeyAlerts(keys, now), [keys, now]);
  const scopes = useMemo(() => scopeDistribution(keys), [keys]);

  const filtered = useMemo(
    () =>
      keys.filter(
        (key) => matchesHealth(key, url.health, now) && matchesQuery(key, deferredQ),
      ),
    [deferredQ, keys, now, url.health],
  );

  const selected = useMemo(
    () => (url.selectedId ? keys.find((key) => key.id === url.selectedId) ?? null : null),
    [keys, url.selectedId],
  );

  const activityItems = useMemo<ActivityItem[]>(() => {
    const entries = (auditQuery.data ?? []).filter(
      (entry) => entry.entityType === 'ApiKey' || entry.action.startsWith('API_KEY_'),
    );
    return entries.slice(0, 12).map((entry) => {
      const meta = entry.metadata ?? {};
      const name =
        typeof meta.name === 'string'
          ? meta.name
          : typeof meta.keyPrefix === 'string'
            ? String(meta.keyPrefix)
            : entry.entityId.slice(0, 8);
      const labels = auditLabel(entry.action);
      return {
        id: entry.id,
        actor: 'Administración',
        action: labels.verb,
        target: name,
        timestamp: entry.createdAt,
        detail: labels.detail,
      };
    });
  }, [auditQuery.data]);

  const liveIntegrations = useMemo(() => {
    return keys
      .filter((key) => key.active)
      .slice(0, 8)
      .map((key) => {
        const health = keyHealthMeta(classifyKey(key, now));
        return {
          id: key.id,
          name: key.name,
          prefix: key.keyPrefix,
          health,
          lastUsed: relativePast(key.lastUsedAt, now),
        };
      });
  }, [keys, now]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'health',
        label: 'Estado',
        multiple: false,
        options: HEALTH_FILTER_OPTIONS.filter((option) => option.value !== 'all').map(
          (option) => ({ value: option.value, label: option.label }),
        ),
      },
    ],
    [],
  );

  async function onCreate(payload: CreateKeyPayload) {
    if (!organizationId) return;
    const created = await createKey.mutateAsync({
      name: payload.name,
      scopes: payload.scopes,
      rateLimit: payload.rateLimit,
      expiresInDays: payload.expiresInDays,
    });
    setSecret({ value: created.secret, name: payload.name });
    setCreateOpen(false);
    toast.success('API key generada');
  }

  async function onRevoke() {
    if (!revokeTarget || !organizationId) return;
    setBusyId(revokeTarget.id);
    try {
      await revokeKey.mutateAsync(revokeTarget.id);
      toast.success(`Clave «${revokeTarget.name}» revocada`);
      setRevokeTarget(null);
      if (url.selectedId === revokeTarget.id) url.setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revocar');
    } finally {
      setBusyId(null);
    }
  }

  async function onRotate() {
    if (!rotateTarget || !organizationId) return;
    setBusyId(rotateTarget.id);
    try {
      // El DTO del backend solo acepta GRANTABLE_SCOPES; se descartan scopes heredados.
      const scopes = rotateTarget.scopes.filter(isGrantableScope);
      const created = await createKey.mutateAsync({
        name: rotateTarget.name,
        scopes: scopes.length > 0 ? scopes : ['read:events', 'read:inventory'],
        rateLimit: rotateTarget.rateLimit,
      });
      await revokeKey.mutateAsync(rotateTarget.id);
      setSecret({ value: created.secret, name: rotateTarget.name });
      setRotateTarget(null);
      if (url.selectedId === rotateTarget.id) url.setSelectedId(null);
      toast.success('Clave rotada — copia el secreto ahora');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo rotar la clave');
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      toast.success('Secreto copiado al portapapeles');
    } catch {
      toast.info('Copia el secreto manualmente');
    }
  }

  const columns: DataTableColumn<ApiKey>[] = [
    {
      key: 'name',
      header: 'Integración',
      width: 220,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className={styles.keyMeta}>
          <strong>{row.name}</strong>
          <code>{row.keyPrefix}…</code>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      width: 130,
      sortValue: (row) => classifyKey(row, now),
      render: (row) => {
        const health = keyHealthMeta(classifyKey(row, now));
        return (
          <Badge tone={health.tone} variant="soft" size="sm" dot>
            {health.label}
          </Badge>
        );
      },
    },
    {
      key: 'scopes',
      header: 'Scopes',
      width: 240,
      render: (row) => (
        <div className={styles.scopes}>
          {row.scopes.slice(0, 3).map((scope) => (
            <Badge
              key={scope}
              tone={isWriteScope(scope) ? 'warning' : 'neutral'}
              variant="outline"
              size="sm"
            >
              {scopeLabel(scope)}
            </Badge>
          ))}
          {row.scopes.length > 3 ? (
            <Badge tone="neutral" variant="soft" size="sm">
              +{row.scopes.length - 3}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'rateLimit',
      header: 'Límite/min',
      width: 110,
      align: 'right',
      sortValue: (row) => row.rateLimit,
      render: (row) => formatNumber(row.rateLimit),
    },
    {
      key: 'lastUsedAt',
      header: 'Último uso',
      width: 130,
      sortValue: (row) => (row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0),
      render: (row) => (
        <span
          className={styles.muted}
          title={row.lastUsedAt ? formatDateTime(row.lastUsedAt) : undefined}
        >
          {relativePast(row.lastUsedAt, now)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      width: 180,
      resizable: false,
      render: (row) =>
        row.active ? (
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyId === row.id}
              onClick={(event) => {
                event.stopPropagation();
                setRotateTarget(row);
              }}
            >
              Rotar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyId === row.id}
              onClick={(event) => {
                event.stopPropagation();
                setRevokeTarget(row);
              }}
            >
              Revocar
            </Button>
          </div>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
  ];

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
          illustration="error"
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Partners · Connect"
        title="Integraciones y API keys"
        description="Credenciales B2B, scopes concedibles y señal de tráfico. El secreto solo se muestra una vez."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            Nueva API key
          </Button>
        }
      />

      {secret ? (
        <div className={styles.secretBanner} role="status" aria-live="polite">
          <h2>Copia el secreto ahora — «{secret.name}»</h2>
          <p>
            No volverá a mostrarse. Guárdalo en tu vault o gestor de secretos antes de cerrar este
            aviso.
          </p>
          <div className={styles.secretBox}>
            <code>{secret.value}</code>
            <Button type="button" size="sm" variant="secondary" onClick={() => void copySecret()}>
              Copiar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Entendido
            </Button>
          </div>
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <div className={styles.alerts} aria-label="Alertas de partners">
          {alerts.map((alert) => (
            <div key={alert.id} className={styles.alert} role="status">
              <Badge tone={alert.tone} variant="soft" size="sm" dot>
                Atención
              </Badge>
              <span>{alert.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Section columns={4} gap="sm" aria-label="Indicadores de partners">
        <KpiCard
          label="Claves totales"
          value={formatCount(kpis.total)}
          loading={keysQuery.isPending}
          hint="Activas y revocadas"
        />
        <KpiCard
          label="Activas"
          value={formatCount(kpis.active)}
          tone="success"
          loading={keysQuery.isPending}
          hint={`${formatCount(kpis.usedRecently)} con uso en 7 d`}
        />
        <KpiCard
          label="Con escritura"
          value={formatCount(kpis.writeCapable)}
          tone="warning"
          loading={keysQuery.isPending}
          hint="Scopes write:* o *"
        />
        <KpiCard
          label="Límite medio"
          value={formatCount(kpis.avgLimit)}
          unit="/min"
          loading={keysQuery.isPending}
          hint={
            kpis.expiringSoon > 0
              ? `${formatCount(kpis.expiringSoon)} por expirar`
              : 'Rate limit de claves activas'
          }
          tone={kpis.expiringSoon > 0 ? 'warning' : 'info'}
        />
      </Section>

      {keysQuery.error ? (
        <QueryError error={keysQuery.error} onRetry={() => void keysQuery.refetch()} />
      ) : (
        <div className={styles.layout}>
          <Section
            title="API keys"
            description="Prefijo visible, scopes y estado de consumo."
            actions={
              <div className={styles.livePill}>
                <StatusDot tone="success" pulse aria-hidden />
                En vivo
              </div>
            }
          >
            <div className={styles.filters}>
              <FilterBar
                filters={filterDefs}
                value={url.filterSelection}
                onChange={url.setFilterSelection}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, prefijo o scope',
                }}
              >
                <SegmentedControl
                  label="Filtro rápido de estado"
                  size="sm"
                  value={url.health === 'all' || url.health === 'active' || url.health === 'revoked' ? url.health : 'all'}
                  onValueChange={(value) => url.setHealth(value)}
                  options={[
                    { value: 'all', label: 'Todas' },
                    { value: 'active', label: 'Activas' },
                    { value: 'revoked', label: 'Revocadas' },
                  ]}
                />
              </FilterBar>
            </div>

            <div className={styles.tableMeta}>
              <span className={styles.muted}>
                {formatCount(filtered.length)} de {formatCount(keys.length)} claves
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void keysQuery.refetch()}
              >
                Actualizar
              </Button>
            </div>

            <DataTable
              label="API keys de partners"
              columns={columns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={keysQuery.isPending}
              maxHeight={480}
              onRowClick={(row) => url.setSelectedId(row.id)}
              empty={
                <EmptyState
                  title={keys.length === 0 ? 'Sin API keys' : 'Sin resultados'}
                  description={
                    keys.length === 0
                      ? 'Crea la primera clave para conectar POS, marketplaces u otros sistemas.'
                      : 'Ajusta la búsqueda o limpia los filtros de la URL.'
                  }
                  illustration={keys.length === 0 ? 'inbox' : 'search'}
                  action={
                    keys.length === 0 ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        Generar API key
                      </Button>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" onClick={url.clearFilters}>
                        Limpiar filtros
                      </Button>
                    )
                  }
                />
              }
            />
          </Section>

          <div className={styles.stack}>
            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Consumo y estado</h2>
                  <p>Integraciones activas y señal de tráfico</p>
                </div>
              </div>
              {liveIntegrations.length === 0 ? (
                <p className={styles.muted}>No hay claves activas para monitorear.</p>
              ) : (
                <ul className={styles.statusList}>
                  {liveIntegrations.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={styles.statusRow}
                        onClick={() => url.setSelectedId(item.id)}
                      >
                        <StatusDot
                          tone={item.health.statusTone}
                          pulse={item.health.pulse}
                          aria-hidden
                        />
                        <div>
                          <strong>{item.name}</strong>
                          <span>
                            {item.prefix}… · {item.lastUsed}
                          </span>
                        </div>
                        <Badge tone={item.health.tone} variant="outline" size="sm">
                          {item.health.label}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <aside className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Scopes en uso</h2>
                  <p>Distribución entre claves activas</p>
                </div>
              </div>
              {scopes.length === 0 ? (
                <EmptyState
                  title="Sin scopes"
                  description="Aparecerán al emitir la primera clave activa."
                  illustration="chart"
                  size="sm"
                />
              ) : (
                <DonutChart
                  label="Distribución de scopes en claves activas"
                  slices={scopes}
                  height={200}
                  centerLabel="Concesiones"
                  formatValue={(value) => formatCount(value)}
                />
              )}
            </aside>
          </div>
        </div>
      )}

      <Section
        title="Actividad de claves"
        description="Creaciones y revocaciones del registro de auditoría."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void auditQuery.refetch()}
          >
            Actualizar
          </Button>
        }
      >
        {auditQuery.error ? (
          <QueryError error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
        ) : (
          <ActivityFeed
            items={activityItems}
            loading={auditQuery.isPending}
            label="Actividad de API keys"
            empty={
              <EmptyState
                title="Sin actividad reciente"
                description="Las altas y bajas de claves aparecerán aquí."
                illustration="inbox"
                size="sm"
              />
            }
          />
        )}
      </Section>

      <CreateKeyModal
        open={createOpen}
        busy={createKey.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
      />

      <KeyDetailDrawer
        keyRow={selected}
        now={now}
        busy={Boolean(busyId)}
        onClose={() => url.setSelectedId(null)}
        onRotate={(key) => setRotateTarget(key)}
        onRevoke={(key) => setRevokeTarget(key)}
      />

      <Modal
        open={Boolean(rotateTarget)}
        onClose={() => setRotateTarget(null)}
        title="Rotar API key"
        description={
          rotateTarget
            ? `Se emitirá una nueva clave para «${rotateTarget.name}» con los mismos scopes y se revocará la actual.`
            : undefined
        }
        footer={
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={() => setRotateTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              loading={Boolean(rotateTarget && busyId === rotateTarget.id)}
              loadingLabel="Rotando…"
              onClick={() => void onRotate()}
            >
              Rotar ahora
            </Button>
          </div>
        }
      >
        <p className={styles.muted}>
          Las integraciones dejarán de autenticarse con el prefijo actual en cuanto confirmes. Ten
          listo el vault para guardar el nuevo secreto.
        </p>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revocar API key"
        description={
          revokeTarget
            ? `«${revokeTarget.name}» (${revokeTarget.keyPrefix}…) dejará de aceptar tráfico de inmediato.`
            : undefined
        }
        footer={
          <div className={styles.modalFooter}>
            <Button type="button" variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={Boolean(revokeTarget && busyId === revokeTarget.id)}
              loadingLabel="Revocando…"
              onClick={() => void onRevoke()}
            >
              Revocar
            </Button>
          </div>
        }
      >
        <p className={styles.muted}>
          Esta acción no se puede deshacer. Usa rotación si solo necesitas renovar el secreto.
        </p>
      </Modal>
    </div>
  );
}

export default function PartnersPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page} role="status" aria-live="polite">
          Cargando integraciones…
        </div>
      }
    >
      <PartnersCockpit />
    </Suspense>
  );
}

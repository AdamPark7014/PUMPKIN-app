'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  Timeline,
  type DataTableColumn,
  type FilterDefinition,
  type TimelineItem,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import {
  useCfdiInvoices,
  useFiscalProfile,
  useStampCfdi,
  useUpsertFiscalProfile,
  type CfdiInvoice,
} from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import {
  folioLabel,
  formatCount,
  formatDateTime,
  formatMoney,
  toCents,
} from './_lib/format';
import {
  FILTER_OPTIONS,
  invoiceMatchesQuery,
  invoiceStatusMeta,
  matchesInvoiceFilter,
  summarizeInvoices,
} from './_lib/invoices';
import { useCfdiUrlState } from './_lib/use-cfdi-url-state';
import styles from './cfdi.module.scss';

const STATUS_FILTERS: FilterDefinition[] = [
  {
    id: 'status',
    label: 'Estado',
    multiple: false,
    options: FILTER_OPTIONS.filter((option) => option.value !== 'ALL').map((option) => ({
      value: option.value,
      label: option.label,
    })),
  },
];

function CfdiCockpit() {
  const session = useSession();
  const organizationId = session.organizationId;
  const toast = useToast();
  const { filter, q, filterSelection, setSearch, setFilterSelection } = useCfdiUrlState();

  const profileQuery = useFiscalProfile(organizationId);
  const invoicesQuery = useCfdiInvoices(organizationId);
  const upsertProfile = useUpsertFiscalProfile(organizationId ?? '');
  const stamp = useStampCfdi(organizationId ?? '');

  const [rfc, setRfc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [stampOpen, setStampOpen] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [receptorRfc, setReceptorRfc] = useState('XAXX010101000');
  const [receptorNombre, setReceptorNombre] = useState('PUBLICO EN GENERAL');

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    setRfc(profile.rfc);
    setLegalName(profile.legalName);
    setCodigoPostal(profile.codigoPostal);
  }, [profileQuery.data]);

  const invoices = invoicesQuery.data ?? [];
  const totals = useMemo(() => summarizeInvoices(invoices), [invoices]);

  const filtered = useMemo(
    () =>
      invoices.filter(
        (invoice) =>
          matchesInvoiceFilter(invoice, filter) && invoiceMatchesQuery(invoice, q),
      ),
    [filter, invoices, q],
  );

  const errorInvoices = useMemo(
    () => invoices.filter((invoice) => invoiceStatusMeta(invoice).kind === 'error'),
    [invoices],
  );

  const profileReady = Boolean(profileQuery.data?.rfc && profileQuery.data.legalName);

  const statusSlices = useMemo(
    () =>
      [
        { id: 'ok', label: 'Timbrados', value: totals.stampedCount },
        { id: 'pending', label: 'Pendientes', value: totals.pendingCount },
        { id: 'error', label: 'Errores', value: totals.errorCount },
      ].filter((slice) => slice.value > 0),
    [totals.errorCount, totals.pendingCount, totals.stampedCount],
  );

  const satTimeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      {
        id: 'profile',
        title: profileReady ? 'Perfil fiscal activo' : 'Perfil fiscal pendiente',
        description: profileReady
          ? `${profileQuery.data?.rfc} · CP ${profileQuery.data?.codigoPostal} · PAC ${profileQuery.data?.pacMode}`
          : 'Configura RFC, razón social y C.P. del emisor',
        tone: profileReady ? 'success' : 'warning',
        current: !profileReady,
      },
    ];

    const recent = [...invoices]
      .sort((a, b) => {
        const left = Date.parse(a.stampedAt ?? '') || 0;
        const right = Date.parse(b.stampedAt ?? '') || 0;
        return right - left;
      })
      .slice(0, 5);

    for (const invoice of recent) {
      const meta = invoiceStatusMeta(invoice);
      items.push({
        id: invoice.id,
        title: `${meta.label} · ${folioLabel(invoice.serie, invoice.folio)}`,
        description: invoice.uuid
          ? `UUID ${invoice.uuid}`
          : `Receptor ${invoice.receptorRfc} · ${formatMoney(toCents(invoice.total))}`,
        timestamp: invoice.stampedAt ?? undefined,
        tone:
          meta.kind === 'error'
            ? 'danger'
            : meta.kind === 'pending'
              ? 'warning'
              : meta.kind === 'ok'
                ? 'success'
                : 'neutral',
        current: meta.kind === 'error' || meta.kind === 'pending',
      });
    }

    if (recent.length === 0 && profileReady) {
      items.push({
        id: 'awaiting',
        title: 'Sin CFDIs emitidos',
        description: 'Listo para timbrar la primera orden COMPLETED.',
        tone: 'info',
        current: true,
      });
    }

    return items;
  }, [
    invoices,
    profileQuery.data?.codigoPostal,
    profileQuery.data?.pacMode,
    profileQuery.data?.rfc,
    profileReady,
  ]);

  type InvoiceTableRow = CfdiInvoice & Record<string, unknown>;
  const invoiceRows = filtered as InvoiceTableRow[];

  const columns = useMemo<DataTableColumn<InvoiceTableRow>[]>(
    () => [
      {
        key: 'folio',
        header: 'Folio',
        width: 140,
        sortValue: (row) => `${row.serie}-${row.folio}`,
        render: (row) => (
          <div className={styles.cellStack}>
            <strong>{folioLabel(row.serie, row.folio)}</strong>
            <small>{row.orderId ?? 'Sin orden vinculada'}</small>
          </div>
        ),
      },
      {
        key: 'uuid',
        header: 'UUID',
        width: 220,
        sortValue: (row) => row.uuid ?? '',
        render: (row) => <span className={styles.mono}>{row.uuid ?? '—'}</span>,
      },
      {
        key: 'receptor',
        header: 'Receptor',
        width: 150,
        sortValue: (row) => row.receptorRfc,
        render: (row) => <strong>{row.receptorRfc}</strong>,
      },
      {
        key: 'total',
        header: 'Total',
        width: 120,
        align: 'right',
        sortValue: (row) => toCents(row.total),
        render: (row) => (
          <span className={styles.amount}>{formatMoney(toCents(row.total))}</span>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 140,
        sortValue: (row) => row.status,
        render: (row) => {
          const meta = invoiceStatusMeta(row);
          return (
            <Badge tone={meta.tone} variant="soft" size="sm" dot>
              {meta.label}
            </Badge>
          );
        },
      },
      {
        key: 'stampedAt',
        header: 'Timbrado',
        width: 150,
        sortValue: (row) => row.stampedAt ?? '',
        render: (row) => formatDateTime(row.stampedAt),
      },
    ],
    [],
  );

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    try {
      await upsertProfile.mutateAsync({
        rfc: rfc.trim().toUpperCase(),
        legalName: legalName.trim(),
        codigoPostal: codigoPostal.trim(),
        pacMode: 'sandbox',
      });
      toast.success('Perfil fiscal guardado');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo guardar el perfil fiscal',
      );
    }
  }

  async function onStamp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    try {
      const result = await stamp.mutateAsync({
        orderId: orderId.trim(),
        receptorRfc: receptorRfc.trim().toUpperCase(),
        receptorNombre: receptorNombre.trim(),
      });
      const uuid =
        result &&
        typeof result === 'object' &&
        'uuid' in result &&
        typeof result.uuid === 'string'
          ? result.uuid
          : null;
      toast.success(
        uuid ? `CFDI timbrado. UUID ${uuid}` : 'CFDI timbrado correctamente (sandbox)',
      );
      setStampOpen(false);
      setOrderId('');
      void invoicesQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'El PAC rechazó el timbrado. Revisa RFC, CP y la orden',
      );
    }
  }

  if (!organizationId) {
    return (
      <main className={styles.page}>
        <PageHeader
          eyebrow="Finanzas · Fiscal MX"
          title="CFDI 4.0 · Operación SAT"
          description="Selecciona una organización para operar el módulo fiscal."
        />
        <EmptyState
          title="Sin organización"
          description="Elige una organización activa para cargar el perfil emisor y las facturas."
          illustration="search"
        />
      </main>
    );
  }

  const loading = profileQuery.isPending || invoicesQuery.isPending;

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Finanzas · Fiscal MX"
        title="CFDI 4.0 · Operación SAT"
        description="Perfil emisor, timbrado sandbox y monitoreo de facturas con trazabilidad PAC/SAT."
        breadcrumbs={[{ label: 'Finanzas' }, { label: 'CFDI' }]}
        actions={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void profileQuery.refetch();
                void invoicesQuery.refetch();
              }}
            >
              Actualizar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStampOpen(true)}
              disabled={!profileReady}
            >
              Timbrar orden
            </Button>
          </div>
        }
      />

      <section className={styles.kpiGrid} aria-label="Indicadores CFDI">
        <KpiCard
          label="Total facturado"
          value={formatMoney(totals.stampedCents)}
          hint="CFDIs con UUID válido"
          tone="accent"
          loading={loading}
        />
        <KpiCard
          label="Timbrados"
          value={formatCount(totals.stampedCount)}
          hint={`de ${formatCount(invoices.length)} emitidos`}
          tone="success"
          loading={loading}
        />
        <KpiCard
          label="Pendientes"
          value={formatCount(totals.pendingCount)}
          hint="Sin UUID o en borrador"
          tone={totals.pendingCount ? 'warning' : 'neutral'}
          loading={loading}
        />
        <KpiCard
          label="Errores SAT/PAC"
          value={formatCount(totals.errorCount)}
          hint={totals.errorCount ? 'Requieren corrección' : 'Sin rechazos activos'}
          tone={totals.errorCount ? 'danger' : 'success'}
          loading={loading}
        />
      </section>

      <section className={styles.layout}>
        <article className={styles.card}>
          <header className={styles.cardHead}>
            <div>
              <h2>Perfil fiscal del emisor</h2>
              <p className={styles.muted}>Datos usados para CFDI 4.0 en sandbox</p>
            </div>
            {profileReady ? (
              <Badge tone="success" variant="soft" size="sm" dot>
                Listo
              </Badge>
            ) : (
              <Badge tone="warning" variant="soft" size="sm" dot>
                Incompleto
              </Badge>
            )}
          </header>

          {profileQuery.data ? (
            <dl className={styles.profileCard} aria-label="Resumen del emisor">
              <div>
                <dt>RFC</dt>
                <dd>{profileQuery.data.rfc}</dd>
              </div>
              <div>
                <dt>Razón social</dt>
                <dd>{profileQuery.data.legalName}</dd>
              </div>
              <div>
                <dt>C.P. / Régimen</dt>
                <dd>
                  {profileQuery.data.codigoPostal} · {profileQuery.data.regimenFiscal}
                </dd>
              </div>
              <div>
                <dt>Serie / PAC</dt>
                <dd>
                  {profileQuery.data.serie} · {profileQuery.data.pacMode}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.muted}>Aún no hay perfil fiscal configurado.</p>
          )}

          <form className={styles.form} onSubmit={saveProfile}>
            <Input
              label="RFC emisor"
              value={rfc}
              onChange={(event) => setRfc(event.target.value.toUpperCase())}
              placeholder="ABC123456XXX"
              minLength={12}
              maxLength={13}
              required
              autoComplete="off"
            />
            <Input
              label="Razón social"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              placeholder="BOLETERA SA DE CV"
              required
            />
            <Input
              label="Código postal"
              value={codigoPostal}
              onChange={(event) => setCodigoPostal(event.target.value)}
              placeholder="06600"
              pattern="[0-9]{5}"
              required
              hint="Debe coincidir con el domicilio fiscal ante el SAT."
            />
            <Button type="submit" variant="primary" size="sm" loading={upsertProfile.isPending}>
              Guardar perfil
            </Button>
          </form>
        </article>

        <aside className={styles.stack}>
          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Por estado</h2>
                <p className={styles.muted}>Mix del inventario fiscal</p>
              </div>
            </header>
            {loading ? (
              <p className={styles.muted} role="status">
                Cargando distribución…
              </p>
            ) : statusSlices.length === 0 ? (
              <EmptyState
                title="Sin facturas"
                description="Cuando timbres una orden verás el mix por estado."
                illustration="chart"
                size="sm"
              />
            ) : (
              <DonutChart
                label="CFDIs por estado"
                slices={statusSlices}
                height={190}
                centerLabel="CFDIs"
                formatValue={(value) => formatCount(value)}
              />
            )}
          </article>

          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Timeline SAT</h2>
                <p className={styles.muted}>Perfil y últimos movimientos fiscales</p>
              </div>
            </header>
            <Timeline label="Historial fiscal SAT" items={satTimeline} density="sm" />
          </article>

          <article className={styles.card}>
            <header className={styles.cardHead}>
              <div>
                <h2>Errores SAT recientes</h2>
                <p className={styles.muted}>Rechazos y cancelaciones a revisar</p>
              </div>
            </header>
            {errorInvoices.length ? (
              <ul className={styles.errorList}>
                {errorInvoices.slice(0, 5).map((invoice) => (
                  <li key={invoice.id}>
                    <span className={styles.errorDot} aria-hidden />
                    <div>
                      <b>
                        {folioLabel(invoice.serie, invoice.folio)} · {invoice.status}
                      </b>
                      <small>
                        Receptor {invoice.receptorRfc} ·{' '}
                        {formatMoney(toCents(invoice.total))}
                      </small>
                    </div>
                    <time dateTime={invoice.stampedAt ?? undefined}>
                      {formatDateTime(invoice.stampedAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Sin errores SAT/PAC"
                description="No hay rechazos activos en el inventario actual."
                illustration="success"
                tone="success"
                size="sm"
              />
            )}
          </article>
        </aside>
      </section>

      <article className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <h2>Facturas CFDI</h2>
            <p className={styles.muted}>Inventario de comprobantes emitidos</p>
          </div>
        </header>
        <FilterBar
          filters={STATUS_FILTERS}
          value={filterSelection}
          onChange={setFilterSelection}
          search={{
            value: q,
            onChange: setSearch,
            placeholder: 'UUID, folio, RFC u orden',
          }}
        />
        <div className={styles.tableMeta}>
          <span>
            {formatCount(filtered.length)} de {formatCount(invoices.length)} facturas
          </span>
        </div>
        <DataTable
          label="Facturas CFDI"
          columns={columns}
          data={invoiceRows}
          rowKey={(row) => row.id}
          maxHeight={460}
          loading={invoicesQuery.isPending}
          error={
            invoicesQuery.error instanceof Error
              ? invoicesQuery.error.message
              : invoicesQuery.error
                ? 'No se pudieron cargar las facturas'
                : null
          }
          onRetry={() => void invoicesQuery.refetch()}
          empty={
            <EmptyState
              title={invoices.length === 0 ? 'Sin facturas' : 'Sin resultados'}
              description={
                invoices.length === 0
                  ? 'Timbra una orden COMPLETED para generar el primer CFDI.'
                  : 'Prueba otro criterio de búsqueda o limpia los filtros.'
              }
              illustration={invoices.length === 0 ? 'inbox' : 'search'}
              size="sm"
            />
          }
        />
      </article>

      <Modal
        open={stampOpen}
        onClose={stamp.isPending ? () => undefined : () => setStampOpen(false)}
        title="Timbrar orden"
        description="Emite un CFDI 4.0 en modo sandbox a partir de una orden completada. El receptor genérico es válido para público en general."
        size="sm"
        dismissible={!stamp.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={stamp.isPending}
              onClick={() => setStampOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={stamp.isPending}
              form="cfdi-stamp-form"
              type="submit"
            >
              Timbrar (sandbox)
            </Button>
          </>
        }
      >
        <form id="cfdi-stamp-form" className={styles.form} onSubmit={onStamp}>
          <Input
            label="Order ID"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="cuid de la orden"
            required
            autoFocus
            disabled={stamp.isPending}
          />
          <Input
            label="RFC receptor"
            value={receptorRfc}
            onChange={(event) => setReceptorRfc(event.target.value.toUpperCase())}
            required
            disabled={stamp.isPending}
          />
          <Input
            label="Nombre receptor"
            value={receptorNombre}
            onChange={(event) => setReceptorNombre(event.target.value)}
            required
            disabled={stamp.isPending}
          />
        </form>
      </Modal>
    </main>
  );
}

function CfdiFallback() {
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Finanzas · Fiscal MX"
        title="CFDI 4.0 · Operación SAT"
        description="Cargando cockpit fiscal…"
      />
      <section className={styles.kpiGrid} aria-busy="true">
        <KpiCard label="Total facturado" value="—" loading />
        <KpiCard label="Timbrados" value="—" loading />
        <KpiCard label="Pendientes" value="—" loading />
        <KpiCard label="Errores SAT/PAC" value="—" loading />
      </section>
    </main>
  );
}

export default function CfdiBillingPage() {
  return (
    <Suspense fallback={<CfdiFallback />}>
      <CfdiCockpit />
    </Suspense>
  );
}

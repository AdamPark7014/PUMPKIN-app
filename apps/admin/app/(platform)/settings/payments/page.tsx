'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  StatusDot,
  Timeline,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { useOrders } from '@/lib/queries/orders';
import { useSession } from '@/lib/use-session';
import {
  buildCredentialRows,
  envLabel,
  envTone,
  feeBreakdown,
  methodEnabled,
  methodHint,
  methodLabel,
  parseOrgFees,
  summarizePaymentHealth,
  type BanorteConfig,
  type ValidateResult,
} from './payments-utils';
import styles from './payments.module.scss';

export default function PaymentsSettingsPage() {
  const toast = useToast();
  const { can, organizationId } = useSession();
  const canReadPayments = can('payment:read');
  const canValidate = can('payment:read');

  const [cfg, setCfg] = useState<BanorteConfig | null>(null);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [orgFees, setOrgFees] = useState<ReturnType<typeof parseOrgFees>>(null);
  const [feesError, setFeesError] = useState<string | null>(null);

  const ordersQuery = useOrders({ limit: 40 });
  const health = summarizePaymentHealth(ordersQuery.data);

  const loadPublic = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const publicCfg = await http<BanorteConfig>('/payments/config', { auth: false });
      setCfg(publicCfg);
    } catch (err) {
      setLoadError(err);
      setCfg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFees = useCallback(async () => {
    if (!organizationId || !canReadPayments) {
      setOrgFees(null);
      return;
    }
    setFeesError(null);
    try {
      const org = await http<Record<string, unknown>>(`/organization/${organizationId}`);
      setOrgFees(parseOrgFees(org));
    } catch (err) {
      setOrgFees(null);
      setFeesError(
        err instanceof Error ? err.message : 'No se pudieron cargar las comisiones de la organización.',
      );
    }
  }, [organizationId, canReadPayments]);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  useEffect(() => {
    void loadFees();
  }, [loadFees]);

  async function runHealthCheck() {
    if (!canValidate) {
      toast.error('No tienes permiso para validar la configuración de pagos');
      return;
    }
    setBusy(true);
    try {
      const result = await http<ValidateResult>('/payments/config/validate');
      setValidation(result);
      setCfg((current) =>
        current
          ? {
              ...current,
              validation: {
                ready: result.ready,
                demo: result.demo,
                missing: result.missing,
                warnings: result.warnings,
              },
              ipn: result.ipn ?? current.ipn,
              productionReady: result.ready && !result.demo,
              demo: result.demo,
              mode: result.demo ? 'demo' : 'live',
            }
          : current,
      );
      toast.success(
        result.ready && !result.demo
          ? 'Health check OK — Banorte listo para producción'
          : result.demo
            ? 'Health check: modo demo (sin cobro real)'
            : 'Health check: faltan variables o hay advertencias',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo validar el setup');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  }

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <PageHeader
          eyebrow="Configuración · Liquidación"
          title="Pagos Banorte"
          description="Estado de Payworks, SPEI, IPN y entornos."
        />
        <div className={styles.skeletonKpis} aria-hidden="true">
          <Skeleton height={96} radius={12} />
          <Skeleton height={96} radius={12} />
          <Skeleton height={96} radius={12} />
          <Skeleton height={96} radius={12} />
        </div>
        <Skeleton height={280} radius={12} />
        <span className={styles.srOnly}>Cargando configuración de pagos…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Configuración · Liquidación" title="Pagos Banorte" />
        <QueryError error={loadError} onRetry={() => void loadPublic()} />
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Configuración · Liquidación" title="Pagos Banorte" />
        <EmptyState
          title="Sin configuración de pagos"
          description="El API no devolvió el estado público de Banorte."
          illustration="error"
          action={
            <Button variant="outline" onClick={() => void loadPublic()}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  const checklist = validation ?? cfg.validation;
  const ipn = validation?.ipn ?? cfg.ipn;
  const blocking = checklist.missing.length;
  const warnings = checklist.warnings.length;
  const credentials = buildCredentialRows({ ...cfg, ipn }, checklist);
  const fees = orgFees ? feeBreakdown(orgFees) : null;
  const misconfigured = !cfg.productionReady || blocking > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración · Liquidación"
        title="Pagos Banorte"
        description="Estado operativo de Payworks / SPEI / OXXO, credenciales enmascaradas, comisiones e IPN. Los secretos nunca se exponen ni se registran en consola."
        actions={
          <>
            <Button variant="outline" onClick={() => void loadPublic()} disabled={busy}>
              Actualizar
            </Button>
            <Button
              loading={busy}
              loadingLabel="Validando…"
              disabled={!canValidate}
              onClick={() => void runHealthCheck()}
            >
              Health check
            </Button>
          </>
        }
      />

      {misconfigured && (
        <div className={styles.alertBanner} role="alert">
          <StatusDot tone="danger" label="Riesgo de venta perdida" />
          <div>
            <strong>
              {cfg.demo
                ? 'El gateway está en demo: no hay cobro real.'
                : 'La configuración live está incompleta.'}
            </strong>
            <p>
              {blocking > 0
                ? `Hay ${blocking} variable${blocking === 1 ? '' : 's'} bloqueante${blocking === 1 ? '' : 's'}. Completa el checklist antes de publicar eventos de pago.`
                : 'Revisa advertencias y confirma el registro IPN en el portal Banorte.'}
            </p>
          </div>
        </div>
      )}

      {!canReadPayments && (
        <div className={styles.permissionBanner} role="status">
          <StatusDot tone="warning" label="Permisos limitados" />
          <span>Necesitas payment:read para health check y detalle de comisiones.</span>
        </div>
      )}

      <section className={styles.kpis} aria-label="Resumen Banorte">
        <KpiCard
          label="Entorno"
          value={cfg.mode === 'demo' ? 'Demo' : 'Live'}
          tone={cfg.demo ? 'warning' : 'success'}
          hint={cfg.demo ? 'Sin cargo real ni liquidación' : 'Cobros hacia cuenta del promotor'}
        />
        <KpiCard
          label="Producción"
          value={cfg.productionReady ? 'Lista' : 'Pendiente'}
          tone={cfg.productionReady ? 'success' : 'warning'}
          hint={cfg.productionReady ? 'Credenciales y IPN OK' : 'Completa el checklist'}
        />
        <KpiCard
          label="IPN secret"
          value={ipn?.webhookSecretConfigured ? 'Configurado' : 'Faltante'}
          tone={ipn?.webhookSecretConfigured ? 'success' : 'warning'}
          hint="Solo estado booleano · valor oculto"
        />
        <KpiCard
          label="Última prueba"
          value={
            validation?.checkedAt
              ? new Date(validation.checkedAt).toLocaleString('es-MX', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—'
          }
          tone="neutral"
          hint="Validate sin revelar secretos"
        />
      </section>

      <div className={`${styles.envBanner} ${cfg.demo ? styles.envDemo : styles.envLive}`}>
        <Badge tone={envTone(cfg)} variant="soft" dot>
          {envLabel(cfg)}
        </Badge>
        <p>
          {cfg.demo
            ? 'Entorno de pruebas: puedes recorrer checkout sin datos de tarjeta reales. No uses producción sin completar credenciales.'
            : 'Entorno de producción: los cobros se liquidan a la cuenta Banorte del comercio. Usa montos de prueba solo en el portal Banorte.'}
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <Section
            title="Estado del gateway"
            description={`${cfg.gateway} · métodos habilitados y liquidación`}
            actions={
              <Badge tone={envTone(cfg)} variant="soft" dot>
                {envLabel(cfg)}
              </Badge>
            }
          >
            <div className={styles.statusRow}>
              <Badge tone={cfg.demo ? 'warning' : 'success'} variant="soft">
                {cfg.demo ? 'Modo demo' : 'Modo live'}
              </Badge>
              <Badge tone={cfg.productionReady ? 'success' : 'warning'} variant="soft">
                {cfg.productionReady ? 'Listo para producción' : 'Credenciales incompletas'}
              </Badge>
              {ipn && (
                <Badge
                  tone={ipn.webhookSecretConfigured ? 'success' : 'warning'}
                  variant="soft"
                >
                  {ipn.webhookSecretConfigured ? 'IPN secret OK' : 'IPN secret faltante'}
                </Badge>
              )}
            </div>
            <p className={styles.settlement}>{cfg.settlement}</p>
            <p className={styles.note}>{cfg.buyerNote}</p>
          </Section>

          <Section
            title="Credenciales (enmascaradas)"
            description="Solo se muestra si están configuradas. Los valores reales viven en variables de entorno del API."
          >
            <ul className={styles.credList}>
              {credentials.map((row) => (
                <li key={row.id} className={styles.credItem}>
                  <div>
                    <strong>{row.label}</strong>
                    <span className={styles.credHint}>{row.hint}</span>
                  </div>
                  <div className={styles.credValue}>
                    <code aria-label={`${row.label}: ${row.configured ? 'configurado' : 'pendiente'}`}>
                      {row.masked}
                    </code>
                    <Badge
                      tone={row.configured ? 'success' : 'warning'}
                      size="sm"
                      variant="soft"
                    >
                      {row.configured ? 'OK' : 'Pendiente'}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.hint}>
              Esta pantalla jamás solicita ni muestra el secret completo. Define{' '}
              <code>BANORTE_*</code> en el servidor; el health check solo reporta faltantes por nombre.
            </p>
          </Section>

          <Section
            title="Métodos de pago"
            description="Habilitados según el gateway público y el estado de liquidación"
          >
            <ul className={styles.methodList}>
              {cfg.methods.map((method) => {
                const state = methodEnabled(method, cfg, checklist);
                return (
                  <li key={method} className={styles.methodItem}>
                    <div>
                      <strong>{methodLabel(method)}</strong>
                      <span>{methodHint(method)}</span>
                      <span className={styles.methodReason}>{state.reason}</span>
                    </div>
                    <Badge
                      tone={state.enabled ? 'success' : 'danger'}
                      variant="soft"
                      size="sm"
                    >
                      {state.enabled ? 'Habilitado' : 'Bloqueado'}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            title="Comisiones"
            description="Desglose según la tasa contractual de la organización (MXN)"
          >
            {fees ? (
              <div className={styles.feeGrid}>
                <div className={styles.feeCard}>
                  <span>Tasa plataforma</span>
                  <strong>{fees.rateLabel}</strong>
                  <em>
                    {fees.inclusive
                      ? 'Fees incluidos en el precio del boleto'
                      : 'Fees adicionales al precio del boleto'}
                  </em>
                </div>
                <div className={styles.feeCard}>
                  <span>Ejemplo boleto</span>
                  <strong>{fees.ticketLabel}</strong>
                  <em>Base ilustrativa $1,000 MXN</em>
                </div>
                <div className={styles.feeCard}>
                  <span>Comisión</span>
                  <strong>{fees.commissionLabel}</strong>
                  <em>Retención TicketOS</em>
                </div>
                <div className={styles.feeCard}>
                  <span>Neto estimado</span>
                  <strong>{fees.netLabel}</strong>
                  <em>Antes de comisiones bancarias Banorte</em>
                </div>
              </div>
            ) : (
              <EmptyState
                size="sm"
                title="Comisiones no disponibles"
                description={
                  feesError ??
                  (canReadPayments
                    ? 'No se pudo leer la tasa de la organización.'
                    : 'Requiere permiso payment:read y una organización activa.')
                }
                illustration="chart"
                action={
                  canReadPayments ? (
                    <Button variant="outline" size="sm" onClick={() => void loadFees()}>
                      Reintentar
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Section>

          {ipn && (
            <Section
              title="IPN / Payworks"
              description={
                ipn.registerHint ||
                'Registra esta URL en el portal Banorte para confirmar CARD/SPEI/OXXO.'
              }
              actions={
                <StatusDot
                  tone={ipn.webhookSecretConfigured ? 'success' : 'warning'}
                  label={ipn.webhookSecretConfigured ? 'Firmas activas' : 'Sin secret'}
                />
              }
            >
              <div className={styles.copyRow}>
                <div>
                  <strong className={styles.copyLabel}>Webhook IPN</strong>
                  <code className={styles.copyValue}>{ipn.webhookUrl}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText('Webhook', ipn.webhookUrl)}
                >
                  Copiar
                </Button>
              </div>
              <div className={styles.copyRow}>
                <div>
                  <strong className={styles.copyLabel}>Return URL base</strong>
                  <code className={styles.copyValue}>{ipn.returnUrlBase}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText('Return URL', ipn.returnUrlBase)}
                >
                  Copiar
                </Button>
              </div>
              <div className={styles.copyRow}>
                <div>
                  <strong className={styles.copyLabel}>Cancel URL</strong>
                  <code className={styles.copyValue}>{ipn.cancelUrl}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText('Cancel URL', ipn.cancelUrl)}
                >
                  Copiar
                </Button>
              </div>
              <p className={styles.hint}>
                Firmas esperadas: <strong>{ipn.signatureHeaders.join(' · ')}</strong>. En
                producción define <code>API_PUBLIC_URL</code> y <code>BANORTE_WEBHOOK_SECRET</code>{' '}
                en el servidor.
              </p>
            </Section>
          )}

          <Section
            title="Checklist de producción"
            description={
              blocking === 0 && warnings === 0
                ? 'Sin faltantes ni advertencias en la validación actual.'
                : `${blocking} bloqueante${blocking === 1 ? '' : 's'} · ${warnings} advertencia${warnings === 1 ? '' : 's'}`
            }
          >
            {blocking > 0 && (
              <div className={styles.listBlock}>
                <strong>Faltantes (bloquean live)</strong>
                <ul>
                  {checklist.missing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings > 0 && (
              <div className={styles.listBlock}>
                <strong>Advertencias</strong>
                <ul>
                  {checklist.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {blocking === 0 && warnings === 0 && (
              <p className={styles.note}>
                La validación no reporta variables faltantes. Confirma el registro IPN en el portal
                Banorte antes del go-live.
              </p>
            )}
          </Section>
        </div>

        <aside className={styles.stack}>
          <Section
            title="Salud de transacciones"
            description="Órdenes recientes del admin · sin secretos ni payloads de pago"
          >
            {ordersQuery.isPending ? (
              <div className={styles.healthSkeleton} aria-busy="true">
                <Skeleton height={64} radius={10} />
                <Skeleton height={160} radius={10} />
              </div>
            ) : ordersQuery.error ? (
              <QueryError
                error={ordersQuery.error}
                onRetry={() => void ordersQuery.refetch()}
              />
            ) : health.total === 0 ? (
              <EmptyState
                size="sm"
                title="Sin órdenes recientes"
                description="Cuando haya ventas, verás aquí el estado de pago Banorte para detectar fallos antes de que escalen."
                illustration="inbox"
              />
            ) : (
              <>
                <div className={styles.healthKpis}>
                  <div>
                    <span>Pagadas</span>
                    <strong>{health.paid}</strong>
                  </div>
                  <div>
                    <span>Pendientes</span>
                    <strong>{health.pending}</strong>
                  </div>
                  <div>
                    <span>Fallidas</span>
                    <strong>{health.failed}</strong>
                  </div>
                </div>
                {health.failed > 0 && (
                  <p className={styles.healthWarn} role="status">
                    Hay pagos fallidos recientes. Revisa IPN, secret y modo live antes de impulsar
                    campañas.
                  </p>
                )}
                <Timeline
                  label="Pagos recientes"
                  density="sm"
                  items={health.recent.map((row) => ({
                    id: row.id,
                    title: `${row.label} · ${row.amount}`,
                    description: `${row.gateway} · ${row.status}`,
                    timestamp: row.when,
                    tone: row.tone,
                  }))}
                />
              </>
            )}
          </Section>

          <Section
            title="Health operativo"
            description="Señales seguras · sin payloads de prueba con datos reales"
          >
            <ul className={styles.healthList}>
              <li className={styles.healthItem}>
                <div>
                  <strong>Gateway</strong>
                  <span>{cfg.gateway} conectado al panel</span>
                </div>
                <Badge tone="info" variant="soft" size="sm">
                  Público
                </Badge>
              </li>
              <li className={styles.healthItem}>
                <div>
                  <strong>Modo de cobro</strong>
                  <span>
                    {cfg.demo
                      ? 'Demo: flujos de confirmación sin cargo'
                      : 'Live: liquidación a cuenta Banorte'}
                  </span>
                </div>
                <Badge tone={cfg.demo ? 'warning' : 'success'} variant="soft" size="sm">
                  {cfg.mode}
                </Badge>
              </li>
              <li className={styles.healthItem}>
                <div>
                  <strong>Validación</strong>
                  <span>
                    {checklist.ready
                      ? 'ready=true en el último check'
                      : 'ready=false — revisa faltantes'}
                  </span>
                </div>
                <Badge
                  tone={checklist.ready ? 'success' : 'danger'}
                  variant="soft"
                  size="sm"
                >
                  {checklist.ready ? 'OK' : 'NOK'}
                </Badge>
              </li>
              <li className={styles.healthItem}>
                <div>
                  <strong>Webhook secret</strong>
                  <span>Booleano enmascarado · valor nunca listado</span>
                </div>
                <Badge
                  tone={ipn?.webhookSecretConfigured ? 'success' : 'warning'}
                  variant="soft"
                  size="sm"
                >
                  {ipn?.webhookSecretConfigured ? 'Sí' : 'No'}
                </Badge>
              </li>
            </ul>
          </Section>

          <Section title="Pruebas seguras" description="Qué puedes hacer sin filtrar secretos">
            <p className={styles.secureCallout}>
              El botón <strong>Health check</strong> llama a{' '}
              <code>/payments/config/validate</code> y solo devuelve listas de variables faltantes,
              advertencias y URLs públicas IPN. No envía cobros, no crea intents y no incluye
              merchant id, claves ni CLABE completa.
              {cfg.demo
                ? ' En demo puedes recorrer el checkout de comprador sin datos de tarjeta reales.'
                : ' En live usa montos de prueba controlados en el portal Banorte, nunca en este panel.'}
            </p>
            <div className={styles.secureAction}>
              <Button
                fullWidth
                loading={busy}
                loadingLabel="Ejecutando…"
                disabled={!canValidate}
                onClick={() => void runHealthCheck()}
              >
                Ejecutar prueba de salud
              </Button>
            </div>
            <span className={styles.srOnly} aria-live="polite">
              {busy ? 'Ejecutando health check de Banorte' : ''}
            </span>
          </Section>
        </aside>
      </div>
    </div>
  );
}

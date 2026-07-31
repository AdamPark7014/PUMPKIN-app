'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  formatCurrency,
  formatDateTime,
  formatNumber,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
  useReducedMotion,
} from '@boletera/ui';
import { ScheduleBuilder } from '@/components/ScheduleBuilder/ScheduleBuilder';
import { useToast } from '@/components/Toast/ToastProvider';
import { useCreateEvent, useCreateResidency } from '@/lib/queries/events';
import { useVenues } from '@/lib/queries/venues';
import { useSession } from '@/lib/use-session';
import {
  createSeries,
  type PhaseTemplate,
  type SchedulePreview,
  type SeriesTemplate,
} from '@/lib/scheduling-api';
import { PublishConfirm } from './_components/PublishConfirm';
import { emptyDraft, parseStep, stepIndex } from './_lib/defaults';
import { clearDraft, loadDraft, saveDraft } from './_lib/draft';
import {
  CATEGORY_LABELS,
  PHASE_KIND_OPTIONS,
  SERIES_KIND_OPTIONS,
  STEP_LABELS,
  categoryTone,
  seriesKindLabel,
} from './_lib/labels';
import { CATEGORIES, STEP_IDS, type EventDraftForm, type StepId } from './_lib/types';
import { residencyFrequency, stepIsValid } from './_lib/validation';
import styles from './new-event.module.scss';

export default function NewEventPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <Skeleton height={96} />
          <Skeleton height={240} />
        </div>
      }
    >
      <NewEventWizard />
    </Suspense>
  );
}

function NewEventWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const reducedMotion = useReducedMotion();
  const { can, status: sessionStatus } = useSession();
  const canWrite = can('event:write');

  const venuesQuery = useVenues();
  const createEvent = useCreateEvent();
  const createResidency = useCreateResidency();
  const [seriesSaving, setSeriesSaving] = useState(false);

  const step = parseStep(searchParams.get('step'));
  const setStep = useCallback(
    (next: StepId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('step', next);
      router.replace(`/events/new?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState<EventDraftForm>(emptyDraft().form);
  const [schedule, setSchedule] = useState(emptyDraft().schedule);
  const [phases, setPhases] = useState<PhaseTemplate[]>([]);
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setForm(draft.form);
      setSchedule(draft.schedule);
      setPhases(draft.phases);
      setForce(draft.force);
      setDraftSavedAt(draft.savedAt);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(
      () => {
        const saved = saveDraft({ form, schedule, phases, force });
        setDraftSavedAt(saved.savedAt);
      },
      reducedMotion ? 0 : 500,
    );
    return () => window.clearTimeout(timer);
  }, [form, schedule, phases, force, hydrated, reducedMotion]);

  useEffect(() => {
    if (!venuesQuery.data?.length || form.venueId) return;
    const only = venuesQuery.data[0];
    if (venuesQuery.data.length === 1 && only) {
      setForm((prev) => ({ ...prev, venueId: only.id }));
    }
  }, [venuesQuery.data, form.venueId]);

  const venue = venuesQuery.data?.find((item) => item.id === form.venueId);
  const timezone = 'America/Mexico_City';

  const template: SeriesTemplate = useMemo(
    () => ({
      capacity: form.capacity,
      basePrice: form.basePrice,
      zoneName: form.zoneName || undefined,
      currency: 'MXN',
      description: form.description || undefined,
      durationMinutes: form.durationMinutes,
      doorsOffsetMinutes: form.doorsOffsetMinutes,
      announceOffsetDays: form.announceOffsetDays,
      publishOffsetDays: form.autoPublish ? form.announceOffsetDays : null,
      salesStartOffsetDays: form.salesStartOffsetDays,
      salesEndOffsetHours: form.salesEndOffsetHours,
    }),
    [form],
  );

  const blocking = preview?.totals.blocking ?? 0;
  const currentValid = stepIsValid(step, form, schedule, preview);
  const reviewValid = stepIsValid('revisar', form, schedule, preview);
  const saving =
    createEvent.isPending || createResidency.isPending || seriesSaving;

  function patchForm(patch: Partial<EventDraftForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function addPhase() {
    setPhases((prev) => [
      ...prev,
      {
        name: prev.length ? `Fase ${prev.length + 1}` : 'Preventa',
        kind: 'PRESALE',
        code: '',
        startOffsetDays: (form.salesStartOffsetDays ?? 45) + 7,
        endOffsetDays: form.salesStartOffsetDays ?? 45,
        discountPercent: null,
        maxPerOrder: 4,
      },
    ]);
  }

  function patchPhase(index: number, patch: Partial<PhaseTemplate>) {
    setPhases((prev) => prev.map((phase, i) => (i === index ? { ...phase, ...patch } : phase)));
  }

  function goNext() {
    const idx = stepIndex(step);
    if (idx < STEP_IDS.length - 1 && currentValid) {
      setStep(STEP_IDS[idx + 1]);
    }
  }

  function goBack() {
    const idx = stepIndex(step);
    if (idx > 0) setStep(STEP_IDS[idx - 1]);
  }

  async function submit() {
    if (!canWrite) {
      toast.error('No tienes permiso event:write para crear eventos');
      return;
    }
    if (!reviewValid) {
      toast.error('Completa los pasos anteriores antes de crear');
      return;
    }
    if (blocking > 0 && !force) {
      toast.error('Hay conflictos de agenda. Ajusta fechas o confirma el override');
      return;
    }

    const title = form.title.trim();
    const description = [
      form.description.trim(),
      form.zoneName ? `Zona base: ${form.zoneName}` : '',
      form.category ? `Categoría: ${CATEGORY_LABELS[form.category]}` : '',
      phases.length
        ? `Fases de venta: ${phases.map((p) => p.name).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      if (schedule.mode === 'single') {
        const event = await createEvent.mutateAsync({
          title,
          description,
          type: 'single',
          startDate: schedule.rule.startLocal,
          venueId: form.venueId,
          capacity: form.capacity,
          basePrice: form.basePrice,
        });
        clearDraft();
        toast.success('Evento creado en borrador');
        if (form.publishNow) {
          setPublishTarget({ id: event.id, title: event.title });
        } else {
          router.push(`/events/${event.id}`);
        }
        return;
      }

      if (form.seriesKind === 'RESIDENCY') {
        const result = await createResidency.mutateAsync({
          name: title,
          venueId: form.venueId,
          startDate: schedule.rule.startLocal,
          frequency: residencyFrequency(schedule.rule),
          occurrenceCount: preview?.totals.occurrences ?? schedule.rule.count ?? 8,
          capacity: form.capacity,
          basePrice: form.basePrice,
        });
        clearDraft();
        const total =
          typeof result.totalEvents === 'number'
            ? result.totalEvents
            : (preview?.totals.occurrences ?? schedule.rule.count ?? 0);
        toast.success(`Residencia creada · ${formatNumber(total)} fechas`);
        router.push('/events/series');
        return;
      }

      const cleanPhases = phases.map((phase) => ({
        ...phase,
        code: phase.code?.trim() ? phase.code.trim().toUpperCase() : null,
      }));

      setSeriesSaving(true);
      try {
        const series = await createSeries({
          name: title,
          description: form.description.trim() || undefined,
          kind: form.seriesKind,
          category: form.category,
          venueId: form.venueId,
          rule: { ...schedule.rule, timezone },
          template,
          phases: cleanPhases,
          publish: form.publishNow,
          force,
        });
        clearDraft();
        toast.success(`Serie creada con ${formatNumber(series.events.length)} fechas`);
        router.push(`/events/series/${series.id}`);
      } finally {
        setSeriesSaving(false);
      }
    } catch (error) {
      setSeriesSaving(false);
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el evento');
    }
  }

  if (sessionStatus === 'loading' || !hydrated) {
    return (
      <div className={styles.page}>
        <Skeleton height={96} />
        <Skeleton height={240} />
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Eventos"
          title="Crear evento"
          description="Se requiere el permiso event:write."
          breadcrumbs={[
            { label: 'Eventos', href: '/events' },
            { label: 'Crear' },
          ]}
        />
        <EmptyState
          title="Sin permiso para crear"
          description="Tu rol no incluye event:write. Solicita acceso a un administrador de la organización."
          illustration="error"
          tone="danger"
          action={
            <Button type="button" variant="outline" onClick={() => router.push('/events')}>
              Volver a eventos
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Programación"
        title="Crear evento"
        description={`Paso ${stepIndex(step) + 1} de ${STEP_IDS.length}: ${STEP_LABELS[step]}. El borrador se guarda en este navegador.`}
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Crear' },
        ]}
        actions={
          <div className={styles.navGroup}>
            <Button type="button" variant="ghost" onClick={() => router.push('/events/series')}>
              Series
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearDraft();
                const fresh = emptyDraft();
                setForm(fresh.form);
                setSchedule(fresh.schedule);
                setPhases([]);
                setForce(false);
                setPreview(null);
                setDraftSavedAt(null);
                setStep('datos');
                toast.success('Borrador local eliminado');
              }}
            >
              Limpiar borrador
            </Button>
          </div>
        }
      >
        <Tabs
          label="Pasos del asistente"
          variant="pill"
          fullWidth
          value={step}
          onValueChange={(id) => {
            const target = parseStep(id);
            const targetIdx = stepIndex(target);
            const currentIdx = stepIndex(step);
            if (targetIdx <= currentIdx || stepIsValid(step, form, schedule, preview)) {
              setStep(target);
            }
          }}
          items={STEP_IDS.map((id) => ({
            id,
            label: STEP_LABELS[id],
            badge: stepIsValid(id, form, schedule, preview) ? '✓' : undefined,
            disabled:
              stepIndex(id) > stepIndex(step) + 1 ||
              (stepIndex(id) > stepIndex(step) && !currentValid),
          }))}
        />
      </PageHeader>

      <Section columns={4} gap="sm" aria-label="Resumen del borrador">
        <KpiCard
          label="Fechas previstas"
          value={formatNumber(preview?.totals.occurrences ?? (schedule.mode === 'single' ? 1 : 0))}
          hint={schedule.mode === 'single' ? 'Fecha única' : seriesKindLabel(form.seriesKind)}
          tone="info"
        />
        <KpiCard
          label="Aforo total"
          value={formatNumber(preview?.totals.capacity ?? form.capacity)}
          hint={`${formatNumber(form.capacity)} por función`}
        />
        <KpiCard
          label="Precio base"
          value={formatCurrency(form.basePrice, 0)}
          hint={form.zoneName || 'Sin zona'}
          tone="accent"
        />
        <KpiCard
          label="Conflictos"
          value={formatNumber(blocking)}
          hint={
            preview
              ? `${formatNumber(preview.totals.withConflicts)} con aviso`
              : 'Sin vista previa'
          }
          tone={blocking > 0 ? 'danger' : 'success'}
        />
      </Section>

      <div className={styles.layout}>
        <div className={styles.main}>
          <Card variant="outline" padding="lg">
            {step === 'datos' && (
              <>
                <CardHeader
                  title="Datos del programa"
                  description="Título, categoría y tipo de serie o residencia."
                />
                <div className={styles.formGrid}>
                  <label className={`${styles.field} ${styles.full}`}>
                    Título
                    <input
                      value={form.title}
                      placeholder="Ej. Noche de Jazz — Temporada 2026"
                      onChange={(e) => patchForm({ title: e.target.value })}
                      required
                      aria-required="true"
                    />
                  </label>
                  <label className={`${styles.field} ${styles.full}`}>
                    Descripción
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) => patchForm({ description: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    Categoría
                    <select
                      value={form.category}
                      onChange={(e) =>
                        patchForm({
                          category: e.target.value as EventDraftForm['category'],
                        })
                      }
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    Tipo de programa
                    <select
                      value={form.seriesKind}
                      onChange={(e) =>
                        patchForm({
                          seriesKind: e.target.value as EventDraftForm['seriesKind'],
                        })
                      }
                    >
                      {SERIES_KIND_OPTIONS.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            {step === 'recinto' && (
              <>
                <CardHeader
                  title="Recinto y aforo"
                  description="Capacidad, precio base MXN y tiempos de sala."
                />
                {venuesQuery.isPending ? (
                  <Skeleton height={160} />
                ) : venuesQuery.error ? (
                  <EmptyState
                    title="No se pudieron cargar recintos"
                    description={
                      venuesQuery.error instanceof Error
                        ? venuesQuery.error.message
                        : 'Error desconocido'
                    }
                    illustration="error"
                    tone="danger"
                    action={
                      <Button type="button" onClick={() => void venuesQuery.refetch()}>
                        Reintentar
                      </Button>
                    }
                  />
                ) : !venuesQuery.data?.length ? (
                  <EmptyState
                    title="Sin recintos"
                    description="Crea un recinto antes de programar un evento."
                    illustration="seats"
                    action={
                      <Button type="button" onClick={() => router.push('/venues')}>
                        Ir a recintos
                      </Button>
                    }
                  />
                ) : (
                  <div className={styles.formGrid}>
                    <label className={`${styles.field} ${styles.full}`}>
                      Recinto
                      <select
                        value={form.venueId}
                        onChange={(e) => patchForm({ venueId: e.target.value })}
                        required
                      >
                        <option value="">Seleccionar…</option>
                        {venuesQuery.data.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.totalCapacity || item.capacity
                              ? ` · ${formatNumber(item.totalCapacity ?? item.capacity ?? 0)} lugares`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      Aforo por función
                      <input
                        type="number"
                        min={1}
                        value={form.capacity}
                        onChange={(e) => patchForm({ capacity: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label className={styles.field}>
                      Duración (min)
                      <input
                        type="number"
                        min={30}
                        step={15}
                        value={form.durationMinutes}
                        onChange={(e) =>
                          patchForm({ durationMinutes: Number(e.target.value) || 30 })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Zona / oferta base
                      <input
                        value={form.zoneName}
                        onChange={(e) => patchForm({ zoneName: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      Precio base (MXN)
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={form.basePrice}
                        onChange={(e) => patchForm({ basePrice: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label className={styles.field}>
                      Puertas abren (min antes)
                      <input
                        type="number"
                        min={0}
                        step={15}
                        value={form.doorsOffsetMinutes}
                        onChange={(e) =>
                          patchForm({ doorsOffsetMinutes: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                    <p className={`${styles.hint} ${styles.full}`}>
                      Zona horaria operativa: <strong>{timezone}</strong>. El mapa de asientos se
                      asigna en el detalle del evento.
                    </p>
                  </div>
                )}
              </>
            )}

            {step === 'programacion' && (
              <>
                <CardHeader
                  title="Programación"
                  description="Fecha única o recurrencia con vista previa de conflictos del recinto."
                />
                {!form.venueId ? (
                  <EmptyState
                    title="Selecciona un recinto"
                    description="La vista previa necesita un recinto para validar traslapes."
                    illustration="seats"
                    action={
                      <Button type="button" onClick={() => setStep('recinto')}>
                        Ir a recinto
                      </Button>
                    }
                  />
                ) : (
                  <ScheduleBuilder
                    venueId={form.venueId}
                    timezone={timezone}
                    template={template}
                    value={schedule}
                    onChange={setSchedule}
                    onPreview={setPreview}
                  />
                )}
              </>
            )}

            {step === 'ventas' && (
              <>
                <CardHeader
                  title="Ventanas y fases de venta"
                  description="Offsets relativos a cada función. Quedan en el borrador y resumen del programa."
                />
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    Anuncio (días antes)
                    <input
                      type="number"
                      min={0}
                      value={form.announceOffsetDays ?? ''}
                      onChange={(e) =>
                        patchForm({
                          announceOffsetDays:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Venta abre (días antes)
                    <input
                      type="number"
                      min={0}
                      value={form.salesStartOffsetDays ?? ''}
                      onChange={(e) =>
                        patchForm({
                          salesStartOffsetDays:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Venta cierra (horas antes)
                    <input
                      type="number"
                      min={0}
                      value={form.salesEndOffsetHours ?? ''}
                      onChange={(e) =>
                        patchForm({
                          salesEndOffsetHours:
                            e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className={`${styles.checkRow} ${styles.full}`}>
                    <input
                      type="checkbox"
                      checked={form.autoPublish}
                      onChange={(e) => patchForm({ autoPublish: e.target.checked })}
                    />
                    Publicar automáticamente en la fecha de anuncio (intención del programa)
                  </label>
                </div>

                <div style={{ marginTop: '1.25rem' }}>
                  <CardHeader
                    as="h3"
                    title={`Fases de venta (${formatNumber(phases.length)})`}
                    description="Los días se cuentan antes de cada función."
                    actions={
                      <Button type="button" size="sm" variant="outline" onClick={addPhase}>
                        Agregar fase
                      </Button>
                    }
                  />
                  {phases.length === 0 ? (
                    <p className={styles.hint}>Sin fases adicionales. Se usará la venta general.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      {phases.map((phase, index) => (
                        <div key={`${phase.name}-${index}`} className={styles.phaseCard}>
                          <label className={styles.field}>
                            Nombre
                            <input
                              value={phase.name}
                              onChange={(e) => patchPhase(index, { name: e.target.value })}
                            />
                          </label>
                          <label className={styles.field}>
                            Tipo
                            <select
                              value={phase.kind}
                              onChange={(e) =>
                                patchPhase(index, {
                                  kind: e.target.value as PhaseTemplate['kind'],
                                })
                              }
                            >
                              {PHASE_KIND_OPTIONS.map((kind) => (
                                <option key={kind.value} value={kind.value}>
                                  {kind.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            Código (opcional)
                            <input
                              value={phase.code ?? ''}
                              placeholder="BANORTE2026"
                              onChange={(e) => patchPhase(index, { code: e.target.value })}
                            />
                          </label>
                          <label className={styles.field}>
                            Abre (días antes)
                            <input
                              type="number"
                              min={0}
                              value={phase.startOffsetDays}
                              onChange={(e) =>
                                patchPhase(index, {
                                  startOffsetDays: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </label>
                          <label className={styles.field}>
                            Cierra (días antes)
                            <input
                              type="number"
                              min={0}
                              value={phase.endOffsetDays}
                              onChange={(e) =>
                                patchPhase(index, { endOffsetDays: Number(e.target.value) || 0 })
                              }
                            />
                          </label>
                          <label className={styles.field}>
                            Descuento %
                            <input
                              type="number"
                              min={0}
                              max={90}
                              value={phase.discountPercent ?? ''}
                              onChange={(e) =>
                                patchPhase(index, {
                                  discountPercent:
                                    e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <div className={styles.full}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setPhases((prev) => prev.filter((_, i) => i !== index))
                              }
                            >
                              Eliminar fase
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 'revisar' && (
              <>
                <CardHeader
                  title="Confirmación"
                  description="Revisa el resumen antes de crear. La publicación pide una segunda confirmación."
                />
                <ul className={styles.summaryList}>
                  <li>
                    <strong>{form.title || '—'}</strong>
                    <span>
                      <Badge tone={categoryTone(form.category)} dot>
                        {CATEGORY_LABELS[form.category]}
                      </Badge>{' '}
                      ·{' '}
                      {schedule.mode === 'single'
                        ? 'Fecha única'
                        : seriesKindLabel(form.seriesKind)}
                    </span>
                  </li>
                  <li>
                    <strong>{venue?.name ?? 'Sin recinto'}</strong>
                    <span>
                      {formatNumber(form.capacity)} lugares · {timezone}
                    </span>
                  </li>
                  <li>
                    <strong>
                      {formatNumber(preview?.totals.occurrences ?? 0)} fecha(s)
                    </strong>
                    <span>
                      {formatNumber(preview?.totals.capacity ?? 0)} lugares totales
                      {preview?.recurrence.summary && schedule.mode === 'recurring'
                        ? ` · ${preview.recurrence.summary}`
                        : ''}
                    </span>
                  </li>
                  <li>
                    <strong>
                      Oferta {form.zoneName}: {formatCurrency(form.basePrice, 0)}
                    </strong>
                    <span>
                      Venta abre {form.salesStartOffsetDays ?? 0} días antes y cierra{' '}
                      {form.salesEndOffsetHours ?? 0} h antes · {formatNumber(phases.length)}{' '}
                      fase(s)
                    </span>
                  </li>
                </ul>

                {blocking > 0 && (
                  <p className={styles.alertDanger} role="alert">
                    {formatNumber(blocking)} fecha(s) tienen conflicto en el recinto. Ajusta la
                    programación o marca el override para crearlas igual.
                  </p>
                )}

                <div style={{ display: 'grid', gap: '0.65rem', marginTop: '1rem' }}>
                  {schedule.mode === 'single' && (
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={form.publishNow}
                        onChange={(e) => patchForm({ publishNow: e.target.checked })}
                      />
                      Publicar después de crear (confirmación adicional)
                    </label>
                  )}
                  {blocking > 0 && (
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                      />
                      Crear a pesar de los conflictos de agenda
                    </label>
                  )}
                </div>
              </>
            )}

            <div className={styles.nav}>
              <div className={styles.draftMeta} aria-live="polite">
                {draftSavedAt ? (
                  <>
                    <Badge tone="neutral" variant="outline">
                      Borrador local
                    </Badge>
                    <span>Guardado {formatDateTime(draftSavedAt)}</span>
                  </>
                ) : (
                  <span>Sin borrador guardado aún</span>
                )}
              </div>
              <div className={styles.navGroup}>
                {stepIndex(step) > 0 && (
                  <Button type="button" variant="ghost" onClick={goBack}>
                    Atrás
                  </Button>
                )}
                {step !== 'revisar' ? (
                  <Button type="button" disabled={!currentValid} onClick={goNext}>
                    Siguiente
                  </Button>
                ) : (
                  <Button
                    type="button"
                    loading={saving}
                    disabled={!reviewValid || (blocking > 0 && !force)}
                    onClick={() => void submit()}
                  >
                    {schedule.mode === 'single'
                      ? 'Crear evento'
                      : form.seriesKind === 'RESIDENCY'
                        ? 'Crear residencia'
                        : `Crear ${formatNumber(preview?.totals.occurrences ?? 0)} fechas`}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        <aside className={styles.aside} aria-label="Vista previa lateral">
          <Card variant="outline" padding="md">
            <CardHeader
              as="h3"
              title="Vista previa"
              description={form.title.trim() || 'Sin título'}
            />
            <div className={styles.previewBlock}>
              <div>
                <Badge tone={categoryTone(form.category)}>{CATEGORY_LABELS[form.category]}</Badge>{' '}
                <Badge tone="info" variant="outline">
                  {schedule.mode === 'single' ? 'Única' : seriesKindLabel(form.seriesKind)}
                </Badge>
              </div>
              <p className={styles.hint}>
                {venue?.name ?? 'Recinto pendiente'} · {formatCurrency(form.basePrice, 0)}
              </p>
              {preview?.occurrences?.length ? (
                <ul className={styles.occList}>
                  {preview.occurrences.slice(0, 8).map((occ) => (
                    <li key={occ.startsAt} className={styles.occItem}>
                      <span>
                        {new Date(occ.startsAt).toLocaleDateString('es-MX', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          timeZone: timezone,
                        })}
                      </span>
                      <span>{occ.localTime}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hint}>Completa la programación para ver fechas.</p>
              )}
              {(preview?.totals.occurrences ?? 0) > 8 && (
                <p className={styles.hint}>
                  +{formatNumber((preview?.totals.occurrences ?? 0) - 8)} fechas más
                </p>
              )}
            </div>
          </Card>

          {blocking > 0 && (
            <p className={styles.alertWarn} role="status">
              Hay conflictos bloqueantes. Revisa el paso de programación.
            </p>
          )}
        </aside>
      </div>

      {publishTarget && (
        <PublishConfirm
          open
          eventId={publishTarget.id}
          eventTitle={publishTarget.title}
          onClose={() => {
            const id = publishTarget.id;
            setPublishTarget(null);
            router.push(`/events/${id}`);
          }}
          onSkip={() => {
            const id = publishTarget.id;
            setPublishTarget(null);
            router.push(`/events/${id}`);
          }}
          onPublished={() => {
            const id = publishTarget.id;
            setPublishTarget(null);
            router.push(`/events/${id}`);
          }}
        />
      )}
    </div>
  );
}

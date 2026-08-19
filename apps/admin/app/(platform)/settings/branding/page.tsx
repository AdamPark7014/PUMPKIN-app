'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  StatusDot,
  readableTextOn,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { http } from '@/lib/http';
import { useBranding, useUpdateBranding, type Branding } from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { BrandPreviews, type PreviewSurface } from './BrandPreviews';
import {
  contrastRatio,
  derivePalette,
  draftsEqual,
  formatRatio,
  gradeContrast,
  gradeLabel,
  isValidHex,
  mapServerErrors,
  normalizeHex,
  readLogoFileAsDataUrl,
  toDraft,
  toPayload,
  validateBrandingDraft,
  DEFAULT_DRAFT,
  STOREFRONT_FONT,
  type BrandDraft,
  type FieldErrors,
  type ThemeSnapshot,
} from './branding-utils';
import styles from './branding.module.scss';

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export default function BrandingSettingsPage() {
  const toast = useToast();
  const { can } = useSession();
  const canManage = can('tenant:manage');
  const brandingQuery = useBranding();
  const updateBranding = useUpdateBranding();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<BrandDraft>(DEFAULT_DRAFT);
  const [baseline, setBaseline] = useState<BrandDraft>(DEFAULT_DRAFT);
  const [themeMeta, setThemeMeta] = useState<ThemeSnapshot | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [logoBroken, setLogoBroken] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>('storefront');
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (!brandingQuery.data) return;
    const snapshot = brandingQuery.data as ThemeSnapshot;
    const next = toDraft(snapshot);
    setDraft(next);
    setBaseline(next);
    setThemeMeta(snapshot);
    setErrors({});
    setStatus('idle');
    setLogoBroken(false);
  }, [brandingQuery.data]);

  const dirty = !draftsEqual(draft, baseline);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const palette = derivePalette(draft.primaryColor, themeMeta?.secondaryColor);
  const contrastOnWhite = contrastRatio(palette.primary, '#ffffff');
  const contrastOnDark = contrastRatio(palette.primary, '#0a0a0a');
  const textOnPrimary = contrastRatio(palette.onPrimary, palette.primary);
  const whiteGrade = gradeContrast(contrastOnWhite);
  const textGrade = gradeContrast(textOnPrimary);

  function patch(partial: Partial<BrandDraft>) {
    if (!canManage) return;
    setDraft((current) => ({ ...current, ...partial }));
    setStatus('dirty');
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(partial) as (keyof BrandDraft)[]) {
        delete next[key];
      }
      delete next.form;
      return next;
    });
    if ('logoUrl' in partial) setLogoBroken(false);
  }

  function resetDraft() {
    setDraft(baseline);
    setErrors({});
    setStatus('idle');
    setLogoBroken(false);
    setConfirmDiscardOpen(false);
  }

  async function persist() {
    const nextErrors = validateBrandingDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatus('error');
      setConfirmSaveOpen(false);
      toast.error('Corrige los campos marcados antes de guardar');
      return;
    }

    const payload = toPayload(draft);
    setStatus('saving');
    setConfirmSaveOpen(false);
    try {
      const saved = await updateBranding.mutateAsync(payload).catch(async (putError: unknown) => {
        const fallback = await http<Branding>('/admin/branding', {
          method: 'POST',
          body: payload,
        });
        if (!fallback) throw putError;
        return fallback;
      });
      const snapshot = saved as ThemeSnapshot;
      const next = toDraft(snapshot);
      setDraft(next);
      setBaseline(next);
      setThemeMeta(snapshot);
      setStatus('saved');
      toast.success('Marca publicada');
    } catch (err) {
      const mapped = mapServerErrors(err);
      setErrors(mapped);
      setStatus('error');
      toast.error(mapped.form ?? 'No se pudo guardar la marca');
    }
  }

  async function onLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canManage) return;
    try {
      const dataUrl = await readLogoFileAsDataUrl(file);
      patch({ logoUrl: dataUrl });
      toast.success('Logo cargado · se guardará con la marca');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el logo');
    }
  }

  if (brandingQuery.isPending) {
    return (
      <div className={styles.page} aria-busy="true">
        <PageHeader
          eyebrow="Configuración · White-label"
          title="Estudio de marca"
          description="Identidad visual del portal de venta, boletos y correos."
        />
        <div className={styles.skeletonLayout} aria-hidden="true">
          <Skeleton height={220} radius={12} />
          <Skeleton height={320} radius={12} />
        </div>
        <span className={styles.srOnly}>Cargando marca…</span>
      </div>
    );
  }

  if (brandingQuery.error) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Configuración · White-label" title="Estudio de marca" />
        <QueryError error={brandingQuery.error} onRetry={() => void brandingQuery.refetch()} />
      </div>
    );
  }

  if (!brandingQuery.data && !dirty) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Configuración · White-label" title="Estudio de marca" />
        <EmptyState
          title="Sin marca configurada"
          description="Aún no hay tema para esta organización. Puedes empezar con los valores por defecto."
          illustration="inbox"
          action={
            <Button
              disabled={!canManage}
              onClick={() => {
                setDraft(DEFAULT_DRAFT);
                setBaseline(DEFAULT_DRAFT);
                setStatus('dirty');
              }}
            >
              Empezar con defaults
            </Button>
          }
        />
      </div>
    );
  }

  const statusLabel =
    status === 'saving'
      ? 'Publicando cambios…'
      : status === 'saved' && !dirty
        ? 'Marca publicada'
        : dirty
          ? 'Hay cambios sin guardar'
          : status === 'error'
            ? 'Revisa errores o reintenta'
            : 'Sin cambios pendientes';

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración · White-label"
        title="Estudio de marca"
        description="Color, logo, dominio y tipografía con vista previa en vivo del storefront, boletos y correos. Validamos contraste WCAG antes de publicar."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!dirty || status === 'saving' || !canManage}
              onClick={() => setConfirmDiscardOpen(true)}
            >
              Deshacer
            </Button>
            <Button
              loading={status === 'saving' || updateBranding.isPending}
              loadingLabel="Guardando…"
              disabled={!dirty || !canManage}
              onClick={() => setConfirmSaveOpen(true)}
            >
              Guardar marca
            </Button>
          </>
        }
      />

      {!canManage && (
        <div className={styles.permissionBanner} role="status">
          <StatusDot tone="warning" label="Solo lectura" />
          <span>Necesitas el permiso tenant:manage para editar o publicar la marca.</span>
        </div>
      )}

      <div
        className={`${styles.statusBanner} ${
          status === 'error'
            ? styles.statusError
            : status === 'saved' && !dirty
              ? styles.statusSaved
              : dirty
                ? styles.statusDirty
                : ''
        }`}
        role="status"
        aria-live="polite"
      >
        <StatusDot
          tone={
            status === 'error'
              ? 'danger'
              : status === 'saved' && !dirty
                ? 'success'
                : dirty
                  ? 'warning'
                  : 'neutral'
          }
          label={statusLabel}
        />
        {dirty ? (
          <Badge tone="warning" variant="soft">
            Borrador
          </Badge>
        ) : (
          <Badge tone="success" variant="soft">
            Publicado
          </Badge>
        )}
      </div>
      {errors.form ? (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      ) : null}
      <span className={styles.srOnly} aria-live="assertive">
        {status === 'saved' ? 'Marca guardada correctamente' : ''}
      </span>

      <div className={styles.layout}>
        <div className={styles.editorCol}>
          <Section
            title="Identidad"
            description="Tokens que se aplican al portal público. Los cambios se reflejan al instante en la vista previa."
          >
            <div className={styles.fields}>
              <div className={styles.colorRow}>
                <div className={styles.swatchWrap}>
                  <label className={styles.swatchLabel} htmlFor={`${formId}-swatch`}>
                    Color
                  </label>
                  <input
                    id={`${formId}-swatch`}
                    className={styles.swatch}
                    type="color"
                    value={palette.primary}
                    disabled={!canManage}
                    aria-label="Selector de color primario"
                    onChange={(e) => patch({ primaryColor: e.target.value })}
                  />
                </div>
                <Input
                  id={`${formId}-hex`}
                  label="Color primario"
                  hint="Hexadecimal #RRGGBB · contraste mínimo 3:1 sobre blanco"
                  value={draft.primaryColor}
                  error={errors.primaryColor}
                  requiredMark
                  disabled={!canManage}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => patch({ primaryColor: e.target.value })}
                  onBlur={() => {
                    if (isValidHex(draft.primaryColor)) {
                      patch({ primaryColor: normalizeHex(draft.primaryColor) });
                    }
                  }}
                />
              </div>

              <div className={styles.checks} aria-label="Accesibilidad del color">
                <div
                  className={`${styles.check} ${
                    whiteGrade === 'fail' ? styles.checkBad : styles.checkOk
                  }`}
                >
                  <Badge
                    tone={whiteGrade === 'fail' ? 'danger' : 'success'}
                    size="sm"
                    variant="soft"
                  >
                    {formatRatio(contrastOnWhite)} · {gradeLabel(whiteGrade)}
                  </Badge>
                  <div>
                    <span className={styles.checkTitle}>Marca sobre fondo claro</span>
                    {whiteGrade === 'fail'
                      ? 'Por debajo de 3:1 — el color no es usable como acento en UI clara.'
                      : whiteGrade === 'aa-large'
                        ? 'Cumple para texto grande / UI (≥ 3:1).'
                        : `Cumple WCAG ${gradeLabel(whiteGrade)} para texto normal.`}
                  </div>
                </div>
                <div
                  className={`${styles.check} ${
                    textGrade === 'fail' || textGrade === 'aa-large'
                      ? styles.checkWarn
                      : styles.checkOk
                  }`}
                >
                  <Badge
                    tone={
                      textGrade === 'fail'
                        ? 'danger'
                        : textGrade === 'aa-large'
                          ? 'warning'
                          : 'success'
                    }
                    size="sm"
                    variant="soft"
                  >
                    {formatRatio(textOnPrimary)} · {gradeLabel(textGrade)}
                  </Badge>
                  <div>
                    <span className={styles.checkTitle}>
                      Texto {readableTextOn(palette.primary) === '#ffffff' ? 'claro' : 'oscuro'}{' '}
                      sobre marca
                    </span>
                    Contraste del CTA en la barra: {formatRatio(textOnPrimary)} · sobre oscuro{' '}
                    {formatRatio(contrastOnDark)}.
                  </div>
                </div>
              </div>

              <div className={styles.paletteRow} aria-label="Paleta derivada">
                {(
                  [
                    ['Primary', palette.primary],
                    ['On primary', palette.onPrimary],
                    ['Secundario', palette.secondary],
                    ['Acento suave', palette.accentSoft],
                  ] as const
                ).map(([label, hex]) => (
                  <div key={label} className={styles.paletteChip}>
                    <span style={{ background: hex }} aria-hidden="true" />
                    <div>
                      <strong>{label}</strong>
                      <code>{hex}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section
            title="Logo"
            description="PNG o SVG transparente por URL HTTPS. También puedes cargar un archivo pequeño para guardarlo embebido."
          >
            <div className={styles.fields}>
              <div className={styles.logoRow}>
                <div className={styles.logoPreviewBox} aria-hidden="true">
                  {draft.logoUrl && !logoBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.logoUrl} alt="" onError={() => setLogoBroken(true)} />
                  ) : (
                    <span>{(draft.subdomain || 'B').slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.logoFields}>
                  <Input
                    id={`${formId}-logo`}
                    label="URL del logo"
                    hint={
                      draft.logoUrl.startsWith('data:')
                        ? 'Archivo embebido listo para publicar · máx. ~180 KB'
                        : 'HTTPS recomendado · o carga un archivo pequeño'
                    }
                    value={draft.logoUrl.startsWith('data:') ? '' : draft.logoUrl}
                    error={errors.logoUrl}
                    type="url"
                    inputMode="url"
                    placeholder={
                      draft.logoUrl.startsWith('data:')
                        ? 'Logo cargado desde archivo'
                        : 'https://cdn.ejemplo.com/logo.svg'
                    }
                    spellCheck={false}
                    autoComplete="off"
                    disabled={!canManage || draft.logoUrl.startsWith('data:')}
                    onChange={(e) => patch({ logoUrl: e.target.value })}
                  />
                  <div className={styles.logoActions}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/webp"
                      className={styles.srOnly}
                      tabIndex={-1}
                      onChange={(e) => void onLogoFile(e)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canManage}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Cargar archivo
                    </Button>
                    {draft.logoUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => patch({ logoUrl: '' })}
                      >
                        Quitar logo
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Dominio"
            description="Subdominio del portal público. El dominio personalizado, si existe, se muestra como solo lectura."
          >
            <div className={styles.fields}>
              <Input
                id={`${formId}-subdomain`}
                label="Subdominio"
                hint="Portal público: {subdominio}.boletera.app"
                leading={<span aria-hidden="true">https://</span>}
                trailing={<span aria-hidden="true">.boletera.app</span>}
                value={draft.subdomain}
                error={errors.subdomain}
                requiredMark
                disabled={!canManage}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => patch({ subdomain: e.target.value.toLowerCase() })}
              />
              {themeMeta?.customDomain ? (
                <div className={styles.domainReadonly}>
                  <StatusDot tone="success" label="Dominio personalizado activo" />
                  <code>{themeMeta.customDomain}</code>
                  <p>
                    Este dominio está vinculado en el tema del tenant. La edición avanzada se
                    gestiona con el equipo del evento.
                  </p>
                </div>
              ) : (
                <p className={styles.domainHint}>
                  ¿Necesitas un dominio propio (ej. entradas.tuempresa.mx)? Actívalo con soporte;
                  mientras tanto el storefront vive en el subdominio.
                </p>
              )}
            </div>
          </Section>

          <Section
            title="Tipografía"
            description="El storefront usa una familia tipográfica fija. Aquí ves cómo se lee con tu color."
          >
            <div className={styles.typeSpecimen} style={{ fontFamily: STOREFRONT_FONT }}>
              <p className={styles.typeLabel}>IBM Plex Sans · storefront</p>
              <p className={styles.typeHeadline} style={{ color: palette.primary }}>
                La noche en vivo
              </p>
              <p className={styles.typeBody}>
                Cuerpo legible para listados, checkout y confirmaciones. No se puede cambiar la
                familia desde este panel: garantiza consistencia y rendimiento en todos los tenants.
              </p>
            </div>
          </Section>
        </div>

        <aside className={styles.previewCol}>
          <div className={styles.previewSticky}>
            <div className={styles.previewHeader}>
              <div>
                <h2 id={`${formId}-preview`}>Vista previa</h2>
                <p>Actualización en vivo con tus tokens.</p>
              </div>
              <Badge tone="info" variant="outline" dot>
                En vivo
              </Badge>
            </div>
            <SegmentedControl
              label="Superficie de vista previa"
              size="sm"
              fullWidth
              value={previewSurface}
              onValueChange={(value) => setPreviewSurface(value)}
              options={[
                { value: 'storefront', label: 'Storefront' },
                { value: 'ticket', label: 'Boleto' },
                { value: 'email', label: 'Correo' },
              ]}
            />
            <div className={styles.previewFrame}>
              <BrandPreviews
                surface={previewSurface}
                palette={palette}
                subdomain={draft.subdomain}
                logoUrl={draft.logoUrl}
                logoBroken={logoBroken}
                onLogoError={() => setLogoBroken(true)}
                customDomain={themeMeta?.customDomain}
              />
            </div>
            <p className={styles.previewCaption}>
              {previewSurface === 'email'
                ? 'Plantillas de correo: vista previa visual. El envío real usa estos tokens al confirmar una orden.'
                : previewSurface === 'ticket'
                  ? 'Boleto digital / PDF: acento de marca, logo y metadatos de ejemplo.'
                  : 'Cabecera y CTAs del portal de compra con tu paleta.'}
            </p>
          </div>
        </aside>
      </div>

      <Modal
        open={confirmSaveOpen}
        onClose={() => setConfirmSaveOpen(false)}
        title="¿Publicar marca?"
        description="Los cambios se aplicarán al storefront, boletos y correos de esta organización."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmSaveOpen(false)}>
              Seguir editando
            </Button>
            <Button
              loading={status === 'saving'}
              loadingLabel="Publicando…"
              onClick={() => void persist()}
            >
              Publicar
            </Button>
          </>
        }
      >
        <ul className={styles.confirmList}>
          <li>
            Color <code>{palette.primary}</code>
          </li>
          <li>
            Host <code>{draft.subdomain || 'demo'}.boletera.app</code>
          </li>
          <li>Logo {draft.logoUrl ? 'incluido' : 'sin logo (iniciales)'}</li>
        </ul>
      </Modal>

      <Modal
        open={confirmDiscardOpen}
        onClose={() => setConfirmDiscardOpen(false)}
        title="¿Descartar cambios?"
        description="Se restaurará la última marca publicada. Esta acción no se puede deshacer."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDiscardOpen(false)}>
              Conservar borrador
            </Button>
            <Button variant="danger" onClick={resetDraft}>
              Descartar
            </Button>
          </>
        }
      >
        <p className={styles.confirmCopy}>
          Hay cambios sin guardar en color, dominio o logo.
        </p>
      </Modal>
    </div>
  );
}

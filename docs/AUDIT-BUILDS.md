# Auditoría de builds y typechecks

**Fecha:** 2026-07-30 22:17 -05:00  
**Repo:** `BOLETERA-app`  
**Shell:** PowerShell  
**Comandos:** `pnpm --filter <pkg> check-types` / `pnpm --filter <pkg> build`

## Resumen final

| Paquete | check-types | build | Estado |
| --- | --- | --- | --- |
| `admin` (`apps/admin`) | PASS (exit 0) | PASS (exit 0) | Verde |
| `api` (`apps/api`) | PASS (exit 0) | PASS (exit 0) `nest build` | Verde |
| `web` (`apps/web`) | PASS (exit 0) | PASS (exit 0) | Verde |
| `taquilla` (`apps/taquilla`) | PASS (exit 0) | — (no solicitado) | Verde |
| `@boletera/ui` | PASS (exit 0) | — (sin script `build`) | Verde |
| `@boletera/venue-engine` | PASS (exit 0) | — (no solicitado) | Verde |
| `@boletera/shared` | PASS (exit 0) | — (no solicitado) | Verde |

**Veredicto:** monorepo verde en los checks solicitados. Sin bloqueos abiertos al cierre de la auditoría.

## Comandos ejecutados

```powershell
pnpm --filter admin check-types
pnpm --filter api check-types
pnpm --filter web check-types
pnpm --filter taquilla check-types
pnpm --filter @boletera/ui check-types
pnpm --filter @boletera/venue-engine check-types
pnpm --filter @boletera/shared check-types

pnpm --filter web build
pnpm --filter admin build
pnpm --filter api build
```

## Bloqueos observados (resueltos durante la auditoría)

### 1. `admin` — JSX sin padre único (mínimo, corregido)

**Archivo:** `apps/admin/app/(platform)/events/page.tsx` (~L828)  
**Error exacto:**

```text
error TS2657: JSX expressions must have one parent element.
```

**Causa:** dos `<Button>` hermanos en `Section.actions` sin fragmento.  
**Fix:** envolver en `<>...</>`.

### 2. `admin` — tipos AI sin import / imports duplicados (mínimo, corregido)

**Archivo:** `apps/admin/app/(platform)/ai/_lib/actions.ts`  
**Errores exactos (según pasada):**

```text
error TS2304: Cannot find name 'AiRecommendationPriority'.
error TS2304: Cannot find name 'AiRecommendationKind'.
# tras re-ediciones concurrentes:
error TS2300: Duplicate identifier 'AiRecommendationKind'.
error TS2300: Duplicate identifier 'AiRecommendationPriority'.
```

**Fix:** un único import de tipo desde `@boletera/shared`.

### 3. `admin` — errores transitorios (documentados; ya no bloquean)

Durante pasadas intermedias (árbol en movimiento por entregas paralelas) `tsc` reportó también:

| Archivo | Error | Clasificación |
| --- | --- | --- |
| `access-control/page.tsx` | `asChild` / `onChange` no existen en `Button` / `SegmentedControl` | Grande (API UI); desapareció en re-check |
| `ai/_components/NarrativePanel.tsx` | `formatMetricsRange` no exportado | Bloqueó un `next build` intermedio; export apareció luego en `_lib/format.ts` |
| `lib/query-keys.ts` | propiedad duplicada `crm` | Mínimo; ya no presente |
| `crm/_lib/use-crm-url-state.ts` | TS2542 escritura en `FilterSelection` readonly | Patrón de mutación; corregido en árbol (spread) |
| `reservations/_lib/use-reservations-url-state.ts` | TS2542 idem | Idem |
| `pricing/page.tsx` | TS6133 unused (`PRICING_VIEWS`, luego `previewMode`/`onPreview`/`onGenerate`) | Transitorio; wire-up presente en re-check |
| `venues/[id]/map/page.tsx` | TS6133 unused `canManage` | Transitorio; ya no presente |

Ninguno de estos queda como bloqueo en el snapshot final (admin `check-types` + `build` exit 0).

## Builds — detalle

### `web` — PASS

- Next.js 16.2.6 (Turbopack)
- Compile + TypeScript + static generation OK
- Sin errores

### `api` — PASS

- `nest build` exit 0
- Sin errores

### `admin` — PASS (con warnings no bloqueantes)

- Compile + TypeScript + static pages OK (45 rutas)
- **Warnings Next.js (no fallan el build):** `themeColor` en `metadata` export; migrar a `viewport` export ([docs](https://nextjs.org/docs/app/api-reference/functions/generate-viewport)). Afecta muchas rutas (`/dashboard`, `/events`, `/ai`, …).

## Fixes aplicados en esta auditoría (escritura fuera del doc)

Solo cambios mínimos/obvios:

1. `apps/admin/app/(platform)/events/page.tsx` — fragmento JSX en `actions`
2. `apps/admin/app/(platform)/ai/_lib/actions.ts` — import único de `AiRecommendationKind` / `AiRecommendationPriority`

## Notas

- `@boletera/ui` no define script `build`; solo `check-types`.
- `api` sí tiene `build` (`nest build`); ejecutado y verde.
- El árbol cambió entre pasadas (entregas/agentes paralelos); el estado de esta tabla es el **snapshot final** tras re-checks.

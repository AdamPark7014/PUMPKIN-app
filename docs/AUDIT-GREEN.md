# Auditoría — API typecheck + builds (TicketOS / BOLETERA)

**Fecha:** 2026-07-30  
**Entorno:** Windows / PowerShell  
**Alcance de escritura:** `apps/api/**` (fixes mínimos) + este informe. `apps/admin` solo lectura.

## Resumen ejecutivo

| Paquete | Script | Resultado | Notas |
|--------|--------|-----------|-------|
| `@boletera/api` | `check-types` | **VERDE** (exit 0) | Sin errores `TS*`. No hizo falta editar `apps/api`. |
| `@boletera/api` | `build` (`nest build`) | **VERDE** (exit 0) | Compilación Nest OK. |
| `@boletera/web` | `build` (`next build`) | **VERDE** (exit 0) | Compile + TypeScript + static generation OK. |
| `@boletera/admin` | `check-types` | **ROJO** (exit 2) | 3 errores en `pricing/` (ver bloqueos). |
| `@boletera/admin` | `build` (`next build`) | **ROJO** (exit 1) | Compile OK; falla typecheck en `calendar/` (ver bloqueos). |

**Veredicto:** API limpia (types + build). Web build verde. Admin bloqueado (fuera de alcance de este pase; no se editó).

---

## 1) `@boletera/api` — check-types

```text
pnpm --filter @boletera/api check-types
→ tsc --noEmit
→ EXIT 0
```

- Barrido previo de literales rotos en controllers/services ya estaba resuelto (`organization.controller.ts` / possessives).
- En esta corrida: **0 errores**. Ningún cambio mínimo requerido en `apps/api`.

---

## 2) Builds

### `@boletera/api` — VERDE

```text
pnpm --filter @boletera/api build
→ nest build
→ EXIT 0
```

### `@boletera/web` — VERDE

```text
pnpm --filter @boletera/web build
→ next build
→ Compiled successfully; TypeScript finished; 17 static routes
→ EXIT 0
```

### `@boletera/admin` — ROJO (bloqueos exactos)

**Build (`next build`):**

```text
./app/(platform)/calendar/CalendarEnterprise.tsx:10:3
Type error: 'FilterBar' is declared but its value is never read.
```

- Compilación Turbopack OK (~25s); falla en fase “Running TypeScript …”.
- Causa: import `FilterBar` no usado (TS6133 vía `next build`).

**Check-types (`tsc --noEmit`) — corrida de confirmación (mismo momento):**

```text
app/(platform)/pricing/_components/RecommendationsTable.tsx(19,3): error TS6133: 'isPageSize' is declared but its value is never read.
app/(platform)/pricing/page.tsx(38,3): error TS6133: 'isPageSize' is declared but its value is never read.
app/(platform)/pricing/page.tsx(558,22): error TS2739: Type '{ rows: ... }' is missing the following properties from type 'Props': emptyBecauseFilters, onClearFilters
```

- Exit 2. Nota: el usuario reportó admin `check-types` verde antes de este pase; al revalidar, pricing ya estaba roto (posible trabajo paralelo en el repo).
- **No se corrigió** (restricción: no tocar `apps/admin`).

---

## 3) Estado final por paquete

| Paquete | check-types | build | Acción en este pase |
|---------|-------------|-------|---------------------|
| `@boletera/api` | VERDE | VERDE | Ninguna (ya limpia) |
| `@boletera/web` | *(no re-corrido)* | VERDE | Solo build |
| `@boletera/admin` | ROJO | ROJO | Solo lectura / reporte de bloqueos |

### Fix mínimo sugerido para admin (fuera de alcance)

1. Quitar import `FilterBar` en `CalendarEnterprise.tsx` (o usarlo).
2. Quitar `isPageSize` no usado en pricing.
3. Pasar `emptyBecauseFilters` + `onClearFilters` al componente en `pricing/page.tsx:558`, o hacer esas props opcionales en el tipo `Props`.

---

## Metodología

1. `pnpm --filter @boletera/api check-types`
2. Si limpia → `pnpm --filter @boletera/{api,admin,web} build`
3. Revalidar admin `check-types` solo para documentar bloqueos (sin editar).
4. Escribir este informe.

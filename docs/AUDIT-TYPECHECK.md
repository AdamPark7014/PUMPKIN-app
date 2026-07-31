# Auditoría final — `check-types` (TicketOS / BOLETERA)

**Fecha:** 2026-07-30  
**Entorno:** Windows / PowerShell  
**Comando:** `pnpm --filter <pkg> check-types` → `tsc --noEmit`  
**Alcance:** solo lectura de código; este informe es el único artefacto escrito.

## Resumen ejecutivo

| Paquete | Script `check-types` | Resultado final | Errores `TS*` |
|--------|----------------------|-----------------|---------------|
| `@boletera/admin` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/api` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/web` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/taquilla` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/ui` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/venue-engine` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/venue-3d` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/shared` | sí | **VERDE** (exit 0) | 0 |
| `@boletera/database` | **no** | **N/A — sin cobertura** | — |

**Veredicto:** los 8 paquetes con `check-types` están verdes en el sweep final secuencial. No quedan incendios de typecheck en ese conjunto. El único hueco es `@boletera/database` (sin script ni `tsconfig`).

---

## Ya está verde

1. `@boletera/admin` — `apps/admin` (`tsc --noEmit`)
2. `@boletera/api` — `apps/api`
3. `@boletera/web` — `apps/web`
4. `@boletera/taquilla` — `apps/taquilla`
5. `@boletera/ui` — `packages/ui`
6. `@boletera/venue-engine` — `packages/venue-engine`
7. `@boletera/venue-3d` — `packages/venue-3d`
8. `@boletera/shared` — `packages/shared`

---

## Errores restantes por carpeta (severidad)

### Ninguno en paquetes con `check-types`

No hay errores `TS*` restantes tras el sweep final. Ranking de incendios: **vacío**.

### Cobertura / tooling (no es fallo de `tsc`)

| Carpeta | Severidad | Hallazgo |
|---------|-----------|----------|
| `packages/database/` | **Media (cobertura)** | `package.json` no define `check-types`. No hay `tsconfig.json`. Scripts actuales: Prisma (`generate`, `migrate`, `seed`, `validate`, etc.). No se pudo ejecutar typecheck comparable al resto del monorepo. |

---

## Ranking de incendios restantes

| # | Foco | Severidad | Errores | Notas |
|---|------|-----------|---------|-------|
| — | *(ninguno en check-types)* | — | 0 | Sweep final: 8/8 verdes |
| 1 | `@boletera/database` sin `check-types` / `tsconfig` | Media (gap) | N/A | Única deuda de cobertura en el alcance pedido |

---

## Observaciones del sweep (inestabilidad durante la auditoría)

Durante corridas previas en la misma sesión, `@boletera/admin` falló de forma **transitoria** mientras el árbol de archivos cambiaba (aparente trabajo paralelo en el repo / sync). Errores vistos y luego desaparecidos:

| Carpeta (relativa a `apps/admin`) | Códigos | Severidad observada | Estado al cierre |
|-----------------------------------|---------|---------------------|------------------|
| `app/(platform)/pricing/` | TS2305, TS2724, TS7006 | Alta (exports/tipos faltantes + `any` implícito) | Resuelto / verde |
| `app/(platform)/partners/` | TS2322, luego TS6133 | Media → Baja | Resuelto / verde |
| `components/venue-builder/panels/` | TS6133 | Baja (unused) | Resuelto / verde |

El **sweep final secuencial** (todos los filtros uno tras otro) reportó **0 errores** en admin y en el resto.

Nota de estructura: al cierre, `apps/admin/app/(platform)/pricing/_lib/` expone `types.ts`, `labels.ts`, `queries.ts` (el antiguo `api.ts` ya no estaba presente en disco).

---

## Metodología

1. Resolver nombres reales desde `package.json` (`@boletera/*`).
2. Ejecutar `pnpm --filter <pkg> check-types` por paquete (PowerShell).
3. Contar líneas `error TS\d+`.
4. Agrupar por carpeta; clasificar severidad:
   - **Alta:** exports/módulos rotos, tipos incompatibles que rompen el módulo.
   - **Media:** mismatch de tipos localizado o hueco de cobertura de typecheck.
   - **Baja:** `TS6133` unused / ruido de `noUnusedLocals`.
5. Re-ejecutar sweep completo al final para snapshot estable.

---

## Recomendación (fuera de alcance de escritura)

Añadir a `@boletera/database` un `tsconfig.json` + script `"check-types": "tsc --noEmit"` (o incluirlo en el `turbo` pipeline) para cerrar el único gap del alcance auditado. No se modificó código en esta auditoría.

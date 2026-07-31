# Auditoría de integridad TicketOS

Fecha: 2026-07-30  
Modo: lectura; este informe es el único archivo escrito por el auditor.

## Resumen ejecutivo

Estado global: **ROJO**.

- `@boletera/api` no compila: 82 diagnósticos sintácticos en un solo controlador, originados por una comilla simple sin escapar.
- `@boletera/admin` no compila y estuvo cambiando durante la auditoría: tres ejecuciones consecutivas devolvieron tres conjuntos diferentes de errores.
- `@boletera/web`, `@boletera/ui`, `@boletera/venue-engine` y `@boletera/shared` pasan `check-types`.
- No se detectaron marcadores de merge (`<<<<<<<`, `=======`, `>>>>>>>`).
- La sonda semántica no encontró imports/exports rotos con códigos TS2307, TS2305, TS2614, TS2724 o TS2459 en `admin` ni `api`. En `api`, el error sintáctico impide considerar completa la validación semántica.

## Ranking de incendios

### 1. CRÍTICO — `apps/api/src/modules/organization`

Archivo: `apps/api/src/modules/organization/organization.controller.ts`

- `check-types`: **FAIL**, 82 diagnósticos.
- Causa raíz estable en línea 46: el texto de `ApiOperation` contiene `caller's` dentro de una cadena delimitada por comillas simples.
- El primer `TS1002 Unterminated string literal` desincroniza el parser; los errores de las líneas 47–95 son mayormente cascada.
- Impacto: bloquea el chequeo completo de API y oculta posibles errores semánticos posteriores.
- Severidad: crítica porque el proyecto ni siquiera puede parsearse.

### 2. CRÍTICO — pisadas concurrentes en `apps/admin`

Tres ejecuciones durante la misma auditoría:

1. Primera: 6 errores en `analytics`, `payouts` y `components/venue-builder`.
2. Segunda: 3 errores en `payouts`, `platform` y `components/venue-builder`.
3. Tercera/final: 3 errores en `billing/cfdi`, `platform` y `components/venue-builder`.

Además, posiciones reportadas por TypeScript dejaron de coincidir con el contenido leído inmediatamente después (por ejemplo, `payouts/page.tsx` y `PayoutDetailDrawer.tsx`). Esto es evidencia directa de archivos modificados mientras corría el auditor, no sólo deuda estática.

Impacto:

- El resultado de CI no es reproducible mientras continúen las escrituras.
- Un agente puede sobrescribir arreglos de otro con una versión basada en un snapshot anterior.
- El ranking de errores de `admin` sólo representa el último snapshot capturado.

### 3. ALTO — `apps/admin/components/venue-builder/panels`

Archivo: `ValidationPanel.tsx`, línea 25.

- Error estable en las tres ejecuciones: TS2345.
- `runValidation` infiere su argumento desde `resolveGeometry`, cuya entrada pública es `unknown`.
- Ese mismo valor se pasa a `buildEgressReport`, que exige `SeatMapData | null | undefined`.
- Clasificación: deriva de contrato entre consumidor y `@boletera/venue-engine`; no es un export faltante.

### 4. ALTO — `apps/admin/app/(platform)/platform`

Archivo: `page.tsx`.

- Segunda ejecución: TS2349, intento de invocar un valor inferido como `never`.
- Ejecución final: TS2552, `refetch` no existe en el scope (línea 187).
- El cambio de firma del error durante la auditoría refuerza la detección de pisada.

### 5. ALTO — `apps/admin/app/(platform)/billing/cfdi/_lib`

Archivo: `use-cfdi-url-state.ts`, línea 26.

- Error final TS2345.
- Una rama produce `{ status?: undefined }`, incompatible con `Readonly<Record<string, readonly string[]>>`.
- Riesgo localizado al estado/filtros de URL de CFDI.

### 6. MEDIO — errores transitorios observados en `apps/admin`

Estos errores aparecieron en snapshots anteriores y ya no estaban en la ejecución final; deben revisarse en el historial del trabajo concurrente para evitar que reaparezcan:

- `analytics/page.tsx`: 3 errores TS2322 por estrechamiento perdido al llamar `searchParams.get(...)` de nuevo tras el type guard.
- `payouts/page.tsx`: contrato inválido de ilustración y posteriormente payload incompatible al completar payout.
- `payouts/_components/PayoutDetailDrawer.tsx`: import no usado.

## Resultado por proyecto

| Proyecto | Resultado final | Diagnósticos finales | Severidad |
|---|---:|---:|---|
| `apps/api` | FAIL | 82 | CRÍTICA |
| `apps/admin` | FAIL | 3 | CRÍTICA por inestabilidad; alta por tipos |
| `apps/web` | PASS | 0 | OK |
| `packages/ui` | PASS | 0 | OK |
| `packages/venue-engine` | PASS | 0 | OK |
| `packages/shared` | PASS | 0 | OK |

Comandos ejecutados:

```text
pnpm --filter @boletera/admin check-types
pnpm --filter @boletera/api check-types
pnpm --filter @boletera/web check-types
pnpm --filter @boletera/ui check-types
pnpm --filter @boletera/venue-engine check-types
pnpm --filter @boletera/shared check-types
```

Los seis proyectos se comprobaron dos veces; `admin` tuvo una tercera captura final debido a cambios concurrentes.

## Imports y exports

Comprobaciones:

- Búsqueda de marcadores de conflicto en TypeScript/JavaScript/JSON: sin hallazgos.
- Diagnósticos semánticos inspeccionados: TS2307, TS2305, TS2614, TS2724 y TS2459.
- Resultado en `admin`: no se detectaron módulos inexistentes ni símbolos importados que falten en el módulo exportador.
- Resultado en `api`: no se detectaron esos códigos, pero la conclusión es provisional hasta corregir el parseo del controlador.
- Los entrypoints de `packages/shared/src/index.ts` y `packages/venue-engine/src/index.ts` exportan sus módulos públicos y ambos paquetes pasan su propio `check-types`.

Conclusión: la evidencia actual apunta a **pisadas de contenido y deriva de tipos**, no a exports eliminados. El bloqueo sintáctico de API debe resolverse antes de certificar completamente sus imports.

## Hallazgos secundarios

- `git diff --check` detectó espacios finales únicamente en `packages/database/generated/client/index.d.ts` (líneas 64537, 64544, 64551, 64558, 64705 y 64712); está fuera de los seis targets solicitados y parece código generado.
- Git reportó advertencias de normalización LF→CRLF en varios archivos. No es el origen de los errores TypeScript, pero aumenta el ruido de diffs en PowerShell/Windows.

## Orden recomendado de contención

1. Detener escrituras concurrentes sobre `apps/admin` y tomar un snapshot único.
2. Corregir la cadena sin escapar de `organization.controller.ts`; volver a correr API para revelar diagnósticos semánticos hoy ocultos.
3. Resolver el contrato `unknown` → `SeatMapData` de `ValidationPanel`.
4. Revalidar `platform/page.tsx` y `billing/cfdi/_lib/use-cfdi-url-state.ts` sobre el snapshot congelado.
5. Repetir los seis `check-types` en una sola revisión estable.

# ADR-0001: TanStack Query en lugar de useEffect + fetch

- **Estado**: Aceptada, migración casi completa
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `apps/admin` (`@tanstack/react-query` ^5.101.4), con cliente HTTP en `apps/admin/lib/http.ts`

## Contexto

El panel administrativo carga decenas de dominios (eventos, pedidos, métricas, venues, fraude, etc.). El antipatrón `useEffect` + `fetch` + estado local produce condiciones de carrera, re-fetches duplicados, falta de caché compartida entre rutas y manejo inconsistente de errores/reintentos. La evidencia en el código muestra una apuesta por TanStack Query v5 como capa de servidor-estado, con un cliente HTTP tipado que centraliza auth, CSRF, refresh y taxonomía de errores.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| `useEffect` + `fetch` + `useState` por página | Cero dependencias; control total | No hay caché, invalidación ni deduplicación; la evidencia residual en `InventoryPanel` ilustra el coste (cancelación manual, flags `cancelled`) |
| SWR | API simple, buen DX | Menos control de mutaciones/keys jerárquicas y de defaults por dominio que ya modela `queryKeys` + `setQueryDefaults` |
| Redux / Zustand como caché de servidor | Familiaridad | Mezcla UI-state con server-state; el repo ya usa Zustand solo en el venue-builder, no como caché HTTP |
| **TanStack Query v5** | Caché, staleTime por dominio, prefetch, retry tipado, integración con SSE vía `setQueryData` | — (elegida) |

## Decisión

Adoptar **TanStack Query v5** como única capa de lectura/escritura remota en admin:

1. `QueryClientProvider` en `apps/admin/app/providers.tsx` con `staleTime` 2 min, `gcTime` 30 min, retry solo si `isRetryableError`, y defaults por dominio (`events` 60 s, `orders`/`analytics` más agresivos con `refetchOnWindowFocus`).
2. Fábrica jerárquica `queryKeys` en `apps/admin/lib/query-keys.ts`.
3. Hooks de dominio en `apps/admin/lib/queries/` (18 módulos + `index.ts` = **19 archivos**).
4. Prefetch al hover/focus de navegación (`prefetch.ts`).
5. Estados UI compartidos (`QueryStates.tsx`) y `ErrorBoundary` alrededor del árbol.

El transporte sigue siendo `http()` (no el `fetch` suelto de las páginas), que tipifica errores (`HttpError` / `AuthenticationError` / `PermissionError` / `ServerError` / `NetworkError` / `RequestAbortedError`), deduplica refresh (`refreshPromise` + `authGeneration`) y aplica CSRF en métodos mutantes.

## Consecuencias

- **Positivas**: caché compartida entre rutas; prefetch de dashboard/events/orders/venues/org; retry coherente con la taxonomía HTTP; invalidación por prefijo de key; el panel en vivo escribe en la misma caché (ver ADR-0008).
- **Negativas**: curva de aprendizaje de keys/invalidación; dependencia de runtime adicional.
- **Obligaciones**:
  - Toda lectura remota nueva debe exponerse como hook en `lib/queries/*` (o reutilizar uno existente), no como `useEffect`+`fetch`.
  - Las keys nuevas van en `query-keys.ts` (jerárquicas, estables).
  - Mutaciones usan `useMutation` + invalidación explícita.
  - Cerrar los restos documentados abajo.

### Estado real de la migración (verificado)

| Señal | Hallazgo |
|-------|----------|
| `localStorage` en `apps/admin/app` | **0** usos (solo aparece en `lib/session.ts` como fallback legacy de token; ver ADR-0003) |
| `useEffect` + `fetch(` en `apps/admin/app` | **1** caso: `events/[id]/InventoryPanel.tsx` (carga `/3d/events/:id/interactive`) |
| `fetch(` directo en app | Además: `login/forgot` y `login/reset` (formularios públicos, con `credentials: 'include'`) |
| Uso de Query | Ampliamente adoptado: hooks en `lib/queries/*` y cientos de referencias a `useQuery`/`useMutation` en admin |
| Login principal | Ya usa `http('/auth/login')` + `useSession`, no el antipatrón |

La migración **no está al 100 %**: queda al menos un panel con el antipatrón y dos pantallas de auth auxiliar con `fetch` crudo.

## Evidencia en el código

- `apps/admin/package.json` — dependencia `@tanstack/react-query` `^5.101.4`
- `apps/admin/app/providers.tsx` — `QueryClient` + defaults por dominio + `ErrorBoundary` + `SessionProvider`
- `apps/admin/lib/http.ts` — jerarquía de errores, `refreshPromise`/`authGeneration`, `isRetryableError`, `credentials: 'include'`
- `apps/admin/lib/query-keys.ts` — fábrica jerárquica de keys
- `apps/admin/lib/prefetch.ts` — prefetch por ruta al hover/focus
- `apps/admin/lib/queries/*.ts` — 19 archivos (18 dominios + barrel)
- `apps/admin/components/QueryStates.tsx` — `QueryLoading` / `QueryError` / `QueryEmpty` / `QueryState`
- `apps/admin/components/ErrorBoundary.tsx` — boundary de clase alrededor del admin
- `apps/admin/app/(platform)/events/[id]/InventoryPanel.tsx` — resto verificado de `useEffect`+`fetch`
- `apps/admin/app/login/forgot/page.tsx`, `…/reset/page.tsx` — `fetch` directo fuera de Query

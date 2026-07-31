# ADR-0008: Tiempo real por SSE en lugar de WebSockets

- **Estado**: Aceptada e implementada; autenticación cross-origin del stream es frágil
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `apps/api` (`reporting-service`), `apps/admin` (`use-realtime.ts`, `RealtimeDashboardPanel`)

## Contexto

El dashboard necesita un “pulso” periódico (canales, ocupación, etc.) sin montar infraestructura de sockets. No hay usos de `WebSocket` / `socket.io` / `@WebSocketGateway` en `apps/api` ni `apps/admin` (búsqueda vacía).

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó |
|--------|----------|---------------------|
| WebSockets / Socket.IO | Bidireccional, rooms, presencia | Complejidad operativa; el caso actual es **servidor → cliente** periódico |
| Long polling manual en React Query | Reutiliza HTTP/auth Bearer | Más ruido de red y lógica de intervalo en cada panel |
| Solo `refetchInterval` | Simple | Sin push; mayor latencia percibida |
| **SSE (`text/event-stream` vía `@Sse`) + escritura en caché Query** | Unidireccional, HTTP friendly, encaja con TanStack Query | — (elegida) |

## Decisión

1. **Backend**: `ReportingController` expone  
   `GET/SSE reports/dashboard/realtime/:organizationId/stream`  
   con `@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)`, roles promoter/admin/… y `@Permissions('analytics:read')`.  
   `streamRealtimeDashboard` emite cada **10 s** (`timer(0, 10_000)`) el JSON de `getRealtimeDashboard`.
2. **Frontend**: `useRealtime` abre `EventSource`, backoff exponencial con techo **30 s**, y aplica el payload con `queryClient.setQueryData`.  
   `useRealtimeDashboardUpdates` construye la URL bajo `NEXT_PUBLIC_ADMIN_API_URL` + `/reports/dashboard/realtime/${organizationId}/stream`.
3. **UI**: `RealtimeDashboardPanel` combina query inicial (`useRealtimeDashboard`) + stream; si el stream falla muestra “Modo sondeo” (la query sigue siendo el respaldo).

### Autenticación del EventSource (problema real)

`EventSource` **no permite** headers personalizados (`Authorization: Bearer …`). La única vía alineada con ADR-0003 es la cookie httpOnly `boletera_access` enviada por el browser.

Evidencia de fragilidad:

| Hecho | Código |
|-------|--------|
| El stream exige `JwtAuthGuard` | `reporting.controller.ts` |
| El JWT puede venir de cookie `boletera_access` | `jwt.strategy.ts` |
| El cliente crea `new EventSource(url)` **sin** `{ withCredentials: true }` | `use-realtime.ts` L54 |
| Admin (p. ej. `:3001`) y API (`:4000`) son **orígenes distintos** | `main.ts` CORS + ports; URL del hook apunta al host de la API |
| CORS del API sí tiene `credentials: true` | `main.ts` |
| Durante la migración, muchas llamadas HTTP autentican por Bearer en memoria | `http.ts` (ADR-0003) — **irrelevante para EventSource** |

Conclusión verificable: en despliegues cross-origin, sin `withCredentials: true` (y cookies `SameSite`/dominio compatibles), el browser **no** adjunta la cookie de sesión al SSE → el guard responde 401 → el hook entra en backoff / error → el panel cae a “Modo sondeo”. Incluso con `withCredentials`, en la fase Bearer-only (token solo en memoria, sin cookie de access aún establecida) el stream **no puede** autenticarse. Esto no es teórico: el código del cliente no pasa credenciales explícitas al `EventSource`.

Mitigación actual observada: la query HTTP del dashboard (con `http()` + cookies/Bearer) sigue alimentando la UI si el SSE falla.

## Consecuencias

- **Positivas**: sin servidor WS; integración natural con la caché de TanStack Query; backoff acotado; fallback de UI.
- **Negativas**: unidireccional; auth SSE distinta del resto del cliente; polling 10 s en servidor por conexión; tipo `RealtimeDashboard` aún no está en `analytics-contracts` (ADR-0006).
- **Obligaciones**:
  - Antes de dar por “en vivo” el SSE en producción cross-origin: `new EventSource(url, { withCredentials: true })` + cookies de access efectivamente emitidas + CORS/origen alineados.
  - No asumir que el Bearer en memoria autentica el stream.
  - Documentar el fallback a query como comportamiento esperado hasta cerrar auth.

## Evidencia en el código

- `apps/admin/lib/use-realtime.ts` — `EventSource`, backoff ≤ 30 s, `setQueryData`
- `apps/admin/components/RealtimeDashboardPanel.tsx` — UI + estados “En vivo · SSE” / “Modo sondeo”
- `apps/api/src/modules/reporting-service/reporting.controller.ts` — `@Sse('dashboard/realtime/:organizationId/stream')` + guards
- `apps/api/src/modules/reporting-service/reporting.service.ts` — `timer(0, 10_000)` → `MessageEvent`
- `apps/api/src/modules/auth/jwt.strategy.ts` — extractor cookie/Bearer
- `apps/api/src/main.ts` — CORS `credentials: true`
- Ausencia de WebSockets en `apps/api/src` y `apps/admin` (búsqueda sin matches)

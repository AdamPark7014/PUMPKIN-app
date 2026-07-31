# ADR-0003: Cookies httpOnly en lugar de token en localStorage

- **Estado**: Aceptada, migración parcial
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `apps/api` (auth + cookie middleware), `apps/admin` (session / http / CSRF)

## Contexto

Persistir el access JWT en `localStorage` lo expone a XSS. El contrato canónico de la migración está en [`SECURITY-MIGRATION.md`](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md) — **este ADR no lo duplica**; resume el estado implementado y las brechas verificadas.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó / límite |
|--------|----------|------------------------------|
| Access token solo en `localStorage` | Simple para SPAs; fácil de enviar como Bearer | Robable por XSS; el contrato de seguridad lo prohíbe como estado final |
| Solo cookie httpOnly sin periodo de transición | Máxima seguridad de inmediato | Rompe clientes que aún envían Bearer; el propio contrato pide fase transitoria con `accessToken` en JSON |
| Session cookies opacas server-side | Sin JWT en el browser | Requiere rediseño de guards/Passport ya basados en JWT |
| **Cookies httpOnly + CSRF double-submit + Bearer transitorio** | Reduce superficie XSS; compatible con clientes viejos durante el rollout | — (elegida; cierre pendiente) |

## Decisión

1. **Cookies httpOnly**: `boletera_access` (15 min) y `boletera_refresh` (30 días), `SameSite=strict`, `secure` en producción (`cookie-security.ts` → `issueAuthCookies`).
2. **CSRF double-submit**: cookie no-httpOnly `boletera_csrf` + header `X-CSRF-Token` en métodos mutantes cuando la auth viene de cookie (`assertCsrf` en `JwtAuthGuard` / refresh / logout).
3. **Refresh con rotación y detección de reuso**: `auth.service.ts` `refresh()` hashea el token, rota con `updateMany` condicional y, si el hash no coincide o la rotación no afecta 1 fila, revoca sesiones y audita `AUTH_REFRESH_REUSE_DETECTED`.
4. **JWT dual-source**: `jwt.strategy.ts` lee Bearer **o** cookie `boletera_access` y marca `authSource`.
5. **RBAC**: `JwtAuthGuard` → `RolesGuard` con `@Roles` y/o `@Permissions` (intersección si ambos); `OrgAccessGuard` amarra `:organizationId` al JWT (salvo `SUPER_ADMIN`).
6. **Admin**: `credentials: 'include'`, `addCsrfHeader`, refresh deduplicado; `cookieTokenStorage` guarda el access en **memoria** y borra el legacy `boletera_token` de `localStorage` al setear.

Documento de referencia: [`../../apps/api/src/modules/auth/SECURITY-MIGRATION.md`](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md).

### Estado intermedio (obligatorio documentar)

La migración **no está cerrada**. Evidencia:

| Comportamiento | Evidencia |
|----------------|-----------|
| API sigue devolviendo `accessToken` en login/register/refresh/OAuth | `auth.controller.ts` → `publicResult` / `issueAuthCookies` + JSON |
| Admin guarda ese token en memoria vía `getTokenStorage().setToken` tras refresh | `http.ts` `performRefresh` |
| Admin envía `Authorization: Bearer` si hay token en storage | `http.ts` `executeRequest` |
| Fallback de lectura a `localStorage` (`boletera_token`) | `session.ts` `cookieTokenStorage.getToken` |
| Login/OAuth aún llaman `setToken(accessToken)` | `login/page.tsx`, `login/oauth/callback/page.tsx` |
| El contrato declara el campo `accessToken` como **transitorio** y pide eliminarlo tras desplegar todos los clientes | `SECURITY-MIGRATION.md` puntos 2, 9 |

**Qué falta para cerrar** (según el contrato + código):

1. Que todos los clientes operen solo con cookies (`credentials: 'include'`) sin necesitar Bearer.
2. Dejar de persistir/aceptar `accessToken` en el cliente (incluido el transient en memoria y el fallback `localStorage`).
3. Quitar el campo `accessToken` de las respuestas de auth en un cambio de API versionado.
4. Asegurar que canales que no pueden mandar cookies (p. ej. SSE cross-origin sin `withCredentials`) tengan una estrategia explícita (ver ADR-0008).

## Consecuencias

- **Positivas**: refresh token inaccesible a JS; reuso de refresh detectado y revocado; CSRF en mutaciones cookie-auth; CORS con `credentials: true` y orígenes explícitos.
- **Negativas**: dos modos de auth en paralelo aumentan superficie y confusión; el token en memoria sigue siendo leíble por JS mientras dure la transición; SSE no puede mandar Bearer (ADR-0008).
- **Obligaciones**: seguir el checklist de `SECURITY-MIGRATION.md`; no reintroducir escritura de JWT a `localStorage`/`sessionStorage`; mutaciones cookie-auth siempre con CSRF.

## Evidencia en el código

- `apps/api/src/modules/auth/SECURITY-MIGRATION.md` — contrato de migración (fuente de verdad)
- `apps/api/src/modules/auth/cookie-security.ts` — nombres de cookies, opciones, CSRF, OAuth state
- `apps/api/src/modules/auth/auth.service.ts` — emisión JWT 15m, rotación refresh, reuse detection
- `apps/api/src/modules/auth/auth.controller.ts` — `issueAuthCookies` + `publicResult` con `accessToken`
- `apps/api/src/modules/auth/jwt-auth.guard.ts` / `jwt.strategy.ts` — Bearer o cookie + CSRF
- `apps/api/src/modules/auth/roles.guard.ts`, `roles.decorator.ts`, `permissions.decorator.ts`, `org-access.guard.ts`
- `apps/api/src/common/cookie.middleware.ts` — parseo de `Cookie` → `request.cookies`
- `apps/admin/lib/auth-cookies.ts` — lectura `boletera_csrf` → header `X-CSRF-Token`
- `apps/admin/lib/session.ts` — `cookieTokenStorage` (memoria + fallback legacy)
- `apps/admin/lib/http.ts` — Bearer condicional, refresh deduplicado, persistencia transitoria del access
- `apps/admin/lib/use-session.ts` — bootstrap `GET /auth/me`, `setToken`, RBAC cliente (`can`)

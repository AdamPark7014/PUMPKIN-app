# Security integration contract

## Frontend cookie migration

1. Send login, register, OAuth callback, refresh, logout, and authenticated API
   calls with `credentials: "include"` (or Axios `withCredentials: true`).
2. Keep reading `accessToken` from the login response only during migration.
   Existing `Authorization: Bearer ...` requests remain supported.
3. Do not persist the returned access token. Change `TokenStorage` so its
   cookie implementation keeps no token in `localStorage`, `sessionStorage`,
   IndexedDB, or JavaScript memory across reloads.
4. Read the non-httpOnly `boletera_csrf` cookie and send its value in
   `X-CSRF-Token` on every state-changing cookie-authenticated request
   (`POST`, `PUT`, `PATCH`, `DELETE`). Never copy the refresh cookie; JavaScript
   cannot and must not read it.
5. On a `401`, make exactly one deduplicated `POST /api/v1/auth/refresh` with
   credentials and `X-CSRF-Token`, then retry the original request once. The
   response rotates both tokens and the CSRF cookie. Concurrent callers must
   await the same refresh promise; parallel refreshes intentionally trigger
   reuse detection and revoke the session.
6. At startup call `GET /api/v1/auth/me` with credentials. If it returns `401`,
   attempt one refresh and repeat `me`; otherwise show the signed-out state.
7. Logout with `POST /api/v1/auth/logout`, credentials, and the CSRF header.
   To terminate every device use `POST /api/v1/auth/sessions/revoke-all`.
8. For OAuth, preserve the provider callback's `state` query parameter and
   include it in the JSON callback body. The API compares it with a short-lived
   httpOnly state cookie; OAuth callback requests must also include credentials.
9. After all clients deploy this flow, remove Bearer persistence and then the
   transitional `accessToken` response field in a separately versioned API
   change.

Production must serve the API and clients over HTTPS. `CORS_ORIGIN` must list
exact origins and cookie requests cannot use a wildcard origin.

## Tenant-scoped module adoption

`TenantContextInterceptor` rejects organization identifiers in route params,
query, or body when they differ from the authenticated tenant. Services that
query tenant-owned tables must additionally inject `TenantContextService` and:

- call `requireOrganization()` to obtain the organization ID;
- include that returned ID in every Prisma `where`, `create`, and relation
  connection;
- call `assertOrganization(id)` before operating on an organization supplied
  indirectly (for example, resolved through an event ID);
- use compound lookups such as `{ id, organizationId }`, never an ID-only
  lookup followed by an authorization check.

Only `SUPER_ADMIN` receives a cross-tenant context. `ADMIN` is tenant-bound.
The request interceptor is a boundary check, not a substitute for scoped
database queries. A future Prisma client extension or PostgreSQL row-level
security policy should enforce this below the service layer; that change
belongs in the database/Prisma module and cannot be made from the auth module.

## Authorization

Apply `JwtAuthGuard` followed by `RolesGuard`, then declare either hierarchical
`@Roles(...)`, granular `@Permissions(...)`, or both. Permissions are
intersection-based: when both decorators exist, both checks must pass.

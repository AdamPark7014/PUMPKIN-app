# ADR-0007: Aislamiento multi-tenant en capa de servicio

- **Estado**: Aceptada; enforcement solo en aplicación (sin RLS ni extensión Prisma)
- **Fecha**: no determinable desde el repositorio
- **Ámbito**: `apps/api` (`TenantContextService`, interceptor, módulo `tenant`, guards de auth)

## Contexto

Boletera es multi-organización. Un bug que olvide `organizationId` en un `findMany` es una fuga cross-tenant. La estrategia actual concentra el aislamiento en la **capa de servicio / request context**, no en la base de datos.

## Alternativas consideradas

| Opción | Ventajas | Por qué se descartó (hoy) |
|--------|----------|---------------------------|
| PostgreSQL Row-Level Security | Enforcement inevitable en cada query | **No implementada**; el propio `SECURITY-MIGRATION.md` la señala como trabajo futuro del módulo DB/Prisma |
| Extensión de Prisma client (inyectar `organizationId`) | Menos disciplina manual | **No implementada**; misma nota en el contrato de seguridad |
| Base de datos / schema por tenant | Aislamiento físico fuerte | Operación y migraciones prohibitivas para el stage actual |
| Solo `OrgAccessGuard` en rutas | Simple | No cubre lookups por `eventId` u otros IDs indirectos |
| **AsyncLocalStorage + disciplina de servicio + guards** | Encaja con Nest actual; privilegiados (`SUPER_ADMIN`) modelados | — (elegida; con deuda explícita) |

## Decisión

1. `TenantContextService` (`AsyncLocalStorage`): `run`, `current`, `requireOrganization`, `assertOrganization`, flag `privileged`.
2. `TenantContextInterceptor` (registrado como `APP_INTERCEPTOR` desde `auth.module.ts`): rechaza `organizationId`/`orgId` en params/query/body distintos del tenant del JWT; popula el ALS (`privileged` si `SUPER_ADMIN`).
3. `TenantScopeService`: resuelve org para operadores cross-tenant (exige `organizationId` explícito) y para el resto pinnea a `requireOrganization()`.
4. `OrgAccessGuard` + `RolesGuard` / `@Permissions` en controladores.
5. Contrato escrito: cada servicio que toque tablas tenant-owned debe inyectar el contexto, filtrar en **todo** `where`/`create`, usar lookups compuestos `{ id, organizationId }`, y `assertOrganization` en IDs indirectos.

Fuente: [`SECURITY-MIGRATION.md` § Tenant-scoped module adoption](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md).

### Consecuencia crítica

**Cada query de servicio debe filtrar a mano.** Hoy **no** hay verificación automática (ni RLS, ni middleware Prisma, ni test estático en este ADR) que demuestre que un `findUnique({ where: { id } })` olvidó el tenant. El interceptor solo valida IDs de organización **presentes en la request**, no el SQL generado.

Nota de API: `requireOrganization()` **lanza** si `privileged === true` (los SUPER_ADMIN no tienen tenant implícito). Por eso existe `TenantScopeService.resolve()`.

## Consecuencias

- **Positivas**: modelo claro para apps Nest; `SUPER_ADMIN` vs tenant-bound explícito; guards de borde + contexto de request.
- **Negativas**: seguridad depende de disciplina humana; falso sentido de seguridad si alguien confía solo en el interceptor; coste de auditoría manual.
- **Obligaciones**:
  - Ningún servicio nuevo de datos tenant-owned sin `TenantContextService` / `TenantScopeService`.
  - Prohibido “fetch by id → check org after” (el contrato lo dice).
  - Planificar RLS o Prisma extension como follow-up (fuera del módulo auth, como indica el contrato).

## Evidencia en el código

- `apps/api/src/common/tenant-context.service.ts` — ALS + `requireOrganization` / `assertOrganization`
- `apps/api/src/common/tenant-context.interceptor.ts` — bound check de org en request + `run()`
- `apps/api/src/modules/auth/auth.module.ts` — `APP_INTERCEPTOR` → `TenantContextInterceptor`
- `apps/api/src/modules/tenant/tenant-scope.service.ts` — resolución para privilegiados
- `apps/api/src/modules/tenant/*` — módulo tenant
- `apps/api/src/modules/auth/org-access.guard.ts` — match JWT org ↔ route org
- `apps/api/src/modules/auth/roles.guard.ts`, `roles.decorator.ts`, `permissions.decorator.ts`
- `apps/api/src/modules/auth/SECURITY-MIGRATION.md` — reconoce RLS/Prisma extension como futuro y no hecho

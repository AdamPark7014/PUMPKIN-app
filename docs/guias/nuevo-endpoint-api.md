# Cómo añadir un endpoint a la API

Receta anclada en `MetricsController` (`apps/api/src/modules/metrics/`), el ejemplo más limpio de guards + DTOs + Swagger en el repo.

**Alcance:** NestJS en `apps/api` (puerto `:4000`, prefijo global `api/v1`, paquete `name`: `@boletera/api`).

Contrato de seguridad cookie/CSRF y adopción tenancy: **léelo aquí, no lo dupliques** → [`SECURITY-MIGRATION.md`](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md).

---

## 1. Estructura de un módulo

Mínimo (como metrics):

```text
apps/api/src/modules/<modulo>/
  <modulo>.module.ts
  <modulo>.controller.ts
  <modulo>.service.ts
  dto/*.dto.ts          # opcional pero obligatorio si hay query/body
```

### Registro

1. **Barrel** `apps/api/src/modules/index.ts` — exporta la mayoría de módulos.
2. **`apps/api/src/app.module.ts`** — importa el módulo en `imports: [...]`.

**Trampa:** `MetricsModule` **no** está en `modules/index.ts`; se importa directo:

```39:39:apps/api/src/app.module.ts
import { MetricsModule } from './modules/metrics/metrics.module';
```

Al añadir un módulo nuevo, o lo exportas en el barrel **y** lo listas en `AppModule`, o documentas el import directo. No dejes el módulo huérfano.

Plantilla del module (real):

```1:13:apps/api/src/modules/metrics/metrics.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsCacheService } from './metrics-cache.service';

@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsCacheService],
  exports: [MetricsService],
})
export class MetricsModule {}
```

---

## 2. Guards: orden correcto

En el controlador:

```22:26:apps/api/src/modules/metrics/metrics.controller.ts
@ApiTags('Metrics')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
@Roles('PROMOTER', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER')
```

Orden:

1. `JwtAuthGuard` — JWT (Bearer o cookie) + CSRF si la auth vino por cookie en métodos no idempotentes (`apps/api/src/modules/auth/jwt-auth.guard.ts`).
2. `RolesGuard` — jerarquía de roles y/o permisos (`roles.guard.ts`).
3. `OrgAccessGuard` — si llega `organizationId`/`orgId` en params/query/body, debe coincidir con el JWT salvo `SUPER_ADMIN` (`org-access.guard.ts`).

### `@Roles` + `@Permissions` = intersección

Decoradores:

- `Roles(...roles)` → `roles.decorator.ts`
- `Permissions(...permissions)` → `permissions.decorator.ts` (`analytics:read`, `order:write`, …)

En `RolesGuard`:

- Si no hay roles ni permisos declarados → pasa.
- `SUPER_ADMIN` → siempre pasa.
- Roles: el rol del usuario debe ser **≥** al requerido en la jerarquía (`CUSTOMER` … `SUPER_ADMIN`), no igualdad exacta.
- Permisos: **todos** los requeridos deben estar en el set del rol.
- Si hay roles **y** permisos: `roleAllowed && permissionAllowed`.

### Lo que OrgAccessGuard **no** hace

Si la petición **no** trae `organizationId`/`orgId`, el guard devuelve `true`. El aislamiento real de datos es responsabilidad del **service** (ver [consultas-multi-tenant.md](./consultas-multi-tenant.md)).

---

## 3. DTOs + ValidationPipe global

En `main.ts`:

```46:52:apps/api/src/main.ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
```

**Consecuencia práctica:** cualquier campo no declarado en el DTO → **400**. No “se ignora”.

Ejemplo real (`metrics-query.dto.ts`):

```21:41:apps/api/src/modules/metrics/dto/metrics-query.dto.ts
export class MetricsRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO start (inclusive). Defaults to start of month Mexico City.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO end (exclusive). Defaults to now.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Override org for SUPER_ADMIN / ADMIN only' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventId?: string;
}
```

---

## 4. Tenancy en el servicio

Infra global:

| Pieza | Archivo | Rol |
|-------|---------|-----|
| `TenantContextService` | `common/tenant-context.service.ts` | ALS: `organizationId`, `userId`, `privileged` |
| `TenantContextInterceptor` | `common/tenant-context.interceptor.ts` | Rellena el contexto; rechaza org ajena en request |
| `TenantScopeService` | `modules/tenant/tenant-scope.service.ts` | Resuelve org para SUPER_ADMIN vs tenant-bound |
| Registro APP_INTERCEPTOR | `modules/auth/auth.module.ts` | Interceptor + `AntiAbuseInterceptor` |

API del contexto:

```22:35:apps/api/src/common/tenant-context.service.ts
  requireOrganization(): string {
    const context = this.current();
    if (!context.organizationId || context.privileged) {
      throw new ForbiddenException('A tenant-scoped organization is required');
    }
    return context.organizationId;
  }

  assertOrganization(organizationId: string): void {
    const context = this.current();
    if (!context.privileged && context.organizationId !== organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
  }
```

**Trampas:**

1. `privileged` solo es `true` para `SUPER_ADMIN` (interceptor). `ADMIN` **no** es cross-tenant en el contexto ALS.
2. `requireOrganization()` **falla** si `privileged === true`. Para SUPER_ADMIN usa `TenantScopeService.resolve(requested)` o pasa `organizationId` explícito.
3. Inconsistencia actual: `MetricsService.resolveOrganizationId` trata `ADMIN` **y** `SUPER_ADMIN` como operadores que pueden overridear `query.organizationId`. Eso **no** coincide con el interceptor ni con SECURITY-MIGRATION (“Only SUPER_ADMIN receives a cross-tenant context”). Al copiar métricas, decide conscientemente y documenta el criterio.

Lookups compuestos: ver guía de [consultas multi-tenant](./consultas-multi-tenant.md).

---

## 5. Swagger

En el controller: `@ApiTags`, `@ApiOperation`, `@ApiBearerAuth`.

Tags registrados en el DocumentBuilder de `main.ts`: Discovery, Inventory, Pricing, Orders, Payments, Resale, Analytics, Fraud, Admin, Event Scheduling, Access, Tenant.

**Trampa:** `@ApiTags('Metrics')` **no** está en esa lista de `.addTag(...)`. El endpoint aparece igual, pero el tag no tiene descripción en el builder. Si añades un dominio nuevo, o usas un tag existente o añades `.addTag(...)` en `main.ts`.

Docs: `http://localhost:4000/api/docs`.

---

## 6. Auditoría

`AuditService` (`common/audit.service.ts`) escribe `AuditEvent` vía Prisma.

Cuándo: mutaciones sensibles (escaneos, transfers, scheduling, season pass create, exports, …).

Ejemplo real (acceso):

```143:158:apps/api/src/modules/access/access.service.ts
    await this.audit.log({
      action: SCAN_ACTION,
      entityType: 'Ticket',
      entityId: ticket.id,
      organizationId: ticket.event.organizationId,
      userId: command.scannedByUserId,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      metadata: {
        zoneId,
        channel: command.channel,
        station: command.station,
        eventId: ticket.eventId,
        ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}),
      },
    });
```

Incluye siempre `organizationId` cuando la entidad es de un tenant.

---

## 7. Forma de errores

Filtro global `AllExceptionsFilter` (`common/http-exception.filter.ts`):

```json
{ "statusCode": 400, "message": "...", "correlationId": "..." }
```

- `HttpException` → status y mensaje públicos (arrays de validación permitidos).
- Cualquier otra cosa → `500` genérico; el stack solo en logs del servidor.
- Header de respuesta: `X-Correlation-Id`.

---

## 8. Rate limiting y anti-abuse

### Throttler global

```54:61:apps/api/src/app.module.ts
    ThrottlerModule.forRoot([
      {
        // Generous default so normal browsing/polling isn't affected;
        // brute-force-sensitive routes (login, manager PIN) set their own
        // tighter @Throttle() limits.
        ttl: 60_000,
        limit: 120,
      },
    ]),
```

`ThrottlerGuard` está como `APP_GUARD`. Rutas sensibles añaden `@Throttle({ default: { limit, ttl } })` (auth login, forgot-password, taquilla PIN, tenant resolve, …).

### Anti-abuse

`AntiAbuseInterceptor`: límites extra in-memory por IP/usuario en `/auth/login`, `/auth/forgot-password`, paths con `/payment` o `/refund`.

---

## 9. Idempotencia

No hay un middleware global de `Idempotency-Key`. El header está permitido en CORS (`main.ts`) y lo consumen controladores concretos:

| Área | Mecanismo |
|------|-----------|
| Orders | `@Headers('idempotency-key')` → columna / lookup en `orders.service.ts` |
| Access (admit) | Header → metadata de scan |
| Resale / Waitlist / Season | Header → caché de resultado en servicio |
| Taquilla POS | `pos-idempotency.service.ts` + keys derivadas (`idempotencyKeyForSale`) |

Si tu endpoint es un POST reintentable (pago, compra, admit), copia el patrón del módulo más cercano; no asumas que el header solo basta.

---

## 10. Cómo probarlo

```powershell
pnpm dev:api
```

- Health: `GET http://localhost:4000/api/v1/health`
- Ready: `GET http://localhost:4000/api/v1/ready`
- Swagger: `http://localhost:4000/api/docs`
- Smoke auxiliar: `pnpm smoke:api`

Filtro de paquete verificado: `pnpm --filter @boletera/api …`.

---

## Checklist de PR

- [ ] Module + controller + service (+ DTOs class-validator)
- [ ] Registrado en `AppModule` (y barrel si aplica)
- [ ] `@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)` + `@Roles` / `@Permissions`
- [ ] Lookups con `organizationId` / `assertOrganization` (no `findUnique` por id solo)
- [ ] Swagger tags/operation/bearer
- [ ] Auditoría en mutaciones sensibles
- [ ] `@Throttle` si la ruta es brute-forceable
- [ ] Idempotency si es POST reintentable
- [ ] Enlace mental a [SECURITY-MIGRATION.md](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md)

## Enlaces

- [Consultas multi-tenant](./consultas-multi-tenant.md)
- [Índice](./README.md)
- [Arquitectura](../arquitectura.md)
- [API README](../api/README.md)

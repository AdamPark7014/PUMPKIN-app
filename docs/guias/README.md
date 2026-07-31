# Guías prácticas del monorepo

Recetas cortas para desarrolladores que tocan Admin, API, design system y mapas. Todo el código de ejemplo sale de archivos reales del repo.

## Guías

| Guía | Cuándo leerla |
|------|----------------|
| [Nuevo módulo admin](./nuevo-modulo-admin.md) | Añadir una página/módulo al panel en `:3001` |
| [Nuevo endpoint API](./nuevo-endpoint-api.md) | Exponer un endpoint Nest con auth, roles y tenancy |
| [Design system (`@boletera/ui`)](./design-system.md) | Usar componentes, tokens y charts del paquete UI |
| [Motor de mapas (`@boletera/venue-engine`)](./motor-de-mapas.md) | Render WebGL/Canvas2D y geometría de venues |
| [Consultas multi-tenant](./consultas-multi-tenant.md) | Lookups Prisma seguros por `organizationId` |

## README de paquetes

- [`packages/ui/README.md`](../../packages/ui/README.md)
- [`packages/venue-engine/README.md`](../../packages/venue-engine/README.md)

## Contexto del monorepo

- Producto: **Boletera Platform** (`@boletera/*`)
- API NestJS en `:4000`, prefijo global `api/v1`, Swagger en `/api/docs`
- Admin Next.js en `:3001` (paquete `name`: `@boletera/admin`)

## Enlaces canónicos

- [Arquitectura](../arquitectura.md)
- [ADRs](../adr/)
- [Ciclo de vida de dominio](../dominio/ciclo-de-vida.md)
- [Glosario](../dominio/glosario.md)
- [API README](../api/README.md)
- [README raíz](../../README.md)
- [Contrato de seguridad (migración cookie/CSRF)](../../apps/api/src/modules/auth/SECURITY-MIGRATION.md)

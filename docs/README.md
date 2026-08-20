# Documentación de Boletera Platform

Índice de la documentación técnica. Todo lo que hay aquí está verificado contra el código
de este repositorio. Cuando una funcionalidad está a medio construir se dice explícitamente:
**documentar algo que no existe es peor que no documentarlo**.

> **Nota de naming.** El producto se llama **Boletera Platform** en todo el código
> (`package.json` raíz → `boletera-platform`, scope npm `@boletera/*`, base de datos `boletera`).
> Si ves el nombre "TicketOS" en algún documento o conversación, se refiere a este mismo sistema;
> en el código solo aparece una vez, en
> `apps/admin/components/operating-modules/OperatingModulePage.tsx`.

---

## Por dónde empezar

| Si eres… | Lee en este orden |
|----------|-------------------|
| Alguien en su primer día | [README raíz](../README.md) → [Dominio de ticketing](./dominio/ciclo-de-vida.md) → [Glosario](./dominio/glosario.md) → [Arquitectura](./arquitectura.md) |
| Frontend en el panel admin | [Añadir un módulo al admin](./guias/nuevo-modulo-admin.md) → [Design system](./guias/design-system.md) → [ADR-0001](./adr/0001-tanstack-query-en-lugar-de-useeffect-fetch.md) |
| Backend en la API | [Añadir un endpoint](./guias/nuevo-endpoint-api.md) → [Consultas multi-tenant](./guias/consultas-multi-tenant.md) → [Referencia de API](./api/README.md) |
| Trabajando en mapas de recinto | [Motor de mapas](./guias/motor-de-mapas.md) → [ADR-0002](./adr/0002-motor-webgl-en-lugar-de-svg-en-dom.md) |
| Revisando seguridad | [SECURITY-MIGRATION.md](../apps/api/src/modules/auth/SECURITY-MIGRATION.md) → [ADR-0003](./adr/0003-cookies-httponly-en-lugar-de-token-en-localstorage.md) → [ADR-0007](./adr/0007-aislamiento-multi-tenant-en-capa-de-servicio.md) |

---

## Mapa de la documentación

### Visión general

- **[../README.md](../README.md)** — puerta de entrada: qué es el producto, arranque desde cero,
  puertos, credenciales de seed, dónde está cada cosa.
- **[arquitectura.md](./arquitectura.md)** — mapa del monorepo, responsabilidad de cada app y
  paquete, grafo de dependencias, flujo de datos de la base a la interfaz, límites entre dominios,
  modelo multi-tenant e inventario de deuda técnica detectada.

### Decisiones de arquitectura (ADR)

Índice completo en **[adr/README.md](./adr/README.md)**.

| # | Decisión |
|---|----------|
| [0001](./adr/0001-tanstack-query-en-lugar-de-useeffect-fetch.md) | TanStack Query v5 en lugar de `useEffect` + `fetch` |
| [0002](./adr/0002-motor-webgl-en-lugar-de-svg-en-dom.md) | Motor WebGL2 en lugar de SVG en el DOM para los mapas |
| [0003](./adr/0003-cookies-httponly-en-lugar-de-token-en-localstorage.md) | Cookies httpOnly en lugar de token en `localStorage` |
| [0004](./adr/0004-graficos-svg-propios-en-lugar-de-libreria.md) | Gráficos SVG propios en lugar de una librería de terceros |
| [0005](./adr/0005-design-system-centralizado-en-lugar-de-scss-por-pagina.md) | Design system centralizado en lugar de SCSS por página |
| [0006](./adr/0006-contratos-tipados-compartidos-para-metricas.md) | Contratos tipados compartidos para métricas |
| [0007](./adr/0007-aislamiento-multi-tenant-en-capa-de-servicio.md) | Aislamiento multi-tenant en la capa de servicio |
| [0008](./adr/0008-tiempo-real-por-sse-en-lugar-de-websockets.md) | Tiempo real por SSE en lugar de WebSockets |

### Guías de desarrollo

Índice en **[guias/README.md](./guias/README.md)**.

- **[nuevo-modulo-admin.md](./guias/nuevo-modulo-admin.md)** — añadir una página/módulo al panel:
  App Router, navegación, query keys, hooks de dominio, estados de carga y error, prefetch.
- **[nuevo-endpoint-api.md](./guias/nuevo-endpoint-api.md)** — añadir un endpoint a la API
  respetando guards, roles, DTOs, auditoría, rate limiting y aislamiento de tenant.
- **[design-system.md](./guias/design-system.md)** — cómo usar `@boletera/ui`: componentes,
  tokens, gráficos SVG, formato es-MX/MXN.
- **[motor-de-mapas.md](./guias/motor-de-mapas.md)** — cómo consumir `@boletera/venue-engine`:
  ciclo de vida del renderer, cámara, hit-testing, LOD, capas y fallback a Canvas2D.
- **[consultas-multi-tenant.md](./guias/consultas-multi-tenant.md)** — cómo escribir consultas
  Prisma que no filtren datos entre organizaciones. **Lectura obligatoria antes de tocar la API.**

### Dominio de negocio

Índice en **[dominio/README.md](./dominio/README.md)**.

- **[ciclo-de-vida.md](./dominio/ciclo-de-vida.md)** — lo que un desarrollador nuevo no sabe:
  ciclo de vida de evento, orden y boleto; qué es un *hold* y por qué expira; zonas, filas,
  asientos y niveles de precio; reventa; abonos de temporada; acceso al recinto; punto de venta;
  CFDI; liquidaciones.
- **[glosario.md](./dominio/glosario.md)** — glosario bilingüe español/inglés, porque el código
  mezcla los dos idiomas. Incluye las trampas de nomenclatura reales del repositorio.

### Referencia de la API

- **[api/README.md](./api/README.md)** — todos los endpoints agrupados por dominio, extraídos de
  los controladores reales. Convenciones, autenticación, headers, roles y la Partner API pública.
- **[api/metricas.md](./api/metricas.md)** — referencia exhaustiva del módulo `metrics`: los 12
  endpoints, la forma exacta de cada respuesta y **cómo se calcula cada métrica**.

### Operación y secretos

- **[ENV-SECRETS.md](./ENV-SECRETS.md)** — cómo generar y operar los secretos que la plataforma
  valida en runtime (`TICKET_QR_SECRET`, `JWT_SECRET`, `INTERNAL_API_SECRET`, Banorte, etc.).
- **[ACTIVAR-MERCADO-PAGO.md](./ACTIVAR-MERCADO-PAGO.md)** — activar cobro online Pumpkin (credenciales + webhook).
- **[research/MERCADO-PAGO-BOLETERAS.md](./research/MERCADO-PAGO-BOLETERAS.md)** — deep research: MP + boleteras (comisiones, OXXO, holds).

### Documentos fuera de `docs/`

- **[apps/api/src/modules/auth/SECURITY-MIGRATION.md](../apps/api/src/modules/auth/SECURITY-MIGRATION.md)**
  — contrato de integración de seguridad: migración a cookies, CSRF, refresh con rotación y
  adopción de módulos con ámbito de tenant. Es la fuente de verdad de seguridad; la documentación
  de `docs/` lo enlaza en vez de duplicarlo.
- **[packages/ui/README.md](../packages/ui/README.md)** — resumen del design system.
- **[packages/venue-engine/README.md](../packages/venue-engine/README.md)** — resumen del motor de mapas.
- **[e2e/README.md](../e2e/README.md)** — suites de Playwright (contratos, seguridad, inventario,
  operaciones).

---

## Documentación heredada en la raíz del repositorio

La raíz contiene una veintena de archivos `.md` anteriores a esta documentación
(`ARCHITECTURE.md`, `API_REFERENCE.md`, `ENTERPRISE_SPECIFICATION.md`,
`COMPETITIVE_ARCHITECTURE.md`, `DOCUMENTATION_INDEX.md`, `PROJECT_COMPLETION_SUMMARY.md`,
`FRONTEND_IMPLEMENTATION.md`, etc.).

**No están verificados y en buena parte son aspiracionales**: describen Stripe, PayPal,
Kubernetes, scoring de fraude con ML, 15+ monedas y despliegue multi-región, nada de lo cual
existe en el código. Trátalos como notas históricas, no como especificación. La documentación
verificada es la de `docs/` y este índice.

`docs/ARCHITECTURE.md` (mayúsculas) es uno de esos documentos heredados y ha quedado reducido a un
aviso que redirige a [`arquitectura.md`](./arquitectura.md).

---

## Cómo mantener esta documentación

1. **Verifica contra el código antes de escribir.** Cita la ruta del archivo que respalda cada
   afirmación no obvia.
2. **Marca lo que está a medio construir.** Usa las palabras "parcial" o "no implementado" en vez
   de omitir el matiz.
3. **Los comandos deben ser ejecutables.** Solo comandos que existan en el `package.json`
   correspondiente.
4. **Una decisión importante = un ADR.** Usa la plantilla de [adr/README.md](./adr/README.md) y
   numera secuencialmente.
5. **Español**, salvo nombres de código y términos técnicos establecidos.

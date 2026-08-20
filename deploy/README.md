# Deploy — Pumpkin Zone

Producción del evento único sobre Boletera Platform.

| Host | Servicio |
|------|----------|
| https://pumpkin.experiencebt.com.mx | Storefront (`web`) + API bajo `/api` |
| https://app.experiencebt.com.mx | Admin |
| https://taquilla.experiencebt.com.mx | POS taquilla |

## Archivos

| Archivo | Uso |
|---------|-----|
| `pumpkin-compose.yml` | Stack Docker (db, redis, api, worker, web, admin, taquilla) |
| `pumpkin.env.example` | Plantilla de secretos → copiar a `.env` junto al compose |

## Arranque en el VPS

```bash
cd /opt/pumpkin
# .env ya debe existir (nunca en git). Ver pumpkin.env.example.
docker compose -f pumpkin-compose.yml up -d
```

Worker arranca siempre (expira holds) con imagen `pumpkin-worker:latest`
(`docker/worker.Dockerfile`). Taquilla requiere `pumpkin-taquilla:latest`
y DNS `taquilla.experiencebt.com.mx` apuntando al mismo Traefik.

## Activar venta online

1. Llenar `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` en `.env`
2. `docker compose -f pumpkin-compose.yml up -d api`
3. Verificar: `curl -s https://pumpkin.experiencebt.com.mx/api/v1/payments/config`

Detalle: [`docs/ACTIVAR-MERCADO-PAGO.md`](../docs/ACTIVAR-MERCADO-PAGO.md)

## Docs canónicas vs obsoletas

Usar: `README.md`, `docs/arquitectura.md`, `docs/ACTIVAR-MERCADO-PAGO.md`, este deploy.

Ignorar para operación Pumpkin: `ROADMAP.md`, `ACTION_PLAN_IMMEDIATE.md`,
`CONTINUATION_PATHS.md` (hablan de Stripe / % inventados).

# 04 — Incidente de pagos (Banorte)

## Objetivo

Diagnosticar y mitigar fallos de cobro, IPN, SPEI/OXXO o reembolsos. Gateway real: **Banorte** (no Stripe — P-10).

## Criterios de entrada (SEV)

- SEV-1: > ~5% intents fallidos o IPN no completa órdenes en venta activa.
- SEV-2: un método (CARD/SPEI/OXXO) fallando; otros OK.
- SEV-3: reembolsos manuales lentos / portal Banorte.

## Endpoints verificados (únicos válidos)

```text
GET  /api/v1/payments/config
GET  /api/v1/payments/config/validate          # JWT staff
POST /api/v1/payments/intents
POST /api/v1/payments/confirm
POST /api/v1/payments/webhooks/banorte         # IPN
GET  /api/v1/payments/webhooks/banorte/return
POST /api/v1/payments/reconcile/spei           # X-Internal-Secret
POST /api/v1/payments/:orderId/refunds         # JWT
POST /api/v1/payments/refunds/:refundId/complete
GET  /api/v1/orders/:publicId/status
GET  /api/v1/metrics/orders                    # JWT + org
```

No hay endpoint de “circuit breaker de pagos” en código (P-05).

## Triage inmediato

```powershell
.\infra\runbooks\scripts\payments-triage.ps1
```

### 1. ¿API viva?

```powershell
.\infra\runbooks\scripts\health-check.ps1
# health.payments debe ser "BANORTE"
```

### 2. ¿Modo demo por error en prod?

```powershell
$cfg = Invoke-RestMethod "$env:API_BASE/api/v1/payments/config"
$cfg | Select-Object gateway, demo, mode, productionReady, methods
$cfg.validation
$cfg.ipn
```

| Hallazgo | Acción |
|----------|--------|
| `demo=true` en prod | SEV-1: falta `BANORTE_MERCHANT_ID` → restaurar secretos, redeploy/restart API |
| `productionReady=false` | Completar `missing[]` (`BANORTE_*`) |
| `ipn.webhookSecretConfigured=false` | Configurar `BANORTE_WEBHOOK_SECRET` + registrar IPN en portal |

IPN esperada: `{API_PUBLIC_URL}/api/v1/payments/webhooks/banorte`  
Headers de firma: `x-banorte-signature`, `x-signature`.

### 3. Validate autenticado (si hay JWT)

```powershell
Invoke-RestMethod "$env:API_BASE/api/v1/payments/config/validate" `
  -Headers @{ Authorization = "Bearer $env:JWT_STAFF" }
```

### 4. Logs API (IPN / intents)

```powershell
docker logs --since 30m $env:API_CONTAINER 2>&1 | Select-String -Pattern "Banorte|payment|IPN|webhook|SPEI"
# K8s:
# kubectl -n $env:KUBE_NS logs deploy/$env:KUBE_DEPLOY_API --since=30m | Select-String ...
```

### 5. Métricas de órdenes (JWT)

```powershell
Invoke-RestMethod "$env:API_BASE/api/v1/metrics/orders?from=...&to=..." `
  -Headers @{ Authorization = "Bearer $env:JWT_STAFF" }
```

## Mitigaciones

### A. IPN no llega / órdenes PENDING

1. Verificar `API_PUBLIC_URL` público HTTPS alcanzable desde Banorte.
2. Re-registrar URL IPN en portal Payworks.
3. Reconciliar SPEI/OXXO pendientes:

```powershell
Invoke-RestMethod -Method POST -Uri "$env:API_BASE/api/v1/payments/reconcile/spei" `
  -Headers @{ "X-Internal-Secret" = $env:INTERNAL_API_SECRET }
```

4. Casos puntuales: confirmar vía flujo `POST /payments/confirm` **solo** si negocio valida cobro (cuidado en live).

### B. Rate limit 429 en pagos

Anti-abuse: **20 req/min** por IP/usuario en paths con `/payment` o `/refund`.  
Mitigar: reintentos con backoff; no martillar confirm; revisar bots.

### C. Payworks / 3DS caído ( Banorte)

- Comunicar SEV; habilitar canal **taquilla** (`/api/v1/taquilla/...`) si el venue opera.
- SPEI/OXXO pueden seguir si Banorte query URL responde — validar con reconcile.
- Escalamiento L4 Banorte.

### D. Reembolsos

1. `POST /payments/:orderId/refunds` (staff).
2. Si queda pendiente en portal: `POST /payments/refunds/:refundId/complete` con `banorteReference`.

## Validación de recuperación

- [ ] `payments/config` → `demo=false`, `productionReady=true` (prod)
- [ ] Intent de prueba en staging o monto mínimo aprobado por negocio
- [ ] Webhook de prueba / reconcile reduce PENDING SPEI
- [ ] `orders/:publicId/status` refleja COMPLETED tras cobro

## Escalamiento

L1 triage → L2 pagos → L4 Banorte. Negocio: mensaje a compradores y taquilla.

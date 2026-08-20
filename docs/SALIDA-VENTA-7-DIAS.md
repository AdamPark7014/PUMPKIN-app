# Salida a venta — Pumpkin Zone (7 días)

Checklist operativo para abrir compra pública. Complementa
`docs/ACTIVAR-MERCADO-PAGO.md` y `docs/INTEGRACION-MP-CHECKLIST.md`.

Última actualización: **2026-08-20**.

---

## Día 1–2 — Bloqueantes (sin esto no se vende)

### Código (repo)
- [x] Forzar pasarela online Mercado Pago (Pumpkin / `PAYMENTS_GATEWAY`)
- [x] Cerrar `POST /payments/confirm` en modo MP (no free-complete por Banorte demo)
- [x] `Payment.gateway` correcto al completar (MP vs Banorte)
- [x] `MAIL_FROM` ← también acepta `SMTP_FROM`; marca `MAIL_BRAND=Pumpkin Zone`
- [x] Comisión de orden usa `organization.commissionRate` (seed Pumpkin = 0)
- [x] Hero video full-bleed sin overlays de texto HTML
- [ ] Confirmar fechas/precios en `apps/web/lib/event-config.ts` + `seed-pumpkin.ts`
- [ ] Commit + deploy de estos cambios a VPS

### Ops VPS (`.env` en `/opt/pumpkin`)
- [ ] `MP_ACCESS_TOKEN=APP_USR-…` (prod, no `TEST-`)
- [ ] `MP_WEBHOOK_SECRET=…`
- [ ] `WEB_PUBLIC_URL=https://pumpkin.experiencebt.com.mx`
- [ ] `API_PUBLIC_URL=https://pumpkin.experiencebt.com.mx`
- [ ] `PAYMENTS_GATEWAY=mercadopago` (compose ya lo fija)
- [ ] SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- [ ] `MAIL_FROM=boletos@…` (dominio verificado) y opcional `SMTP_FROM` igual
- [ ] Secretos ≥32 chars: `JWT_SECRET`, `TICKET_QR_SECRET`, `POSTGRES_PASSWORD`, `INTERNAL_API_SECRET`
- [ ] Rotar passwords seed si aún son default (`SEED_PASSWORD` / PIN taquilla)

### Mercado Pago panel
- [ ] Webhook URL: `https://pumpkin.experiencebt.com.mx/api/v1/payments/webhooks/mercadopago`
- [ ] Topic **Payments** (Order solo si Point después)
- [ ] Liquidación bancaria / RFC listos

### Build / runtime
- [ ] Rebuild `pumpkin-web` con  
  `NEXT_PUBLIC_API_URL=https://pumpkin.experiencebt.com.mx/api/v1`
- [ ] Contenedores: `api`, `web`, **`worker`** (holds expirados), redis, db
- [ ] `GET /api/v1/payments/config` → `gateway: MERCADOPAGO`, `mode: live`, sin `MP_ACCESS_TOKEN` en `validation.missing`

### Smoke gate (obligatorio antes de anunciar)
- [ ] Compra real ~$50 con tarjeta → orden `COMPLETED`
- [ ] Webhook recibido (logs API)
- [ ] Correo con PDF/QR llega al comprador
- [ ] QR escanea en acceso / taquilla (mismo `TICKET_QR_SECRET`)

---

## Día 3–4 — Riesgo alto / contenido

- [ ] Términos + privacidad: razón social, contacto, reembolsos, no transferencia
- [ ] Ayuda: flujo Pumpkin (no marketplace / asientos genéricos)
- [ ] Footer: quitar reventa / ciudades / categorías si aún aparecen
- [ ] Capacitar taquilla: efectivo + voucher CARD (last4 + auth); Point después
- [ ] Proceso manual contracargos (quién responde en MP + cómo anular QR)
- [ ] Verificar hold 24h (`MP_PENDING_TTL_HOURS`) comunicado a staff (OXXO/SPEI)

---

## Día 5–7 — Eficiencia / no tocar

**Hacer solo si sobra tiempo**
- [ ] Admin → página Pagos centrada en MP (salud webhook)
- [ ] Noindex o redirect de `/ciudades`, `/categoria`, `/resale`
- [ ] Soft-hide módulos muertos en admin nav

**Explicitamente diferir post-lanzamiento**
- Mercado Pago Point (API + PDV)
- CFDI PAC real
- Contracargos automáticos / mediación
- Borrar paquete Banorte del monorepo
- Multi-tier / Pasaje como oferta aparte

---

### Diferir (explícito — no construir esta semana)
- Impresora Bluetooth al PDA
- Papel térmico 58 mm (seguimos en **80 mm**)
- App nativa iOS/Android (reemplazada por **PWA instalable** en escritorio/móvil para taquilla y admin)
- Admit offline autoritativo en puerta (solo cola client-side; exigir verde online)

---

## Impresión térmica Epson + PDA en puerta

### Ya listo en código
- ESC/POS propio en taquilla (`apps/taquilla/lib/escpos.ts`, `ticket-print.ts`)
- Puente de red → Epson puerto **9100** (`tools/print-bridge/`, ver `LEEME.txt`)
- Reimpresión marcada `* REIMPRESION *`
- Escáner de puerta: admin `/scanner` (`POST /access/scan`) — admite / rechaza duplicados
- QR unificado: código durable **`BLT-…`** en papel, PDF, correo y pantalla (mismo payload que el láser del PDA)
- Boleto térmico con **localizador** (`LOC ORD-…`), sede/fecha, zona, QR BLT y comprobante
- PWA instalable (Chrome/Edge): taquilla + admin como ventana de app

### Día de evento — Epson (taquilla PC)
- [ ] Epson TM serie **80 mm** en Ethernet (recomendado TM-T20 / T88); IP conocida
- [ ] Node LTS en la PC de taquilla
- [ ] `tools/print-bridge/config-impresora.txt` con la IP correcta
- [ ] Correr `iniciar-puente.bat` y **dejar la ventana abierta**
- [ ] Taquilla → Ajustes → “Guardar y probar puente” → “Imprimir boleto de prueba” con QR
- [ ] Probar venta real + reimpresión si atasca papel

### Día de evento — PDA / acceso
- [ ] PDA o teléfono con Chrome → login rol `SCANNER` / `TAQUILLA` → **`/scanner`**
- [ ] Preferir **láser HID** (teclado) al campo manual; cámara como respaldo
- [ ] Solo admitir con respuesta online verde (“Acceso permitido”) — no confiar en cola offline
- [ ] Smoke: escanear boleto térmico `BLT-…` → OK; segundo escaneo → rechazado
- [ ] Smoke: QR de correo/PDF/`/orders/…` con mismo `BLT-…` → OK

### Diferir
- Impresora Bluetooth desde el PDA
- Papel 58 mm
- App nativa de acceso / admit offline autoritativo
- Point MP en taquilla (sigue voucher CARD manual)

---

## Comandos útiles

```bash
# En VPS, tras editar .env
cd /opt/pumpkin
docker compose -f pumpkin-compose.yml up -d api worker web

# Health pasarela
curl -sS https://pumpkin.experiencebt.com.mx/api/v1/payments/config | jq .
```

Guía de credenciales: `docs/Manual-Mercado-Pago-Credenciales.pdf`  
Activación detallada: `docs/ACTIVAR-MERCADO-PAGO.md`

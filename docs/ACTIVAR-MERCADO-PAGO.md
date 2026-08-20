# Activar el cobro en línea (Mercado Pago) — 15 minutos

La venta en línea está **codificada, probada y desplegada**. Está apagada
únicamente porque faltan las credenciales de la cuenta de Mercado Pago de la
empresa. Mientras tanto, `pumpkin.experiencebt.com.mx/boletos` muestra
"La venta en línea abre muy pronto" y la compra queda deshabilitada — se
enciende sola al detectar las credenciales.

## Paso 1 — Crear la aplicación (en mercadopago.com.mx)

1. Inicia sesión en la cuenta de Mercado Pago de la empresa (o crea una:
   solo pide RFC/datos bancarios para liquidar).
2. Ve a **Tus integraciones** → **Crear aplicación**.
   - Nombre: `Pumpkin Zone Boletos`
   - Producto: **Checkout Pro**
3. Entra a la aplicación → **Credenciales de producción**.
   - Copia el **Access Token** (empieza con `APP_USR-`).

## Paso 2 — Registrar el webhook

En la misma aplicación → **Webhooks / Notificaciones**:

- URL: `https://pumpkin.experiencebt.com.mx/api/v1/payments/webhooks/mercadopago`
- Evento: **Pagos** (payments)
- Copia la **clave secreta** que Mercado Pago genera para la firma.

## Paso 3 — Poner las credenciales en el servidor

```bash
ssh -i C:\Users\adpoz\.ssh\id_ed25519_nexara_hetzner -p 2222 root@5.78.215.109
```

Edita `/opt/pumpkin/.env` (plantilla: `deploy/pumpkin.env.example`) y llena:

```
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxx
MP_WEBHOOK_SECRET=xxxxxxxxxxxx
WEB_PUBLIC_URL=https://pumpkin.experiencebt.com.mx
API_PUBLIC_URL=https://pumpkin.experiencebt.com.mx
```

`deploy/pumpkin-compose.yml` inyecta esas variables al contenedor `api`
(`env_file` + `environment`). Sin ellas en el `.env`, la API no ve Mercado Pago
aunque el archivo exista.

Aplica:

```bash
cd /opt/pumpkin && docker compose -f pumpkin-compose.yml up -d api
```

## Paso 4 — Verificar (2 minutos)

```bash
curl -s https://pumpkin.experiencebt.com.mx/api/v1/payments/config | head -c 200
```

Debe decir `"gateway":"MERCADOPAGO"`. En ese momento `/boletos` habilita la
compra solo. Haz una compra real de $50, revisa que llegue el correo con el
QR, y reembólsala desde el panel de Mercado Pago si quieres.

## Ensayo previo (opcional, recomendado)

Con las **credenciales de prueba** de la misma aplicación (Access Token
`TEST-…`) el flujo completo funciona con [tarjetas de prueba de Mercado
Pago](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards)
— sin dinero real. Mismos pasos; luego se cambia al token `APP_USR-`.

## Qué pasa al activarse

- El comprador paga en Mercado Pago (tarjeta, OXXO, transferencia o saldo).
- El webhook confirma el pago → la orden se completa → el correo con los
  boletos QR sale solo.
- El dinero liquida a la cuenta de Mercado Pago de la empresa (de ahí al
  banco según la configuración de la cuenta).
- La comisión de MP (~3.5% + IVA para Checkout Pro) la absorbe el cargo por
  servicio — visible solo en la vista interna de reportes.

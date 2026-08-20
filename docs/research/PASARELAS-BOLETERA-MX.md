# Deep research: Clip vs Mercado Pago vs Stripe vs PayPal — boletera México

Fecha: **2026-08-20**. Pregunta: ¿quién tiene las comisiones más bajas y qué conviene
para una boletera? Más: qué cableado tiene ya Boletera/Pumpkin.

## Respuesta corta

**Comisión de tarjeta nacional más baja publicada hoy (promo): Clip 2.99% + $1 + IVA.**  
**Para boletera online en México (API + OXXO/SPEI + webhooks + adopción): Mercado Pago
sigue siendo el mejor equilibrio** — y es lo que Pumpkin ya tiene cableado. Stripe gana
en plataforma (Connect, Radar, escala), no en precio. PayPal es el más caro en tarifa
estándar. **No elijas solo por %**: a ticket $50 (Pumpkin) la cuota fija de Stripe/MP/PayPal
duele más que el porcentaje.

## Hallazgos

### 1. Comisiones publicadas (tarjeta nacional, e-commerce / cobro con tarjeta)

| Proveedor | Tarifa base publicada | IVA | Fuente | Fecha |
|-----------|----------------------|-----|--------|-------|
| **Clip** (promo) | **2.99% + $1 MXN** | Sí (ejemplo oficial con IVA) | [Blog Clip](https://blog.clip.mx/articulo/cuanto-cobra-de-comision-clip) | 24 Mar 2026 |
| **Clip** (estándar) | **3.6% + IVA** (sin cuota fija en ese párrafo) | Sí | mismo blog + [clip.mx](https://clip.mx/) promo vs “antes 3.6%” | 2026 |
| **Stripe MX** | **3.6% + MXN $3** nacionales; +0.5% intl; +2% FX | **Excluye IVA** (se suma aparte) | [stripe.com/mx/pricing](https://stripe.com/mx/pricing) | consultado 2026-08-20 |
| **Mercado Pago** (link/checkout, blog oficial) | **3.49% + $4** al instante; 3.19%+$4 / 7d; 2.95%+$4 / 30d | Blog no desglosa IVA en la lista; partners sí citan +IVA | [Hot Sale 2026](https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago) (5 May 2026); [Partners](https://www.mercadopago.com.mx/partners/developers/es/details) 3.19%+$4+IVA | 2026 |
| **PayPal MX** | **3.95% + $4.00 MXN** estándar; merchant rate 3.65%→2.95% por volumen | “subject to VAT” en PDF EN | [Fees merchant](https://www.paypal.com/mx/webapps/mpp/fees-merchant) (act. 15 Jul 2026); PDF [22 Jan 2026](https://www.paypalobjects.com/marketing/ua/pdf/MX/es/mx-merchant-fees-es-22-jan-2026.pdf) | 2026 |

**Ranking de costo (tarjeta nacional, con IVA 16% sobre la comisión):**

Fórmula usada: `((monto × %) + fijo) × 1.16`.

| Ticket | Clip promo | Clip 3.6% | MP 3.49%+$4 | Stripe 3.6%+$3 | PayPal 3.95%+$4 |
|--------|------------|-----------|-------------|----------------|-----------------|
| $50 | **~$2.89** | ~$3.48 | ~$6.66 | ~$5.57 | ~$6.93 |
| $100 | **~$4.63** | ~$4.18* | ~$8.69 | ~$7.66 | ~$9.22 |
| $500 | **~$18.50** | ~$20.88 | ~$24.91 | ~$24.36 | ~$27.61 |
| $1,000 | **~$35.84** | ~$41.76 | ~$45.12 | ~$45.24 | ~$50.46 |
| $5,000 | **~$174.02** | ~$208.80 | ~$207.42 | ~$212.28 | ~$233.86 |
| $10,000 | **~$347.64** | ~$417.60 | ~$410.44 | ~$421.08 | ~$463.06 |

\*Clip 3.6% sin fijo en el blog: a $100 sale ~$4.18; la promo 2.99%+$1 a $100 es ~$4.63 (el fijo $1 pesa).

Corrección vs mensaje previo: Stripe a $1,000 con IVA es **~$45.24**, no $44.08.

### 2. Capacidad para boletera (no solo %)

| Capacidad | Clip | Mercado Pago | Stripe | PayPal |
|-----------|------|--------------|--------|--------|
| Checkout online API | Sí (Redirect + Transparente; PCI para transparente) | Checkout Pro / API / Bricks | Checkout / Elements / Payment Intents | Checkout / Orders |
| Webhooks | Sí (checkout + transparent) | Sí (payment + firma) | Sí (events) | Sí (IPN/webhooks) |
| Reembolsos API | Sí (180 días) | Sí | Sí | Sí |
| OXXO / SPEI / efectivo MX | Limitado / no es el fuerte de Clip online | **Nativo fuerte** | OXXO/local methods (tarifas propias; Stripe lista SPEI/bank en pricing) | Alternativos (OXXO vía PayPal listado en fees) |
| Contracargos / disputes | Vía producto Clip | API chargebacks documentada | Disputas MXN $150 + Smart Disputes | Controversias PayPal |
| Split / marketplace | Débil vs Stripe Connect | Marketplace/partners | **Connect** (líder) | Limited |
| Terminal física | **Fuerte** | Point | Terminal | POS reader |
| Escala / docs eng | Buena (MX) | Buena (LATAM) | **Excelente** global | Media |

Fuentes Clip API: [developer.clip.mx](https://developer.clip.mx/docs/api-de-checkout-transparente), refunds, webhooks.  
Stripe disputes: pricing MX. MP chargebacks: docs Checkout Pro.

### 3. Qué tiene YA cableado Boletera / Pumpkin

| Capacidad | Estado en repo | Evidencia |
|-----------|----------------|-----------|
| Checkout online | **MP Checkout Pro** (preferencia + redirect) | `packages/payments/.../mercadopago.provider.ts` |
| Fallback online | Banorte (demo sin merchant) | `banorte.provider.ts` + registry |
| Taquilla / efectivo | Cash provider | `cash.provider.ts` |
| Webhooks | MP + Banorte (firma + fetch verdad) | `payment.controller.ts` |
| Reembolsos | API orden → provider **por gateway** (fix 2026-08-20: antes siempre Banorte) | `payment.service.ts` |
| Contracargos | **Parcial**: `charged_back` mapea a cancelled; **sin** flujo defensa/docs | `mercadopago.provider.ts` mapStatus |
| Pagos masivos / on-sale | Rate limit 120/60s; holds Redis; **sin** waiting room / K8s | runbooks P-01…P-04 |
| Split organizer/boletera | **Payouts admin internos**, no Stripe Connect / MP marketplace auto | `admin` payouts |
| Stripe / Clip / PayPal providers | **No implementados** (solo enums/tipos) | `types.ts` ids; registry solo banorte+cash+mp |
| Escalabilidad ops | Compose + Traefik prod; worker holds 24h MP | `deploy/pumpkin-compose.yml` |

### 4. Recomendación boletera (Pumpkin)

1. **Seguir con Mercado Pago como pasarela online principal** (ya integrado; OXXO/SPEI; adopción MX).  
2. **Clip** si necesitas terminal física barata en taquilla — no reemplazar el checkout web solo por el 2.99%.  
3. **Stripe** cuando haya multi-promotor + Connect / Radar / volumen y puedas absorber ~igual o más comisión que MP.  
4. **PayPal** solo como método opcional (más caro, peor UX LATAM para muchos compradores).

Para ticket **$50** (modelo Pumpkin): Clip promo es el más barato en %; **pero** sin SPEI/OXXO nativos al nivel de MP pierdes conversión. El costo MP (~$6.7) vs Clip (~$2.9) en $50 es ~$3.8 por boleto — a menudo menor que una venta perdida por falta de OXXO.

## Contradicciones y huecos

- Clip: promo 2.99%+$1 vs estándar 3.6%; no está claro en todas las páginas si la promo aplica a **API checkout** o solo terminales/cobro general — **verificar en contrato / dashboard Clip**.  
- MP: blog Hot Sale omite IVA en la lista; Partners sí pone +IVA; tarifario ayuda no legible sin sesión.  
- Stripe vs Clip a $1k: casi empatan con MP (~$45) si Clip no está en promo.  
- PayPal “merchant rate” requiere volumen y aprobación — no es la tarifa default.  
- Ninguna fuente primaria pública confirma “mejor para boleteras” como producto vertical.

## Qué verificar antes de decidir

- [ ] En panel Clip: ¿2.99%+$1 aplica a Checkout API / links online?  
- [ ] Simulador MP logueado (IVA + plazo liberación).  
- [ ] Si habrá split a organizadores → cotizar Stripe Connect vs liquidaciones propias.  
- [ ] Volumen esperado on-sale → waiting room / scale (hoy no hay).  
- [ ] Política MSI (todas suman sobretasa al comercio).

## Fuentes

**Primarias:** [Stripe MX pricing](https://stripe.com/mx/pricing) · [PayPal MX fees](https://www.paypal.com/mx/webapps/mpp/fees-merchant) · [PayPal PDF Jan 2026](https://www.paypalobjects.com/marketing/ua/pdf/MX/es/mx-merchant-fees-es-22-jan-2026.pdf) · [Clip blog comisiones](https://blog.clip.mx/articulo/cuanto-cobra-de-comision-clip) · [clip.mx](https://clip.mx/) · [MP Hot Sale](https://www.mercadopago.com.mx/blog/hot-sale-integra-mercado-pago) · [MP Partners rates](https://www.mercadopago.com.mx/partners/developers/es/details) · [Clip developers](https://developer.clip.mx/)

**Secundarias:** atempora / tspayy (solo cruzan; no mandan).

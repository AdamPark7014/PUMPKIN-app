# Deep research — Boleto térmico Pumpkin / Epson

Fecha de investigación: **2026-08-20**.

## Respuesta corta

Tu arte `ticket pumpink 8x 14.8 cm.pdf` mide exactamente **80,0 × 148,0 mm**. Eso es el estándar de **papel térmico “80 mm”** de Epson TM (no 88 mm de ancho útil). El “88 mm” casi seguro es el **diámetro del rollo** o una medida del cuerpo/tapa; el ancho de impresión es ~**72 mm** útiles / **42 columnas** Font A. En código: layout compacto tipo boletera (~148 mm de alto por persona), QR `BLT-…`, localizador, fecha/horario/lugar, folio; comprobante de pago **corto** al final de la venta para ahorrar papel.

## Hallazgos

### 1) ¿Qué miden 8 × 14,8 cm?

| Dato | Valor | Fuente |
|------|-------|--------|
| MediaBox del PDF | **80,0 × 148,0 mm** | Extracción `pypdf` del archivo del usuario, 2026-08-20 |
| Nombre del archivo | `8x 14.8 cm` | Coincide con el PDF |

### 2) Epson: ancho de papel vs “88 mm”

| Dato | Valor | Fuente (primaria) |
|------|-------|-------------------|
| Ancho de rollo “80 mm” | **79,5 ± 0,5 mm** | Spec sheet Epson TM-T88VII / TM-T88V ([Epson AU TM-T88VII](https://www.epson.com.au/products/receipt-printers/receipt-printers/tmt88vii), [JRC TM-T88V PDF](https://jrc.com.au/files/TM-T88V_0912.pdf)) |
| Diámetro máx. de rollo | **83 mm** (a veces se vende 80×80) | Mismas fichas Epson; mercado MX “80×80×12” ([Unimarq](https://unimarq.mx/papel-termico-80mm-compatibilidad-y-compra-segura), [Kelttys](https://www.kelttys.com/rollos-de-papel-termico/1070-688-rollo-papel-termico-80x80x12.html)) |
| Área imprimible 80 mm (TM-T20) | **72,1 ± 0,2 mm** = **576 dots** | [TM-T20 Technical Reference Guide](https://download4.epson.biz/sec_pubs/bs/pdf/tmt20utrm_en_0.pdf) |
| Columnas Font A @ 80 mm | **42** (también modos 48/56) | Epson AU TM-T88VII; código actual `WIDTH = 42` |
| Alternativa 58 mm | 57,5 ± 0,5 mm; **no** es el arte Pumpkin | Fichas Epson |

**Conclusión aproximada:** diseñar y comprar como **80 mm**. Si alguien midió **~88 mm**, es compatible con **diámetro de rollo ~80–83 mm** (error común al medir el carrete), no con un ancho de papel de 88 mm (Epson no publica 88 mm como ancho estándar).

### 3) Alto del boleto (sin medida fija de fábrica)

| Dato | Valor | Fuente |
|------|-------|--------|
| Alto del arte Pumpkin | **148 mm** por boleto | PDF del usuario |
| Alto en Epson | **Variable** — corta donde manda ESC/POS (`GS V`) | Comportamiento TM + ESC/POS |
| Regla de negocio | **Más corto = menos papel** | Indicación del organizador |

**Promedio práctico boletera térmica 80 mm:** **120–160 mm** por persona con QR legible + datos. Tu arte **148 mm** cae en el centro de ese rango.

### 4) Estándares de boletaje (contenido mínimo)

Cruzando boleteras (Billettera: térmico 80 mm + QR + barcode de respaldo), plantillas de evento y práctica POS:

| Elemento | Obligatorio en taquilla | En layout Pumpkin |
|----------|-------------------------|-------------------|
| Nombre del evento | Sí | `PUMPKIN ZONE` |
| Fecha / horario / lugar | Sí | `FECHA` / `HORARIO` / `LUGAR` |
| Tipo de acceso / zona | Sí | asiento/zona |
| Identificador único escaneable | Sí (QR o 1D) | QR = `BLT-…` |
| Código humano legible | Sí (respaldo PDA) | texto bajo QR |
| Localizador de orden | Buena práctica will-call | `LOC ORD-…` |
| Folio / # boleto | Buena práctica | `FOLIO` |
| Una sola entrada / no reembolso corto | Buena práctica anti-fraude | pie |
| Comprobante de pago | Sí en venta POS | stub **corto** al final (ahorro de papel) |

Fuentes: [Billettera tickets de caja](https://billettera.com/es/funcionalidad/tickets-de-caja) (térmico 80 mm + QR); [SICAR MX 58 vs 80](https://www.sicar.mx/centro-de-soluciones/dispositivos/impresora-de-tickets-sicar) (80 mm profesional / QR); guías de diseño de ticket de evento (nombre, fecha, venue, código).

### 5) Impresora del chat (serie `U64632M2G130027`)

- Formato entre asteriscos es típico de **etiqueta Epson**.
- El arte **80 × 148 mm** encaja con **Epson TM de recibo 80 mm**, no con Brother QL-800 (etiquetas DK, ancho útil típico **≤ 62 mm**).
- Si en el chat apareció “Brother QL-800”, tratarlo como **posible foto de otro equipo**; el PDF + uso de boleto 80 mm apuntan a **Epson térmica de rollo 80 mm**.

## Contradicciones y huecos

- **“88 mm” vs 80 mm:** no hay ficha Epson de papel de 88 mm de ancho; sí hay **diámetro ~83 mm**. Sin foto de la regla midiendo el **ancho del papel**, no se puede cerrar al 100 %.
- Modelo exacto (TM-T20 vs T88…): **sin confirmar** con la sola serie; el bridge actual (Ethernet :9100 + ESC/POS) sirve a la familia TM.
- Gráficos del PDF (calabazas, tipografía script): en ESC/POS nativo salen como **texto + QR**; logos bitmap se pueden añadir después (NV bit image), no bloquean el lanzamiento.

## Qué verificar antes de decidir

1. Medir con regla el **ancho del papel** (debe ~80 mm) vs el **diámetro del rollo** (~80–83 mm).
2. Confirmar modelo exacto en la etiqueta (TM-T20III / T88V / etc.) para memoria de switches 80 mm.
3. Imprimir boleto de prueba desde Taquilla → Ajustes y medir alto real vs 148 mm; bajar módulo QR si sobra papel.
4. Comprar rollos **80×80×12** (o 80×70) BPA-free, no 58 mm.

## Fuentes

**Primarias**

- [Epson TM-T88VII specs (AU)](https://www.epson.com.au/products/receipt-printers/receipt-printers/tmt88vii) — ancho 79,5 ± 0,5 / Ø 83
- [Epson TM-T20 TRG PDF](https://download4.epson.biz/sec_pubs/bs/pdf/tmt20utrm_en_0.pdf) — área imprimible 72,1 mm / 576 dots
- [JRC TM-T88V datasheet](https://jrc.com.au/files/TM-T88V_0912.pdf) — 80/58 mm, 42 columnas Font A
- PDF usuario `ticket pumpink 8x 14.8 cm.pdf` — 80 × 148 mm

**Secundarias (mercado / boleteras)**

- [Unimarq — papel 80 mm MX](https://unimarq.mx/papel-termico-80mm-compatibilidad-y-compra-segura)
- [SICAR — 58 vs 80 mm](https://www.sicar.mx/centro-de-soluciones/dispositivos/impresora-de-tickets-sicar)
- [Billettera — ticket térmico 80 mm](https://billettera.com/es/funcionalidad/tickets-de-caja)

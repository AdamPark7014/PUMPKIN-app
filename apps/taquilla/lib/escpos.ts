/**
 * Constructor ESC/POS a nivel de bytes.
 *
 * Por qué no strings: el comando de QR nativo (`GS ( k`) codifica la longitud
 * de los datos en dos bytes, y la impresora interpreta cada byte crudo. Un
 * `TextEncoder` UTF-8 rompe las dos cosas — parte los acentos en dos bytes
 * (descuadrando la longitud declarada) y manda secuencias que la impresora no
 * entiende. Todo lo que sale de aquí es `Uint8Array`.
 *
 * Codificación de texto: CP850, que es la página de códigos que traen de
 * fábrica prácticamente todas las Epson TM. Lo que no esté en la tabla cae a
 * su equivalente ASCII antes que imprimir un jeroglífico.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Acentos y signos del español en CP850 (página 2 de Epson). */
const CP850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, '·': 0xfa, '€': 0xd5, '£': 0x9c,
};

/** Último recurso cuando el carácter no existe en CP850. */
const ASCII_FALLBACK: Record<string, number> = {
  '–': 0x2d, '—': 0x2d, '“': 0x22, '”': 0x22, '‘': 0x27, '’': 0x27, '…': 0x2e,
};

function encodeText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out[i] = code;
    } else if (CP850[ch] !== undefined) {
      out[i] = CP850[ch]!;
    } else if (ASCII_FALLBACK[ch] !== undefined) {
      out[i] = ASCII_FALLBACK[ch]!;
    } else {
      out[i] = 0x3f; // '?'
    }
  }
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Acumulador de comandos. Cada método devuelve `this` para encadenar.
 */
export class EscPosBuilder {
  private readonly chunks: Uint8Array[] = [];

  private raw(...bytes: number[]): this {
    this.chunks.push(Uint8Array.from(bytes));
    return this;
  }

  /** `ESC @` reset + `ESC t 2` selecciona CP850. Siempre primero. */
  init(): this {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 0x02);
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
    return this.raw(ESC, 0x61, n);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** `GS ! n` — multiplicador de ancho y alto, 1 a 8. */
  size(width: number, height: number): this {
    const w = Math.min(Math.max(width, 1), 8) - 1;
    const h = Math.min(Math.max(height, 1), 8) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  text(value: string): this {
    this.chunks.push(encodeText(value));
    return this;
  }

  line(value = ''): this {
    return this.text(value).raw(0x0a);
  }

  /** Regla horizontal. 42 columnas es el ancho de fuente A en papel de 80 mm. */
  rule(char = '-', width = 42): this {
    return this.line(char.repeat(width));
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.min(Math.max(lines, 0), 255));
  }

  /**
   * QR nativo de la impresora vía `GS ( k`. Se renderiza en el firmware, así
   * que sale nítido y sin el costo de mandar un bitmap por el puerto.
   *
   * @param data   Contenido del QR. Aquí va el payload firmado de `@boletera/crypto`.
   * @param module Tamaño de módulo (1-16). 6 da un QR de ~25 mm, cómodo de escanear.
   * @param ecc    Corrección de error: L, M, Q o H. M aguanta un doblez del boleto.
   */
  qr(data: string, module = 6, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): this {
    const bytes = encodeText(data);

    // Modelo 2.
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Tamaño de módulo.
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(module, 1), 16));
    // Nivel de corrección de error.
    const eccByte = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 }[ecc];
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, eccByte);

    // Guardar en el búfer del símbolo. La longitud declarada incluye los 3
    // bytes de cabecera (cn, fn, m), de ahí el +3.
    const len = bytes.length + 3;
    if (len > 0xffff) throw new Error('Payload de QR demasiado largo');
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.chunks.push(bytes);

    // Imprimir el símbolo almacenado.
    return this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  }

  /** `GS V 66 n` — avanza y hace corte parcial. Deja el papel listo para arrancar. */
  cut(feedDots = 3): this {
    return this.raw(GS, 0x56, 0x42, feedDots);
  }

  /** Pulso al cajón de dinero, pin 2. */
  drawerKick(): this {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0x19);
  }

  build(): Uint8Array {
    return concat(this.chunks);
  }
}

export function escpos(): EscPosBuilder {
  return new EscPosBuilder().init();
}

/**
 * Centra un texto en `width` columnas sin depender de `ESC a`, útil cuando ya
 * se está imprimiendo en modo doble ancho y el centrado por hardware descuadra.
 */
export function padCenter(text: string, width = 42): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

/** Etiqueta a la izquierda, valor pegado a la derecha. */
export function padBetween(left: string, right: string, width = 42): string {
  const gap = width - left.length - right.length;
  if (gap < 1) return `${left} ${right}`;
  return left + ' '.repeat(gap) + right;
}

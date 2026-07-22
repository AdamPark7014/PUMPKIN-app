/** ESC/POS básico para impresoras térmicas vía Web Serial o ventana de impresión */
export function buildEscPosReceipt(lines: string[]): string {
  const ESC = '\x1b';
  const GS = '\x1d';
  const init = `${ESC}@`;
  const center = `${ESC}a\x01`;
  const left = `${ESC}a\x00`;
  const boldOn = `${ESC}E\x01`;
  const boldOff = `${ESC}E\x00`;
  const cut = `${GS}V\x00`;
  const body = lines.join('\n');
  return `${init}${center}${boldOn}BOLETERA TAQUILLA${boldOff}\n${left}${body}\n\n${cut}`;
}

export function printEscPos(text: string) {
  const w = window.open('', '_blank', 'width=320,height=480');
  if (!w) return;
  w.document.write(`<pre style="font-family:monospace;font-size:12px">${text.replace(/[\x00-\x1f]/g, '')}</pre>`);
  w.print();
  w.close();
}

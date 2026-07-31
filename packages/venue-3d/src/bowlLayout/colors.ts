const SECTION_PALETTE = [
  '#c45c6a',
  '#c4a35a',
  '#5a9e78',
  '#5b9fd4',
  '#7a8fd4',
  '#b87a9a',
  '#8b9aab',
  '#a67c6d',
];

export function sectionColor(key: string, fallbackIndex = 0) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SECTION_PALETTE[h % SECTION_PALETTE.length] ?? SECTION_PALETTE[fallbackIndex % SECTION_PALETTE.length];
}

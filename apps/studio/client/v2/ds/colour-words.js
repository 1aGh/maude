// client/v2/ds/colour-words.js — a colour said in words (CONTRACT: a person never reads a raw oklch/hex).
// Pure. Used where a value has no name of its own yet (the conflict pick, 13 · ds-truth-conflict).

const HUES = [
  [15, 'pink'],
  [45, 'red'],
  [70, 'orange'],
  [100, 'yellow'],
  [135, 'lime'],
  [170, 'green'],
  [200, 'teal'],
  [225, 'cyan'],
  [262, 'blue'],
  [295, 'indigo'],
  [320, 'purple'],
  [361, 'pink'],
];

const OKLCH = /^\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/[^)]*)?\)\s*$/i;

/**
 * "Deep blue", "Light grey" for an OKLCH value; null for anything else (the caller draws its own words).
 * @param {unknown} value
 */
export function colourWords(value) {
  const m = OKLCH.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  const l = Number(m[1]) / (m[2] ? 100 : 1);
  const c = Number(m[3]);
  const h = ((Number(m[4]) % 360) + 360) % 360;
  if (![l, c, h].every(Number.isFinite)) return null;
  const tone =
    l > 0.93 ? 'Very light' : l > 0.8 ? 'Light' : l > 0.55 ? 'Bright' : l > 0.38 ? 'Deep' : 'Dark';
  if (c < 0.03)
    return l > 0.97 ? 'White' : l < 0.18 ? 'Black' : `${tone === 'Bright' ? 'Mid' : tone} grey`;
  return `${tone} ${(HUES.find(([to]) => h < to) ?? HUES[0])[1]}`;
}

const PLAIN_COLOUR =
  /^(?:#[0-9a-f]{3,8}|(?:oklch|oklab|rgba?|hsla?|lab|lch|color|color-mix)\([^;{}]*\))$/i;

/** What a side calls its value: the person's name for it, else the colour in words, else the plain value. */
export function valueWords(name, value) {
  if (typeof name === 'string' && name) return name;
  if (typeof value !== 'string' || !value) return '—';
  if (PLAIN_COLOUR.test(value.trim())) return colourWords(value) ?? 'This colour';
  return value;
}

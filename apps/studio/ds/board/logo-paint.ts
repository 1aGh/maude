// Brand logo row (board 13): a logo file is drawn through <img> so it can run nothing — and an <img>
// SVG cannot read the page's custom properties, so `var(--accent)` / `currentColor` in a lockup came
// out unpainted (an empty tile, or a black wordmark on a dark ground). The colours are written into
// the file's text here, from the system's own values for the mode the board shows, then handed back
// as the same kind of data URI. PURE (no DOM beyond atob / btoa): bundled into the canvas.

import { type BoardMode, type BoardModel, safeCssValue, themeFor } from './types.ts';

const PLAIN_COLOUR = /^[#\w(),.%\s/+-]+$/;

/** A token's value for a theme, following `var(--other)` references (and their fallbacks). */
export function resolveColour(
  model: BoardModel,
  theme: string,
  css: string,
  depth = 0
): string | null {
  if (depth > 6) return null;
  const tok = model.tokens.find((t) => t.css === css);
  const raw = tok?.values[theme]?.trim();
  if (!raw) return null;
  return settle(model, theme, raw, depth);
}

function settle(model: BoardModel, theme: string, raw: string, depth: number): string | null {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(raw);
  if (!m) return safeCssValue(raw) && PLAIN_COLOUR.test(raw) ? raw : null;
  return (
    resolveColour(model, theme, m[1], depth + 1) ??
    (m[2] ? settle(model, theme, m[2].trim(), depth + 1) : null)
  );
}

export interface LogoPaint {
  /** `currentColor` and any custom property the system does not define */
  ink: string;
  theme: string;
}

const decode = (src: string): string | null => {
  const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(src);
  if (!m) return null;
  try {
    return decodeURIComponent(escape(atob(m[1])));
  } catch {
    return null;
  }
};
const encode = (svg: string): string =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

/** The file with its colours written in: `var(--x[, fallback])` from the system, `currentColor` as `ink`. */
export function paintLogo(model: BoardModel, src: string, paint: LogoPaint): string {
  const svg = decode(src);
  if (svg === null) return src;
  const out = svg
    .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_all, name: string, fb?: string) => {
      const v = resolveColour(model, paint.theme, name);
      if (v) return v;
      if (fb && PLAIN_COLOUR.test(fb.trim())) return fb.trim();
      return paint.ink;
    })
    .replace(/currentColor/gi, paint.ink);
  return encode(out);
}

/** A wide file (wordmark / lockup) is the one the board also shows on the opposite ground. */
export function isLockup(file: string, src: string | null): boolean {
  if (/wordmark|lockup/i.test(file)) return true;
  const svg = src ? decode(src) : null;
  const vb = svg
    ? /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg)
    : null;
  return vb ? Number(vb[1]) / Number(vb[2]) >= 2 : false;
}

export interface LogoTileModel {
  key: string;
  file: string;
  /** the opposite ground: the lockup in the page's colour on the ink ground */
  onInk: boolean;
  wide: boolean;
  /** `null` when the file is not a drawable SVG */
  src: string | null;
  /** the ink tile's ground colour (literal, so the picture and its ground always agree) */
  ground: string | null;
}

const FALLBACK = { light: ['#111111', '#ffffff'], dark: ['#ffffff', '#111111'] } as const;

/** Board 13's logo row: the lockup on the page, the lockup on the ink ground, then the marks. */
export function logoTiles(model: BoardModel, mode: BoardMode): LogoTileModel[] {
  const theme = themeFor(model, mode);
  const [fbInk, fbPage] = FALLBACK[mode];
  const ink = resolveColour(model, theme, '--fg-0') ?? fbInk;
  const page = resolveColour(model, theme, '--bg-0') ?? fbPage;
  const spark = resolveColour(model, theme, '--spark') ?? ink;
  const tile = (l: BoardModel['logos'][number], onInk: boolean, wide: boolean): LogoTileModel => {
    const colour = onInk ? page : /spark/i.test(l.file) ? spark : ink;
    return {
      key: `${l.file}${onInk ? ':ink' : ''}`,
      file: l.file,
      onInk,
      wide,
      src: l.src ? paintLogo(model, l.src, { ink: colour, theme }) : null,
      ground: onInk ? ink : null,
    };
  };
  const lockups = model.logos.filter((l) => isLockup(l.file, l.src));
  const first = lockups[0];
  const out: LogoTileModel[] = [];
  if (first) {
    out.push(tile(first, false, true), tile(first, true, true));
    for (const l of lockups.slice(1)) out.push(tile(l, false, true));
  }
  for (const l of model.logos) if (!lockups.includes(l)) out.push(tile(l, false, false));
  return out;
}

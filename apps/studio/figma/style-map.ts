/**
 * @file       figma/style-map.ts — Figma paint/effect/typeStyle → CSS.
 * @scope      apps/studio/figma/style-map.ts
 * @purpose    Turn a node's visual properties into CSS declarations, resolving
 *             every colour to the NEAREST active-DS token rather than baking a
 *             hex into an imported canvas.
 *
 * @invariant  IMPORTED FRAMES MUST NOT HARDCODE HEX. A canvas whose colours are
 *             literals is off-brand the moment the DS moves, and it defeats the
 *             point of importing INTO a design system. Every paint resolves to
 *             `var(--token)` inside a configurable ΔE threshold; outside it, the
 *             literal ships WITH a `/* figma: no near token *​/` marker so the
 *             drift is auditable rather than silent. Threshold and fallback are
 *             per-import flags, never hidden constants.
 *
 * @invariant  EVERY EMITTED VALUE IS GRAMMAR-VALIDATED FIRST (DDR-216 D6, which
 *             reuses DDR-172 Decision 4 verbatim): printable-ASCII pre-filter,
 *             no `m`/`s` regex flags, shape AND magnitude bounds, no unbounded
 *             free-text capture. A value that fails is DROPPED and reported —
 *             never "cleaned up" and never partially applied. This matters more
 *             here than in `import-tokens`: a canvas stylesheet is rendered live
 *             in the canvas iframe.
 *
 * @invariant  DEPENDENCY-FREE beyond `draw/palette.ts` (the colorspace helpers
 *             `import-tokens` already reuses) and `codegen-fonts.ts` (the
 *             font-class allowlist, pure string work). No fs, no network.
 */

import { parseColor, rgbToOklch } from '../draw/palette.ts';
import {
  type FontResolution,
  type FontToken,
  isDsFontValue,
  resolveDsFontStack,
} from './codegen-fonts.ts';
import type { FigmaColor, FigmaEffect, FigmaNode, FigmaPaint, FigmaTypeStyle } from './types.ts';

/** Default perceptual distance under which a paint snaps to a DS token. */
export const DEFAULT_TOKEN_THRESHOLD = 0.08;

/** The marker that makes an un-snapped literal auditable rather than silent. */
export const NO_TOKEN_MARKER = '/* figma: no near token */';

export interface DsToken {
  /** e.g. `--accent` — the name only, never a value the caller invented. */
  name: string;
  /** Resolved hex for distance comparison. */
  hex: string;
}

// ── Value grammars (DDR-172 Decision 4, reused verbatim per DDR-216 D6) ─────
//
// Deliberately NO unbounded free-text capture anywhere, and every numeric
// grammar is paired with a magnitude bound: a grammar-valid `99999999px` is a
// live-render hang vector even though its SHAPE is fine.

const PRINTABLE_ASCII_RE = /^[\x20-\x7E]*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_RE = /^rgba?\( ?[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+(?: ?[,/] ?[\d.]+%?)? ?\)$/;
const VAR_RE = /^var\(--[a-z0-9-]{1,64}\)$/;
// A token at partial strength: the ONE function-shaped colour the grammar admits,
// closed to `var(--token)` + a percentage + the keyword `transparent` (#155 §4).
const COLOR_MIX_RE =
  /^color-mix\(in srgb, var\(--[a-z0-9-]{1,64}\) (?:100|[0-9]{1,2}(?:\.[0-9])?)%, transparent\)$/;
// A built gradient: only the characters the builders below can produce.
const GRADIENT_RE = /^(?:linear|radial|conic)-gradient\([A-Za-z0-9 .,%()#-]{1,1800}\)$/;
const DIM_MAX = 4096;
const FONT_SIZE_MAX = 512;

/** True when a string is safe to place in a CSS value position at all. */
function printableAscii(v: string): boolean {
  // Checked BEFORE any grammar regex, and no grammar here uses `m`/`s` — an
  // anchor is only as strong as the flags it runs under, and a multiline value
  // would otherwise match just its first line.
  return PRINTABLE_ASCII_RE.test(v);
}

export function isValidColorValue(v: string): boolean {
  if (!printableAscii(v)) return false;
  return HEX_RE.test(v) || RGBA_RE.test(v) || VAR_RE.test(v) || COLOR_MIX_RE.test(v);
}

/** A gradient this file built (checked again at the end: belt and braces). */
export function isValidGradient(v: string): boolean {
  return printableAscii(v) && GRADIENT_RE.test(v) && !/url\(|expression|;|\{|\}/i.test(v);
}

export function isValidDimension(v: string, max = DIM_MAX): boolean {
  if (!printableAscii(v)) return false;
  if (v === '0') return true;
  const m = /^(-?[\d.]{1,7})(px|rem|em|%)$/.exec(v);
  if (!m) return false;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) && Math.abs(n) <= max;
}

// ── Colour ──────────────────────────────────────────────────────────────────

function figmaColorToHex(c: FigmaColor): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

/** Perceptual distance in OKLCH — the same space `import-tokens` compares in. */
export function perceptualDistance(aHex: string, bHex: string): number {
  try {
    const a = rgbToOklch(parseColor(aHex));
    const b = rgbToOklch(parseColor(bHex));
    // Chroma/hue folded into a Cartesian pair so a hue difference at low chroma
    // (where hue is perceptually meaningless) doesn't dominate the distance.
    const aa = a.c * Math.cos((a.h * Math.PI) / 180);
    const ab = a.c * Math.sin((a.h * Math.PI) / 180);
    const ba = b.c * Math.cos((b.h * Math.PI) / 180);
    const bb = b.c * Math.sin((b.h * Math.PI) / 180);
    return Math.hypot(a.l - b.l, aa - ba, ab - bb);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface ResolvedColor {
  /** The CSS value to emit — `var(--token)` or a literal hex. */
  value: string;
  /** Set when no token was near enough; the caller emits it as a comment. */
  marker?: string;
  /** Which token matched, for the report. */
  token?: string;
}

/**
 * Resolve a hex to the nearest DS token, or fall back to the literal WITH a
 * marker. Never invents a token name and never silently ships a hex.
 */
export function resolveColor(
  hex: string,
  tokens: readonly DsToken[],
  threshold = DEFAULT_TOKEN_THRESHOLD
): ResolvedColor {
  let best: DsToken | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of tokens) {
    const d = perceptualDistance(hex, t.hex);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (best && bestDist <= threshold) {
    return { value: `var(${best.name})`, token: best.name };
  }
  return { value: hex, marker: NO_TOKEN_MARKER };
}

// ── Paints / effects / type ─────────────────────────────────────────────────

export interface StyleMapOptions {
  tokens: readonly DsToken[];
  threshold?: number;
  /** The DS's `--font*` tokens, so a TEXT node's family lands on the project's own stack (D8). */
  fontTokens?: readonly FontToken[];
}

export interface MappedStyle {
  /** CSS property → value. Every value has already passed its grammar. */
  declarations: Record<string, string>;
  /** Properties dropped because a value failed its grammar (reported). */
  rejected: string[];
  /** Properties that shipped a literal because no token was near (reported). */
  unTokenized: string[];
  /** Constructs CSS has no exact equivalent for, drawn by the nearest one (reported). */
  approximated: string[];
  /** How a TEXT node's font family was resolved (carried so the caller can report it once per family). */
  font?: FontResolution;
}

function emptyStyle(): MappedStyle {
  return { declarations: {}, rejected: [], unTokenized: [], approximated: [] };
}

function firstVisible<T extends { visible: boolean }>(list: readonly T[] | undefined): T | null {
  for (const p of list ?? []) if (p.visible) return p;
  return null;
}

/** Alpha as the shortest decimal CSS accepts (`0.1`, not `0.100000001`). */
function alphaText(a: number): string {
  return String(Number(a.toFixed(3)));
}

/**
 * A colour at an alpha: the token (mixed down to the alpha) when one is near,
 * else a literal. `mark` controls whether an un-snapped literal is flagged —
 * fills are audited, shadows never were and stay quiet.
 */
function colorAt(
  c: FigmaColor,
  alpha: number,
  opts: StyleMapOptions,
  out: MappedStyle,
  prop: string,
  mark: boolean
): string | null {
  const hex = figmaColorToHex(c);
  const resolved = resolveColor(hex, opts.tokens, opts.threshold);
  if (mark && resolved.marker) out.unTokenized.push(prop);
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 0.9995) return isValidColorValue(resolved.value) ? resolved.value : null;
  let value: string;
  if (resolved.token) {
    value = `color-mix(in srgb, ${resolved.value} ${Number((a * 100).toFixed(1))}%, transparent)`;
  } else {
    const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    value = `rgba(${to(c.r)}, ${to(c.g)}, ${to(c.b)}, ${alphaText(a)})`;
  }
  return isValidColorValue(value) ? value : null;
}

/** The paint's own alpha: colour alpha × paint opacity. */
function paintAlpha(paint: FigmaPaint): number {
  return (paint.color?.a ?? 1) * (paint.opacity ?? 1);
}

const pct = (v: number) => `${Number(v.toFixed(1))}%`;

/**
 * A gradient paint → the CSS equivalent.
 *
 * LINEAR is placed exactly: the handles are projected onto CSS's gradient line
 * (whose length depends on the angle and the box), so the stop positions move
 * rather than the angle drifting. RADIAL takes centre and radii from the
 * handles; ANGULAR becomes `conic-gradient` starting where the first handle
 * points. DIAMOND has no CSS form and is drawn as the radial one (reported).
 * Rotation of a skewed radial is not carried.
 */
function gradientCss(
  paint: FigmaPaint,
  box: { width: number; height: number } | undefined,
  opts: StyleMapOptions,
  out: MappedStyle
): string | null {
  const stops = paint.gradientStops;
  if (!stops || stops.length < 2) return null;
  const handles = paint.gradientHandlePositions;
  const W = box && box.width > 0 ? box.width : 0;
  const H = box && box.height > 0 ? box.height : 0;
  const sized = W > 0 && H > 0;
  const kind = paint.type;
  const opacity = paint.opacity ?? 1;

  const colorStops = (project: (position: number) => number): string | null => {
    const parts: string[] = [];
    for (const s of stops) {
      const value = colorAt(s.color, s.color.a * opacity, opts, out, 'background-image', true);
      if (value === null) return null;
      const at = Math.max(-500, Math.min(500, project(Math.max(0, Math.min(1, s.position)))));
      parts.push(`${value} ${pct(at * 100)}`);
    }
    return parts.join(', ');
  };

  let css: string | null = null;
  if (kind === 'GRADIENT_LINEAR') {
    let angle = 180;
    let project = (t: number) => t;
    if (handles && handles.length >= 2) {
      const dx = (handles[1].x - handles[0].x) * (sized ? W : 1);
      const dy = (handles[1].y - handles[0].y) * (sized ? H : 1);
      const rad = Math.atan2(dy, dx) + Math.PI / 2;
      angle = Math.round((rad * 180) / Math.PI);
      if (sized) {
        // CSS's gradient line: length |W sinθ| + |H cosθ|, through the box centre.
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        const len = Math.abs(W * sin) + Math.abs(H * cos);
        if (len > 1e-6) {
          const along = (hx: number, hy: number) =>
            ((hx * W - W / 2) * sin + (hy * H - H / 2) * -cos) / len + 0.5;
          const t0 = along(handles[0].x, handles[0].y);
          const t1 = along(handles[1].x, handles[1].y);
          project = (t) => t0 + t * (t1 - t0);
        }
      }
    }
    const list = colorStops(project);
    if (list) css = `linear-gradient(${((angle % 360) + 360) % 360}deg, ${list})`;
  } else if (kind === 'GRADIENT_RADIAL' || kind === 'GRADIENT_DIAMOND') {
    if (kind === 'GRADIENT_DIAMOND') out.approximated.push('diamond gradient');
    const list = colorStops((t) => t);
    if (list) {
      let shape = 'ellipse closest-side at 50% 50%';
      if (handles && handles.length >= 2 && sized) {
        const rx = Math.hypot((handles[1].x - handles[0].x) * W, (handles[1].y - handles[0].y) * H);
        const third = handles[2] ?? { x: handles[0].x, y: handles[0].y + 0.5 };
        const ry = Math.hypot((third.x - handles[0].x) * W, (third.y - handles[0].y) * H);
        if (rx >= 1 && ry >= 1 && rx <= 8192 && ry <= 8192) {
          shape = `${Math.round(rx)}px ${Math.round(ry)}px at ${pct(handles[0].x * 100)} ${pct(handles[0].y * 100)}`;
        }
      }
      css = `radial-gradient(${shape}, ${list})`;
    }
  } else if (kind === 'GRADIENT_ANGULAR') {
    const list = colorStops((t) => t);
    if (list) {
      let from = 90;
      let at = '50% 50%';
      if (handles && handles.length >= 2) {
        const dx = (handles[1].x - handles[0].x) * (sized ? W : 1);
        const dy = (handles[1].y - handles[0].y) * (sized ? H : 1);
        from = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
        from = ((from % 360) + 360) % 360;
        at = `${pct(handles[0].x * 100)} ${pct(handles[0].y * 100)}`;
      }
      css = `conic-gradient(from ${from}deg at ${at}, ${list})`;
    }
  }
  return css !== null && isValidGradient(css) ? css : null;
}

/** Effects → `box-shadow`. Every layer is strict-numeric; no free-text capture. */
function shadowCss(
  effects: readonly FigmaEffect[],
  opts: StyleMapOptions,
  out: MappedStyle
): string | null {
  const layers: string[] = [];
  for (const e of effects) {
    if (!e.visible) continue;
    if (e.type !== 'DROP_SHADOW' && e.type !== 'INNER_SHADOW') continue;
    const c = e.color ?? { r: 0, g: 0, b: 0, a: 1 };
    const colour = colorAt(c, c.a, opts, out, 'box-shadow', false);
    if (colour === null) continue;
    const x = Math.round(e.offset?.x ?? 0);
    const y = Math.round(e.offset?.y ?? 0);
    const blur = Math.round(e.radius ?? 0);
    const spread = Math.round(e.spread ?? 0);
    if ([x, y, blur, spread].some((n) => !Number.isFinite(n) || Math.abs(n) > 512)) continue;
    const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
    layers.push(`${inset}${x}px ${y}px ${blur}px ${spread}px ${colour}`);
  }
  return layers.length ? layers.join(', ') : null;
}

/**
 * Figma's blur radius is twice CSS's `blur()` sigma (Dev Mode itself emits
 * `blur(5px)` for a blur of 10), so the value is halved.
 */
function blurPx(radius: number | undefined): string | null {
  if (radius === undefined || !Number.isFinite(radius) || radius < 0) return null;
  const v = `${Number((radius / 2).toFixed(1))}px`;
  return isValidDimension(v, 256) ? v : null;
}

/**
 * Figma blend modes → `mix-blend-mode`. A closed table (own-property, null
 * prototype): the mode name is document text, so it is looked up, never copied.
 * `exact` modes have a CSS twin; the rest are drawn by the nearest one.
 */
const BLEND_EXACT: Record<string, string> = Object.assign(Object.create(null), {
  DARKEN: 'darken',
  MULTIPLY: 'multiply',
  COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten',
  SCREEN: 'screen',
  LINEAR_DODGE: 'plus-lighter',
  COLOR_DODGE: 'color-dodge',
  OVERLAY: 'overlay',
  SOFT_LIGHT: 'soft-light',
  HARD_LIGHT: 'hard-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
});
const BLEND_NEAREST: Record<string, string> = Object.assign(Object.create(null), {
  LINEAR_BURN: 'color-burn',
});

/** A node's fills/strokes/effects/corner radius → CSS declarations. */
export function mapNodeStyle(node: FigmaNode, opts: StyleMapOptions): MappedStyle {
  const out = emptyStyle();
  const set = (prop: string, value: string, validator: (v: string) => boolean) => {
    if (!validator(value)) {
      out.rejected.push(prop);
      return;
    }
    out.declarations[prop] = value;
  };

  // Figma lists fills bottom → top. IMAGE fills are pictures, handled by the
  // emitter before it ever asks for a colour.
  const paints = (node.fills ?? []).filter((p) => p.visible && p.type !== 'IMAGE');
  if (node.type === 'TEXT') {
    // A TEXT node's fill is its FOREGROUND — one colour, the topmost solid.
    for (let i = paints.length - 1; i >= 0; i--) {
      const p = paints[i];
      if (p.type !== 'SOLID' || !p.color) continue;
      const value = colorAt(p.color, paintAlpha(p), opts, out, 'background', true);
      if (value === null) out.rejected.push('background');
      else out.declarations.background = value;
      break;
    }
  } else if (paints.length > 0) {
    // CSS lists background layers top → bottom.
    const layers: Array<{ solid: boolean; css: string }> = [];
    let blended = false;
    for (let i = paints.length - 1; i >= 0; i--) {
      const p = paints[i];
      if (p.blendMode && p.blendMode !== 'NORMAL' && p.blendMode !== 'PASS_THROUGH') blended = true;
      if (p.type === 'SOLID' && p.color) {
        const alpha = paintAlpha(p);
        if (alpha <= 0.003) continue; // fully transparent: paints nothing
        const value = colorAt(p.color, alpha, opts, out, 'background', true);
        if (value === null) out.rejected.push('background');
        else layers.push({ solid: true, css: value });
      } else if (p.type.startsWith('GRADIENT')) {
        const css = gradientCss(p, node.absoluteBoundingBox, opts, out);
        if (css) layers.push({ solid: false, css });
        else out.rejected.push('background-image');
      }
    }
    if (blended) out.approximated.push('fill blend mode');
    if (layers.length === 1 && layers[0].solid) {
      out.declarations.background = layers[0].css;
    } else if (layers.length > 0) {
      // The bottom solid becomes the background COLOUR; every other solid is a
      // one-colour gradient layer, since `background-color` has only one slot.
      // camelCase, NOT `background-image`: these declarations are emitted into a
      // JSX style OBJECT, where a hyphenated key is a syntax error that takes
      // the whole canvas down. One gradient anywhere on a page was enough to
      // make the file unparseable.
      const bottom = layers[layers.length - 1];
      const images = bottom.solid ? layers.slice(0, -1) : layers;
      if (bottom.solid) out.declarations.backgroundColor = bottom.css;
      if (images.length > 0) {
        out.declarations.backgroundImage = images
          .map((l) => (l.solid ? `linear-gradient(${l.css}, ${l.css})` : l.css))
          .join(', ');
      }
    }
  }

  const stroke = firstVisible(node.strokes);
  if (stroke?.type === 'SOLID' && stroke.color) {
    const colour = colorAt(stroke.color, paintAlpha(stroke), opts, out, 'border-color', true);
    const w = Math.round(node.strokeWeight ?? 1);
    if (Number.isFinite(w) && w > 0 && w <= 64 && colour !== null) {
      out.declarations.border = `${w}px solid ${colour}`;
    } else {
      out.rejected.push('border');
    }
  }

  if (node.cornerRadius !== undefined) {
    set('borderRadius', `${Math.round(node.cornerRadius)}px`, (v) => isValidDimension(v, 512));
  }

  if (node.effects?.length) {
    const css = shadowCss(node.effects, opts, out);
    if (css) out.declarations.boxShadow = css;
    const layerBlur = node.effects.find(
      (e) => e.visible && (e.type === 'LAYER_BLUR' || e.type === 'FOREGROUND_BLUR')
    );
    if (layerBlur) {
      const px = blurPx(layerBlur.radius);
      if (px) out.declarations.filter = `blur(${px})`;
      else out.rejected.push('filter');
    }
    const backBlur = node.effects.find((e) => e.visible && e.type === 'BACKGROUND_BLUR');
    if (backBlur) {
      const px = blurPx(backBlur.radius);
      if (px) {
        out.declarations.backdropFilter = `blur(${px})`;
        out.declarations.WebkitBackdropFilter = `blur(${px})`;
      } else out.rejected.push('backdrop-filter');
    }
  }

  if (node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') {
    const exact = BLEND_EXACT[node.blendMode];
    const near = exact ? undefined : BLEND_NEAREST[node.blendMode];
    if (exact) out.declarations.mixBlendMode = exact;
    else if (near) {
      out.declarations.mixBlendMode = near;
      out.approximated.push(`blend mode ${node.blendMode}`);
    } else out.rejected.push('mix-blend-mode');
  }

  // Node opacity is carried ONLY when it is not a hiding mechanism. D6b makes
  // the translator guarantee visibility, so an opacity that would render the
  // subtree effectively invisible is dropped rather than reproduced.
  if (node.opacity !== undefined && node.opacity < 1) {
    if (node.opacity >= 0.15) out.declarations.opacity = String(Number(node.opacity.toFixed(3)));
    else out.rejected.push('opacity');
  }

  return out;
}

/** A TEXT node's `style` block → CSS declarations. */
export function mapTypeStyle(
  style: FigmaTypeStyle | undefined,
  opts: StyleMapOptions
): MappedStyle {
  const out = emptyStyle();
  if (!style) return out;

  if (style.fontSize !== undefined) {
    const v = `${Math.round(style.fontSize)}px`;
    if (isValidDimension(v, FONT_SIZE_MAX)) out.declarations.fontSize = v;
    else out.rejected.push('fontSize');
  }
  if (style.fontWeight !== undefined) {
    const w = Math.round(style.fontWeight);
    if (w >= 100 && w <= 1000) out.declarations.fontWeight = String(w);
    else out.rejected.push('fontWeight');
  }
  if (style.lineHeightPx !== undefined) {
    const v = `${Math.round(style.lineHeightPx)}px`;
    if (isValidDimension(v, FONT_SIZE_MAX)) out.declarations.lineHeight = v;
    else out.rejected.push('lineHeight');
  }
  if (style.letterSpacing !== undefined && style.letterSpacing !== 0) {
    const v = `${style.letterSpacing.toFixed(2)}px`;
    if (isValidDimension(v, 64)) out.declarations.letterSpacing = v;
    else out.rejected.push('letterSpacing');
  }
  if (style.textAlignHorizontal) {
    const align = style.textAlignHorizontal.toLowerCase();
    if (['left', 'center', 'right', 'justified'].includes(align)) {
      out.declarations.textAlign = align === 'justified' ? 'justify' : align;
    }
  }
  if (style.textCase === 'UPPER') out.declarations.textTransform = 'uppercase';
  if (style.textCase === 'LOWER') out.declarations.textTransform = 'lowercase';
  if (style.textDecoration === 'UNDERLINE') out.declarations.textDecoration = 'underline';
  if (style.textDecoration === 'STRIKETHROUGH') out.declarations.textDecoration = 'line-through';

  // FONT FAMILY (#155 §3, D8). A Figma font name is free text from the document
  // and the canvas CSP is `font-src 'self'`, so the literal can neither be
  // loaded nor safely written into a stylesheet. It is therefore NEVER carried:
  // the family is classified against a closed allowlist (sans / serif / mono)
  // and mapped onto the project's own DS stack of that class — or onto a fixed
  // system stack when the DS has none. Without this every imported artboard
  // rendered in the browser's serif default.
  if (style.fontFamily) {
    const res = resolveDsFontStack(style.fontFamily, opts.fontTokens ?? []);
    if (isDsFontValue(res.css)) {
      out.declarations.fontFamily = res.css;
      out.font = res;
    } else out.rejected.push('fontFamily');
  }

  return out;
}

/** Auto-layout → flex. The thing that makes the handle surfaces work at all. */
export function mapAutoLayout(node: FigmaNode): Record<string, string> {
  if (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') return {};
  const out: Record<string, string> = {
    display: 'flex',
    flexDirection: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
  };
  if (node.itemSpacing) out.gap = `${Math.round(node.itemSpacing)}px`;
  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  if (pad.some((p) => p !== undefined && p !== 0)) {
    out.padding = pad.map((p) => `${Math.round(p ?? 0)}px`).join(' ');
  }
  // `Object.create(null)`: these are indexed by DOCUMENT-CONTROLLED strings, so a
  // plain literal returns `Object.prototype.constructor` (a FUNCTION) for
  // `primaryAxisAlignItems: "constructor"`, which then stringifies into an
  // emitted style value (review F11). D5 mandates this shape for exactly this.
  const MAIN: Record<string, string> = Object.assign(Object.create(null), {
    MIN: 'flex-start',
    CENTER: 'center',
    MAX: 'flex-end',
    SPACE_BETWEEN: 'space-between',
  });
  const CROSS: Record<string, string> = Object.assign(Object.create(null), {
    MIN: 'flex-start',
    CENTER: 'center',
    MAX: 'flex-end',
    BASELINE: 'baseline',
  });
  if (node.primaryAxisAlignItems && MAIN[node.primaryAxisAlignItems]) {
    out.justifyContent = MAIN[node.primaryAxisAlignItems];
  }
  if (node.counterAxisAlignItems && CROSS[node.counterAxisAlignItems]) {
    out.alignItems = CROSS[node.counterAxisAlignItems];
  }
  if (node.layoutWrap === 'WRAP') out.flexWrap = 'wrap';
  return out;
}

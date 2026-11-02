/**
 * @file       annotations/ui/tool-prefs.ts — what the annotation tools remember per person (S4.8, Q8)
 * @scope      apps/studio/annotations/ui/tool-prefs.ts
 * @purpose    The last sticky colour, Marker ink and thickness, Marker tip, and the Highlighter's
 *             colour and width — a person's own, so Tereza's stickies stay sky while yours stay yellow.
 *             One pure module (no React, no DOM) shared by every place that reads or writes them:
 *             the canvas's tool state (tool-state.ts), the shell's store (client/v2/shell/
 *             annotation-prefs-store.js) and `/_api/ui-prefs` (ui-prefs.ts, key `annotationPrefs`).
 *             Each field is a MEMBER of its palette, so a hostile canvas cannot park a CSS value
 *             in the prefs file.
 *
 *             The key is `annotationPrefs`, not `annotations`: prefs.json already has a boolean
 *             `annotations` (the v1 show/hide switch) and a rename would break a 1.x peer.
 *
 *             Which five colours sit up front and which sit behind "+N" is canvas 15's
 *             (an-sticky: yellow · coral · green · sky · lilac, +5; an-marker: Ink · red · amber ·
 *             green · blue, +4), mapped onto the palettes the model has shipped since Phase 21.
 */

import {
  DEFAULT_COLOR,
  DEFAULT_HIGHLIGHTER_COLOR,
  DEFAULT_HIGHLIGHTER_WIDTH,
  DEFAULT_STICKY_COLOR,
  HIGHLIGHTER_PALETTE,
  HIGHLIGHTER_WIDTHS,
  STICKY_PALETTE,
  STROKE_PALETTE,
  STROKE_WIDTH_THICK,
  STROKE_WIDTH_THIN,
  type Thickness,
} from '../../annotations-model.ts';

export type MarkerTip = 'pen' | 'highlighter' | 'eraser';
export const MARKER_TIP_IDS: readonly MarkerTip[] = ['pen', 'highlighter', 'eraser'];

export interface AnnotationPrefs {
  stickyColor?: string;
  /** The ink's palette hex. The default ink (slot 8) renders themed, see `resolveInk`. */
  ink?: string;
  thickness?: Thickness;
  tip?: MarkerTip;
  highlighterColor?: string;
  highlighterWidth?: number;
}

/** A sticker the person placed lately: the gallery's `pack` slug and the catalogue `id`. */
export interface RecentSticker {
  pack: string;
  id: string;
}
/** How many Recent keeps (canvas 15 an-stk-search: "the last stickers you placed"). */
export const RECENT_STICKERS_MAX = 12;
/** Pack slugs are words; a sticker's id here is its FILE name (`group-46.png`) - the gallery resolves Recent by it. */
const PACK_WORD = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * S4.13 (Q8): what the SHELL remembers per person on top of the canvas's tool memory — the Recent stickers.
 * The canvas never reads or writes it (its `annotation-prefs` parse drops it), so it is not in
 * `ANNOTATION_PREF_KEYS`; prefs.json `annotationPrefs` and the local mirror carry it.
 */
export interface ShellAnnotationPrefs extends AnnotationPrefs {
  recentStickers?: RecentSticker[];
}
export const SHELL_PREF_KEYS = ['recentStickers'] as const;

/** A list of `{pack, id}` words, newest first, de-duplicated and capped; undefined when it is not a list. */
export function sanitizeRecents(v: unknown): RecentSticker[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: RecentSticker[] = [];
  for (const r of v) {
    const o = r as { pack?: unknown; id?: unknown } | null;
    if (!o || typeof o.pack !== 'string' || typeof o.id !== 'string') continue;
    if (!PACK_WORD.test(o.pack) || !FILE_WORD.test(o.id)) continue;
    if (out.some((x) => x.pack === o.pack && x.id === o.id)) continue;
    out.push({ pack: o.pack, id: o.id });
    if (out.length >= RECENT_STICKERS_MAX) break;
  }
  return out;
}

export const ANNOTATION_PREF_KEYS = [
  'stickyColor',
  'ink',
  'thickness',
  'tip',
  'highlighterColor',
  'highlighterWidth',
] as const satisfies readonly (keyof AnnotationPrefs)[];

export interface Swatch {
  readonly hex: string;
  /** The word the swatch is announced and titled with (canvas 15's names). */
  readonly name: string;
}
const sw = (hex: string, name: string): Swatch => Object.freeze({ hex, name });

const P = STICKY_PALETTE;
/** Sticky papers up front (an-sticky), then "+5". */
export const STICKY_FRONT: readonly Swatch[] = Object.freeze([
  sw(P[0], 'Yellow'),
  sw(P[3], 'Coral'),
  sw(P[5], 'Green'),
  sw(P[7], 'Sky'),
  sw(P[8], 'Lilac'),
]);
export const STICKY_MORE: readonly Swatch[] = Object.freeze([
  sw(P[1], 'White'),
  sw(P[2], 'Grey'),
  sw(P[4], 'Peach'),
  sw(P[6], 'Aqua'),
  sw(P[9], 'Pink'),
]);

const S = STROKE_PALETTE;
/** Marker inks up front (an-marker; black first, CONTRACT C14), then "+4". */
export const INK_FRONT: readonly Swatch[] = Object.freeze([
  sw(S[8], 'Ink'),
  sw(S[0], 'Red'),
  sw(S[2], 'Amber'),
  sw(S[3], 'Green'),
  sw(S[4], 'Blue'),
]);
export const INK_MORE: readonly Swatch[] = Object.freeze([
  sw(S[1], 'Orange'),
  sw(S[5], 'Purple'),
  sw(S[6], 'Pink'),
  sw(S[7], 'Grey'),
]);

const H = HIGHLIGHTER_PALETTE;
/** The Highlighter's four hues (an-today cell 7). */
export const HIGHLIGHTER_SWATCHES: readonly Swatch[] = Object.freeze([
  sw(H[0], 'Yellow'),
  sw(H[1], 'Green'),
  sw(H[2], 'Pink'),
  sw(H[3], 'Blue'),
]);
export const HIGHLIGHTER_WIDTH_NAMES: Readonly<Record<number, string>> = Object.freeze({
  [HIGHLIGHTER_WIDTHS[0]]: 'Thin',
  [HIGHLIGHTER_WIDTHS[1]]: 'Medium',
  [HIGHLIGHTER_WIDTHS[2]]: 'Thick',
});

export const DEFAULT_ANNOTATION_PREFS: Readonly<Required<AnnotationPrefs>> = Object.freeze({
  stickyColor: DEFAULT_STICKY_COLOR,
  ink: DEFAULT_COLOR,
  thickness: STROKE_WIDTH_THIN,
  tip: 'pen' as MarkerTip,
  highlighterColor: DEFAULT_HIGHLIGHTER_COLOR,
  highlighterWidth: DEFAULT_HIGHLIGHTER_WIDTH,
});

const member = (list: readonly string[], v: unknown): v is string =>
  typeof v === 'string' && list.includes(v);

/** One field, or `undefined` when it is not a member of its palette. */
export function sanitizeField<K extends keyof AnnotationPrefs>(
  key: K,
  v: unknown
): AnnotationPrefs[K] | undefined {
  switch (key) {
    case 'stickyColor':
      return (member(STICKY_PALETTE, v) ? v : undefined) as AnnotationPrefs[K] | undefined;
    case 'ink':
      return (member(STROKE_PALETTE, v) ? v : undefined) as AnnotationPrefs[K] | undefined;
    case 'thickness':
      return (v === STROKE_WIDTH_THIN || v === STROKE_WIDTH_THICK ? v : undefined) as
        | AnnotationPrefs[K]
        | undefined;
    case 'tip':
      return (member(MARKER_TIP_IDS, v) ? v : undefined) as AnnotationPrefs[K] | undefined;
    case 'highlighterColor':
      return (member(HIGHLIGHTER_PALETTE, v) ? v : undefined) as AnnotationPrefs[K] | undefined;
    case 'highlighterWidth':
      return (
        typeof v === 'number' && (HIGHLIGHTER_WIDTHS as readonly number[]).includes(v)
          ? v
          : undefined
      ) as AnnotationPrefs[K] | undefined;
    default:
      return undefined;
  }
}

/** Keep only the fields that are members of their palette; anything else is dropped, never coerced. */
export function sanitizeAnnotationPrefs(raw: unknown): AnnotationPrefs {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of ANNOTATION_PREF_KEYS) {
    const v = sanitizeField(k, Object.hasOwn(o, k) ? o[k] : undefined);
    if (v !== undefined) out[k] = v;
  }
  return out as AnnotationPrefs;
}

/** The canvas's fields plus the shell's (`recentStickers`); anything else is dropped. */
export function sanitizeShellPrefs(raw: unknown): ShellAnnotationPrefs {
  const out: ShellAnnotationPrefs = sanitizeAnnotationPrefs(raw);
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const recents = Object.hasOwn(o, 'recentStickers')
    ? sanitizeRecents(o.recentStickers)
    : undefined;
  if (recents) out.recentStickers = recents;
  return out;
}

/**
 * The body check for `/_api/ui-prefs`: unlike the sanitiser it REJECTS a bad field (a rejected patch
 * resets nothing), and an unknown key is an error too.
 */
export function checkAnnotationPrefsPatch(
  v: unknown
): { ok: true; value: ShellAnnotationPrefs } | { ok: false; error: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    return { ok: false, error: 'annotationPrefs must be an object' };
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (k === 'recentStickers') {
      const recents = sanitizeRecents(o[k]);
      if (!recents) return { ok: false, error: 'annotationPrefs.recentStickers is not a list' };
      out[k] = recents;
      continue;
    }
    if (!(ANNOTATION_PREF_KEYS as readonly string[]).includes(k))
      return { ok: false, error: 'annotationPrefs has an unknown key' };
    const clean = sanitizeField(k as keyof AnnotationPrefs, o[k]);
    if (clean === undefined)
      return { ok: false, error: `annotationPrefs.${k} is not a valid value` };
    out[k] = clean;
  }
  return { ok: true, value: out as ShellAnnotationPrefs };
}

/** The ink a stroke is drawn with: the default ink follows the canvas theme (`resolveDefaultInk`). */
export function resolveInk(ink: string, themed: string): string {
  return ink === DEFAULT_COLOR ? themed : ink;
}

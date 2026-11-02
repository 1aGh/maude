// apps/studio/kinds/presets.ts — S7.20: the ONE preset catalogue (08 Artboard Kinds `ak-picker`, `ak-picker-full`).
//
// What the F size picker lists, what the `artboard.insert-preset` edit-op writes, what the Edit › Advanced ▸ New
// artboard rows and the inspector's Size select offer, and what the picker's search finds — all read this table
// (test/presets-catalogue.test.ts holds the v1 menu rows to it). Pure data + pure functions: no DOM, no disk, so the
// shell picker, the canvas ghost, the server op and a test import the same bytes.
//
// The picker groups by WHAT YOU ARE MAKING — App · Web page · Social · Print · Video — but the product has four
// kinds. App and Social both make `digital`, whose one designer word is "Fixed size" (badge, legend, filter chip,
// inspector chip). Never "Screen".
//
//   digital  `<DCArtboard kind="digital" fixed width height>`              exact px, place things anywhere
//   web      `<DCArtboard kind="web" width height>`                         hug: the height is a FLOOR and grows
//   print    `<DCArtboard kind="print" print={{ paper, … }} width height>`  px = trim + 2 × bleed (print/units.ts)
//   video    `<DCArtboard kind="video" width height>` + a `<VideoComp>`     has a length; selecting it brings the timeline
//
// Custom print (Q7): `print={{ paper: "<nearest-larger preset>", orientation, sizeMm: [w, h], bleedMm }}` — see
// kinds/print-custom.ts. The Custom size… tile is a catalogue entry (`print-custom`) with no fixed size of its own.
//
// decision:maude/v2-S7.20-one-preset-catalogue

import {
  DEFAULT_SAFE_MARGIN_MM,
  defaultBleedMm,
  getPaperPreset,
  type Orientation,
  resolvePrintArtboard,
  trimSizeMm,
} from '../print/units.ts';
import {
  customPrintProp,
  MAX_CUSTOM_MM,
  MIN_CUSTOM_MM,
  resolveCustomPrintArtboard,
  type SizeMm,
} from './print-custom.ts';

export type ArtboardKind = 'digital' | 'web' | 'print' | 'video';
export type PresetGroupId = 'app' | 'web' | 'social' | 'print' | 'video';

/** The one designer word per kind (08: `digital` = "Fixed size" everywhere). */
export const KIND_WORD: Readonly<Record<ArtboardKind, string>> = {
  digital: 'Fixed size',
  web: 'Web page',
  print: 'Print',
  video: 'Video',
};

export const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface Preset {
  /** Stable id: what `artboard.insert-preset` takes and `prefs.json` remembers. */
  id: string;
  group: PresetGroupId;
  kind: ArtboardKind;
  /** The tile's name ("FB event cover"). */
  name: string;
  /** The artboard label it lands with ("Story 9:16"). */
  label: string;
  /** The tile's second line: "1920 × 1005", "148 × 210 mm", "1440 wide". */
  sizeText: string;
  /** The artboard's width / height in px (print: trim + bleed; web: the hug floor). */
  widthPx: number;
  heightPx: number;
  /** Shown before "All N" is opened. */
  top: boolean;
  /** Extra words the search finds it by. */
  aliases: readonly string[];
  /** print: the `print` prop the artboard carries. */
  print?: { paper: string; orientation: Orientation };
  /** video: frames per second of the comp it lands with. */
  fps?: number;
}

export interface PresetGroup {
  id: PresetGroupId;
  kind: ArtboardKind;
  title: string;
  icon: string;
  badge: string;
  presets: readonly Preset[];
}

// ── the table ────────────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  name: string;
  label?: string;
  size: readonly [number, number];
  top?: boolean;
  aliases?: readonly string[];
  sizeText?: string;
};

const px = (g: PresetGroupId, kind: ArtboardKind, r: Row): Preset => ({
  id: r.id,
  group: g,
  kind,
  name: r.name,
  label: r.label ?? r.name,
  sizeText: r.sizeText ?? `${r.size[0]} × ${r.size[1]}`,
  widthPx: r.size[0],
  heightPx: r.size[1],
  top: !!r.top,
  aliases: r.aliases ?? [],
});

const APP: Row[] = [
  { id: 'app-desktop', name: 'Desktop', size: [1440, 1024], top: true },
  { id: 'app-laptop', name: 'Laptop', size: [1280, 800], top: true },
  { id: 'app-mobile', name: 'Mobile', size: [390, 844], top: true, aliases: ['phone', 'iphone'] },
  { id: 'app-tablet', name: 'Tablet', size: [834, 1194], aliases: ['ipad'] },
];

/** A web page is a width; the height is the floor it grows from (a viewport of that device). */
const WEB: Row[] = [
  {
    id: 'web-desktop',
    name: 'Desktop',
    label: 'Web desktop',
    size: [1440, 900],
    sizeText: '1440 wide',
    top: true,
  },
  {
    id: 'web-tablet',
    name: 'Tablet',
    label: 'Web tablet',
    size: [834, 1024],
    sizeText: '834 wide',
    top: true,
  },
  {
    id: 'web-mobile',
    name: 'Mobile',
    label: 'Web mobile',
    size: [390, 844],
    sizeText: '390 wide',
    top: true,
    aliases: ['phone'],
  },
  {
    id: 'web-laptop',
    name: 'Laptop',
    label: 'Web laptop',
    size: [1280, 800],
    sizeText: '1280 wide',
  },
];

const SOCIAL: Row[] = [
  {
    id: 'social-post-4-5',
    name: 'Post 4:5',
    size: [1080, 1350],
    top: true,
    aliases: ['instagram', 'ig', 'portrait post'],
  },
  {
    id: 'social-story',
    name: 'Story 9:16 (still)',
    label: 'Story 9:16',
    size: [1080, 1920],
    top: true,
    aliases: ['story', 'stories', 'instagram story', 'vertical'],
  },
  {
    id: 'social-fb-event',
    name: 'FB event cover',
    size: [1920, 1005],
    top: true,
    aliases: ['facebook', 'event'],
  },
  { id: 'social-post-1-1', name: 'Post 1:1', size: [1080, 1080], aliases: ['square'] },
  { id: 'social-link-preview', name: 'Link preview', size: [1200, 630], aliases: ['og', 'share'] },
  {
    id: 'social-youtube',
    name: 'YouTube thumbnail',
    size: [1280, 720],
    aliases: ['yt', 'thumbnail'],
  },
];

const VIDEO: Row[] = [
  {
    id: 'video-reels',
    name: 'Reels 9:16 (moving)',
    label: 'Reels 9:16',
    size: [1080, 1920],
    top: true,
    aliases: ['reel', 'story', 'tiktok', 'vertical video'],
  },
  {
    id: 'video-landscape',
    name: 'Landscape 16:9',
    label: 'Landscape 16:9',
    size: [1920, 1080],
    top: true,
    aliases: ['hd', 'full hd', 'youtube'],
  },
  {
    id: 'video-square',
    name: 'Square 1:1',
    label: 'Square 1:1',
    size: [1080, 1080],
    top: true,
    aliases: ['instagram'],
  },
];

/** The paper rows: id, tile name, whether it is up front. A paper's mm / in text comes from print/units.ts. */
const PAPER: ReadonlyArray<{ paper: string; name: string; top?: boolean; aliases?: string[] }> = [
  { paper: 'a4', name: 'A4', top: true },
  { paper: 'a5', name: 'A5', top: true },
  { paper: 'a6', name: 'A6', top: true, aliases: ['flyer', 'postcard'] },
  { paper: 'letter', name: 'Letter', aliases: ['us letter'] },
  { paper: 'a3', name: 'A3', aliases: ['poster'] },
  { paper: 'a2', name: 'A2', aliases: ['poster'] },
  { paper: 'card-eu', name: 'Business card', aliases: ['card', 'visitka'] },
];

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function paperPreset(r: (typeof PAPER)[number]): Preset {
  const p = getPaperPreset(r.paper);
  if (!p) throw new Error(`presets: unknown paper "${r.paper}"`);
  const res = resolvePrintArtboard({ paper: r.paper });
  const t = trimSizeMm(p, 'portrait');
  return {
    id: `print-${r.paper === 'card-eu' ? 'business-card' : r.paper}`,
    group: 'print',
    kind: 'print',
    name: r.name,
    label: r.name,
    sizeText:
      p.unit === 'in'
        ? `${fmt(p.width)} × ${fmt(p.height)} in`
        : `${fmt(t.widthMm)} × ${fmt(t.heightMm)} mm`,
    widthPx: res.widthPx,
    heightPx: res.heightPx,
    top: !!r.top,
    aliases: r.aliases ?? [],
    print: { paper: r.paper, orientation: 'portrait' },
  };
}

export const PRESET_GROUPS: readonly PresetGroup[] = [
  {
    id: 'app',
    kind: 'digital',
    title: 'App',
    icon: 'laptop',
    badge: 'Fixed size',
    presets: APP.map((r) => px('app', 'digital', r)),
  },
  {
    id: 'web',
    kind: 'web',
    title: 'Web page',
    icon: 'web',
    badge: 'Grows as you add',
    presets: WEB.map((r) => px('web', 'web', r)),
  },
  {
    id: 'social',
    kind: 'digital',
    title: 'Social',
    icon: 'image',
    badge: 'Fixed size',
    presets: SOCIAL.map((r) => px('social', 'digital', r)),
  },
  {
    id: 'print',
    kind: 'print',
    title: 'Print',
    icon: 'print',
    badge: 'mm, with bleed',
    presets: PAPER.map(paperPreset),
  },
  {
    id: 'video',
    kind: 'video',
    title: 'Video',
    icon: 'video',
    badge: 'Has a timeline',
    presets: VIDEO.map((r) => ({ ...px('video', 'video', r), fps: 30 })),
  },
];

/** Every preset, group order then row order. */
export const PRESETS: readonly Preset[] = PRESET_GROUPS.flatMap((g) => g.presets);

/** The "Custom size…" tile (Print, behind "All 7"): not a size, a door to the mm fields. */
export const CUSTOM_PRINT_ID = 'print-custom';
export const CUSTOM_PRINT_TILE = Object.freeze({
  id: CUSTOM_PRINT_ID,
  group: 'print' as const,
  kind: 'print' as const,
  name: 'Custom size…',
  sizeText: 'mm, any bleed',
});

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
export const presetById = (id: unknown): Preset | null =>
  typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;

export const groupOf = (id: PresetGroupId): PresetGroup =>
  PRESET_GROUPS.find((g) => g.id === id) as PresetGroup;

// ── search ───────────────────────────────────────────────────────────────────────────────────

/** Diacritics off, lower case, one space — "Příběh" finds "pribeh". */
export const fold = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const searchText = (p: Preset): string =>
  fold(
    [p.name, p.label, p.sizeText, groupOf(p.group).title, KIND_WORD[p.kind], ...p.aliases].join(
      ' | '
    )
  );

/**
 * The presets a search finds, best first. Every word of the query must appear (so "a5", "story", "1920" and
 * "social 4:5" all work); a name that starts with the query beats one that contains it, which beats a match on
 * size text or an alias. An empty query finds nothing — the picker shows its groups then.
 */
export function searchPresets(query: unknown): Preset[] {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: Array<{ p: Preset; score: number; i: number }> = [];
  PRESETS.forEach((p, i) => {
    const hay = searchText(p);
    if (!words.every((w) => hay.includes(w))) return;
    const name = fold(p.name);
    const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;
    scored.push({ p, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.map((s) => s.p);
}

// ── Recent (prefs.json `recentSizes`) ────────────────────────────────────────────────────────

export const RECENT_MAX = 3;
/** The Recent chips: ids that still name a preset, newest first, at most RECENT_MAX. Unknown ids are dropped. */
export function recentPresets(ids: unknown): Preset[] {
  if (!Array.isArray(ids)) return [];
  const out: Preset[] = [];
  for (const id of ids) {
    const p = presetById(id);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}
/** The list after `id` was picked: it moves to the front; at most 8 are kept (a few unknown ones may precede). */
export function pushRecent(ids: unknown, id: string): string[] {
  const rest = (Array.isArray(ids) ? ids : []).filter(
    (x): x is string => typeof x === 'string' && x !== id
  );
  return [id, ...rest].slice(0, 8);
}

// ── what a pick writes ───────────────────────────────────────────────────────────────────────

export interface ArtboardSpec {
  kind: ArtboardKind;
  label: string;
  width: number;
  height: number;
  /** digital: the drawn height is the height (the bare `fixed` prop). */
  fixed: boolean;
  /** print: the `print` prop object (JSON-serialisable). */
  print?: Record<string, unknown>;
  /** video: frames per second for the `<VideoComp>` it lands with. */
  fps?: number;
}

/** The numbers a custom print size is made of (mm, trim). */
export interface CustomPrintInput {
  widthMm: number;
  heightMm: number;
  bleedMm?: number;
  /** The safe margin, one value for all four sides; absent or the 5 mm default writes nothing. */
  marginMm?: number;
}

export type SpecResult = { ok: true; spec: ArtboardSpec } | { ok: false; message: string };

/** The artboard a catalogue preset becomes. */
export function specOf(p: Preset): ArtboardSpec {
  return {
    kind: p.kind,
    label: p.label,
    width: p.widthPx,
    height: p.heightPx,
    fixed: p.kind === 'digital',
    ...(p.print ? { print: { paper: p.print.paper, orientation: p.print.orientation } } : {}),
    ...(p.fps ? { fps: p.fps } : {}),
  };
}

/** The artboard a custom print size becomes, or the one line that says why not. */
export function customSpec(input: CustomPrintInput): SpecResult {
  const w = Number(input.widthMm);
  const h = Number(input.heightMm);
  const size: SizeMm = [w, h];
  const inRange = (n: number) => Number.isFinite(n) && n >= MIN_CUSTOM_MM && n <= MAX_CUSTOM_MM;
  if (!inRange(w) || !inRange(h))
    return {
      ok: false,
      message: `A custom size is ${MIN_CUSTOM_MM}–${MAX_CUSTOM_MM} mm a side.`,
    };
  const bleed = input.bleedMm;
  if (bleed !== undefined && !(Number.isFinite(bleed) && bleed >= 0 && bleed <= 20))
    return { ok: false, message: 'Bleed is 0–20 mm.' };
  const margin = input.marginMm;
  if (margin !== undefined && !(Number.isFinite(margin) && margin >= 0 && margin <= 50))
    return { ok: false, message: 'The safe margin is 0–50 mm.' };
  const print = customPrintProp(size, {
    ...(bleed === undefined ? {} : { bleedMm: bleed }),
    ...(margin === undefined || margin === DEFAULT_SAFE_MARGIN_MM
      ? {}
      : { marginsMm: { top: margin, right: margin, bottom: margin, left: margin } }),
  });
  const res = resolveCustomPrintArtboard(print);
  return {
    ok: true,
    spec: {
      kind: 'print',
      label: `${fmt(print.sizeMm[0])} × ${fmt(print.sizeMm[1])} mm`,
      width: res.widthPx,
      height: res.heightPx,
      fixed: false,
      print: { ...print },
    },
  };
}

/** The mm text a print preset shows in the custom fields' defaults (the paper's own trim). */
export function defaultBleedFor(p: Preset): number {
  const paper = p.print ? getPaperPreset(p.print.paper) : null;
  return paper ? defaultBleedMm(paper) : 0;
}

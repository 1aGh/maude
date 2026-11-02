// apps/studio/kinds/safe-zones.ts — S7.22: safe zones (08 ak-safe-zones).
//
// decision:maude/v2-S7-safe-zones-prop — the preset is the JSX prop `safeZones="instagram-reels"` on
// `<DCArtboard>` (design intent, DDR-181); "Show on canvas" is the person's own view state in
// `_canvas-state/<slug>.view.json` `overlays.safeZones` (shown unless it says `false`). A bare id is the
// whole prop: a Maude 1.x peer does not know it and draws the artboard without a band (V2-1.12 R1–R3).
//
// A safe zone is where a platform's own interface covers the design: Instagram's profile bar on top, the
// reply bar below. It is drawn on the canvas ONLY (the engine's guides overlay, which every exporter hides
// — `.dc-artboard-guides` in exporters/capture-chrome.ts). The bands are fractions of the artboard, never
// pixels of one size, so a 1080 × 1920 story and a 540 × 960 draft read the same.
//
// The figures are each platform's published ones as of SAFE_ZONES_CHECKED; the apps move them, which is why
// the menu foot carries the date. Update `SAFE_ZONES_CHECKED` together with any band below.
//
// Leaf module: no IO, no React, no npm import — canvas-lib reaches it through safe-zones-overlay.tsx, and
// the canvas iframe is untrusted (DDR-054), so the id is looked up in a closed table, never evaluated.

/** When the bands below were last compared with what each platform publishes. */
export const SAFE_ZONES_CHECKED = 'Oct 2026';

/** The menu's foot, word for word (CONTRACT §3, 08 ak-safe-zones). */
export const SAFE_ZONES_FOOT =
  'Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026.';

export type SafeZoneEdge = 'top' | 'bottom' | 'left' | 'right';

export interface SafeZoneBand {
  edge: SafeZoneEdge;
  /** Percent of the artboard side the band stands on: height for top/bottom, width for left/right. */
  size: number;
  /** What sits there, in the band's own tag ("Profile and progress bar"). */
  label: string;
  /** The flag on content that lands in the band ("Under the caption"). */
  under: string;
}

export interface SafeZoneCrop {
  /** The shape the platform shows of a bigger picture, width : height. */
  aspect: [number, number];
  /** The tag on the part that is cut off. */
  label: string;
}

export interface SafeZonePreset {
  id: string;
  /** The menu row. */
  label: string;
  /** One line under the close-up (08 ak-safe-zones). */
  note: string;
  bands: readonly SafeZoneBand[];
  crop?: SafeZoneCrop;
}

const bands = (...b: SafeZoneBand[]): readonly SafeZoneBand[] => Object.freeze(b);

/** The six platforms the menu offers after "None" (the seven rows of the canvas's menu). */
export const SAFE_ZONE_PRESETS: readonly SafeZonePreset[] = Object.freeze(
  (
    [
      {
        id: 'instagram-story',
        label: 'Instagram story',
        note: 'Profile and progress bar on top, reply bar below.',
        bands: bands(
          {
            edge: 'top',
            size: 13,
            label: 'Profile and progress bar',
            under: 'Under the profile bar',
          },
          { edge: 'bottom', size: 17.7, label: 'Reply bar', under: 'Under the reply bar' }
        ),
      },
      {
        id: 'instagram-reels',
        label: 'Instagram Reels',
        note: 'Caption and audio take more of the bottom; buttons run down the right.',
        bands: bands(
          {
            edge: 'top',
            size: 11.5,
            label: 'Profile and progress bar',
            under: 'Under the profile bar',
          },
          { edge: 'bottom', size: 21.9, label: 'Caption and audio', under: 'Under the caption' },
          { edge: 'right', size: 13, label: 'Buttons', under: 'Under the buttons' }
        ),
      },
      {
        id: 'instagram-grid',
        label: 'Instagram profile grid',
        note: 'A 1:1 post shows as 3:4 in the grid — the pale sides are cut off there.',
        bands: bands(),
        crop: { aspect: [3, 4], label: 'Cut off in the grid' },
      },
      {
        id: 'tiktok',
        label: 'TikTok',
        note: 'Search and tabs on top; caption and sound below; buttons down the right.',
        bands: bands(
          { edge: 'top', size: 6.8, label: 'Search and tabs', under: 'Under the top bar' },
          { edge: 'bottom', size: 25.2, label: 'Caption and sound', under: 'Under the caption' },
          { edge: 'right', size: 11.1, label: 'Buttons', under: 'Under the buttons' }
        ),
      },
      {
        id: 'youtube-shorts',
        label: 'YouTube Shorts',
        note: 'Title and channel along the bottom; buttons down the right.',
        bands: bands(
          { edge: 'top', size: 6.5, label: 'Search and camera', under: 'Under the top bar' },
          { edge: 'bottom', size: 16, label: 'Title and channel', under: 'Under the title' },
          { edge: 'right', size: 11.1, label: 'Buttons', under: 'Under the buttons' }
        ),
      },
      {
        id: 'facebook-event-cover',
        label: 'Facebook event cover',
        note: 'The cover shows as 5:2 on a computer — the top and bottom are cut off there.',
        bands: bands(),
        crop: { aspect: [5, 2], label: 'Cut off on a computer' },
      },
    ] satisfies SafeZonePreset[]
  ).map((p) => Object.freeze(p))
);

const BY_ID: ReadonlyMap<string, SafeZonePreset> = new Map(SAFE_ZONE_PRESETS.map((p) => [p.id, p]));

/** The menu in the canvas's order: "None", then the six. `value` is what the prop carries ('' = none). */
export const SAFE_ZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Object.freeze([
  { value: '', label: 'None' },
  ...SAFE_ZONE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
]);

export const SAFE_ZONE_IDS: readonly string[] = Object.freeze(SAFE_ZONE_PRESETS.map((p) => p.id));

/** Is this a preset id this build knows? (A newer peer's id is not: it draws nothing here.) */
export function isSafeZoneId(v: unknown): v is string {
  return typeof v === 'string' && BY_ID.has(v);
}

/** The preset for a prop value, or null for none / unknown. */
export function safeZonePreset(v: unknown): SafeZonePreset | null {
  return typeof v === 'string' ? (BY_ID.get(v) ?? null) : null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BandRect extends Rect {
  edge: SafeZoneEdge;
  label: string;
  under: string;
}

const finite = (n: number) => Number.isFinite(n) && n > 0;

/**
 * The bands of a preset on an artboard of `w` × `h`, in the artboard's own px. Top and bottom run the
 * full width; a side band runs between them (so a corner is covered once, as the canvas draws it).
 */
export function bandRects(preset: SafeZonePreset | null, w: number, h: number): BandRect[] {
  if (!preset || !finite(w) || !finite(h)) return [];
  const pct = (b: SafeZoneBand | undefined, side: number) =>
    b ? Math.min(50, Math.max(0, b.size)) * 0.01 * side : 0;
  const top = preset.bands.find((b) => b.edge === 'top');
  const bottom = preset.bands.find((b) => b.edge === 'bottom');
  const topH = pct(top, h);
  const botH = pct(bottom, h);
  const out: BandRect[] = [];
  for (const b of preset.bands) {
    const meta = { edge: b.edge, label: b.label, under: b.under };
    if (b.edge === 'top') out.push({ ...meta, x: 0, y: 0, w, h: topH });
    else if (b.edge === 'bottom') out.push({ ...meta, x: 0, y: h - botH, w, h: botH });
    else if (b.edge === 'left')
      out.push({ ...meta, x: 0, y: topH, w: pct(b, w), h: h - topH - botH });
    else out.push({ ...meta, x: w - pct(b, w), y: topH, w: pct(b, w), h: h - topH - botH });
  }
  return out.filter((r) => r.w > 0 && r.h > 0);
}

export interface CropRects {
  /** What the platform shows. */
  frame: Rect;
  /** What it cuts off (one or two strips). */
  cut: Rect[];
  label: string;
}

/** The part of the artboard a platform crops away, centred; null when nothing is cut. */
export function cropRects(preset: SafeZonePreset | null, w: number, h: number): CropRects | null {
  const crop = preset?.crop;
  if (!crop || !finite(w) || !finite(h)) return null;
  const [aw, ah] = crop.aspect;
  const shownW = Math.min(w, (h * aw) / ah);
  const shownH = Math.min(h, (w * ah) / aw);
  const x = (w - shownW) / 2;
  const y = (h - shownH) / 2;
  const cut: Rect[] = [];
  if (x > 0.5) {
    cut.push({ x: 0, y: 0, w: x, h });
    cut.push({ x: w - x, y: 0, w: x, h });
  }
  if (y > 0.5) {
    cut.push({ x: 0, y: 0, w, h: y });
    cut.push({ x: 0, y: h - y, w, h: y });
  }
  if (cut.length === 0) return null;
  return { frame: { x, y, w: shownW, h: shownH }, cut, label: crop.label };
}

/** How much of an item must sit inside a band for it to count as "under" it. */
export const UNDER_SHARE = 0.25;

const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

export interface UnderFlag {
  band: BandRect;
  /** The first item (in the order given) that sits under it. */
  item: Rect;
}

/**
 * The flags to draw: for each band, the first item whose area lies at least UNDER_SHARE inside it. One flag
 * per band, so a busy artboard shows a handful of tags, not a rash. `items` are the artboard's text, in the
 * artboard's own px.
 */
export function flagsUnderBands(
  bandList: readonly BandRect[],
  items: readonly Rect[]
): UnderFlag[] {
  const flags: UnderFlag[] = [];
  for (const band of bandList) {
    const item = items.find((it) => {
      const area = it.w * it.h;
      return area > 0 && overlap(it, band) / area >= UNDER_SHARE;
    });
    if (item) flags.push({ band, item });
  }
  return flags;
}

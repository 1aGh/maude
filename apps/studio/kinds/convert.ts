// apps/studio/kinds/convert.ts — S7.25: what "Change kind" will do, said before it does it (08 ak-convert, ak-convert-after).
//
// Picking A6 for an Instagram post does not quietly rewrite it. The dialog says what converts, where the extra height
// goes and what to check, and the post stays as it was: the A6 is made from a COPY (the switch can be turned off, and then
// the artboard itself changes — ⌘Z brings it back). This is the arithmetic and the words; the write is the edit-op
// `artboard.convert-kind` (edit-ops/convert-kind.ts), and "Check after" is the SAME detectors the warning style uses
// (kinds/warnings.ts), run on the geometry the copy would have.
//
// How the design is carried over — one rule, so it can be said in a sentence:
//   the design is scaled (CSS `zoom`, so text stays text) to the paper's WIDTH, pinned to the top; the extra height is
//   the artboard's own background. A design taller than the paper scales to its HEIGHT instead, centred, and the
//   extra is at the sides. Nothing is cropped and nothing is rasterised.
//
// Pure: no IO, no React. Never throws on a source it cannot read; it answers null (no plan, no dialog).
//
// decision:maude/v2-S7.25-convert-is-a-scaled-copy

import { getPaperPreset, type Orientation, resolvePrintArtboard } from '../print/units.ts';
import { mmWord } from './physical.ts';
import { detectWarnings, type Warning, type WarnRect, type WarnRects } from './warnings.ts';

export interface ConvertSource {
  id: string;
  label: string;
  widthPx: number;
  heightPx: number;
  /** the artboard's background as written (`var(--ink)`, `#112233`), or null */
  background?: string | null;
  /** the safe-zone preset the post had, if any (print has its own safe margin) */
  safeZones?: string | null;
}

export interface ConvertTarget {
  /** a paper preset id from print/units.ts (`a6`) */
  paper: string;
  orientation?: Orientation;
  bleedMm?: number;
}

export interface ConvertPlan {
  /** "Make “Oznámení události” an A6 print?" */
  title: string;
  /** the dialog's primary button: "Make A6 print" */
  primary: string;
  /** the first paragraph */
  lead: string;
  /** the `print` prop the new artboard carries */
  print: { paper: string; orientation: Orientation; bleedMm: number };
  widthPx: number;
  heightPx: number;
  /** what the design is multiplied by (CSS `zoom`) */
  scale: number;
  /** the design's left offset after scaling, px (0 when it fits the width) */
  offsetX: number;
  fit: 'width' | 'height';
  /** the extra length that is background, as a whole percent of the scaled design */
  extraPct: number;
  /** the background's name ("Ink"), or null when it is not a token */
  fill: string | null;
  /** "Instagram safe zones turn off — print has its own safe margin." — only when the post had some */
  note: string | null;
  /** the label of the new artboard */
  copyLabel: string;
  paperName: string;
  sizeMm: [number, number];
}

const round = (n: number) => Math.round(n);

/** `var(--ink)` → "Ink", `var(--bg-1)` → "Bg 1"; anything that is not a token has no name. */
export function fillName(background: string | null | undefined): string | null {
  const m = /^var\(\s*--([A-Za-z][\w-]*)\s*\)$/.exec((background ?? '').trim());
  if (!m) return null;
  const words = (m[1] as string).split(/[-_]+/).filter(Boolean).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Everything the dialog and the write need, or null when the paper is not one this build knows. */
export function planConvert(source: ConvertSource, target: ConvertTarget): ConvertPlan | null {
  const preset = getPaperPreset(target.paper);
  if (!preset) return null;
  if (!(source.widthPx > 0 && source.heightPx > 0)) return null;
  const orientation: Orientation =
    target.orientation ?? (source.widthPx > source.heightPx ? 'landscape' : 'portrait');
  let r: ReturnType<typeof resolvePrintArtboard>;
  try {
    r = resolvePrintArtboard({
      paper: target.paper,
      orientation,
      ...(typeof target.bleedMm === 'number' ? { bleedMm: target.bleedMm } : {}),
    });
  } catch {
    return null;
  }
  const kw = r.widthPx / source.widthPx;
  const kh = r.heightPx / source.heightPx;
  // the design is as wide as the paper when it can be; a design too tall for that goes by its height instead
  const fit: 'width' | 'height' = source.heightPx * kw <= r.heightPx + 0.5 ? 'width' : 'height';
  const scale = fit === 'width' ? kw : kh;
  const scaledW = source.widthPx * scale;
  const scaledH = source.heightPx * scale;
  const offsetX = fit === 'height' ? round((r.widthPx - scaledW) / 2) : 0;
  const extraPct =
    fit === 'width'
      ? round(((r.heightPx - scaledH) / scaledH) * 100)
      : round(((r.widthPx - scaledW) / scaledW) * 100);
  const fill = fillName(source.background);
  const name = String(r.paper).toUpperCase();
  const sizeMm: [number, number] = [r.trimWidthMm, r.trimHeightMm];
  const bg = fill ? `its background colour, ${fill}` : 'its background';
  const sizeWords = `${mmWord(sizeMm[0])} × ${mmWord(sizeMm[1])} mm`;
  const lead =
    extraPct > 0
      ? `Size becomes ${sizeWords} with ${mmWord(r.bleedMm)} mm bleed. The design scales to the ${name} ${
          fit === 'width' ? 'width' : 'height'
        }; the extra ${extraPct} % of ${fit === 'width' ? 'height' : 'width'} is filled with ${bg}. Text stays text.`
      : `Size becomes ${sizeWords} with ${mmWord(r.bleedMm)} mm bleed. The design scales to the ${name} width. Text stays text.`;
  return {
    title: `Make “${source.label}” ${/^[AEIOU8]/i.test(name) ? 'an' : 'a'} ${name} print?`,
    primary: `Make ${name} print`,
    lead,
    print: { paper: r.paper, orientation, bleedMm: r.bleedMm },
    widthPx: r.widthPx,
    heightPx: r.heightPx,
    scale: Math.round(scale * 10000) / 10000,
    offsetX,
    fit,
    extraPct: Math.max(0, extraPct),
    fill,
    note: source.safeZones
      ? `${safeZoneWords(source.safeZones)} safe zones turn off — print has its own safe margin.`
      : null,
    copyLabel: `${source.label} · ${name}`,
    paperName: name,
    sizeMm,
  };
}

const ZONE_WORDS: Record<string, string> = {
  'instagram-story': 'Instagram',
  'instagram-reels': 'Instagram',
  'instagram-grid': 'Instagram',
  tiktok: 'TikTok',
  'youtube-shorts': 'YouTube',
  'facebook-event': 'Facebook',
};
const safeZoneWords = (preset: string): string => ZONE_WORDS[preset] ?? 'The';

/**
 * "Check after": the warnings the new artboard would have, from the source's layers moved to where the copy puts
 * them. `rects` are the SOURCE artboard's, in world px (its own artboard rect first); `null` = no render, no list.
 */
export function checkAfter(plan: ConvertPlan, rects: WarnRects | null): Warning[] {
  if (!rects) return [];
  const k = plan.scale;
  const ab = { x: 0, y: 0, w: plan.widthPx, h: plan.heightPx };
  const elements: WarnRect[] = rects.elements.map((e) => ({
    ...e,
    x: (e.x - rects.artboard.x) * k + plan.offsetX,
    y: (e.y - rects.artboard.y) * k,
    w: e.w * k,
    h: e.h * k,
  }));
  return detectWarnings(
    {
      id: 'after',
      kind: 'print',
      widthPx: plan.widthPx,
      heightPx: plan.heightPx,
      fixed: true,
      print: plan.print,
    },
    { artboard: ab, elements }
  );
}

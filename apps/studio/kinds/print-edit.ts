// apps/studio/kinds/print-edit.ts — S7.23: what changing one thing about a print artboard writes.
//
// The print inspector (Paper · Size in mm · Orientation · Bleed · Safe margin · Print guides), the `artboard.set-print`
// edit-op and an agent's hand edit all end in the same two things — the `print` prop and the artboard's px size — and
// they must agree: px = trim + 2 × bleed (print/units.ts), so a bleed change moves the artboard and a paper change
// moves it too. `nextPrint` is the one place that arithmetic lives. Pure: no DOM, no disk.
//
//   paper        a preset id; clears a custom size (picking a paper means "that paper")
//   sizeMm       [w, h] in mm — a custom trim (kinds/print-custom.ts: `paper` = the nearest larger preset, `sizeMm` the truth)
//   orientation  portrait | landscape; on a custom size it swaps the two numbers
//   bleedMm      0–20            marginMm   0–50, one value for all four sides (the 5 mm default writes nothing)
//   showGuides   true | false | null (null = follow View; see print-guides.ts)
//
// Every other key of the existing prop is kept as it stands, so a hand-authored `print` loses nothing.
//
// decision:maude/v2-S7.23-one-print-write

import {
  DEFAULT_SAFE_MARGIN_MM,
  getPaperPreset,
  type Orientation,
  resolveMarginsMm,
} from '../print/units.ts';
import {
  customPrintProp,
  MAX_CUSTOM_MM,
  MIN_CUSTOM_MM,
  readSizeMm,
  resolveCustomPrintArtboard,
  type SizeMm,
} from './print-custom.ts';

export interface PrintPatch {
  paper?: string;
  orientation?: Orientation;
  bleedMm?: number;
  marginMm?: number;
  sizeMm?: SizeMm | null;
  showGuides?: boolean | null;
}

export const MAX_BLEED_MM = 20;
export const MAX_MARGIN_MM = 50;

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface NextPrint {
  print: Record<string, unknown>;
  widthPx: number;
  heightPx: number;
}

/** @throws RangeError with the sentence the person reads when a number is out of range or a paper unknown */
export function nextPrint(current: Record<string, unknown> | null, input: PrintPatch): NextPrint {
  const patch: PrintPatch = { ...input };
  let print: Record<string, unknown> = { paper: 'a4', ...(current ?? {}) };
  const had = readSizeMm(print);

  if (patch.paper !== undefined) {
    if (typeof patch.paper !== 'string' || !getPaperPreset(patch.paper))
      throw new RangeError('That paper is not one Maude knows.');
    print = { ...print, paper: patch.paper };
    print.sizeMm = undefined;
    if (patch.orientation === undefined && print.orientation === undefined)
      print.orientation = 'portrait';
  }
  if (patch.orientation !== undefined) {
    if (patch.orientation !== 'portrait' && patch.orientation !== 'landscape')
      throw new RangeError('Orientation is portrait or landscape.');
    const size = patch.paper === undefined ? had : null;
    if (size) {
      // a custom size is its two numbers: turning the sheet swaps them (and re-derives the paper it sits in)
      const wide = size[0] > size[1];
      if (wide !== (patch.orientation === 'landscape')) patch.sizeMm = [size[1], size[0]];
    } else {
      print.orientation = patch.orientation;
    }
  }
  if (patch.bleedMm !== undefined) {
    if (!inRange(patch.bleedMm, 0, MAX_BLEED_MM)) throw new RangeError('Bleed is 0–20 mm.');
    print.bleedMm = round2(patch.bleedMm);
  }
  if (patch.marginMm !== undefined) {
    if (!inRange(patch.marginMm, 0, MAX_MARGIN_MM))
      throw new RangeError('The safe margin is 0–50 mm.');
    const m = round2(patch.marginMm);
    if (m === DEFAULT_SAFE_MARGIN_MM) print.marginsMm = undefined;
    else print.marginsMm = { top: m, right: m, bottom: m, left: m };
  }
  if (patch.showGuides !== undefined) {
    if (patch.showGuides === null) print.showGuides = undefined;
    else if (typeof patch.showGuides === 'boolean') print.showGuides = patch.showGuides;
    else throw new RangeError('Print guides are on, off, or follow View.');
  }
  if (patch.sizeMm !== undefined && patch.sizeMm !== null) {
    const size = readSizeMm({ sizeMm: patch.sizeMm });
    if (!size)
      throw new RangeError(`A custom size is ${MIN_CUSTOM_MM}–${MAX_CUSTOM_MM} mm a side.`);
    const margins = isRec(print.marginsMm) ? print.marginsMm : undefined;
    const c = customPrintProp(size, {
      ...(typeof print.bleedMm === 'number' ? { bleedMm: print.bleedMm } : {}),
      ...(margins ? { marginsMm: margins } : {}),
    });
    print = {
      ...print,
      paper: c.paper,
      orientation: c.orientation,
      sizeMm: c.sizeMm,
      bleedMm: c.bleedMm,
    };
  } else if (patch.sizeMm === null) {
    print.sizeMm = undefined;
  }

  // drop what became undefined, so the prop never carries `sizeMm: undefined` into JSON
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(print)) if (v !== undefined) clean[k] = v;
  const r = resolveCustomPrintArtboard(clean as Parameters<typeof resolveCustomPrintArtboard>[0]);
  return { print: clean, widthPx: r.widthPx, heightPx: r.heightPx };
}

/** The safe margin as the one number the inspector shows: all four sides equal, else null ("Mixed"). */
export function uniformMarginMm(print: unknown): number | null {
  const m = resolveMarginsMm(isRec(print) && isRec(print.marginsMm) ? print.marginsMm : undefined);
  return m.top === m.right && m.top === m.bottom && m.top === m.left ? m.top : null;
}

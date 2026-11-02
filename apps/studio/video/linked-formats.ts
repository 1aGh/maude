// video/linked-formats.ts — S7.13: which video artboards share one cut, and the Formats list built from it.
//
// A link is DERIVED, never stored (decision maude/v2-S7-linked-formats-derived, S7-slices Q4): video artboards whose
// `<VideoComp component={X}>` name the same comp share one cut. "Make an unlinked copy" forks the comp's declaration as
// `<X>Unlinked` (edit-ops/clip/formats.ts), so a copy is recognised the same way, by name: a comp called `<Y>Unlinked[N]`
// where `<Y>` is another comp of the file is "an unlinked copy of Y — its own cut".
//
// Two readers, one rule:
//   - `linkedFormats(file, source, artboardId)` — the server's answer (GET /_api/comp-media `formats`): the list the
//     inspector's Formats section draws and the Export sheet's "Formats · 3 of 4 ticked" asks for;
//   - `linkGroups(items)` — the pure core, also used by the canvas's link-line layer, where the key of a comp is its
//     component FUNCTION (two artboards mounting one function share a cut), not a name.
//
// Pure: no IO, no DOM.

import { videoArtboards } from '../edit-ops/clip/comp.ts';
import { aspectOf, MAX_SIDE, MIN_SIDE, sizeOf } from '../edit-ops/clip/formats.ts';
import { literalProp, parseProgram } from '../edit-ops/clip/jsx.ts';
import { aspectKey } from './framing.ts';
import { unlinkedBase } from './link-groups.ts';

export { type LinkGroup, type LinkItem, linkGroups, unlinkedBase } from './link-groups.ts';

/** What "Add a format" offers (the catalogue's three video rows, plus the feed post). Name, then W × H. */
export const FORMAT_PRESETS: ReadonlyArray<Readonly<{ name: string; w: number; h: number }>> =
  Object.freeze([
    Object.freeze({ name: 'Reels 9:16', w: 1080, h: 1920 }),
    Object.freeze({ name: '16:9', w: 1920, h: 1080 }),
    Object.freeze({ name: '1:1', w: 1080, h: 1080 }),
    Object.freeze({ name: '4:5', w: 1080, h: 1350 }),
  ]);

export interface FormatRow {
  artboardId: string;
  /** the artboard's own label ("Recap · Reels · 0:30"), when it has a literal one */
  label: string | null;
  /** "Reels 9:16" for the row that is this artboard, else the aspect ("16:9") */
  name: string;
  /** "1920 × 1080" */
  size: string;
  w: number | null;
  h: number | null;
  aspect: string | null;
  /** this is the artboard the list was asked for */
  current: boolean;
  /** shares the asked artboard's cut (the asked artboard itself counts) */
  linked: boolean;
  /** it has its own cut, forked from the comp the asked artboard mounts */
  unlinkedCopy: boolean;
}

export interface LinkedFormats {
  /** the asked artboard's comp, null when its VideoComp does not name one */
  comp: string | null;
  /** the comp this artboard's own cut was forked from ("Unlinked copy — its own cut"), else null */
  unlinkedFrom: string | null;
  /** every artboard of the cut, in document order (the asked one included, `current`) */
  formats: FormatRow[];
  /** artboards that are unlinked copies of this cut */
  copies: FormatRow[];
  /** what "Add a format" can still add: the aspects this cut has no artboard for */
  free: Array<{ name: string; w: number; h: number }>;
  /** "Make an unlinked copy" has something to fork from: another artboard shares this cut */
  canUnlink: boolean;
}

const presetNameFor = (w: number | null, h: number | null): string | null =>
  FORMAT_PRESETS.find((p) => p.w === w && p.h === h)?.name ?? null;

/** The asked artboard's formats; null when the source has no such video artboard or does not parse. */
export function linkedFormats(
  file: string,
  source: string,
  artboardId: string | undefined
): LinkedFormats | null {
  let all: ReturnType<typeof videoArtboards>;
  try {
    all = videoArtboards(file, parseProgram(file, source));
  } catch {
    return null;
  }
  const self = artboardId === undefined ? all[0] : all.find((a) => a.id === artboardId);
  if (!self) return null;
  const compNames = new Set(all.map((a) => a.comp).filter((c): c is string => !!c));
  const labelOf = (a: (typeof all)[number]): string | null => {
    try {
      const v = literalProp(file, a.artboard, 'label');
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  };
  const row = (a: (typeof all)[number], linked: boolean, unlinkedCopy: boolean): FormatRow => {
    const w = sizeOf(source, a.artboard, 'width') ?? sizeOf(source, a.videoComp, 'width');
    const h = sizeOf(source, a.artboard, 'height') ?? sizeOf(source, a.videoComp, 'height');
    const aspect = aspectOf(source, a);
    const current = a.id === self.id;
    return {
      artboardId: a.id,
      label: labelOf(a),
      name: current ? (presetNameFor(w, h) ?? aspect ?? '') : (aspect ?? ''),
      size: w && h ? `${w} × ${h}` : '',
      w,
      h,
      aspect,
      current,
      linked,
      unlinkedCopy,
    };
  };

  const formats =
    self.comp === null
      ? [row(self, true, false)]
      : all.filter((a) => a.comp === self.comp).map((a) => row(a, true, false));
  const copies = all
    .filter((a) => {
      const base = unlinkedBase(a.comp);
      return !!base && base === self.comp;
    })
    .map((a) => row(a, false, true));
  const base = unlinkedBase(self.comp);

  const used = new Set(formats.map((f) => f.aspect));
  const free = FORMAT_PRESETS.filter(
    (p) =>
      !used.has(aspectKey(p.w, p.h)) &&
      p.w >= MIN_SIDE &&
      p.w <= MAX_SIDE &&
      p.h >= MIN_SIDE &&
      p.h <= MAX_SIDE
  ).map((p) => ({ name: p.name, w: p.w, h: p.h }));

  return {
    comp: self.comp,
    unlinkedFrom: base && compNames.has(base) ? base : null,
    formats,
    copies,
    free: self.comp ? free : [],
    canUnlink: self.comp !== null && formats.length > 1,
  };
}

// edit-ops/artboard-facts.ts — S7.25: what each `<DCArtboard>` in a canvas's source says about itself, read from the
// opening tag without a parser (the same quote- and brace-aware scan `artboardLabels` uses). Only literals count: a
// width written as an expression, or a label built at run time, reads as absent — never guessed.
//
// Two callers: `artboard.convert-kind` (what is being converted) and `GET /_api/kinds/warnings` (what each artboard is,
// so the detectors have its kind, size and paper). Pure.

import { openingTagAttrs, stripBraces } from './duplicate-at-width.ts';

export interface ArtboardSourceFacts {
  id: string;
  label: string | null;
  kind: string;
  widthPx: number | null;
  heightPx: number | null;
  fixed: boolean;
  background: string | null;
  safeZones: string | null;
}

const unescapeAttr = (v: string): string =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Every artboard of the source, in order. An artboard with no literal `id` is not listed. */
export function scanArtboards(source: string): ArtboardSourceFacts[] {
  const out: ArtboardSourceFacts[] = [];
  const open = /<DCArtboard\b/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    const attrs = openingTagAttrs(source, m.index + m[0].length);
    if (attrs === null) continue;
    const top = stripBraces(attrs);
    const mine = /\bid=(?:"([^"]*)"|'([^']*)')/.exec(top);
    const id = mine?.[1] ?? mine?.[2];
    if (id === undefined) continue;
    const num = (name: string): number | null => {
      const r = new RegExp(
        `\\b${name}=(?:\\{\\s*(\\d+(?:\\.\\d+)?)\\s*\\}|"(\\d+(?:\\.\\d+)?)")`
      ).exec(attrs);
      const v = r ? Number(r[1] ?? r[2]) : Number.NaN;
      return Number.isFinite(v) ? v : null;
    };
    const str = (name: string): string | null => {
      const r = new RegExp(
        `\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:"([^"]*)"|'([^']*)')\\s*\\})`
      ).exec(attrs);
      const v = r ? (r[1] ?? r[2] ?? r[3] ?? r[4] ?? null) : null;
      return v === null ? null : unescapeAttr(v);
    };
    out.push({
      id,
      label: str('label'),
      kind: str('kind') ?? 'digital',
      widthPx: num('width'),
      heightPx: num('height'),
      fixed: /\bfixed(?![=\w-])/.test(top) || /\bfixed=\{\s*true\s*\}/.test(attrs),
      background: str('background'),
      safeZones: str('safeZones'),
    });
  }
  return out;
}

/** One artboard's facts, or null when the source has no such literal-id artboard. */
export const artboardFactsOf = (source: string, id: string): ArtboardSourceFacts | null =>
  scanArtboards(source).find((a) => a.id === id) ?? null;

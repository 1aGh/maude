// Text-only change detection for the F4 peer-render fast path.
//
// A teammate's text edit reaches this disk ~100 ms after they commit it, but
// re-importing and remounting the canvas module takes several hundred more.
// When the ONLY difference between the source the iframe renders and the new
// source is the text between an element's opening and closing tag, the iframe
// can show the new string at once and let the remount confirm it.
//
// DELIBERATELY PARSER-FREE. In a cell this runs in the process that holds the
// tenant's credentials, where canvas source is never parsed or built (DDR-209:
// that happens in the sandbox). So this is bounded string scanning over one
// changed region, and the element's identity comes from the LOCATOR the
// sandboxed build already produced for the rendered source — never from
// parsing tenant bytes here. Anything it cannot prove is a plain text run —
// markup, attributes, expressions, entities, several regions — returns null,
// and the remount alone renders the change, exactly as before.

import type { LocatorMap } from './locator.ts';

export interface TextPatch {
  /** The element's `data-cd-id` in the rendered (before) build. */
  id: string;
  /** The string React renders for the element's text child. */
  text: string;
}

const STRUCTURAL = /[<>{}&]/;

/** Babel's JSX text whitespace rule (cleanJSXElementLiteralChild). */
export function renderedJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i] as string)) lastNonEmpty = i;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] as string).replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, '');
    if (line) {
      if (i !== lastNonEmpty) line += ' ';
      out += line;
    }
  }
  return out;
}

/** 1-based line / 0-based column, counted the way the build's locator counts. */
function lineCol(source: string, at: number): { line: number; col: number } {
  let line = 1;
  let col = 0;
  for (let i = 0; i < at; i++) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      col = 0;
    } else col += 1;
  }
  return { line, col };
}

const TAG_NAME = /^[A-Za-z][\w.:-]*/;

/**
 * The single text patch that turns `before`'s render into `after`'s, [] when
 * they are identical, or null when the change is anything but the text run of
 * one element that `locator` (the build of `before`) names.
 */
export function textOnlyPatches(
  before: string,
  after: string,
  locator: LocatorMap
): TextPatch[] | null {
  if (before === after) return [];
  const limit = Math.min(before.length, after.length);
  let p = 0;
  while (p < limit && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < limit - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  if (STRUCTURAL.test(before.slice(p, before.length - s))) return null;
  if (STRUCTURAL.test(after.slice(p, after.length - s))) return null;

  // The text run around the change: from the `>` ending an opening tag to the
  // `</` of a closing tag, with nothing structural in between (both sides).
  let open = p - 1;
  while (open >= 0 && !STRUCTURAL.test(before[open] as string)) open--;
  if (open < 0 || before[open] !== '>' || before[open - 1] === '/') return null;
  let close = before.length - s;
  while (close < before.length && !STRUCTURAL.test(before[close] as string)) close++;
  if (before[close] !== '<' || before[close + 1] !== '/') return null;
  const closeAfter = close + (after.length - before.length);

  // The opening tag this `>` ends: its `<`, a tag name, and a closing tag that
  // names the same element.
  const start = before.lastIndexOf('<', open);
  if (start < 0) return null;
  const name = TAG_NAME.exec(before.slice(start + 1))?.[0];
  if (!name || before.slice(close + 2, close + 2 + name.length + 1) !== `${name}>`) return null;

  const at = lineCol(before, start);
  // The locator is the sandboxed build's output: trust its shape, not its size.
  const ids = Object.entries(locator ?? {}).filter(
    ([id, e]) =>
      /^[0-9a-f]{8}$/.test(id) &&
      e?.line === at.line &&
      e?.col === at.col &&
      Array.isArray(e?.jsxPath) &&
      e.jsxPath.at(-1) === name
  );
  if (ids.length !== 1) return null;

  const text = renderedJsxText(after.slice(open + 1, closeAfter));
  if (!text) return null;
  return [{ id: (ids[0] as [string, unknown])[0], text }];
}

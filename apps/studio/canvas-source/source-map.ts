// Canvas source map — S11.6 (contract S11-slices §3 row S11.6). Which lines of a canvas's TSX
// draw which artboard, so the code view (S11.7) can mark the selected artboard's lines.
//
// `DCArtboard id="…"` → `{ startLine, endLine }` (1-based, inclusive: the line of `<DCArtboard`
// and the line of its closing `>`). Parsed with oxc through the same `parseCanvas` the history
// describer uses (S1.9, history/describe-match.ts) — comments are blanked there with their
// offsets kept, so a `<DCArtboard` inside a comment is never an artboard, and every offset is
// still the file's (oxc reports UTF-16 offsets, the unit a JS string is indexed in).
//
// Artboards nest anywhere — inside `DCSection`s, fragments, helper components, a `.map()` — the
// walk visits every JSX element. An id that is a template literal is a FAMILY (`disc-*`, one row
// per rendered artboard): it is listed under that key with `dynamic: true`. An artboard without
// a literal id is not listed (nothing selects it by id). The first artboard of an id wins.

import {
  artboardIdOf,
  forEachChild,
  isNode,
  jsxTagName,
  parseCanvas,
} from '../history/describe-match.ts';
import { lineColumnOf } from './errors.ts';

export interface ArtboardLines {
  startLine: number;
  endLine: number;
  /** The id is a template (`disc-${i}` → `disc-*`): every artboard of the family. */
  dynamic?: true;
}

export interface CanvasSourceMap {
  /** `false` when the source does not parse (then `artboards` is empty). */
  parsed: boolean;
  lines: number;
  artboards: Record<string, ArtboardLines>;
}

/** Count of lines as an editor shows them (a trailing newline opens no new line). */
export function lineCount(source: string): number {
  if (source === '') return 0;
  let n = 1;
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) n++;
  return source.endsWith('\n') ? n - 1 : n;
}

/** The artboard → lines map of one canvas source. */
export function canvasSourceMap(source: string): CanvasSourceMap {
  const lines = lineCount(source);
  const parsed = parseCanvas(source);
  if (!parsed) return { parsed: false, lines, artboards: {} };
  const artboards: Record<string, ArtboardLines> = {};
  const walk = (n: unknown): void => {
    if (!isNode(n)) return;
    if (n.type === 'JSXElement' && jsxTagName(n.openingElement?.name) === 'DCArtboard') {
      const id = artboardIdOf(n.openingElement);
      if (id && !Object.hasOwn(artboards, id)) {
        const startLine = lineColumnOf(source, n.start).line;
        // `end` is one past the last character — the line of that last character.
        const endLine = lineColumnOf(source, Math.max(n.start, n.end - 1)).line;
        artboards[id] = id.includes('*')
          ? { startLine, endLine, dynamic: true }
          : { startLine, endLine };
      }
    }
    forEachChild(n, (c) => walk(c));
  };
  walk(parsed.program);
  return { parsed: true, lines, artboards };
}

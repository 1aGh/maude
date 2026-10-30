// edit-ops/clip/captions.ts — `video.captions.add` (S7.6c; V2-1.10 §5.3 `<Captions>`, §5.7 `captions
// {props, fixes}`, 07 ve-captions "Captions from speech").
//
// ONE `<Captions data-cd-id="captions" …/>` per comp, at the comp root after the series (the Text
// track, lane 1, C35). The op inserts it, or updates the props of the one already there (absent =
// keep, null = remove). The words themselves are DERIVED at build from the transcripts
// (`__words`, never written); the file only holds the style and the person's `fixes`, written with
// JSON.stringify (the footage-director codegen escaping rule). Linked formats share the comp, so
// they share the captions. Transcribing a source with no transcript is the CLI's job
// (`maude design captions add`), never this op's. Pure: no IO.

import MagicString from 'magic-string';

import { compOf, rootJsx } from './comp.ts';
import {
  bad,
  ensureCanvasLibImport,
  finish,
  indentAt,
  jsonProp,
  jsxElements,
  type Node,
  parseProgram,
  setProp,
  tagOf,
} from './jsx.ts';

export const POSITIONS = ['top', 'middle', 'bottom'] as const;
export const MAX_FIXES = 5000;
/** A token or a colour/font value: no quote, brace, angle bracket, backslash or backtick. */
const STYLE_VALUE = /^[A-Za-z0-9 _\-(),.#%'+/:]{1,200}$/;

export interface CaptionsPatch {
  words?: 1 | 3 | 'line';
  position?: (typeof POSITIONS)[number];
  font?: string | null;
  highlight?: string | null;
  maxChars?: number | null;
  fixes?: Array<{ src: string; at: number; text: string | null }> | null;
}

export function captionsPatch(file: string, p: Record<string, unknown>): CaptionsPatch {
  const out: CaptionsPatch = {};
  if (p.words !== undefined) {
    if (p.words !== 1 && p.words !== 3 && p.words !== 'line')
      bad(file, 'Words at a time is 1, 3 or line.');
    out.words = p.words as 1 | 3 | 'line';
  }
  if (p.position !== undefined) {
    if (!POSITIONS.includes(p.position as never)) bad(file, 'Position is top, middle or bottom.');
    out.position = p.position as CaptionsPatch['position'];
  }
  for (const k of ['font', 'highlight'] as const) {
    const v = p[k];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== 'string' || !STYLE_VALUE.test(v)))
      bad(file, `The ${k} is not a value Maude can write.`);
    out[k] = v as string | null;
  }
  if (p.maxChars !== undefined) {
    if (
      p.maxChars !== null &&
      !(
        Number.isInteger(p.maxChars) &&
        (p.maxChars as number) >= 8 &&
        (p.maxChars as number) <= 200
      )
    )
      bad(file, 'Line length is 8 to 200 characters.');
    out.maxChars = p.maxChars as number | null;
  }
  if (p.fixes !== undefined) {
    if (p.fixes === null) out.fixes = null;
    else {
      if (!Array.isArray(p.fixes) || p.fixes.length > MAX_FIXES)
        bad(file, 'The caption fixes are not readable.');
      out.fixes = (p.fixes as unknown[]).map((f) => {
        const { src, at, text } = (f ?? {}) as Record<string, unknown>;
        if (typeof src !== 'string' || !src || src.length > 512)
          bad(file, 'A caption fix names no source.');
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0)
          bad(file, 'A caption fix has no time.');
        if (text !== null && (typeof text !== 'string' || text.length > 200))
          bad(file, 'A caption fix’s text is not readable.');
        return { src: src as string, at: at as number, text: text as string | null };
      });
    }
  }
  return out;
}

function texts(p: CaptionsPatch): Record<string, string | null | undefined> {
  const t: Record<string, string | null | undefined> = {};
  if (p.words !== undefined)
    t.words = typeof p.words === 'number' ? `{${p.words}}` : `"${p.words}"`;
  if (p.position !== undefined) t.position = `"${p.position}"`;
  if (p.font !== undefined) t.font = p.font === null ? null : `"${p.font}"`;
  if (p.highlight !== undefined) t.highlight = p.highlight === null ? null : `"${p.highlight}"`;
  if (p.maxChars !== undefined) t.maxChars = p.maxChars === null ? null : `{${p.maxChars}}`;
  if (p.fixes !== undefined) t.fixes = p.fixes?.length ? jsonProp(p.fixes) : null;
  return t;
}

export function applyCaptions(
  file: string,
  source: string,
  artboard: string | undefined,
  patch: CaptionsPatch
): { source: string; inserted: boolean } {
  const program = parseProgram(file, source);
  const comp = compOf(file, source, program, artboard);
  const inComp = jsxElements(program).filter(
    (e) => e.el.start >= comp.statement.start && e.el.end <= comp.statement.end
  );
  const existing = inComp.filter((e) => tagOf(e.el) === 'Captions');
  if (existing.length > 1)
    bad(file, 'This video has two caption tracks; keep one.', artboard ?? '');
  const t = texts(patch);
  const s = new MagicString(source);

  if (existing[0]) {
    const el = existing[0].el as Node;
    for (const [k, v] of Object.entries(t)) if (v !== undefined) setProp(s, el, k, v);
    return { source: finish(file, s), inserted: false };
  }

  // Inserted with the §5.3 defaults for what the patch does not say.
  const props: Record<string, string> = { words: '"line"', position: '"bottom"' };
  for (const [k, v] of Object.entries(t)) {
    if (v === null) delete props[k];
    else if (v !== undefined) props[k] = v;
  }
  const tag = `<Captions data-cd-id="captions"${Object.entries(props)
    .map(([k, v]) => ` ${k}=${v}`)
    .join('')} />`;
  const series = inComp.find((e) => tagOf(e.el) === 'TransitionSeries');
  const root = rootJsx(comp.decl);
  if (series && series.parent && series.parent.start >= comp.statement.start) {
    s.appendLeft(series.el.end, `\n${indentAt(source, series.el.start)}${tag}`);
  } else if (series) {
    // the series IS the comp's root: give it a fragment so the captions sit beside it
    const ind = indentAt(source, series.el.start);
    s.appendLeft(series.el.start, '<>\n' + ind);
    s.appendLeft(series.el.end, `\n${ind}${tag}\n${ind}</>`);
  } else if (root) {
    const close = root.type === 'JSXFragment' ? root.closingFragment : root.closingElement;
    if (!close) bad(file, 'This video’s composition has no body to add captions to.');
    s.appendLeft(close.start, `${tag}\n${indentAt(source, close.start)}`);
  } else {
    bad(file, 'This video’s composition has no body to add captions to.');
  }
  ensureCanvasLibImport(s, program, 'Captions');
  return { source: finish(file, s), inserted: true };
}

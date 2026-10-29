// "Restore only <artboard>" — the one-artboard splice (V2-1.9 §5.8, S1.13).
//
// `restoreArtboard(canvas, now, old, id)` computes, from the canvas as it is Now and as it was at the
// chosen version A, the lanes that put ONE artboard back the way it was at A while every other part of
// the canvas stays as it is now:
//   1. the artboard's element range in Now becomes A's; removed since → inserted after the nearest earlier
//      artboard (A's order) that still exists, else before the next one;
//   2. every declaration A's artboard reaches: unchanged → nothing; reached ONLY by this artboard now (or
//      by nothing — removed since) → A's (added back before the canvas component); reached by another
//      artboard → kept as now and listed in `sharedKept`. Imports A's artboard needs that Now lacks are
//      added;
//   3. CSS rules whose every class is used only inside this artboard (in A and in Now) → A's rule; other
//      rules that differ are kept and counted ("2 styles");
//   4. meta: `layout.artboards[id]`, `artboardMeta[id]` and the `artboards[]` mirror entry → A's;
//   5. the artboard's annotations (in A or Now: `parentArtboard` is `id`, a section's contents, an arrow
//      bound only to them — annotations/artboard-members.ts, the set ⌫ Move to trash takes, S2.10c) →
//      A's records by id (added-since ones go — they stay in Version history);
//   6. the result must parse and still carry the artboard, or nothing is proposed.
//
// Pure: no I/O. The route (routes/history.ts) reads both sides through the accepted runtime and proposes
// the changed lanes as ONE `kind: 'restore'` action with `baseContent` = the head it read, so the kernel
// merges three-way onto whatever landed meanwhile. Every value a v1 peer reads stays its own format;
// unknown meta keys and unknown annotation fields are carried through untouched.

import { artboardMembers } from '../annotations/artboard-members.ts';
import { parseBoard } from '../annotations/schema';
import { type ArtboardInfo, artboardLabel, parseModel, type TsxModel } from './describe';
import { type AnyNode, forEachChild, isNode, jsxTagName } from './describe-match';

export type SpliceLane = 'html' | 'css' | 'meta' | 'annotations';

export interface SpliceSide {
  html: string;
  css?: string | null;
  meta?: string | null;
  annotations?: string | null;
}

export type SpliceRefusal = 'not-in-version' | 'family' | 'invalid-result';

export type SpliceAnswer =
  | {
      ok: true;
      /** Only the lanes that change. Empty = the artboard is already as it was. */
      lanes: Partial<Record<SpliceLane, string>>;
      /** Parts the artboard uses that others share, kept as they are now ("Jersey", "2 styles"). */
      sharedKept: string[];
      /** The artboard's name in words. */
      label: string;
      /** The why-line, when `sharedKept` is non-empty (§5.8 step 6). */
      why: string | null;
    }
  | { ok: false; reason: SpliceRefusal; label: string; line: string };

/** "Can't restore only <label> — restore the whole canvas instead." (§5.8). */
export const refusalLine = (label: string): string =>
  `Can't restore only ${label} — restore the whole canvas instead.`;

const refuse = (reason: SpliceRefusal, label: string): SpliceAnswer => ({
  ok: false,
  reason,
  label,
  line: refusalLine(label),
});

type Edit = { start: number; end: number; text: string };

function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function hasArtboard(root: AnyNode): boolean {
  if (!isNode(root)) return false;
  if (root.type === 'JSXElement' && jsxTagName(root.openingElement?.name) === 'DCArtboard')
    return true;
  let found = false;
  forEachChild(root, (c) => {
    if (!found && hasArtboard(c)) found = true;
  });
  return found;
}

/** The function a top-level statement declares (the canvas component), or null. */
function fnOf(s: AnyNode): AnyNode | null {
  if (!isNode(s)) return null;
  if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration')
    return fnOf(s.declaration);
  if (
    s.type === 'FunctionDeclaration' ||
    s.type === 'FunctionExpression' ||
    s.type === 'ArrowFunctionExpression'
  )
    return s;
  if (s.type === 'VariableDeclaration' && s.declarations?.length === 1) {
    let init = s.declarations[0].init;
    while (init && (init.type === 'ParenthesizedExpression' || init.type === 'TSAsExpression'))
      init = init.expression;
    return init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
      ? init
      : null;
  }
  return null;
}

/** Where a declaration that came back goes: before the canvas component (module) / its render (local). */
function insertionPoints(model: TsxModel): { m: number; l: number } | null {
  for (const stmt of model.parsed.program.body ?? []) {
    if (!hasArtboard(stmt)) continue;
    const fn = fnOf(stmt);
    let l = stmt.start;
    if (fn?.body?.type === 'BlockStatement')
      for (const s of fn.body.body ?? [])
        if (hasArtboard(s)) {
          l = s.start;
          break;
        }
    return { m: stmt.start, l };
  }
  return null;
}

/** The indentation of the line `at` sits on. */
function indentAt(src: string, at: number): string {
  const lineStart = src.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(src.slice(lineStart, at))?.[0] ?? '';
}

const familyMatch = (family: string, id: string): boolean =>
  new RegExp(
    `^${family
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+')}$`
  ).test(id);

// ── imports ─────────────────────────────────────────────────────────────────────────────────

interface ImportInfo {
  text: string;
  source: string;
  locals: Array<{ local: string; text: string }>;
}

function importsOf(model: TsxModel, source: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  for (const stmt of model.parsed.program.body ?? []) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const locals: ImportInfo['locals'] = [];
    for (const s of stmt.specifiers ?? []) {
      const local = s.local?.name;
      if (typeof local !== 'string') continue;
      const text =
        s.type === 'ImportSpecifier'
          ? s.imported?.name && s.imported.name !== local
            ? `${s.imported.name} as ${local}`
            : local
          : '';
      locals.push({ local, text });
    }
    out.push({
      text: source.slice(stmt.start, stmt.end),
      source: String(stmt.source?.value ?? ''),
      locals,
    });
  }
  return out;
}

const mentions = (text: string, name: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_$.])${name.replace(/[$]/g, '\\$')}(?![A-Za-z0-9_$])`).test(text);

// ── CSS (hub lane) ──────────────────────────────────────────────────────────────────────────

interface CssChunk {
  key: string;
  text: string;
  classes: string[];
  start: number;
  end: number;
}

/** Top-level chunks of a stylesheet (comments and strings skipped), each with the classes it selects. */
function cssChunks(src: string): CssChunk[] | null {
  const out: CssChunk[] = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let preludeEnd = -1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return null;
      if (depth === 0 && src.slice(start, i).trim() === '') start = e + 2;
      i = e + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) preludeEnd = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        const text = src.slice(start, i + 1);
        const prelude = src.slice(start, preludeEnd).replace(/\/\*[\s\S]*?\*\//g, '');
        out.push({
          key: prelude.replace(/\s+/g, ' ').trim(),
          text: text.trim(),
          classes: classesOf(text, prelude),
          start: start + (text.length - text.trimStart().length),
          end: i + 1,
        });
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      start = i + 1; // `@import …;` — never this artboard's own
    }
    i++;
  }
  return depth === 0 ? out : null;
}

function classesOf(text: string, prelude: string): string[] {
  const p = prelude.trim();
  if (/^@(?:-\w+-)?keyframes\b/i.test(p) || /^@font-face\b/i.test(p)) return [];
  // A container at-rule: the classes its inner rules select.
  const selectors = p.startsWith('@')
    ? [...text.slice(text.indexOf('{') + 1).matchAll(/(^|[{};])\s*([^{};@]+)\{/g)].map((m) => m[2])
    : [p];
  const out = new Set<string>();
  for (const s of selectors) for (const m of s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return [...out];
}

/** class → the artboard keys it is used in (`''` = the canvas frame / a shared component). */
function classUse(model: TsxModel): Map<string, Set<string>> {
  const use = new Map<string, Set<string>>();
  for (const el of model.classElements()) {
    for (const c of el.classes) {
      if (c.prefix) continue;
      let s = use.get(c.token);
      if (!s) {
        s = new Set();
        use.set(c.token, s);
      }
      if (!el.artboards.length) s.add('');
      for (const a of el.artboards) s.add(a);
    }
  }
  return use;
}

function spliceCss(
  nowCss: string,
  oldCss: string,
  nowModel: TsxModel,
  oldModel: TsxModel,
  id: string
): { css: string; kept: number } | null {
  const now = cssChunks(nowCss);
  const old = cssChunks(oldCss);
  if (!now || !old) return null;
  const useNow = classUse(nowModel);
  const useOld = classUse(oldModel);
  const onlyHere = (c: string): boolean => {
    const a = useNow.get(c);
    const b = useOld.get(c);
    if (!a && !b) return false;
    for (const s of [a, b]) if (s) for (const k of s) if (k !== id) return false;
    return true;
  };
  const own = (ch: CssChunk): boolean => ch.classes.length > 0 && ch.classes.every(onlyHere);
  const oldByKey = new Map(old.map((c) => [c.key, c]));
  const nowKeys = new Set(now.map((c) => c.key));
  const edits: Edit[] = [];
  let kept = 0;
  for (const c of now) {
    const o = oldByKey.get(c.key);
    if (o && o.text === c.text) continue;
    if (own(c) && (!o || own(o))) edits.push({ start: c.start, end: c.end, text: o ? o.text : '' });
    else kept++;
  }
  const added: string[] = [];
  for (const o of old) {
    if (nowKeys.has(o.key)) continue;
    if (own(o)) added.push(o.text);
    else kept++;
  }
  let css = applyEdits(nowCss, edits).replace(/\n{3,}/g, '\n\n');
  if (added.length) css = `${css.replace(/\s*$/, '')}\n\n${added.join('\n\n')}\n`;
  return { css, kept };
}

// ── meta + annotations ──────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function parseJson(text: string | null | undefined): Obj | null | 'broken' {
  if (!text?.trim()) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return isObj(v) ? v : 'broken';
  } catch {
    return 'broken';
  }
}

const indentOf = (text: string): number | string => {
  const m = /\n([ \t]+)"/.exec(text);
  return m ? (m[1].includes('\t') ? '\t' : m[1].length) : 2;
};

/**
 * Where an artboard goes in a canvas that holds none: as the first child of the `<DCSection>` it stood in
 * (matched by id), else the first `<DCSection>` that has a closing tag, else `<DesignCanvas>`. A self-closing
 * container has no inside — refused by the caller.
 */
function emptyCanvasPlace(
  now: string,
  old: string,
  oldStart: number
): { at: number; pad: string } | null {
  const idOfSection = (() => {
    const opens = [...old.slice(0, oldStart).matchAll(/<DCSection\b[^>]*?\bid=["']([^"']+)["']/g)];
    return opens.at(-1)?.[1] ?? null;
  })();
  const closeOf = (tag: string, from: number): number => {
    const i = now.indexOf(`</${tag}>`, from);
    return i;
  };
  const candidates: Array<{ tag: string; from: number }> = [];
  if (idOfSection) {
    const m = new RegExp(`<DCSection\\b[^>]*?\\bid=["']${idOfSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?(?<!/)>`).exec(now);
    if (m) candidates.push({ tag: 'DCSection', from: m.index + m[0].length });
  }
  const anySection = /<DCSection\b[^>]*?(?<!\/)>/.exec(now);
  if (anySection) candidates.push({ tag: 'DCSection', from: anySection.index + anySection[0].length });
  const canvas = /<DesignCanvas\b[^>]*?(?<!\/)>/.exec(now);
  if (canvas) candidates.push({ tag: 'DesignCanvas', from: canvas.index + canvas[0].length });
  for (const { tag, from } of candidates) {
    if (closeOf(tag, from) < 0) continue;
    // first child of the container, one level deeper than the line its opening tag sits on
    const lineStart = now.lastIndexOf('\n', from) + 1;
    const lead = /^[ \t]*/.exec(now.slice(lineStart))?.[0] ?? '';
    return { at: from, pad: `${lead}  ` };
  }
  return null;
}

/** Replace (or drop, or append) the entry of `list` whose `id` is `id` with A's. */
function spliceById(now: unknown, old: unknown, id: string): unknown[] | undefined {
  const n = Array.isArray(now) ? now : undefined;
  const o = Array.isArray(old) ? old : undefined;
  if (!n && !o) return undefined;
  const mine = o?.find((e) => isObj(e) && e.id === id);
  const out: unknown[] = [];
  let placed = false;
  for (const e of n ?? []) {
    if (isObj(e) && e.id === id) {
      if (mine !== undefined && !placed) out.push(mine);
      placed = true;
      continue;
    }
    out.push(e);
  }
  if (mine !== undefined && !placed) out.push(mine);
  return out;
}

function spliceMeta(
  nowText: string,
  oldText: string | null | undefined,
  id: string
): string | null {
  const now = parseJson(nowText);
  const old = parseJson(oldText);
  if (!isObj(now)) return null;
  const a = isObj(old) ? old : {};
  const next: Obj = structuredClone(now);
  // layout.artboards[id]
  const nl = isObj(now.layout) ? now.layout.artboards : undefined;
  const ol = isObj(a.layout) ? a.layout.artboards : undefined;
  const layout = spliceById(nl, ol, id);
  if (layout && (isObj(next.layout) || layout.length)) {
    next.layout = { ...(isObj(next.layout) ? next.layout : {}), artboards: layout };
  }
  // artboardMeta[id]
  const nm = isObj(now.artboardMeta) ? now.artboardMeta : null;
  const om = isObj(a.artboardMeta) ? a.artboardMeta : null;
  if (nm || om) {
    const m: Obj = { ...(nm ?? {}) };
    if (om && Object.hasOwn(om, id)) m[id] = om[id];
    else delete m[id];
    next.artboardMeta = m;
  }
  // the `artboards[]` mirror (labels / notes)
  const mirror = spliceById(now.artboards, a.artboards, id);
  if (mirror && Array.isArray(now.artboards)) next.artboards = mirror;
  if (JSON.stringify(next) === JSON.stringify(now)) return null;
  return `${JSON.stringify(next, null, indentOf(nowText))}${nowText.endsWith('\n') ? '\n' : ''}`;
}

function spliceAnnotations(
  nowText: string,
  oldText: string | null | undefined,
  id: string
): string | null {
  const now = parseJson(nowText);
  if (!isObj(now) || !Array.isArray(now.elements)) return null;
  // Only a board this client reads is rewritten (a newer format stays byte for byte).
  if (!parseBoard(nowText).elements.length && now.elements.length) return null;
  const old = parseJson(oldText);
  const oldEls = isObj(old) && Array.isArray(old.elements) ? old.elements.filter(isObj) : [];
  // S2.10c — the artboard's members as ⌫ Move to trash takes them (annotations/artboard-members.ts):
  // `parentArtboard`, a section's contents, an arrow bound only to them.
  const oldMembers = artboardMembers(oldEls, [id]);
  const parented = (e: Obj) => typeof e.id === 'string' && oldMembers.has(e.id);
  const oldById = new Map(oldEls.filter((e) => typeof e.id === 'string').map((e) => [e.id, e]));
  const touched = new Set<unknown>([...oldMembers, ...artboardMembers(now.elements, [id])]);
  if (!touched.size) return null;
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  for (const e of now.elements) {
    if (!isObj(e) || !touched.has(e.id)) {
      out.push(e);
      continue;
    }
    seen.add(e.id);
    const o = oldById.get(e.id);
    if (o) out.push(o); // A's record (its own parent then); none → added since: it goes
  }
  for (const e of oldEls) if (parented(e) && !seen.has(e.id)) out.push(e);
  if (JSON.stringify(out) === JSON.stringify(now.elements)) return null;
  // The board's own layout: one element per line (DDR-242), every other top-level key kept.
  const { elements: _drop, ...head } = now;
  const prefix = JSON.stringify(head).slice(0, -1);
  const lines = out.map((e) => JSON.stringify(e));
  return `${prefix}${Object.keys(head).length ? ',' : ''}"elements":[${lines.length ? `\n${lines.join(',\n')}\n` : ''}]}\n`;
}

// ── the splice ──────────────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function restoreArtboard(
  _canvas: string,
  now: SpliceSide,
  old: SpliceSide,
  id: string
): SpliceAnswer {
  const mOld = parseModel(old.html);
  const mNow = parseModel(now.html);
  const label =
    (mOld?.artboards.some((a) => a.key === id) && mOld ? artboardLabel(mOld, id) : null) ??
    (mNow?.artboards.some((a) => a.key === id) && mNow ? artboardLabel(mNow, id) : null) ??
    id;
  if (!mOld || !mNow) return refuse('invalid-result', label);
  const isFamily = (m: TsxModel) =>
    m.artboards.some((a) => a.family && (a.key === id || familyMatch(a.key, id)));
  if (isFamily(mOld) || isFamily(mNow)) return refuse('family', label);
  const aOld = mOld.artboards.find((a) => a.key === id);
  if (!aOld) return refuse('not-in-version', label);
  // An id that is not unique on either side cannot be restored on its own.
  if (mOld.artboards.filter((a) => a.key === id).length > 1) return refuse('family', label);
  if (mNow.artboards.filter((a) => a.key === id).length > 1) return refuse('family', label);
  const aNow = mNow.artboards.find((a) => a.key === id);
  const src = now.html;
  const oldText = old.html.slice(aOld.node.start, aOld.node.end);
  const edits: Edit[] = [];

  // 1. the artboard's element range
  if (aNow) {
    if (src.slice(aNow.node.start, aNow.node.end) !== oldText)
      edits.push({ start: aNow.node.start, end: aNow.node.end, text: oldText });
  } else {
    const order = mOld.artboards.map((a) => a.key);
    const at = order.indexOf(id);
    const byKey = new Map<string, ArtboardInfo>(mNow.artboards.map((a) => [a.key, a]));
    let placed = false;
    for (let i = at - 1; i >= 0 && !placed; i--) {
      const prev = byKey.get(order[i] as string);
      if (!prev) continue;
      const pad = indentAt(src, prev.node.start);
      edits.push({ start: prev.node.end, end: prev.node.end, text: `\n${pad}${oldText}` });
      placed = true;
    }
    for (let i = at + 1; i < order.length && !placed; i++) {
      const next = byKey.get(order[i] as string);
      if (!next) continue;
      const pad = indentAt(src, next.node.start);
      edits.push({ start: next.node.start, end: next.node.start, text: `${oldText}\n${pad}` });
      placed = true;
    }
    // No neighbour left in Now — the canvas holds no artboard (every one was moved to the trash; 05 · es-all-trashed).
    // Put it where it was: inside the section it was in, else the first section, else the canvas itself.
    if (!placed) {
      const at = emptyCanvasPlace(src, old.html, aOld.node.start);
      if (!at) return refuse('invalid-result', label);
      edits.push({ start: at.at, end: at.at, text: `\n${at.pad}${oldText}` });
      placed = true;
    }
  }

  // 2. declarations the artboard reaches, and the imports they need
  const sharedKept: string[] = [];
  const restoredTexts: string[] = [oldText];
  const nowDecls = new Map(mNow.decls.map((d) => [d.key, d]));
  const points = insertionPoints(mNow);
  for (const d of mOld.decls) {
    if (!mOld.reach(d.key).includes(id)) continue;
    const dn = nowDecls.get(d.key);
    if (dn && dn.src === d.src) continue;
    const text = old.html.slice(d.node.start, d.node.end);
    if (dn) {
      const others = mNow.reach(dn.key).filter((k) => k !== id);
      if (others.length) {
        sharedKept.push(d.names[0] ?? d.key);
        continue;
      }
      edits.push({ start: dn.node.start, end: dn.node.end, text });
    } else {
      if (!points) return refuse('invalid-result', label);
      const at = d.key.startsWith('l:') ? points.l : points.m;
      edits.push({
        start: at,
        end: at,
        text: `${text}\n${d.key.startsWith('l:') ? indentAt(src, at) : '\n'}`,
      });
    }
    restoredTexts.push(text);
  }
  const nowImports = importsOf(mNow, src);
  const nowLocals = new Set(nowImports.flatMap((x) => x.locals.map((l) => l.local)));
  const declared = new Set(mNow.decls.flatMap((d) => d.names));
  const needed = restoredTexts.join('\n');
  const newImports: string[] = [];
  for (const imp of importsOf(mOld, old.html)) {
    const missing = imp.locals.filter(
      (l) => !nowLocals.has(l.local) && !declared.has(l.local) && mentions(needed, l.local)
    );
    if (!missing.length) continue;
    if (missing.length === imp.locals.length) newImports.push(imp.text);
    else if (missing.every((l) => l.text))
      newImports.push(`import { ${missing.map((l) => l.text).join(', ')} } from '${imp.source}';`);
    else newImports.push(imp.text);
  }
  if (newImports.length) {
    const lastImport = [...(mNow.parsed.program.body ?? [])]
      .filter((s: AnyNode) => s.type === 'ImportDeclaration')
      .at(-1);
    const at = lastImport ? lastImport.end : 0;
    edits.push({
      start: at,
      end: at,
      text: lastImport ? `\n${newImports.join('\n')}` : `${newImports.join('\n')}\n`,
    });
  }

  const lanes: Partial<Record<SpliceLane, string>> = {};
  if (edits.length) {
    const html = applyEdits(src, edits);
    // 6. the parse check: the result parses and still carries the artboard, once.
    const check = parseModel(html);
    if (check?.artboards.filter((a) => a.key === id).length !== 1)
      return refuse('invalid-result', label);
    lanes.html = html;
  }

  // 3. CSS
  if (typeof now.css === 'string' && typeof old.css === 'string' && now.css !== old.css) {
    const r = spliceCss(now.css, old.css, mNow, mOld, id);
    if (r) {
      if (r.css !== now.css) lanes.css = r.css;
      if (r.kept) sharedKept.push(plural(r.kept, 'style', 'styles'));
    }
  }
  // 4. meta
  if (typeof now.meta === 'string' && now.meta.trim()) {
    const m = spliceMeta(now.meta, old.meta, id);
    if (m !== null) lanes.meta = m;
  }
  // 5. annotations
  if (typeof now.annotations === 'string' && now.annotations.trim()) {
    const a = spliceAnnotations(now.annotations, old.annotations, id);
    if (a !== null) lanes.annotations = a;
  }

  const why = sharedKept.length
    ? `Restores ${label} as it was, as a new version. It uses parts other artboards share — ${sharedKept.join(', ')} — they stay as they are now.`
    : null;
  return { ok: true, lanes, sharedKept, label, why };
}

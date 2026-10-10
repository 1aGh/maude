// agent-evals/lib/tsx.mjs — canvas TSX analysis for the eval graders and the prototype check.
//
// One oxc parse gives three things the V2-1.18 harness needs:
//   - artboards: every <DCArtboard id="…"> with its source span;
//   - elements: every JSX element with its authored `data-cd-id` (V2-1.4), `data-cd-locked`,
//     the artboard it sits in, and a print (tag + literal attributes + own text + style text);
//   - top-level declarations with the identifiers they reference, so a change to a shared
//     component is attributed to every artboard that (transitively) renders it — the V2-1.5
//     `attributeArtboards` reference closure, simplified (locals of the canvas component count
//     as a canvas-component change → whole-file scope).
//
// Offsets are the JS string offsets oxc-parser's JS API returns (UTF-16), same as canvas-edit.ts.

import { parseSync } from 'oxc-parser';

const AUTHORED_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMPUTED_ID_RE = /^[0-9a-f]{8}$/;

function jsxName(n) {
  if (!n) return '?';
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${jsxName(n.property)}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace?.name}:${n.name?.name}`;
  return '?';
}

function attr(opening, name) {
  for (const a of opening?.attributes ?? []) {
    if (a?.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === name)
      return a;
  }
  return null;
}

function literalOf(a) {
  const v = a?.value;
  if (!v) return null;
  if (v.type === 'Literal' || v.type === 'StringLiteral')
    return typeof v.value === 'string' ? v.value : String(v.value);
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression;
    if (e && (e.type === 'Literal' || e.type === 'StringLiteral')) return String(e.value);
    if (e?.type === 'TemplateLiteral' && e.expressions.length === 0)
      return e.quasis.map((q) => q.value.cooked).join('');
  }
  return undefined; // an expression
}

function ownText(node) {
  let t = '';
  for (const c of node?.children ?? []) if (c?.type === 'JSXText') t += String(c.value);
  return t.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function literalAttrs(opening, src) {
  const out = [];
  for (const a of opening?.attributes ?? []) {
    if (a?.type !== 'JSXAttribute' || a.name?.type !== 'JSXIdentifier') continue;
    const name = String(a.name.name);
    if (name.startsWith('data-cd-') || name === 'key') continue;
    const lit = literalOf(a);
    out.push(
      `${name}=${lit === undefined ? src.slice(a.value.start, a.value.end) : lit === null ? 'true' : lit}`
    );
  }
  return out.sort().join('|');
}

/** Identifiers referenced anywhere under `node` (Identifier + JSXIdentifier names). */
function collectRefs(node, into = new Set()) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    if (n.type === 'Identifier' || n.type === 'JSXIdentifier' || n.type === 'IdentifierReference') {
      if (typeof n.name === 'string') into.add(n.name);
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return into;
}

function declNames(stmt) {
  const d =
    stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration'
      ? stmt.declaration
      : stmt;
  if (!d) return [];
  if (stmt.type === 'ExportDefaultDeclaration') return [d.id?.name ?? 'default'];
  if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration')
    return d.id?.name ? [d.id.name] : [];
  if (d.type === 'VariableDeclaration') {
    return d.declarations.flatMap((x) => (x.id?.type === 'Identifier' ? [x.id.name] : []));
  }
  if (
    d.type === 'TSTypeAliasDeclaration' ||
    d.type === 'TSInterfaceDeclaration' ||
    d.type === 'TSEnumDeclaration'
  ) {
    return d.id?.name ? [d.id.name] : [];
  }
  return [];
}

/**
 * Scan one canvas source.
 * @returns {{ ok: boolean, error?: string, artboards: Array<{id:string,label?:string,start:number,end:number}>,
 *   elements: Array<{cdId:string|null, cdIdKind:'literal'|'expression'|null, locked:boolean, tag:string,
 *     artboard:string|null, start:number, end:number, line:number, print:string, text:string}>,
 *   decls: Array<{names:string[], start:number, end:number, refs:Set<string>, text:string}>,
 *   imports: string, other: string }}
 */
export function scanCanvas(path, src) {
  let parsed;
  try {
    parsed = parseSync(path.endsWith('.tsx') || path.endsWith('.jsx') ? path : `${path}.tsx`, src, {
      sourceType: 'module',
    });
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message ?? e),
      artboards: [],
      elements: [],
      decls: [],
      imports: '',
      other: '',
    };
  }
  if (parsed.errors?.length) {
    const e = parsed.errors[0];
    return {
      ok: false,
      error: `${e.message ?? 'parse error'}${e.labels?.[0] ? ` at ${lineOf(src, e.labels[0].start)}` : ''}`,
      artboards: [],
      elements: [],
      decls: [],
      imports: '',
      other: '',
    };
  }
  const artboards = [];
  const sections = [];
  const elements = [];
  const lineStarts = lineIndex(src);
  const visit = (node, ab) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c, ab);
      return;
    }
    let here = ab;
    if (node.type === 'JSXElement') {
      const op = node.openingElement;
      const tag = jsxName(op?.name);
      if (tag === 'DCSection')
        sections.push({ id: literalOf(attr(op, 'id')) ?? null, start: node.start, end: node.end });
      if (tag === 'DCArtboard') {
        const id = literalOf(attr(op, 'id'));
        if (typeof id === 'string') {
          artboards.push({
            id,
            label: literalOf(attr(op, 'label')) ?? undefined,
            start: node.start,
            end: node.end,
          });
          here = id;
        }
      }
      const idAttr = attr(op, 'data-cd-id');
      const idLit = idAttr ? literalOf(idAttr) : null;
      elements.push({
        cdId: typeof idLit === 'string' ? idLit : null,
        cdIdKind: idAttr ? (typeof idLit === 'string' ? 'literal' : 'expression') : null,
        locked: !!attr(op, 'data-cd-locked'),
        tag,
        artboard: here,
        start: node.start,
        end: node.end,
        line: lineAt(lineStarts, node.start),
        print: `${tag}|${literalAttrs(op, src)}|${ownText(node)}`,
        text: ownText(node),
      });
    }
    for (const k in node) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (v && typeof v === 'object') visit(v, here);
    }
  };
  visit(parsed.program, null);

  const decls = [];
  let imports = '';
  let other = '';
  for (const stmt of parsed.program.body) {
    if (stmt.type === 'ImportDeclaration') {
      imports += `${src.slice(stmt.start, stmt.end)}\n`;
      continue;
    }
    const names = declNames(stmt);
    if (names.length) {
      decls.push({
        names,
        start: stmt.start,
        end: stmt.end,
        refs: collectRefs(stmt),
        text: src.slice(stmt.start, stmt.end),
      });
    } else {
      other += `${src.slice(stmt.start, stmt.end)}\n`;
    }
  }
  for (const s of sections)
    s.artboards = artboards.filter((a) => a.start >= s.start && a.end <= s.end).map((a) => a.id);
  return { ok: true, artboards, sections, elements, decls, imports, other };
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineAt(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
export function lineOf(src, off) {
  return lineAt(lineIndex(src), off);
}

/** Replace every artboard span inside [start,end) by a stable placeholder, so the canvas component's own text compares without artboard bodies. */
function maskArtboards(src, start, end, artboards, dropSections = []) {
  let out = '';
  let cur = start;
  // A section that only holds added (or only removed) artboards is part of the artboard-set change.
  const spans = [
    ...dropSections,
    ...artboards.filter((a) => !dropSections.some((s) => a.start >= s.start && a.end <= s.end)),
  ];
  for (const ab of spans
    .filter((a) => a.start >= start && a.end <= end)
    .sort((a, b) => a.start - b.start)) {
    out += src.slice(cur, ab.start);
    cur = ab.end;
  }
  out += src.slice(cur, end);
  return out.replace(/\s+/g, ' ').trim();
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Line-level: does `after` only ADD whole lines to `before` (every line of `before` survives unchanged,
 * in order)? A new icon entry or a new helper is additive; an edited existing line (a changed text,
 * a widened signature) is not — token-level was too loose ("Nothing to save" → "Nothing to save yet").
 */
export function insertionOnly(before, after) {
  const lines = (s) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  const A = lines(before);
  const B = lines(after);
  let i = 0;
  for (const t of B) if (i < A.length && t === A[i]) i++;
  return i === A.length;
}

/**
 * Which artboards a change from `before` to `after` reaches (V2-1.5 §5.7, simplified).
 * @returns {{ scope:'artboards'|'file'|'none', artboards:string[], reason?:string, detail?:string[] }}
 *
 * `lenient` (graders only — the hook keeps V2-1.5's strict closure): an import that is only ADDED,
 * a `DCSection` label change, and a lines-added-only change of a shared declaration (a new icon in a
 * map, a new helper) do not reach the existing artboards — a proxy for "renders the same".
 */
export function attributeArtboards(path, before, after, { lenient = false } = {}) {
  if (before === after) return { scope: 'none', artboards: [] };
  const a = scanCanvas(path, before);
  const b = scanCanvas(path, after);
  if (!a.ok || !b.ok) return { scope: 'file', artboards: [], reason: 'parse-error' };
  const marked = new Set();
  const detail = [];
  let fileReason = null;
  if (norm(a.imports) !== norm(b.imports) && !(lenient && insertionOnly(a.imports, b.imports)))
    fileReason = 'imports';
  if (norm(a.other) !== norm(b.other)) fileReason ??= 'module-scope';

  const abA = new Map(a.artboards.map((x) => [x.id, x]));
  const abB = new Map(b.artboards.map((x) => [x.id, x]));
  for (const id of new Set([...abA.keys(), ...abB.keys()])) {
    const x = abA.get(id);
    const y = abB.get(id);
    if (!x || !y) {
      marked.add(id);
      detail.push(`${id}: artboard-set-changed`);
    } else if (before.slice(x.start, x.end) !== after.slice(y.start, y.end)) {
      marked.add(id);
      detail.push(`${id}: own JSX`);
    }
  }

  // Declarations: compare by name; a decl that holds artboards is compared with them masked.
  const onlyIn = (scan, other) =>
    (scan.sections ?? []).filter(
      (s) =>
        s.artboards.length > 0 &&
        s.artboards.every((id) => !other.artboards.some((x) => x.id === id))
    );
  const byName = (scan, src, other) => {
    const m = new Map();
    const drop = onlyIn(scan, other);
    for (const d of scan.decls) {
      const holds = scan.artboards.some((ab) => ab.start >= d.start && ab.end <= d.end);
      let cmp = holds ? maskArtboards(src, d.start, d.end, scan.artboards, drop) : norm(d.text);
      if (holds && lenient) cmp = cmp.replace(/<DCSection\b[^>]*>/g, '<DCSection>');
      m.set(d.names.join(','), { ...d, holds, cmp });
    }
    return m;
  };
  const dA = byName(a, before, b);
  const dB = byName(b, after, a);
  const changed = new Set();
  for (const k of new Set([...dA.keys(), ...dB.keys()])) {
    const x = dA.get(k);
    const y = dB.get(k);
    if (!x || !y || x.cmp !== y.cmp) {
      if ((x?.holds || y?.holds) && x && y) {
        // The canvas component itself changed outside its artboards (a new section, a local const…).
        fileReason ??= 'canvas-component';
        detail.push(`${k}: canvas component outside artboards`);
      } else if (lenient && x && y && insertionOnly(x.text, y.text)) {
        detail.push(`${k}: insertion-only (not counted)`);
      } else {
        for (const n of k.split(',')) changed.add(n);
      }
    }
  }
  if (changed.size) {
    // Reference closure on the AFTER side (and BEFORE, for removed decls).
    for (const [scan, src] of [
      [b, after],
      [a, before],
    ]) {
      const declOf = new Map();
      for (const d of scan.decls) for (const n of d.names) declOf.set(n, d);
      for (const ab of scan.artboards) {
        const seen = new Set();
        const queue = [...collectRefsInSpan(src, scan, ab)];
        let hit = null;
        while (queue.length) {
          const name = queue.pop();
          if (seen.has(name)) continue;
          seen.add(name);
          if (changed.has(name)) {
            hit = name;
            break;
          }
          const d = declOf.get(name);
          if (d && !scan.artboards.some((x) => x.start >= d.start && x.end <= d.end))
            for (const r of d.refs) queue.push(r);
        }
        if (hit && !marked.has(ab.id)) {
          marked.add(ab.id);
          detail.push(`${ab.id}: via ${hit}`);
        }
      }
    }
    // A changed decl no artboard reaches is still a change (dead code / a new helper) — not file scope.
  }
  if (fileReason) return { scope: 'file', artboards: [...marked], reason: fileReason, detail };
  return { scope: marked.size ? 'artboards' : 'none', artboards: [...marked], detail };
}

const refCache = new WeakMap();
function collectRefsInSpan(src, _scan, ab) {
  // Re-parse-free: identifiers inside the artboard span, by a token scan of the span text.
  let m = refCache.get(ab);
  if (!m) {
    m = new Set(src.slice(ab.start, ab.end).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []);
    refCache.set(ab, m);
  }
  return m;
}

export function isAuthoredId(s) {
  return (
    typeof s === 'string' && s.length <= 48 && AUTHORED_ID_RE.test(s) && !COMPUTED_ID_RE.test(s)
  );
}

/** The artboard (id) whose span contains [start,end), or null. */
export function artboardAt(scan, start, end = start) {
  for (const ab of scan.artboards) if (ab.start <= start && end <= ab.end) return ab.id;
  return null;
}

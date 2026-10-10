// `maude design ds-check --canvas` — the S-rules (V2-1.13 §5.7): what keeps a canvas
// switchable between design systems. Deterministic and read-only; `fixCanvas` applies the
// three mechanical kinds (alias, own-css, wrapper) as byte-minimal span edits.
//
// Sources of a canvas: its `.tsx`, its sibling `.css`, and every stylesheet it imports that
// resolves inside <designRoot>/ but outside system/ (a shared `_kit.css`'s `--k-*` names are
// canvas-local). TSX via oxc-parser, CSS via ds/css-scan.ts.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import type { SystemReport } from './check.ts';
import { lineCol, ownDeclarations, scanCssRules, splitTopLevel } from './css-scan.ts';
import { aliasFor, type RegistryIndex, slotKindOf } from './registry.ts';
import type { SystemConfig, SystemModel } from './system.ts';
import { isNamedColor, varRefs } from './value-types.ts';

export type CanvasState = 'switchable' | 'review' | 'blocked' | 'pinned';

export interface Finding {
  rule: string;
  kind: string;
  name?: string;
  file: string;
  line: number;
  col: number;
  severity: 'autofix' | 'warning' | 'blocker';
  fix?: string;
  /** internal: the span a mechanical fix replaces */
  span?: [number, number];
}

export interface CanvasReport {
  path: string;
  system: string | null;
  state: CanvasState;
  findings: Finding[];
  pins: Record<string, number>;
  truncated: number;
}

export interface CanvasContext {
  designRoot: string;
  config: Record<string, unknown>;
  systems: SystemConfig[];
  models: Map<string, SystemModel>;
  reports: Map<string, SystemReport>;
  idx: RegistryIndex;
}

const MAX_FINDINGS = 500;
const BLOCKING = new Set([
  'S2:undefined',
  'S2:foreign',
  'S5:kit-module',
  'S5:other-system',
  'S9:meta',
]);
const COLOR_ATTRS = new Set([
  'fill',
  'stroke',
  'stopColor',
  'stop-color',
  'color',
  'floodColor',
  'lightingColor',
]);
const TYPE_PROPS = new Set(['font-size', 'font-weight', 'letter-spacing', 'font-family', 'font']);
const BOX_PROP_RE =
  /^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(gap|row-gap|column-gap)$|^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/;
const TYPE_TOKEN_RE = /var\(\s*--(type-|display-|lh-|weight-|tracking-|font-)/;
const CSS_WIDE = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'currentcolor',
  'transparent',
  'none',
  'auto',
  'normal',
]);
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
]);

const kebab = (p: string) =>
  p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A colour literal: a colour function whose arguments hold no `var(`, a hex, or a named colour. */
export function colourLiterals(value: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  // strip strings and url() first (offsets preserved)
  const v = value.replace(/"[^"]*"|'[^']*'|url\([^)]*\)/gi, (m) => ' '.repeat(m.length));
  for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push({ text: m[0], index: m.index ?? 0 });
  const fnRe = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;
  for (let m = fnRe.exec(v); m; m = fnRe.exec(v)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < v.length; end++) {
      if (v[end] === '(') depth++;
      else if (v[end] === ')' && --depth === 0) break;
    }
    const call = v.slice(m.index, end + 1);
    if (!/var\(/.test(call)) out.push({ text: call, index: m.index });
    fnRe.lastIndex = end + 1;
  }
  const noFns = v
    .replace(/var\([^)]*\)/g, (m) => ' '.repeat(m.length))
    .replace(/\b[a-z-]+\(/gi, (m) => ' '.repeat(m.length));
  for (const m of noFns.matchAll(/(?<![\w#-])([A-Za-z]+)(?![\w-])/g)) {
    const w = m[1].toLowerCase();
    if (w === 'transparent' || w === 'currentcolor') continue;
    if (isNamedColor(w)) out.push({ text: m[1], index: m.index ?? 0 });
  }
  return out;
}

function boxLiteral(value: string): boolean {
  const v = value.replace(/var\([^)]*\)/g, ' ').replace(/\b(calc|min|max|clamp)\(/g, ' ');
  for (const m of v.matchAll(/(?<![\w-])(-?\d*\.?\d+)(px|rem|em|%|vh|vw|ch|pt)\b/g))
    if (Number(m[1]) !== 0) return true;
  return false;
}

interface Src {
  rel: string;
  text: string;
  kind: 'tsx' | 'css';
  /** the canvas's own files (fixable); imported shared stylesheets are not */
  own: boolean;
}

interface Ast {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

function walk(node: unknown, visit: (n: Ast, parents: Ast[]) => void, parents: Ast[] = []): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit, parents);
    return;
  }
  const n = node as Ast;
  if (typeof n.type === 'string') visit(n, parents);
  const next = typeof n.type === 'string' ? [...parents, n] : parents;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'range' || k === 'loc') continue;
    if (v && typeof v === 'object') walk(v, visit, next);
  }
}

function jsxName(n: Ast): string | null {
  const name = n.name as Ast | undefined;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name as string;
  if (name.type === 'JSXMemberExpression') {
    const parts: string[] = [];
    let cur: Ast | undefined = name;
    while (cur?.type === 'JSXMemberExpression') {
      parts.unshift((cur.property as Ast).name as string);
      cur = cur.object as Ast;
    }
    if (cur?.type === 'JSXIdentifier') parts.unshift(cur.name as string);
    return parts.join('.');
  }
  return null;
}

function attr(open: Ast, name: string): Ast | null {
  for (const a of (open.attributes as Ast[]) ?? []) {
    if (a.type === 'JSXAttribute' && ((a.name as Ast)?.name as string) === name) return a;
  }
  return null;
}

function staticString(v: Ast | null | undefined): { text: string; start: number } | null {
  if (!v) return null;
  if (v.type === 'Literal' && typeof v.value === 'string')
    return { text: v.value as string, start: v.start + 1 };
  if (v.type === 'JSXExpressionContainer') return staticString(v.expression as Ast);
  if (v.type === 'TemplateLiteral' && ((v.expressions as unknown[]) ?? []).length === 0) {
    const q = (v.quasis as Ast[])[0];
    return {
      text: ((q.value as { raw: string }).raw ?? '') as string,
      start: q.end - 1 - ((q.value as { raw: string }).raw ?? '').length,
    }; // oxc spans include the backticks;
  }
  return null;
}

/** Resolve a module specifier from a canvas to a designRoot-relative path (or null). */
function resolveSpec(ctx: CanvasContext, fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const abs = resolve(dirname(join(ctx.designRoot, fromRel)), spec);
  const rel = relative(ctx.designRoot, abs);
  if (rel.startsWith('..')) return null;
  for (const cand of [rel, `${rel}.tsx`, `${rel}.ts`, `${rel}.jsx`, `${rel}.js`, `${rel}.css`]) {
    try {
      if (statSync(join(ctx.designRoot, cand)).isFile()) return cand;
    } catch {}
  }
  return rel;
}

function readRel(ctx: CanvasContext, rel: string): string | null {
  try {
    return readFileSync(join(ctx.designRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

export function canvasRelOf(designRoot: string, root: string, input: string): string {
  const abs = resolve(root, input);
  const rel = relative(designRoot, abs);
  if (!rel.startsWith('..')) return rel;
  return input.replace(/^\.design\//, '');
}

export function checkCanvas(
  ctx: CanvasContext,
  rel: string,
  opts: { strict?: boolean } = {}
): CanvasReport {
  const findings: Finding[] = [];
  const pins: Record<string, number> = {};
  const pin = (k: string) => {
    pins[k] = (pins[k] ?? 0) + 1;
  };
  const tsx = readRel(ctx, rel);
  const specimen = /^system\/([^/]+)\/preview\//.exec(rel);
  const metaRel = rel.replace(/\.tsx$/, '.meta.json');
  let meta: Record<string, unknown> | null = null;
  const metaText = readRel(ctx, metaRel);
  if (metaText) {
    try {
      meta = JSON.parse(metaText);
    } catch {
      meta = null;
    }
  }
  const sysName = specimen
    ? (ctx.systems.find((s) => s.path === `system/${specimen[1]}`)?.name ?? specimen[1])
    : typeof meta?.designSystem === 'string'
      ? (meta.designSystem as string)
      : null;
  const sys = ctx.systems.find((s) => s.name === sysName) ?? null;
  const model = sys ? (ctx.models.get(sys.name) ?? null) : null;
  const report = sys ? (ctx.reports.get(sys.name) ?? null) : null;
  const strict = opts.strict ?? ctx.config.dsFidelity === 'strict';
  const sev = (rule: string, kind: string): Finding['severity'] => {
    if (BLOCKING.has(`${rule}:${kind}`)) return 'blocker';
    if (['alias', 'own-css', 'wrapper'].includes(kind)) return 'autofix';
    if (strict && rule === 'S1') return 'blocker';
    return 'warning';
  };
  const add = (
    f: Omit<Finding, 'severity' | 'line' | 'col'> & { offset: number; text: string }
  ) => {
    const { line, col } = lineCol(f.text, f.offset);
    const { offset: _o, text: _t, ...rest } = f;
    findings.push({ ...rest, line, col, severity: sev(f.rule, f.kind) });
  };

  if (tsx === null) {
    return {
      path: rel,
      system: sysName,
      state: 'blocked',
      findings: [
        {
          rule: 'S9',
          kind: 'meta',
          file: rel,
          line: 0,
          col: 0,
          severity: 'blocker',
          name: 'unreadable',
        },
      ],
      pins,
      truncated: 0,
    };
  }
  // ── S9 meta ───────────────────────────────────────────────────────────────
  if (!specimen) {
    if (!meta)
      add({ rule: 'S9', kind: 'meta', name: '.meta.json', file: rel, offset: 0, text: tsx });
    else if (!sys)
      add({
        rule: 'S9',
        kind: 'meta',
        name: `designSystem=${String(meta.designSystem ?? '(absent)')}`,
        file: rel,
        offset: 0,
        text: tsx,
      });
  }
  const pinned = meta?.opt_out_scope === 'full' || meta?.dsPinned === true;

  // ── Sources ───────────────────────────────────────────────────────────────
  const sources: Src[] = [{ rel, text: tsx, kind: 'tsx', own: true }];
  const siblingCss = rel.replace(/\.tsx$/, '.css');
  const siblingText = readRel(ctx, siblingCss);
  if (siblingText !== null)
    sources.push({ rel: siblingCss, text: siblingText, kind: 'css', own: true });

  let program: unknown = null;
  try {
    program = parseSync(rel, tsx, { sourceType: 'module', lang: 'tsx' }).program;
  } catch {
    program = null;
  }
  const imports: {
    spec: string;
    start: number;
    end: number;
    resolved: string | null;
    from: string;
  }[] = [];
  if (program) {
    walk(program, (n) => {
      if (
        (n.type === 'ImportDeclaration' ||
          n.type === 'ExportNamedDeclaration' ||
          n.type === 'ExportAllDeclaration') &&
        n.source
      ) {
        const spec = (n.source as Ast).value as string;
        imports.push({
          spec,
          start: n.start,
          end: n.end,
          resolved: resolveSpec(ctx, rel, spec),
          from: rel,
        });
      }
      if (n.type === 'ImportExpression' && (n.source as Ast)?.type === 'Literal') {
        const spec = (n.source as Ast).value as string;
        imports.push({
          spec,
          start: n.start,
          end: n.end,
          resolved: resolveSpec(ctx, rel, spec),
          from: rel,
        });
      }
    });
  }
  // CSS @imports of the sibling CSS (and transitively of imported shared CSS, one level)
  const cssImports = (src: Src) => {
    for (const m of src.text.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?[^;]*;/g)) {
      imports.push({
        spec: m[1],
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
        resolved: resolveSpec(ctx, src.rel, m[1]),
        from: src.rel,
      });
    }
  };
  if (siblingText !== null) cssImports(sources[1]);
  for (const im of [...imports]) {
    if (
      !im.resolved?.endsWith('.css') ||
      im.resolved.startsWith('system/') ||
      im.resolved === siblingCss
    )
      continue;
    const text = readRel(ctx, im.resolved);
    if (text !== null && !sources.some((s) => s.rel === im.resolved)) {
      const s: Src = { rel: im.resolved, text, kind: 'css', own: false };
      sources.push(s);
    }
  }

  // ── S5 system imports + S8 font imports ──────────────────────────────────
  if (!specimen) {
    for (const im of imports) {
      if (!im.resolved?.startsWith('system/')) continue;
      const src = sources.find((s) => s.rel === im.from) as Src;
      const owner = /^system\/([^/]+)\//.exec(im.resolved)?.[1];
      const ownSys = sys && sys.path === `system/${owner}`;
      if (!ownSys) {
        add({
          rule: 'S5',
          kind: 'other-system',
          name: im.spec,
          file: im.from,
          offset: im.start,
          text: src.text,
        });
        continue;
      }
      if (/\.(t|j)sx?$/.test(im.resolved)) {
        add({
          rule: 'S5',
          kind: 'kit-module',
          name: im.spec,
          file: im.from,
          offset: im.start,
          text: src.text,
        });
        continue;
      }
      if (
        im.resolved === sys.tokensCssRel ||
        im.resolved === `${sys.path}/preview/_components.css`
      ) {
        add({
          rule: 'S5',
          kind: 'own-css',
          name: im.spec,
          file: im.from,
          offset: im.start,
          text: src.text,
          fix: 'remove the import (the shell injects it)',
          span: [im.start, im.end],
        });
        continue;
      }
      const css = readRel(ctx, im.resolved) ?? '';
      if (/@font-face/.test(css))
        add({
          rule: 'S8',
          kind: 'font',
          name: im.spec,
          file: im.from,
          offset: im.start,
          text: src.text,
        });
    }
  }

  // ── Declared names in canvas sources (S2 "local") ────────────────────────
  const localNames = new Set<string>();
  for (const s of sources) {
    const text = s.kind === 'css' ? s.text : tsx;
    for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) localNames.add(m[1]);
    // TSX: `'--x': v`, `['--x' as string]: v`, `setProperty('--x', v)`
    if (s.kind === 'tsx')
      for (const m of text.matchAll(
        /["'](--[A-Za-z0-9_-]+)["'](?:\s+as\s+[A-Za-z]+)?\s*\]?\s*[:,]/g
      ))
        localNames.add(m[1]);
  }
  const otherDeclared = new Map<string, string>();
  for (const [name, m] of ctx.models)
    if (name !== sysName)
      for (const n of m.declared) if (!otherDeclared.has(n)) otherDeclared.set(n, name);
  const fontStacks = new Set<string>();
  for (const d of model?.decls ?? []) {
    if (!d.name.startsWith('--font-')) continue;
    for (const f of splitTopLevel(d.value, ','))
      fontStacks.add(f.replace(/^["']|["']$/g, '').toLowerCase());
  }

  const idx = ctx.idx;
  const s2 = (
    name: string,
    hasFallback: boolean,
    file: string,
    offset: number,
    text: string,
    nameAt: number
  ) => {
    if (idx.roles.has(name) || slotKindOf(idx, name)) return;
    if (localNames.has(name)) {
      if (idx.localPalette.test(name)) pin('local-palette');
      return;
    }
    if (model) {
      const a = aliasFor(idx, name, model.declared);
      if (a) {
        add({
          rule: 'S2',
          kind: 'alias',
          name,
          file,
          offset,
          text,
          fix: a.v1,
          span: [nameAt, nameAt + name.length],
        });
        return;
      }
      if (model.declared.has(name)) {
        pin(`own-token:${name}`);
        return;
      }
    }
    if (idx.ownToken.test(name) && model?.declared.has(name)) {
      pin(`own-token:${name}`);
      return;
    }
    if (otherDeclared.has(name)) {
      add({ rule: 'S2', kind: 'foreign', name, file, offset, text });
      return;
    }
    if (hasFallback) {
      add({ rule: 'S2', kind: 'undefined-fallback', name, file, offset, text });
      return;
    }
    add({ rule: 'S2', kind: 'undefined', name, file, offset, text });
  };

  const checkValue = (
    prop: string,
    value: string,
    file: string,
    valueAt: number,
    text: string,
    ctxFlags: { s1: boolean; t: boolean }
  ) => {
    for (const r of varRefs(value)) {
      const nameAt = valueAt + r.index + value.slice(r.index).indexOf(r.name);
      s2(r.name, r.hasFallback, file, nameAt, text, nameAt);
    }
    const p = kebab(prop);
    if (p.startsWith('--')) {
      if (idx.localPalette.test(p)) return; // --c-* local palette: S1-exempt
    }
    if (ctxFlags.s1 && !pinned) {
      for (const lit of colourLiterals(value)) {
        add({
          rule: 'S1',
          kind: 'literal',
          name: lit.text,
          file,
          offset: valueAt + lit.index,
          text,
        });
        pin('literal-colour');
      }
    }
    const plain = value.trim().toLowerCase();
    if (
      TYPE_PROPS.has(p) &&
      !ctxFlags.t &&
      !TYPE_TOKEN_RE.test(value) &&
      !/var\(/.test(value) &&
      !CSS_WIDE.has(plain)
    ) {
      add({
        rule: 'S3',
        kind: 'literal',
        name: `${p}: ${value.trim().slice(0, 40)}`,
        file,
        offset: valueAt,
        text,
      });
    }
    if (BOX_PROP_RE.test(p) && boxLiteral(value)) {
      add({
        rule: 'S4',
        kind: 'literal',
        name: `${p}: ${value.trim().slice(0, 40)}`,
        file,
        offset: valueAt,
        text,
      });
    }
    if (p === 'font-family' && fontStacks.size && !/var\(/.test(value)) {
      for (const f of splitTopLevel(value, ',')) {
        const fam = f.replace(/^["']|["']$/g, '').toLowerCase();
        if (!GENERIC_FAMILIES.has(fam) && !fontStacks.has(fam)) {
          add({ rule: 'S8', kind: 'font', name: f, file, offset: valueAt, text });
          break;
        }
      }
    }
  };

  // ── CSS sources ───────────────────────────────────────────────────────────
  const cssCheck = (text: string, file: string, base = 0, fileText = text) => {
    const rules = scanCssRules(text);
    rules.forEach((r, i) => {
      if (r.atRule === 'font-face') {
        add({
          rule: 'S8',
          kind: 'font',
          name: '@font-face',
          file,
          offset: base + r.preludeStart,
          text: fileText,
        });
        return;
      }
      if (r.atRule) return;
      const typeRule = /\.t-[a-z0-9-]+/.test(r.selector);
      const exempt = /\[data-ds-exempt/.test(r.selector);
      for (const d of ownDeclarations(text, rules, i)) {
        checkValue(d.prop, d.rawValue, file, base + d.valueStart, fileText, {
          s1: !exempt,
          t: typeRule,
        });
      }
    });
  };
  for (const s of sources) if (s.kind === 'css') cssCheck(s.text, s.rel);

  // ── TSX ───────────────────────────────────────────────────────────────────
  if (program) {
    const rootClasses = new Set<string>(
      [
        ...ctx.systems.map((s) => s.rootClass),
        typeof ctx.config.rootClass === 'string' ? (ctx.config.rootClass as string) : null,
      ].filter(Boolean) as string[]
    );
    const hasBrand = Boolean(
      report && (report.components.brand.logo || report.components.manifest === 'ok')
    );
    walk(program, (n, parents) => {
      // <style>{`…`}</style> and css template strings: scan as CSS
      if (n.type === 'TemplateLiteral' && ((n.expressions as unknown[]) ?? []).length === 0) {
        const q = (n.quasis as Ast[])[0];
        const raw = ((q.value as { raw: string }).raw ?? '') as string;
        if (/[{;]/.test(raw) && /:\s*[^;]+;/.test(raw))
          cssCheck(raw, rel, q.end - 1 - raw.length, tsx);
        else
          for (const r of varRefs(raw)) {
            const at = q.end - 1 - raw.length + raw.indexOf(r.name, r.index);
            s2(r.name, r.hasFallback, rel, at, tsx, at);
          }
        return;
      }
      if (n.type !== 'JSXOpeningElement') return;
      const name = jsxName(n);
      const exemptS1 =
        parents.some((p) => {
          if (p.type !== 'JSXElement') return false;
          const op = p.openingElement as Ast;
          if (jsxName(op) === 'DrawProof') return true;
          const ex = attr(op, 'data-ds-exempt');
          const v = staticString(ex?.value as Ast);
          return Boolean(ex && (!v || /S1/.test(v.text)));
        }) || Boolean(staticString(attr(n, 'data-ds-exempt')?.value as Ast)?.text.includes('S1'));
      const cls = staticString(attr(n, 'className')?.value as Ast);
      const hasT = Boolean(cls && /(^|\s)t-[a-z0-9-]+/.test(cls.text));
      // S6 wrapper
      if (cls && attr(n, 'data-theme')) {
        let offset = 0;
        for (const tok of cls.text.split(/(\s+)/)) {
          if (tok && rootClasses.has(tok)) {
            const at = cls.start + offset;
            add({
              rule: 'S6',
              kind: 'wrapper',
              name: tok,
              file: rel,
              offset: at,
              text: tsx,
              fix: 'ds',
              span: [at, at + tok.length],
            });
          }
          offset += tok.length;
        }
      }
      // colour attributes
      for (const a of (n.attributes as Ast[]) ?? []) {
        if (a.type !== 'JSXAttribute') continue;
        const an = (a.name as Ast)?.name as string;
        if (an === 'style') continue;
        const sv = staticString(a.value as Ast);
        if (!sv) continue;
        if (COLOR_ATTRS.has(an))
          checkValue('color', sv.text, rel, sv.start, tsx, { s1: !exemptS1, t: true });
        // any other attribute counts only when its value IS a CSS value (`bg="var(--bg-1)"`),
        // never prose that mentions one (`help="binds var(--token)"`)
        else if (/^\s*(var|color-mix|calc)\(/.test(sv.text))
          for (const r of varRefs(sv.text)) {
            const at = sv.start + sv.text.indexOf(r.name, r.index);
            s2(r.name, r.hasFallback, rel, at, tsx, at);
          }
      }
      // style={{ … }}
      const style = attr(n, 'style');
      const expr = (style?.value as Ast)?.expression as Ast | undefined;
      if (expr?.type === 'ObjectExpression') {
        for (const p of (expr.properties as Ast[]) ?? []) {
          if (p.type !== 'Property') continue;
          const key = p.key as Ast;
          const prop =
            key.type === 'Identifier'
              ? (key.name as string)
              : typeof key.value === 'string'
                ? (key.value as string)
                : null;
          const sv = staticString(p.value as Ast);
          if (!prop || !sv) continue;
          checkValue(prop, sv.text, rel, sv.start, tsx, { s1: !exemptS1, t: hasT });
        }
      }
      // S7 identity: inline svg path data outside Icon / Logo
      if (name === 'path' && attr(n, 'd') && hasBrand) {
        const inIdentity = parents.some(
          (p) =>
            p.type === 'JSXElement' &&
            ['Icon', 'Logo', 'DrawProof'].includes(jsxName(p.openingElement as Ast) ?? '')
        );
        if (!inIdentity)
          add({
            rule: 'S7',
            kind: 'identity',
            name: 'inline <svg> path',
            file: rel,
            offset: n.start,
            text: tsx,
          });
      }
      // ext.* components and Icon gaps
      if (name?.startsWith('ext.')) pin(`ext:${name}`);
      if (name === 'Icon' && report) {
        const iconName = staticString(attr(n, 'name')?.value as Ast)?.text;
        if (iconName && report.components.declaredMissing.icons.includes(iconName))
          add({
            rule: 'S7',
            kind: 'icon-gap',
            name: iconName,
            file: rel,
            offset: n.start,
            text: tsx,
          });
      }
    });
  }

  // de-duplicate (a template literal inside a style attribute can be seen twice)
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const k = `${f.rule}|${f.kind}|${f.name}|${f.file}|${f.line}|${f.col}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const state: CanvasState = pinned
    ? 'pinned'
    : unique.some((f) => BLOCKING.has(`${f.rule}:${f.kind}`))
      ? 'blocked'
      : Object.keys(pins).length
        ? 'review'
        : 'switchable';
  return {
    path: rel,
    system: sysName,
    state,
    findings: unique.slice(0, MAX_FINDINGS),
    pins,
    truncated: Math.max(0, unique.length - MAX_FINDINGS),
  };
}

/** Findings on changed lines only (`--changed <file>:<from>-<to>`). */
export function scopeToChanged(
  r: CanvasReport,
  ranges: { file: string; from: number; to: number }[]
): CanvasReport {
  const findings = r.findings.filter((f) =>
    ranges.some(
      (g) =>
        (f.file === g.file || f.file.endsWith(`/${g.file}`) || g.file.endsWith(f.file)) &&
        f.line >= g.from &&
        f.line <= g.to
    )
  );
  const blocked = findings.some((f) => BLOCKING.has(`${f.rule}:${f.kind}`));
  return {
    ...r,
    findings,
    state:
      r.state === 'pinned'
        ? 'pinned'
        : blocked
          ? 'blocked'
          : r.state === 'blocked'
            ? 'review'
            : r.state,
  };
}

/**
 * `--fix=mechanical`: alias → v1 name, own-css import removed, wrapper token → `ds`. Only the
 * canvas's own files are edited; spans come from the check, so the edit is byte-minimal and a
 * second run finds nothing to do (idempotent). Returns the new text per file.
 */
export function fixCanvas(
  ctx: CanvasContext,
  r: CanvasReport
): Map<string, { before: string; after: string; edits: number }> {
  const byFile = new Map<string, Finding[]>();
  for (const f of r.findings) {
    if (!f.span || f.severity !== 'autofix') continue;
    const own = f.file === r.path || f.file === r.path.replace(/\.tsx$/, '.css');
    if (!own) continue;
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const out = new Map<string, { before: string; after: string; edits: number }>();
  for (const [file, list] of byFile) {
    const before = readRel(ctx, file);
    if (before === null) continue;
    const ms = new MagicString(before);
    const done = new Set<string>();
    for (const f of list) {
      const [a, b] = f.span as [number, number];
      const key = `${a}:${b}`;
      if (done.has(key)) continue;
      done.add(key);
      if (f.kind === 'own-css') {
        let end = b;
        if (before[end] === '\n') end++;
        ms.remove(a, end);
      } else ms.overwrite(a, b, f.fix as string);
    }
    out.set(file, { before, after: ms.toString(), edits: done.size });
  }
  return out;
}

export function isCanvasFile(rel: string): boolean {
  if (!rel.endsWith('.tsx')) return false;
  return !rel.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.'));
}

export function existsRel(designRoot: string, rel: string): boolean {
  return existsSync(join(designRoot, rel));
}

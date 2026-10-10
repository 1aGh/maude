// index/extract.ts — the static extractor of the project index (V2-2.17, contract V2-1.17 §5.1/§5.2/§5.6).
//
//   listCanvases()   every `.tsx` canvas in the config's canvas groups, by the same rules the file
//                    tree uses (api.ts findFiles: no `_`/dot entries, SKIP_DIRS, regular files only)
//   extractCanvas()  one CanvasRow: an oxc parse lists the LITERAL artboards (id/label/kind/size);
//                    a DCArtboard inside a callback (.map), with a non-literal id, or rendered by an
//                    imported local module makes the canvas `dynamic` — the renderer's harvest
//                    (V2-1.17 §5.8, S1) fills those in later
//   stampOf()        the crash-safety fingerprint: sha256 over sorted `rel \0 size \0 trunc(mtime)`
//                    of every canvas .tsx + .meta.json + config.json (first 32 hex)

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

import { SKIP_DIRS } from '../skip-dirs.ts';
import type { ArtboardKind, ArtboardRow, CanvasKind, CanvasRow, Stamp } from './types.ts';

const ARTBOARD_KINDS = new Set<ArtboardKind>(['digital', 'print', 'web', 'video']);
const CANVAS_KINDS = new Set<CanvasKind>([
  'canvas',
  'specimen',
  'brief-board',
  'imported-figma',
  'reconstructed-experimental',
]);
const HIDDEN_OK = new Set(['.ai', '.claude', '.design']);
const MAX_DEP_BYTES = 2 * 1024 * 1024;
const isInside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export interface IndexContext {
  designRoot: string;
  /** the project root relative imports may reach (default: designRoot's parent) */
  repoRoot?: string;
  /** canvas groups from config (`{ path, label }`), relative to designRoot */
  groups: Array<{ path: string; label: string }>;
  defaultDs: string | null;
  designSystems: Array<{ name: string; path: string }>;
}

/** Every canvas `.tsx` under the canvas groups, designRoot-relative, sorted. */
export function listCanvases(ctx: IndexContext): string[] {
  const out = new Set<string>();
  const walk = (abs: string, rel: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      // Dirents, not a stat per entry: asset-heavy groups have thousands of files
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const name = e.name;
      if (name.startsWith('.') && !HIDDEN_OK.has(name)) continue;
      if (name.startsWith('_') || SKIP_DIRS.has(name)) continue;
      const r = rel ? `${rel}/${name}` : name;
      // a symlink is neither — skipped, like the file tree (api.ts findFiles)
      if (e.isDirectory()) walk(path.join(abs, name), r);
      else if (e.isFile() && name.endsWith('.tsx')) out.add(r);
    }
  };
  for (const g of ctx.groups) walk(path.join(ctx.designRoot, g.path), g.path.replace(/\/+$/, ''));
  return [...out].sort();
}

/** Is `rel` a canvas by the same rules as listCanvases()? One stat, no walk (per-event updates). */
export function isCanvasRel(ctx: IndexContext, rel: string): boolean {
  if (!rel.endsWith('.tsx')) return false;
  const group = ctx.groups.find((g) => rel.startsWith(`${g.path.replace(/\/+$/, '')}/`));
  if (!group) return false;
  const segs = rel.slice(group.path.replace(/\/+$/, '').length + 1).split('/');
  for (const seg of segs) {
    if (seg.startsWith('.') && !HIDDEN_OK.has(seg)) return false;
    if (seg.startsWith('_') || SKIP_DIRS.has(seg)) return false;
  }
  try {
    return lstatSync(path.join(ctx.designRoot, rel)).isFile();
  } catch {
    return false;
  }
}

const metaRelOf = (rel: string) => rel.replace(/\.tsx$/, '.meta.json');

/** The crash-safety stamp (V2-1.17 §5.6). */
export function stampOf(ctx: IndexContext, rels = listCanvases(ctx)): Stamp {
  const lines: string[] = [];
  let maxMtimeMs = 0;
  const add = (rel: string) => {
    // throwIfNoEntry: most canvases have no sidecar — an exception per miss cost 10× the stat
    const st = statSync(path.join(ctx.designRoot, rel), { throwIfNoEntry: false });
    if (!st) return;
    const m = Math.trunc(st.mtimeMs);
    maxMtimeMs = Math.max(maxMtimeMs, m);
    lines.push(`${rel}\0${st.size}\0${m}`);
  };
  for (const rel of rels) {
    add(rel);
    add(metaRelOf(rel));
  }
  add('config.json');
  lines.sort();
  return {
    files: lines.length,
    maxMtimeMs,
    hash: createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 32),
  };
}

// ── AST helpers (oxc ESTree shape) ───────────────────────────────────────────────────────────
type Node = { type: string; [k: string]: unknown };
const isNode = (v: unknown): v is Node =>
  !!v && typeof v === 'object' && typeof (v as Node).type === 'string';

/** Iterative walk; `inFn` = inside a function passed as a call argument (`.map(a => …)`). */
function walkAst(root: unknown, visit: (n: Node, inFn: boolean) => void) {
  const stack: Array<[unknown, boolean]> = [[root, false]];
  while (stack.length) {
    const [node, inFn] = stack.pop() as [unknown, boolean];
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push([node[i], inFn]);
      continue;
    }
    const n = node as Node;
    if (typeof n.type === 'string') visit(n, inFn);
    const isCall = n.type === 'CallExpression';
    for (const k in n) {
      if (k === 'parent') continue;
      const v = n[k];
      if (!v || typeof v !== 'object') continue;
      if (isCall && k === 'arguments' && Array.isArray(v)) {
        for (const arg of v) {
          const t = (arg as Node | null)?.type;
          stack.push([arg, inFn || t === 'ArrowFunctionExpression' || t === 'FunctionExpression']);
        }
        continue;
      }
      stack.push([v, inFn]);
    }
  }
}

function jsxName(n: Node): string | null {
  const name = n.name as Node | undefined;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name as string;
  if (name.type === 'JSXMemberExpression') return (name.property as Node)?.name as string;
  return null;
}

/** A literal attribute value: string, template without expressions, number, or null if dynamic. */
function attrLiteral(
  attrs: Node[],
  key: string
): { present: boolean; value: string | number | null } {
  const a = attrs.find(
    (x) => x.type === 'JSXAttribute' && ((x.name as Node)?.name as string) === key
  );
  if (!a) return { present: false, value: null };
  const v = a.value as Node | null;
  if (!v) return { present: true, value: null };
  if (v.type === 'Literal' || v.type === 'StringLiteral')
    return { present: true, value: v.value as string };
  if (v.type === 'JSXExpressionContainer') {
    const e = v.expression as Node;
    if (e?.type === 'Literal' || e?.type === 'StringLiteral' || e?.type === 'NumericLiteral')
      return { present: true, value: e.value as string | number };
    if (
      e?.type === 'TemplateLiteral' &&
      Array.isArray(e.expressions) &&
      e.expressions.length === 0
    ) {
      const q = (e.quasis as Node[])[0] as Node;
      return {
        present: true,
        value: ((q?.value as { cooked?: string })?.cooked ?? null) as string | null,
      };
    }
  }
  return { present: true, value: null };
}

const num = (v: string | number | null) =>
  typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;

// ── one canvas ──────────────────────────────────────────────────────────────────────────────
export function extractCanvas(ctx: IndexContext, rel: string): CanvasRow {
  const abs = path.join(ctx.designRoot, rel);
  const source = readFileSync(abs, 'utf8');
  const st = statSync(abs);
  const metaAbs = path.join(ctx.designRoot, metaRelOf(rel));
  const metaText = existsSync(metaAbs) ? readFileSync(metaAbs, 'utf8') : null;
  let meta: Record<string, unknown> | null = null;
  try {
    meta = metaText ? (JSON.parse(metaText) as Record<string, unknown>) : null;
  } catch {
    meta = null;
  }

  const artboards: ArtboardRow[] = [];
  let dynamic = false;
  let parse: CanvasRow['parse'] = 'ok';
  const relImports: string[] = [];
  // A source that never says DCArtboard has no literal artboards: skip the AST (most specimens).
  if (!/\bDCArtboard\b/.test(source)) {
    for (const m of source.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm))
      relImports.push(m[1] as string);
  } else
    try {
      const parsed = parseSync(abs, source, { sourceType: 'module' });
      if (parsed.errors?.length) parse = 'error';
      const program = parsed.program as unknown as Node;
      walkAst(program, (n, inFn) => {
        if (n.type === 'ImportDeclaration') {
          const spec = (n.source as Node)?.value as string;
          if (typeof spec === 'string' && spec.startsWith('.')) relImports.push(spec);
        }
        if (n.type !== 'JSXOpeningElement' || jsxName(n) !== 'DCArtboard') return;
        const attrs = (n.attributes as Node[]) ?? [];
        const id = attrLiteral(attrs, 'id');
        if (inFn || typeof id.value !== 'string') {
          dynamic = true;
          return;
        }
        const label = attrLiteral(attrs, 'label').value;
        const kind = attrLiteral(attrs, 'kind').value;
        artboards.push({
          id: id.value,
          label: typeof label === 'string' ? label : null,
          kind:
            typeof kind === 'string' && ARTBOARD_KINDS.has(kind as ArtboardKind)
              ? (kind as ArtboardKind)
              : null,
          w: num(attrLiteral(attrs, 'width').value),
          h: num(attrLiteral(attrs, 'height').value),
        });
      });
    } catch {
      parse = 'error';
    }

  // relative imports: their content feeds depsHash; a local module that renders artboards makes
  // this canvas dynamic (Alligators' ui/club-web/_render.tsx)
  const deps: string[] = [];
  const projectRoot = ctx.repoRoot ?? path.dirname(ctx.designRoot);
  let importsRenderArtboards = false;
  for (const spec of [...new Set(relImports)].sort()) {
    const base = path.resolve(path.dirname(abs), spec);
    const hit = [
      base,
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      `${base}.js`,
      path.join(base, 'index.tsx'),
    ].find((p) => {
      // only files inside the project, and of a sane size: a peer-authored canvas importing
      // `../../../../etc/…` must not make the indexer read outside the tree (Phase 1 gate review)
      if (!isInside(projectRoot, p)) return false;
      const st = statSync(p, { throwIfNoEntry: false });
      return !!st && st.isFile() && st.size <= MAX_DEP_BYTES;
    });
    if (!hit) continue;
    const text = readFileSync(hit);
    deps.push(`${path.relative(ctx.designRoot, hit)}\0${sha(text)}`);
    if (/\.(tsx|jsx|ts|js)$/.test(hit) && /\bDCArtboard\b/.test(text.toString('utf8')))
      importsRenderArtboards = true;
  }
  if (importsRenderArtboards) dynamic = true;

  const parts = rel.split('/');
  const name = (parts.pop() as string).replace(/\.tsx$/, '');
  const folder = parts.join('/');
  const sysMatch = rel.match(/^system\/([^/]+)\//);
  const ownerDs = sysMatch
    ? (ctx.designSystems.find(
        (d) => d.path === `system/${sysMatch[1]}` || d.path.endsWith(`/${sysMatch[1]}`)
      )?.name ?? null)
    : null;
  const declaredDs =
    typeof meta?.designSystem === 'string' && meta.designSystem.trim() ? meta.designSystem : null;
  const metaKind =
    typeof meta?.kind === 'string' && CANVAS_KINDS.has(meta.kind as CanvasKind)
      ? (meta.kind as CanvasKind)
      : null;
  const artboardMeta = meta?.artboardMeta;
  const madeByAi = Boolean(
    artboardMeta &&
      typeof artboardMeta === 'object' &&
      Object.values(artboardMeta as Record<string, unknown>).some((a) => {
        const m = (a as { madeBy?: unknown })?.madeBy;
        return m === 'ai' || (typeof m === 'object' && (m as { kind?: unknown })?.kind === 'ai');
      })
  );

  return {
    rel,
    name,
    folder,
    kind: metaKind ?? (sysMatch ? 'specimen' : 'canvas'),
    ds: ownerDs ?? declaredDs ?? ctx.defaultDs,
    mtimeMs: Math.trunc(st.mtimeMs),
    srcHash: sha(source),
    metaHash: metaText === null ? null : sha(metaText),
    depsHash: sha(deps.join('\n')),
    artboards,
    artboardsFrom: 'static',
    hasArtboards: artboards.length > 0 || dynamic || /\b(DCArtboard|DesignCanvas)\b/.test(source),
    dynamic,
    cover: null,
    madeByAi,
    parse,
  };
}

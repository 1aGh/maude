// canvas-lib inlining for /design:handoff (Phase 3.6.1 Task 9; per DDR-025 the
// lib source now ships with the dev-server install).
//
// `/design:handoff` emits a self-contained shadcn registry-item.json. Canvases
// import their envelope + helpers from `@maude/canvas-lib`, which the dev-server
// resolves to its bundled `apps/studio/canvas-lib.tsx`. The
// handoff drop must inline every used export so the consumer never sees the
// `@maude/canvas-lib` specifier — it's a dev-time virtual module, not a real
// npm dep.
//
// Strategy:
//   1. Parse the dev-server-bundled canvas-lib.tsx via oxc-parser. Walk top-level declarations
//      to build a Map<name, { source, deps }>:
//        - source: byte range of the declaration (including JSDoc immediately
//                  above, when present).
//        - deps: other top-level identifiers referenced inside the body.
//   2. Scan the canvas TSX for `import { ... } from "@maude/canvas-lib"`.
//      Collect the named imports.
//   3. Transitively resolve deps: each import drags in helpers it calls,
//      which drag in helpers THEY call, etc.
//   4. Strip the import line.
//   5. Append the resolved function/const bodies AFTER the canvas's default
//      export. (Placing them after default avoids "use before declare" issues
//      in dev-mode tooling — JSX inside the component reads the outer scope.)
//
// Pure module — caller persists. Tested.

import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';
import {
  canvasSystemFor,
  DS_SPECIFIER,
  dsTargetFor,
  importsDs,
  registrationCall,
} from './ds/ds-resolver.ts';

// biome-ignore lint/suspicious/noExplicitAny: oxc AST nodes are heterogeneous.
type AnyNode = any;

export interface LibExport {
  name: string;
  /** Full declaration source, including leading JSDoc block. */
  source: string;
  /** Other top-level identifiers this declaration references. */
  deps: string[];
}

export type LibMap = Map<string, LibExport>;

/**
 * Parse a canvas-lib TSX source into a Map keyed by named-export identifier.
 * For each entry, `source` is the verbatim declaration text (with JSDoc
 * comment if it precedes the declaration), and `deps` is the set of other
 * top-level names the declaration body references.
 */
export function buildLibMap(libPath: string, libSource: string): LibMap {
  const parsed = parseSync(libPath, libSource, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      `oxc-parser failed on ${libPath} (${parsed.errors.length} errors). First: ${first?.message ?? 'unknown'}`
    );
  }

  // First pass — collect every top-level binding name (exports + internals).
  const topLevelNames = new Set<string>();
  for (const node of parsed.program.body as AnyNode[]) {
    for (const n of namesFromTopLevel(node)) topLevelNames.add(n);
  }

  // Second pass — record exported declarations with their source range +
  // identifier references inside the body.
  const map: LibMap = new Map();
  // Also keep internal (non-exported) declarations indexed for transitive
  // resolution — when an exported helper calls an internal helper, that
  // internal must travel along.
  const internals = new Map<string, LibExport>();

  for (const node of parsed.program.body as AnyNode[]) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      for (const name of namesFromDecl(node.declaration)) {
        const range = nodeRangeWithComment(libSource, node);
        const source = libSource.slice(range.start, range.end);
        // Strip the leading `export` token from the captured source — inlined
        // bodies must NOT re-export.
        const stripped = source.replace(/^export\s+/m, '');
        const deps = collectIdentifierRefs(node.declaration, topLevelNames, name);
        map.set(name, { name, source: stripped, deps: [...deps] });
      }
    } else if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'VariableDeclaration' ||
      node.type === 'ClassDeclaration'
    ) {
      for (const name of namesFromDecl(node)) {
        const range = nodeRangeWithComment(libSource, node);
        const source = libSource.slice(range.start, range.end);
        const deps = collectIdentifierRefs(node, topLevelNames, name);
        internals.set(name, { name, source, deps: [...deps] });
      }
    }
  }

  // Merge internals into the map under their own names — they're resolvable
  // by the inliner when an export depends on them. Internals are never
  // surfaced as user-requested imports but are reachable transitively.
  for (const [name, info] of internals) {
    if (!map.has(name)) map.set(name, info);
  }

  return map;
}

function namesFromTopLevel(node: AnyNode): string[] {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    return namesFromDecl(node.declaration);
  }
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'VariableDeclaration'
  ) {
    return namesFromDecl(node);
  }
  return [];
}

function namesFromDecl(decl: AnyNode): string[] {
  if (!decl) return [];
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
    return decl.id?.name ? [decl.id.name as string] : [];
  }
  if (decl.type === 'VariableDeclaration') {
    const out: string[] = [];
    for (const d of decl.declarations ?? []) {
      if (d.id?.type === 'Identifier' && d.id.name) out.push(d.id.name as string);
    }
    return out;
  }
  return [];
}

/**
 * Walk an AST subtree collecting Identifier names that match the top-level
 * registry, excluding `selfName` (no self-reference).
 */
function collectIdentifierRefs(
  decl: AnyNode,
  registry: Set<string>,
  selfName: string
): Set<string> {
  const found = new Set<string>();
  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'Identifier' && typeof node.name === 'string') {
      if (node.name !== selfName && registry.has(node.name)) found.add(node.name);
    }
    // JSXIdentifier looks the same shape — treat like Identifier.
    if (node.type === 'JSXIdentifier' && typeof node.name === 'string') {
      if (node.name !== selfName && registry.has(node.name)) found.add(node.name);
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  }
  visit(decl);
  return found;
}

/**
 * Find the source-range start of a node, extended backwards over any
 * immediately-preceding block-comment (JSDoc) so the inlined declaration
 * keeps its docs.
 */
function nodeRangeWithComment(source: string, node: AnyNode): { start: number; end: number } {
  const end = node.end as number;
  let start = node.start as number;
  // Walk back over whitespace; if we hit `*/` we extend through the matching
  // `/*`.
  let i = start - 1;
  while (i >= 0 && /\s/.test(source[i] ?? '')) i--;
  if (i >= 1 && source[i - 1] === '*' && source[i] === '/') {
    // We're at the `*/` — find matching `/*`.
    const open = source.lastIndexOf('/*', i);
    if (open >= 0) start = open;
  }
  return { start, end };
}

export interface InlineResult {
  /** Canvas source with the import stripped + helpers appended. */
  content: string;
  /** True when an `@maude/canvas-lib` import was found + removed. */
  droppedImport: boolean;
  /** Sorted list of helper names inlined (including transitive). */
  inlined: string[];
}

/**
 * Replace `import { ... } from "@maude/canvas-lib"` with the resolved bodies
 * of every named import (+ their transitive dependencies). Returns the
 * rewritten source.
 */
export function inlineUsedExports(
  canvasSource: string,
  libMap: LibMap,
  specifier = '@maude/canvas-lib'
): InlineResult {
  // 1. Locate the import line. We tolerate single OR double quotes, type-only
  //    imports (rare), trailing commas, multi-line shapes.
  const spec = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const importRe = new RegExp(
    `\\bimport\\s+(?:type\\s+)?\\{([^}]+)\\}\\s*from\\s*["']${spec}["']\\s*;?`,
    'm'
  );
  const m = importRe.exec(canvasSource);
  if (!m) {
    return { content: canvasSource, droppedImport: false, inlined: [] };
  }
  const importList = (m[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // Drop `type` prefix on individual names + handle `X as Y` aliases (rare).
    .map((s) => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    .filter((s): s is string => Boolean(s));

  // 2. Resolve transitive deps. BFS over the libMap.
  const wanted = new Set<string>();
  const queue = [...importList];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (wanted.has(name)) continue;
    const info = libMap.get(name);
    if (!info) {
      throw new Error(
        `[canvas-lib-inline] Canvas imports '${name}' from ${specifier} but the lib has no such export.`
      );
    }
    wanted.add(name);
    for (const dep of info.deps) {
      if (!wanted.has(dep)) queue.push(dep);
    }
  }

  // 3. Strip the import line.
  let out = canvasSource.slice(0, m.index) + canvasSource.slice(m.index + m[0].length);
  // Cleanup: collapse runs of blank lines we just opened up.
  out = out.replace(/\n{3,}/g, '\n\n');

  // 4. Append the resolved declarations at the file's tail. The plan calls
  //    for "before export default", but a trailing block works in modern JS
  //    (function declarations hoist, top-level consts referenced inside the
  //    default export are evaluated at module init). Place after a clear
  //    separator + section comment so cold readers grok what's happening.
  const ordered = [...wanted].sort();
  const banner =
    '\n\n// ─────────────────────────────────────────────────────────────────────────────\n' +
    '// Canvas-lib helpers (inlined by /design:handoff). Self-contained drop —\n' +
    '// no dev-time specifier is referenced from this file.\n\n';
  const bodies = ordered.map((n) => (libMap.get(n)?.source ?? '').trimEnd()).join('\n\n');

  return {
    content: `${out.trimEnd()}${banner}${bodies}\n`,
    droppedImport: true,
    inlined: ordered,
  };
}

/**
 * The handoff inline for a canvas that may also import `@maude/ds` (V2-1.13 §5.11): its names are
 * inlined from the canvas system's override or the shipped defaults, canvas-lib's are inlined as
 * before (plus `__registerDesignSystem`), and the registration runs LAST — after the `let` it
 * writes is declared — so the drop renders `<DSRoot>` with the same default theme as the canvas.
 */
export function inlineDsImport(
  canvasSource: string,
  designRoot: string,
  canvasAbs: string,
  libMap: LibMap
): InlineResult {
  if (!importsDs(canvasSource)) return inlineUsedExports(canvasSource, libMap);
  const sys = canvasSystemFor(designRoot, canvasAbs);
  const target = dsTargetFor(designRoot, sys);
  const ds = inlineUsedExports(
    canvasSource,
    buildLibMap(target, readFileSync(target, 'utf8')),
    DS_SPECIFIER
  );
  let src = ds.content;
  if (sys) {
    const libRe = /(\bimport\s+\{)([^}]+)(\}\s*from\s*["']@maude\/canvas-lib["'])/m;
    src = libRe.test(src)
      ? src.replace(
          libRe,
          (_m, a, names, b) => `${a}${names.trimEnd()}, __registerDesignSystem ${b}`
        )
      : `import { __registerDesignSystem } from "@maude/canvas-lib";\n${src}`;
  }
  const lib = inlineUsedExports(src, libMap);
  return {
    content: sys ? `${lib.content.trimEnd()}\n\n${registrationCall(sys)}\n` : lib.content,
    droppedImport: true,
    inlined: [...new Set([...ds.inlined, ...lib.inlined])].sort(),
  };
}

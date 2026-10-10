// /design:handoff emitter — shadcn registry-item.json sidecar (Phase 3.6 Task 7 + 12b).
//
// Walks a canvas TSX file, classifies its imports, strips `data-cd-id` attrs
// (those are dev-time scaffolding the production drop has no business with),
// optionally bundles the actually-used subset of `_components.css` +
// `colors_and_type.css`, and emits a JSON sidecar conforming to
// https://ui.shadcn.com/schema/registry-item.json.
//
// Consumer pattern:
//   bunx shadcn add file://./<Slug>.registry.json
//
// Same oxc-parser + magic-string + lightningcss toolchain as canvas-pipeline.ts
// and canvas-edit.ts — one mental model, three call sites.
//
// Strip semantics (Task 12):
//   - data-cd-id  → removed (pipeline-emitted; not source)
//   - JSDoc header → kept (cold-read context for future Claude / human reader)
//   - inline DesignCanvas/DCSection/DCArtboard chrome → kept as-is; the
//     consumer's host page wraps or unwraps as needed.
//
// CSS bundling (Task 12b):
//   - Scan canvas TSX for every string literal that appears as a `className`
//     attribute value. Tokenise on whitespace → set of class names.
//   - Parse `_components.css` with lightningcss; keep rules whose selector list
//     contains any selector whose `base class` (the first class segment, after
//     stripping pseudo + descendant tail) is in the set.
//   - Walk the kept CSS for `var(--name)` references, intersect with
//     `colors_and_type.css`, emit only the matched custom properties under
//     cssVars.theme (the schema's first-class theme-token slot).

import path from 'node:path';

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { buildLibMap, inlineDsImport } from './canvas-lib-inline.ts';
import { canvasLibPath } from './canvas-lib-resolver.ts';

// biome-ignore lint/suspicious/noExplicitAny: oxc AST nodes are heterogeneous.
type AnyNode = any;

// ---------------------------------------------------------------------------
// Public types — shaped to match shadcn's registry-item.json schema. Reference:
//   https://ui.shadcn.com/schema/registry-item.json
// We don't ship every optional field — only the ones we can produce reliably.

export interface RegistryItemFile {
  /** Relative path the file should land at in the consumer project. */
  path: string;
  /** File contents. */
  content: string;
  /** shadcn file-type discriminator. */
  type:
    | 'registry:component'
    | 'registry:block'
    | 'registry:ui'
    | 'registry:style'
    | 'registry:lib'
    | 'registry:hook'
    | 'registry:theme';
  /** Optional override for where the file lands in the consumer project. */
  target?: string;
}

export interface RegistryItem {
  $schema: string;
  name: string;
  type: 'registry:block' | 'registry:component' | 'registry:ui';
  title?: string;
  description?: string;
  /** npm package specifiers (e.g. ["react", "lucide-react"]). */
  dependencies: string[];
  /** Other registry items this depends on (e.g. ["button", "card"]). */
  registryDependencies: string[];
  /** Files to drop. Index 0 is conventionally the entry component. */
  files: RegistryItemFile[];
  /** CSS custom properties grouped by theme (light/dark). Empty when no tokens used. */
  cssVars?: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
  /**
   * shadcn's generic item-specific-metadata extension point. feature-3-web-
   * artboards T6 — carries the resolved artboard `kind` (`digital` | `print`
   * | `web` | `video` | `mixed`) so a consumer (or a future re-import) knows
   * what authoring contract produced this drop without re-parsing the TSX.
   */
  meta?: {
    kind: string;
  };
}

export interface EmitOptions {
  /** Absolute path to canvas .tsx file. */
  canvasAbsPath: string;
  /** Pretty title from meta.json (becomes registry item `title`). */
  title?: string;
  /** One-line description from meta.json.subtitle (becomes `description`). */
  description?: string;
  /** Optional path to project's `_components.css` for CSS bundling (Task 12b). */
  componentsCssPath?: string;
  /** Optional path to project's tokens CSS for cssVars resolution (Task 12b). */
  tokensCssPath?: string;
  /**
   * Absolute path to design root. When provided, `@maude/canvas-lib` imports
   * in the canvas are inlined from the dev-server-bundled canvas-lib so the
   * emitted drop is self-contained (Phase 3.6.1 Task 9; per DDR-025 the lib
   * lives in the dev-server, not under designRoot). The argument is kept for
   * back-compat with the CLI shape — handoff inlining no longer reads it.
   */
  designRoot?: string;
}

// ---------------------------------------------------------------------------
// feature-3-web-artboards T6 — thread the artboard kind into the emitted
// registry-item's `meta` (a first-class shadcn registry-item.json extension
// point for item-specific metadata, not a maude-invented field). A regex scan
// is deliberate here (not an AST walk like stripDataCdId) — this only needs
// the `kind="…"` string values, never a node reference to edit.

/**
 * Resolve a single `kind` value for the whole canvas file, from its
 * `<DCArtboard kind="…">` occurrences. A canvas with zero explicit `kind`
 * attributes resolves to `'digital'` (DCArtboard's own implicit default). A
 * canvas whose artboards carry more than one distinct explicit kind (e.g. a
 * multi-breakpoint web canvas assembled via "Duplicate at width…" next to an
 * unrelated screen) resolves to `'mixed'` rather than picking one arbitrarily.
 */
export function resolveCanvasKind(rawSource: string): string {
  const kinds = new Set<string>();
  for (const m of rawSource.matchAll(/<DCArtboard\b[^>]*\bkind="([a-z]+)"/g)) {
    if (m[1]) kinds.add(m[1]);
  }
  if (kinds.size === 0) return 'digital';
  if (kinds.size === 1) return [...kinds][0] as string;
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Strip data-cd-id from source — the inverse of canvas-pipeline.ts pass 1.

/**
 * Remove every canvas-only `data-cd-*` attribute — the pipeline's ` data-cd-id`
 * / ` data-cd-editable` and the authored id, lock and hide marker (V2-2.19) —
 * from a TSX source string. Same result as element-ids.ts `stripCanvasOnly`.
 * Pure: caller persists. Uses the same oxc-parser + magic-string toolchain as
 * the pipeline that emitted them.
 */
export function stripDataCdId(canvasAbsPath: string, source: string): string {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      `oxc-parser failed on ${canvasAbsPath} (${parsed.errors.length} errors). First: ${first?.message ?? 'unknown'}`
    );
  }
  const s = new MagicString(source);

  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;

    if (node.type === 'JSXOpeningElement') {
      const attrs = node.attributes as AnyNode[] | undefined;
      if (Array.isArray(attrs)) {
        for (const a of attrs) {
          if (
            a?.type === 'JSXAttribute' &&
            a.name?.type === 'JSXIdentifier' &&
            // V2-2.19 (contract V2-1.4 §5.5): the whole canvas-only namespace — the id, the
            // pipeline's editable marker, the lock and the hide marker — never reaches a handoff.
            String(a.name.name).startsWith('data-cd-') &&
            typeof a.start === 'number' &&
            typeof a.end === 'number'
          ) {
            // Trim the leading whitespace too — author-friendly output.
            let from = a.start as number;
            while (from > 0 && /\s/.test(source[from - 1] as string)) from--;
            s.remove(from, a.end);
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  }

  visit(parsed.program);
  return s.toString();
}

// ---------------------------------------------------------------------------
// Import classification — npm specifier vs shadcn `@/components/ui/*`.

interface ClassifiedImports {
  /** npm package names, deduped. */
  dependencies: string[];
  /** shadcn primitive names (e.g. `button` from `@/components/ui/button`). */
  registryDependencies: string[];
}

/**
 * Classify import specifiers in a TSX source. Heuristic:
 *   - `@/components/ui/<name>`     → registry dependency `<name>`
 *   - bare specifier starting with letter / `@` not in the above pattern
 *                                  → npm dependency (the package portion)
 *   - relative imports (`./...`, `../...`) → ignored (consumer ships its own)
 */
export function classifyImports(canvasAbsPath: string, source: string): ClassifiedImports {
  const deps = new Set<string>();
  const regDeps = new Set<string>();

  // Bun.Transpiler.scanImports() is the documented fast path; pulls every
  // ImportDeclaration / dynamic import / require call.
  const scanner = new Bun.Transpiler({ loader: 'tsx' });
  const imports = scanner.scanImports(source);
  for (const imp of imports) {
    const spec = imp.path;
    if (!spec) continue;
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) continue;
    if (spec.startsWith('@/components/ui/')) {
      const name = spec.slice('@/components/ui/'.length).split('/')[0];
      if (name) regDeps.add(name);
      continue;
    }
    deps.add(packageNameOf(spec));
  }

  void canvasAbsPath;
  return {
    dependencies: [...deps].sort(),
    registryDependencies: [...regDeps].sort(),
  };
}

/**
 * Extract the npm package name from a bare specifier. Handles scoped packages
 * (`@scope/name`) and subpath imports (`react-dom/client` → `react-dom`).
 */
function packageNameOf(spec: string): string {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  const slash = spec.indexOf('/');
  return slash > 0 ? spec.slice(0, slash) : spec;
}

// ---------------------------------------------------------------------------
// className harvester — collect every class name string appearing as a JSX
// className attribute value (`className="a b"` or `className={'a b'}`).

export function collectClassNames(canvasAbsPath: string, source: string): Set<string> {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  const out = new Set<string>();

  function pushTokens(str: string): void {
    for (const tok of str.split(/\s+/)) {
      if (tok) out.add(tok);
    }
  }

  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;

    if (
      node.type === 'JSXAttribute' &&
      node.name?.type === 'JSXIdentifier' &&
      node.name.name === 'className'
    ) {
      // Walk the value subtree and harvest every string-literal / template
      // quasi we find. Covers literal, JSXExpressionContainer(Literal),
      // TemplateLiteral, BinaryExpression of literals, conditional with
      // literal branches, clsx/cn calls with literal args, etc.
      harvestStrings(node.value, pushTokens);
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  }

  visit(parsed.program);
  return out;
}

function harvestStrings(node: AnyNode, sink: (s: string) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) harvestStrings(c, sink);
    return;
  }
  const t = node.type;
  if (typeof t !== 'string') return;
  if (t === 'Literal' || t === 'StringLiteral') {
    if (typeof node.value === 'string') sink(node.value);
    return;
  }
  if (t === 'TemplateLiteral') {
    for (const q of node.quasis ?? []) {
      const raw = q?.value?.cooked ?? q?.value?.raw ?? '';
      if (typeof raw === 'string') sink(raw);
    }
    for (const e of node.expressions ?? []) harvestStrings(e, sink);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    harvestStrings(node[k], sink);
  }
}

// ---------------------------------------------------------------------------
// CSS subset extraction — keep rules whose base class is in the harvested set,
// plus the var(--*) references inside those rules.

interface CssBundleResult {
  /** CSS source containing only used rules. May be empty string. */
  css: string;
  /** Names of CSS custom properties referenced by the kept rules. */
  tokens: Set<string>;
}

/**
 * Filter a CSS file to only the rules whose first class selector is in `keep`.
 * Naive but reliable parser: walks top-level rule blocks via balanced braces.
 * Avoids pulling lightningcss into the visitor path for the v1 of this feature.
 */
export function filterComponentsCss(cssSource: string, keep: Set<string>): CssBundleResult {
  const out: string[] = [];
  const tokens = new Set<string>();

  let i = 0;
  const n = cssSource.length;
  while (i < n) {
    // Skip whitespace.
    while (i < n && /\s/.test(cssSource[i] as string)) i++;
    if (i >= n) break;

    // Handle comments at top level — preserve them if attached to a kept rule;
    // for simplicity, drop them all (they're documentation, not necessary).
    if (cssSource[i] === '/' && cssSource[i + 1] === '*') {
      const end = cssSource.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }

    // @-rules: @media { ... }, @keyframes { ... }, etc. Recurse into @media,
    // emit @keyframes wholesale if any class inside its body is referenced
    // (animations are class-attached; we keep them when their owning class
    // survives). Simpler v1: keep every @-rule whose body, when filtered, has
    // content; emit the filtered body.
    if (cssSource[i] === '@') {
      const ruleStart = i;
      // Find prelude end at next `{` or `;`.
      let j = i;
      while (j < n && cssSource[j] !== '{' && cssSource[j] !== ';') j++;
      if (j >= n) break;
      if (cssSource[j] === ';') {
        // Naked @import / @charset / @namespace — drop.
        i = j + 1;
        continue;
      }
      // Body starts at j. Scan to matching `}`.
      const bodyEnd = matchBrace(cssSource, j);
      if (bodyEnd < 0) {
        i = n;
        continue;
      }
      const prelude = cssSource.slice(ruleStart, j).trim();
      const body = cssSource.slice(j + 1, bodyEnd);
      const isKeyframes = /^@(-\w+-)?keyframes\b/.test(prelude);
      if (isKeyframes) {
        // Keep keyframes wholesale if its name shows up via animation refs in
        // the kept ruleset. For v1 we keep all @keyframes; size impact is
        // small (canvases rarely define many).
        const block = cssSource.slice(ruleStart, bodyEnd + 1);
        out.push(block);
        collectVars(block, tokens);
        i = bodyEnd + 1;
        continue;
      }
      // Recurse — filter inside @media.
      const inner = filterComponentsCss(body, keep);
      if (inner.css.trim().length > 0) {
        out.push(`${prelude} {\n${inner.css.trimEnd()}\n}`);
        for (const t of inner.tokens) tokens.add(t);
      }
      i = bodyEnd + 1;
      continue;
    }

    // Selector rule: read prelude up to `{`.
    const ruleStart = i;
    let j = i;
    while (j < n && cssSource[j] !== '{') j++;
    if (j >= n) break;
    const bodyEnd = matchBrace(cssSource, j);
    if (bodyEnd < 0) break;
    const prelude = cssSource.slice(ruleStart, j).trim();
    if (selectorListIntersects(prelude, keep)) {
      const block = cssSource.slice(ruleStart, bodyEnd + 1);
      out.push(block);
      collectVars(block, tokens);
    }
    i = bodyEnd + 1;
  }

  return { css: out.join('\n\n'), tokens };
}

function matchBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * True if the comma-separated selector list contains any selector whose
 * first class segment is in `keep`. Splits on commas at depth 0 (won't fail on
 * `:is(.a,.b)` and similar but stays naive for v1 — the canvases this serves
 * don't use complex CSSWG selectors).
 */
function selectorListIntersects(prelude: string, keep: Set<string>): boolean {
  for (const sel of prelude.split(',')) {
    const cls = firstClass(sel.trim());
    if (!cls) continue;
    // Direct hit, or BEM-base hit (.btn--ghost survives when `btn` is kept,
    // .card__title survives when `card` is kept). Matches author intent —
    // canvases that already opt into BEM modifiers expect the whole family to
    // travel with the base class.
    if (keep.has(cls)) return true;
    const bem = cls.split(/(?:--|__)/, 1)[0];
    if (bem && bem !== cls && keep.has(bem)) return true;
  }
  return false;
}

function firstClass(selector: string): string | null {
  // Scan for `.name` — pick the first one. Stops at descendant combinators.
  const m = selector.match(/\.([A-Za-z_-][A-Za-z0-9_-]*)/);
  return m?.[1] ? m[1] : null;
}

function collectVars(css: string, tokens: Set<string>): void {
  for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    if (m[1]) tokens.add(m[1]);
  }
}

// ---------------------------------------------------------------------------
// Token resolution — read `colors_and_type.css`, pluck only the custom
// properties listed in `tokens`. Output is keyed by token-without-`--`.

export function filterTokensCss(
  cssSource: string,
  tokens: Set<string>
): { theme: Record<string, string>; usedCss: string } {
  const theme: Record<string, string> = {};
  // The expectation here is that the tokens CSS declares each `--foo: value;`
  // inside `:root` or theme-scoped blocks. We keep things simple: regex over
  // top-level `--name: value;` declarations. Multiple themes get merged into
  // `theme` (consumer can split later); a richer light/dark scheme is a
  // later iteration.
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  const usedDeclarations: string[] = [];
  let m: RegExpExecArray | null = re.exec(cssSource);
  while (m !== null) {
    const name = m[1] as string;
    const value = (m[2] as string).trim();
    if (tokens.has(name)) {
      theme[name.slice(2)] = value;
      usedDeclarations.push(`${name}: ${value};`);
    }
    m = re.exec(cssSource);
  }
  // Build a minimal :root usedCss block — useful when the consumer wants the
  // raw declarations rather than the shadcn cssVars sugar.
  const usedCss =
    usedDeclarations.length > 0 ? `:root {\n  ${usedDeclarations.join('\n  ')}\n}\n` : '';
  return { theme, usedCss };
}

// ---------------------------------------------------------------------------
// Phase 4 T7 — handoff-static frame overrides.
//
// Dev-time canvas-lib carries the full infinite-canvas engine: DesignCanvas
// runs `useViewportController`, mounts `DCMiniMap` + `DCZoomToolbar`, walks
// children via `harvestArtboards`, etc. None of that belongs in a shadcn
// registry item — the consumer of a handed-off canvas wants the design as
// rendered, not the authoring engine.
//
// `applyHandoffStaticOverrides` rewrites the three frame functions in the
// libMap to minimal static variants with empty `deps`. When `inlineUsedExports`
// then BFS-resolves what the user canvas imports (`DesignCanvas`, `DCSection`,
// `DCArtboard`), it finds these stub bodies and never reaches the engine code
// (`useViewportController`, `DCMiniMap`, `DCZoomToolbar`, `WorldContext`,
// `harvestArtboards`, `synthDefaultGrid`, `computeFit`, ...).
//
// The static frames intentionally mirror the standalone-mode rendering branch
// of the dev-time components — same DOM, same classes, same data attributes —
// so the DS's `_components.css` rules still apply 1:1.

const STATIC_DESIGN_CANVAS = `function DesignCanvas({ children }) {
  return <div className="dc-canvas">{children}</div>;
}`;

const STATIC_DC_SECTION = `function DCSection({ id, title, subtitle, children }) {
  return (
    <section className="dc-section" data-dc-section={id}>
      <header>
        <h2>{title}</h2>
        {subtitle ? <p className="sku">{subtitle}</p> : null}
      </header>
      <div className="dc-section-body">{children}</div>
    </section>
  );
}`;

const STATIC_DC_ARTBOARD = `function DCArtboard({ id, label, width, height, children }) {
  return (
    <article className="dc-artboard" data-dc-screen={id} style={{ width, height }}>
      <header className="dc-artboard-label sku">{label}</header>
      <div className="dc-artboard-body">{children}</div>
    </article>
  );
}`;

/**
 * Names this routine overrides. Exported so tests can pin the list. Adding
 * a new engine-bearing top-level export to canvas-lib that the canvas might
 * import requires either (a) extending this map with a static variant, or
 * (b) extending `inlineUsedExports`'s skip-set.
 */
export const HANDOFF_STATIC_FRAME_EXPORTS = ['DesignCanvas', 'DCSection', 'DCArtboard'] as const;

export function applyHandoffStaticOverrides(
  libMap: Map<string, { name: string; source: string; deps: string[] }>
): void {
  if (libMap.has('DesignCanvas')) {
    libMap.set('DesignCanvas', { name: 'DesignCanvas', source: STATIC_DESIGN_CANVAS, deps: [] });
  }
  if (libMap.has('DCSection')) {
    libMap.set('DCSection', { name: 'DCSection', source: STATIC_DC_SECTION, deps: [] });
  }
  if (libMap.has('DCArtboard')) {
    libMap.set('DCArtboard', { name: 'DCArtboard', source: STATIC_DC_ARTBOARD, deps: [] });
  }
}

// ---------------------------------------------------------------------------
// Main entry — emit the registry-item.json structure.

export async function emitRegistryItem(opts: EmitOptions): Promise<RegistryItem> {
  const canvasFile = Bun.file(opts.canvasAbsPath);
  if (!(await canvasFile.exists())) {
    throw new Error(`Canvas not found: ${opts.canvasAbsPath}`);
  }
  const rawTsx = await canvasFile.text();

  // Strip dev-time scaffolding.
  let tsx = stripDataCdId(opts.canvasAbsPath, rawTsx);

  // Inline canvas-lib helpers — when the canvas imports from @maude/canvas-lib,
  // we splice the resolved exports + their transitive deps into the canvas
  // source and strip the specifier. Phase 3.6.1 Task 9.
  //
  // Phase 4 T7 — engine exports (useViewportController, DCMiniMap,
  // DCZoomToolbar, ...) MUST NOT travel into a handed-off registry item.
  // The trick: replace `DesignCanvas`, `DCArtboard`, `DCSection` in the
  // libMap with their static-frame variants before BFS. The static variants
  // have empty deps, so the transitive walk never reaches the engine code.
  //
  // Phase 3.7 / DDR-049 — motion helpers (MotionDemo, MotionTrack,
  // TokenPlayback, ReducedMotionToggle, useMotionTokens, easingFromToken)
  // depend on aliased imports from motion/react (_motionImpl,
  // _useReducedMotion, _MotionAnimatePresence). When any of those land in the
  // inlined output, splice the matching motion/react import line at the file
  // head AND force-add "motion" to the registry-item's dependencies. The
  // consumer's npm install + Next.js bundler resolves motion → bunx shadcn
  // add lands an animated component with zero manual wiring.
  let motionUsed = false;
  if (opts.designRoot) {
    const libPath = canvasLibPath(opts.designRoot);
    const libFile = Bun.file(libPath);
    if (await libFile.exists()) {
      const libSource = await libFile.text();
      const libMap = buildLibMap(libPath, libSource);
      applyHandoffStaticOverrides(libMap);
      // `@maude/ds` too (V2-1.13 §5.11): its names + the system registration, same as the canvas
      const inlined = inlineDsImport(tsx, opts.designRoot, opts.canvasAbsPath, libMap);
      tsx = inlined.content;
      // Detect motion-helper usage from the inlined surface (the body refs
      // _motionImpl / _useReducedMotion / _MotionAnimatePresence). We probe
      // the post-inline source so we don't false-positive on a canvas that
      // imports a non-motion helper sharing a name prefix.
      motionUsed =
        /\b_motionImpl\b/.test(tsx) ||
        /\b_useReducedMotion\b/.test(tsx) ||
        /\b_MotionAnimatePresence\b/.test(tsx);
      if (motionUsed) {
        const motionImport =
          "import { motion as _motionImpl, useReducedMotion as _useReducedMotion, AnimatePresence as _MotionAnimatePresence } from 'motion/react';\n";
        tsx = `${motionImport}${tsx}`;
      }
    }
  }

  // Classify imports.
  const { dependencies, registryDependencies } = classifyImports(opts.canvasAbsPath, tsx);
  // @maude/canvas-lib is a dev-time virtual specifier — never ship as dep.
  const depsFiltered = dependencies.filter((d) => d !== '@maude/canvas-lib');

  // React + ReactDOM always shipped as runtime deps — the canvas authoring
  // contract requires React 19 (DDR-012). scanImports already finds `react`
  // when JSX is present (Bun.Transpiler tracks jsx-runtime usage), but it
  // doesn't surface react-dom unless explicitly imported. Force-include both.
  const depSet = new Set(depsFiltered);
  depSet.add('react');
  depSet.add('react-dom');
  if (motionUsed) depSet.add('motion');
  const finalDeps = [...depSet].sort();

  // Compute slug for `name` field — kebab-case of the file stem.
  const slug = kebabCase(path.basename(opts.canvasAbsPath, path.extname(opts.canvasAbsPath)));

  // Files: index 0 is the canvas TSX (always). 1+ are CSS bundles (optional —
  // when componentsCssPath / tokensCssPath are passed).
  const files: RegistryItemFile[] = [
    {
      path: `components/${slug}.tsx`,
      content: tsx,
      type: 'registry:component',
    },
  ];

  let cssVars: RegistryItem['cssVars'] | undefined;

  if (opts.componentsCssPath) {
    const componentsCss = await Bun.file(opts.componentsCssPath)
      .text()
      .catch(() => '');
    if (componentsCss) {
      const classNames = collectClassNames(opts.canvasAbsPath, tsx);
      const { css, tokens } = filterComponentsCss(componentsCss, classNames);
      if (css.trim().length > 0) {
        files.push({
          path: `styles/${slug}.css`,
          content: `${css}\n`,
          type: 'registry:style',
        });
      }
      if (opts.tokensCssPath && tokens.size > 0) {
        const tokensCss = await Bun.file(opts.tokensCssPath)
          .text()
          .catch(() => '');
        if (tokensCss) {
          const { theme, usedCss } = filterTokensCss(tokensCss, tokens);
          if (Object.keys(theme).length > 0) {
            cssVars = { theme };
          }
          // The consumer will graft cssVars into globals.css via shadcn's CLI;
          // we also include the raw token block as a fallback for non-shadcn
          // consumers.
          if (usedCss.length > 0) {
            files.push({
              path: `styles/${slug}.tokens.css`,
              content: usedCss,
              type: 'registry:theme',
            });
          }
        }
      }
    }
  }

  const item: RegistryItem = {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name: slug,
    type: 'registry:block',
    title: opts.title,
    description: opts.description,
    dependencies: finalDeps,
    registryDependencies,
    files,
    ...(cssVars ? { cssVars } : {}),
    meta: { kind: resolveCanvasKind(rawTsx) },
  };

  // Drop undefined keys for a clean JSON.
  if (!item.title) (item as Partial<RegistryItem>).title = undefined;
  if (!item.description) (item as Partial<RegistryItem>).description = undefined;

  return item;
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Write the registry-item.json sidecar next to a canvas. Caller picks the
 * destination path; conventional default is `<canvas-dir>/<Slug>.registry.json`.
 */
export async function writeRegistryItem(destPath: string, item: RegistryItem): Promise<void> {
  const json = `${JSON.stringify(item, null, 2)}\n`;
  const tmp = `${destPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
  await Bun.write(tmp, json);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, destPath);
}

// ---------------------------------------------------------------------------
// CLI entry — invoked from bin/handoff.sh (the orchestrator wrapper) when
// /design:handoff shells out. Keeps Bun-startup costs off the hot path.

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--emit' && argv.length >= 2) {
    const canvas = argv[1] as string;
    const designRoot = argv[2];
    const opts: EmitOptions = { canvasAbsPath: canvas };
    if (designRoot) {
      opts.designRoot = designRoot;
      opts.componentsCssPath = path.join(designRoot, 'system/project/preview/_components.css');
      opts.tokensCssPath = path.join(designRoot, 'system/project/colors_and_type.css');
    }
    // Try to read meta.json sidecar for title/description.
    const metaPath = canvas.replace(/\.tsx$/, '.meta.json');
    try {
      const metaFile = Bun.file(metaPath);
      if (await metaFile.exists()) {
        const meta = (await metaFile.json()) as { title?: string; subtitle?: string };
        opts.title = meta.title;
        opts.description = meta.subtitle;
      }
    } catch {
      // ignore — meta is optional
    }
    try {
      const item = await emitRegistryItem(opts);
      const dest = canvas.replace(/\.tsx$/, '.registry.json');
      await writeRegistryItem(dest, item);
      console.log(
        JSON.stringify({ dest, files: item.files.length, deps: item.dependencies.length })
      );
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`handoff: ${msg}`);
      process.exit(2);
    }
  } else {
    console.error('Usage: bun run handoff.ts --emit <canvas-abs-path> [designRoot]');
    process.exit(2);
  }
}

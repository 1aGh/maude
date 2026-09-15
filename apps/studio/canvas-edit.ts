// AST-aware single-element edits for the `/design:edit` Step 3a fast path
// (DDR-019, Phase 3.6 Task 5).
//
// Caller hands us (canvasAbsPath, dataCdId, attr, value); we parse the TSX,
// re-walk it with the same component/jsxIndex bookkeeping as canvas-pipeline.ts,
// find the JSX element whose ID matches, and rewrite a single attribute via
// magic-string. The two-pass-transform contract (DDR-019) is the only thing
// that keeps source-DOM identity stable across edits — so the editor lives
// next to the transpiler and shares its toolchain (oxc-parser + magic-string).
//
// Supported `attr` syntaxes:
//   - "className"         → swap the value of the `className` JSX attribute
//                           (insert one if missing). Value form: bare string.
//   - "style.<prop>"      → swap (or insert) a single CSS-property key inside
//                           the inline `style={{ ... }}` object. Value form:
//                           literal text inserted between `:` and `,` — pass a
//                           JS expression (string with quotes for strings, raw
//                           number for numbers).
//   - "<any other name>"  → swap (or insert) the value of a plain string
//                           attribute (aria-label, role, title, ...).
//
// All edits preserve every other attribute byte-for-byte. The `data-cd-id`
// attribute is intentionally NOT writable through this path — the pipeline
// owns those.
//
// Concurrent edits against the same canvas serialise behind a per-file mutex
// (matches the locator.ts pattern). Two parallel edits against different
// canvases run in parallel.

import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

export class CanvasEditError extends Error {
  readonly canvas: string;
  readonly id: string;
  /** The target no longer holds the value the caller expected (a peer changed it). */
  readonly conflict: boolean;
  constructor(message: string, info: { canvas: string; id: string; conflict?: boolean }) {
    super(message);
    this.name = 'CanvasEditError';
    this.canvas = info.canvas;
    this.id = info.id;
    this.conflict = info.conflict === true;
  }
}

/**
 * Expected-current-value guard for a single-attribute write (audit 2026-09-13
 * P1 #5). `expected` is what the caller believes the source holds now, `next`
 * is what it is about to write; `null` means "attribute / style key absent".
 * Values are the RAW strings the edit routes take (not JSON-encoded).
 */
export interface AttributePrecondition {
  expected: string | null;
  next: string | null;
}

const PASCAL_CASE = /^[A-Z][A-Za-z0-9_]*$/;
// biome-ignore lint/suspicious/noExplicitAny: oxc-parser AST nodes are heterogeneous.
type AnyNode = any;

function isPascalIdent(name: unknown): name is string {
  return typeof name === 'string' && PASCAL_CASE.test(name);
}

function componentNameOf(node: AnyNode): string | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'FunctionDeclaration' && isPascalIdent(node.id?.name)) return node.id.name;
  if (node.type === 'VariableDeclarator' && isPascalIdent(node.id?.name)) {
    const init = node.init;
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
      return node.id.name;
    }
  }
  if (node.type === 'FunctionExpression' && isPascalIdent(node.id?.name)) return node.id.name;
  return null;
}

function computeId(componentName: string, idx: number): string {
  return Bun.hash(`${componentName}:${idx}`).toString(16).padStart(16, '0').slice(0, 8);
}

interface OpeningHit {
  opening: AnyNode;
  /** The full JSXElement node — `editText` needs `.children` (JSXText), not just the opening tag. */
  element: AnyNode;
}

/**
 * Find the openingElement of the JSX element whose pipeline-computed ID matches
 * `targetId`. Walks pre-order with the same component+jsxIndex bookkeeping the
 * pipeline uses, so the ID arithmetic stays in lockstep. Returns null if no
 * match.
 */
/**
 * Hand-authored `data-cd-id` literal on an opening element, when present. The
 * pipeline PRESERVES an authored id (it skips injection — canvas-pipeline.ts
 * `hasJsxAttr` gate), so the DOM carries the AUTHORED value while the
 * positional `computeId` for that element never exists anywhere. Every walker
 * that maps ids therefore has to prefer the authored literal — without this,
 * authored-id elements were unreachable by the whole edit engine (dogfood
 * 2026-07-20: "Convert failed: invalid container data-cd-id" on
 * `data-cd-id="wal-hero-nav"`).
 */
function authoredCdId(opening: AnyNode): string | null {
  const attr = findAttribute(opening, 'data-cd-id');
  const v = attr?.value;
  if (v?.type === 'Literal' && typeof v.value === 'string' && v.value) return v.value;
  return null;
}

function findOpening(program: AnyNode, targetId: string): OpeningHit | null {
  interface Frame {
    componentName: string;
    jsxIndex: number;
  }
  const stack: Frame[] = [{ componentName: '', jsxIndex: 0 }];
  let hit: OpeningHit | null = null;

  function visit(node: AnyNode): void {
    if (hit || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) {
        if (hit) return;
        visit(c);
      }
      return;
    }
    if (typeof node.type !== 'string') return;

    const newComp = componentNameOf(node);
    let pushed = false;
    if (newComp !== null) {
      stack.push({ componentName: newComp, jsxIndex: 0 });
      pushed = true;
    }

    if (node.type === 'JSXElement') {
      const frame = stack[stack.length - 1] as Frame;
      const idx = frame.jsxIndex;
      frame.jsxIndex += 1;
      const id = authoredCdId(node.openingElement) ?? computeId(frame.componentName, idx);
      if (id === targetId) {
        hit = { opening: node.openingElement, element: node };
      }
      if (!hit) {
        if (node.openingElement) visit(node.openingElement.attributes);
        visit(node.children);
      }
      if (pushed) stack.pop();
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }

    if (pushed) stack.pop();
  }

  visit(program);
  return hit;
}

function findAttribute(opening: AnyNode, name: string): AnyNode | null {
  const attrs = opening?.attributes;
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (a?.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier' && a.name.name === name) {
      return a;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-canvas mutex — TWO layers (DDR-150 P2). (1) An in-process Promise chain
// serialises edits within THIS process (fast). (2) A cross-process advisory
// lockfile serialises against edits from ANOTHER process — the `/design:edit`
// CLI (`import.meta.main` below) or the HMR file-watcher — so their
// read-modify-write can't interleave with ours and lose an update (the in-
// process `locks` Map alone couldn't see them). The lockfile lives in the OS
// temp dir (NOT the versioned design root — never touches the gitignore
// taxonomy) keyed by the canvas absolute path. A crashed holder leaves a STALE
// lock, stolen after LOCK_STALE_MS; if it stays contended past LOCK_MAX_WAIT_MS
// we proceed anyway rather than deadlock — the atomic tmp-rename write + the
// content-hash fingerprint are the backstop against a truly simultaneous writer.

const LOCK_DIR = path.join(tmpdir(), 'maude-locks');
const LOCK_STALE_MS = 15_000;
const LOCK_POLL_MS = 25;
const LOCK_MAX_WAIT_MS = 10_000;

/** OS-temp lockfile path for a canvas (shared across processes; keyed by abs path). */
export function lockPathFor(filePath: string): string {
  return path.join(LOCK_DIR, `${Bun.hash(filePath).toString(16).padStart(16, '0')}.lock`);
}

/**
 * Acquire the cross-process advisory lock for `filePath`; resolves to an
 * idempotent release fn. Exported for tests. Degrades to a no-op lock (rather
 * than breaking every edit) if the temp dir is unwritable or contention outlasts
 * LOCK_MAX_WAIT_MS.
 */
export async function acquireFileLock(filePath: string): Promise<() => Promise<void>> {
  const lp = lockPathFor(filePath);
  await mkdir(LOCK_DIR, { recursive: true }).catch(() => {});
  const start = Date.now();
  for (;;) {
    try {
      const fh = await open(lp, 'wx'); // O_CREAT | O_EXCL — fails if already held
      await fh.writeFile(`${process.pid} ${Date.now()}`);
      await fh.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await unlink(lp).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return async () => {}; // can't create a lockfile at all → in-process-only
      }
      try {
        const st = await stat(lp);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await unlink(lp).catch(() => {}); // holder crashed — steal
          continue;
        }
      } catch {
        continue; // vanished between EEXIST and stat — retry the create
      }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) return async () => {}; // don't deadlock
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
}

const locks = new Map<string, Promise<void>>();
export function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  const next = prev.then(() => gate);
  locks.set(filePath, next);
  return prev
    .then(async () => {
      // In-process calls are already serialised by the chain above, so only ONE
      // local call ever contends the lockfile — cross-process is its only job.
      const releaseFile = await acquireFileLock(filePath);
      try {
        return await fn();
      } finally {
        await releaseFile();
      }
    })
    .finally(() => {
      release();
      if (locks.get(filePath) === next) locks.delete(filePath);
    });
}

// ---------------------------------------------------------------------------
// Public API.

export interface EditResult {
  /** The post-edit source (also written to disk by editAttribute()). */
  source: string;
  /** Number of bytes the edit changed (positive = grew, negative = shrunk). */
  delta: number;
  /**
   * Whether a disk write actually happened. Set by the disk-op wrappers only
   * (pure apply* variants leave it undefined). Callers must NOT infer this from
   * `delta` — an equal-length replacement (e.g. text "Alpha" → "Gamma") is a
   * real write with delta 0 (RC1 rim-suppression finding).
   */
  changed?: boolean;
  /**
   * What the target held BEFORE this write, read under the same lock. The
   * value an undo must restore is what the write replaced — never what a
   * client panel last believed was there (it can be a teammate's edit old).
   */
  previous?: AttributeState;
}

/**
 * Apply a single-attribute edit to the JSX element with the given `data-cd-id`.
 * Reads the canvas, rewrites in memory, writes atomically (via Bun.write to a
 * tmp + rename) so a concurrent reader never sees a partial file.
 */
export async function editAttribute(
  canvasAbsPath: string,
  id: string,
  attr: string,
  value: string,
  occurrence?: number,
  precondition?: AttributePrecondition
): Promise<EditResult> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    // Read under the same per-file lock as the write — no gap between the read
    // that proves the precondition (and records what is replaced) and the rename.
    const previous = readAttributeState(canvasAbsPath, source, id, attr, occurrence);
    if (
      precondition &&
      checkPrecondition(previous, id, attr, canvasAbsPath, precondition) === 'already'
    ) {
      return { source, delta: 0, changed: false, previous };
    }
    const next = applyEdit(canvasAbsPath, source, id, attr, value, occurrence);
    if (next.source === source) return { source, delta: 0, changed: false, previous };
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return { ...next, changed: true, previous };
  });
}

/**
 * Remove an attribute (or one inline-style property) from the element with the
 * given `data-cd-id` — the "reset to original" path (Phase 12.3). `attr` follows
 * the same shape as `editAttribute`: `style.<camelOrKebab>` removes one inline
 * style key (dropping the whole `style={{}}` when it was the last key); any other
 * name removes that plain JSX attribute. A missing key/attribute is a no-op
 * (delta 0), never an error. Same atomic write + per-file lock as `editAttribute`.
 */
export async function removeAttribute(
  canvasAbsPath: string,
  id: string,
  attr: string,
  occurrence?: number,
  precondition?: AttributePrecondition
): Promise<EditResult> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    const previous = readAttributeState(canvasAbsPath, source, id, attr, occurrence);
    if (
      precondition &&
      checkPrecondition(previous, id, attr, canvasAbsPath, precondition) === 'already'
    ) {
      return { source, delta: 0, changed: false, previous };
    }
    const next = applyRemove(canvasAbsPath, source, id, attr, occurrence);
    if (next.source === source) return { source, delta: 0, changed: false, previous };
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return { ...next, changed: true, previous };
  });
}

/** What one plain attribute or inline style key currently holds in source. */
export type AttributeState =
  | { kind: 'absent' }
  | { kind: 'literal'; value: string }
  /** Present, but not a literal this module can compare (an expression, a spread). */
  | { kind: 'expression' };

function literalText(node: AnyNode): string | null {
  if (!node) return null;
  if (node.type === 'Literal' || node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
    return typeof node.value === 'string' || typeof node.value === 'number'
      ? String(node.value)
      : null;
  }
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked ?? null;
  }
  return null;
}

/**
 * Read the current value of `attr` (`style.<prop>` or a plain attribute name)
 * on the element with `data-cd-id` `id`, with the same occurrence routing as
 * `applyEdit` / `applyRemove`. Pure — exposed for tests and preconditions.
 */
export function readAttributeState(
  canvasAbsPath: string,
  source: string,
  id: string,
  attr: string,
  occurrence?: number
): AttributeState {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }
  if (typeof occurrence === 'number' && Number.isFinite(occurrence)) {
    id = resolveUsageId(parsed.program, id, occurrence);
  }
  const hit = findOpening(parsed.program, id);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${id}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  if (attr.startsWith('style.')) {
    const style = findAttribute(hit.opening, 'style');
    if (!style) return { kind: 'absent' };
    const obj = style.value?.type === 'JSXExpressionContainer' ? style.value.expression : null;
    if (obj?.type !== 'ObjectExpression') return { kind: 'expression' };
    const prop = attr.slice('style.'.length);
    const propCamel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    for (const p of obj.properties as AnyNode[]) {
      if (p?.type !== 'Property' && p?.type !== 'ObjectProperty') continue;
      const k = p.key;
      const kname =
        k?.type === 'Identifier' ? k.name : k?.type === 'Literal' ? String(k.value) : null;
      if (kname !== prop && kname !== propCamel) continue;
      const text = literalText(p.value);
      return text === null ? { kind: 'expression' } : { kind: 'literal', value: text };
    }
    // A spread may supply the key at runtime; "absent" would be a guess.
    return (obj.properties as AnyNode[]).some((p) => p?.type === 'SpreadElement')
      ? { kind: 'expression' }
      : { kind: 'absent' };
  }
  const found = findAttribute(hit.opening, attr);
  if (!found) return { kind: 'absent' };
  if (found.value == null) return { kind: 'literal', value: '' };
  const direct = literalText(found.value);
  if (direct !== null) return { kind: 'literal', value: direct };
  const inner =
    found.value.type === 'JSXExpressionContainer' ? literalText(found.value.expression) : null;
  return inner === null ? { kind: 'expression' } : { kind: 'literal', value: inner };
}

/**
 * `'apply'` when the source still holds `expected`; `'already'` when it holds
 * `next` (a retried or already-applied write — idempotent success). Anything
 * else is a peer's newer value: refuse rather than overwrite it.
 */
function checkPrecondition(
  state: AttributeState,
  id: string,
  attr: string,
  canvasAbsPath: string,
  pre: AttributePrecondition
): 'apply' | 'already' {
  const holds = (value: string | null) =>
    value === null ? state.kind === 'absent' : state.kind === 'literal' && state.value === value;
  if (holds(pre.next)) return 'already';
  if (holds(pre.expected)) return 'apply';
  const name = attr.startsWith('style.') ? attr.slice('style.'.length) : attr;
  throw new CanvasEditError(`${name} was changed by someone else — kept their value`, {
    canvas: canvasAbsPath,
    id,
    conflict: true,
  });
}

/** Pure variant of `removeAttribute` — exposed for tests. */
export function applyRemove(
  canvasAbsPath: string,
  source: string,
  id: string,
  attr: string,
  occurrence?: number
): EditResult {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      {
        canvas: canvasAbsPath,
        id,
      }
    );
  }
  // Stage H3 — mirror applyEdit: a whole-instance reset routes to the dragged
  // occurrence's `<Component/>` usage (no-op for a normal / single-usage element).
  if (typeof occurrence === 'number' && Number.isFinite(occurrence)) {
    id = resolveUsageId(parsed.program, id, occurrence);
  }
  const hit = findOpening(parsed.program, id);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${id}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  const s = new MagicString(source);
  if (attr.startsWith('style.')) {
    removeStyleProp(s, hit.opening, attr.slice('style.'.length), source);
  } else if (attr === 'data-cd-id') {
    throw new CanvasEditError('data-cd-id is owned by the pipeline; cannot be removed', {
      canvas: canvasAbsPath,
      id,
    });
  } else {
    removeStringAttr(s, hit.opening, attr, source);
  }
  const out = s.toString();
  return { source: out, delta: out.length - source.length };
}

/**
 * Apply an inline TEXT-content edit to the JSX element with the given
 * `data-cd-id`. Leaf-text only: the element's children must be exactly one
 * `JSXText` node (whitespace-only siblings are ignored). Mixed/expression
 * children (`<b>x</b>`, `{count}`) throw `CanvasEditError` — the caller should
 * surface a "use /design:edit" refusal rather than guess. The text is
 * JSX-escaped before it touches source. Same atomic write + per-file lock as
 * `editAttribute`. See DDR-103.
 */
export async function editText(
  canvasAbsPath: string,
  id: string,
  text: string,
  opts?: DynamicTextOpts
): Promise<EditResult> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    // Byte cap before the AST walk (ethical-hacker F-C) — a real canvas is well
    // under this; a pathologically large attacker-authored file that would make
    // the resolver's per-candidate walk expensive is refused up front.
    if (source.length > 4_000_000) {
      throw new CanvasEditError(`canvas too large to edit inline (${source.length} bytes)`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const next = applyTextEdit(canvasAbsPath, source, id, text, opts);
    if (next.source === source) return { source, delta: 0, changed: false };
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return { ...next, changed: true };
  });
}

/**
 * Pure variant — exposed for tests + in-memory pipelines. Caller owns
 * persistence. Throws CanvasEditError if the ID isn't found or the edit shape
 * isn't representable.
 */
export function applyEdit(
  canvasAbsPath: string,
  source: string,
  id: string,
  attr: string,
  value: string,
  occurrence?: number
): EditResult {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }

  // feature-element-editing-robustness Stage H3 — when the caller passes an
  // explicit DOM-occurrence index (a whole-component-instance move/resize), route
  // the write to that occurrence's parent `<Component/>` USAGE so the edit stays
  // LOCAL to the dragged instance (its own left/top/width/height) instead of
  // mutating the shared inner definition (which would move every instance). A
  // no-op for a normal element or a `.map()`ed single-usage one (resolveUsageId
  // returns `id`). Deliberately gated on `occurrence` being present: the CssKnobs
  // / paste-style paths pass NO occurrence, so styling an INNER shared element
  // stays global-and-labeled — the H2 badge is the answer there (the chosen model).
  if (typeof occurrence === 'number' && Number.isFinite(occurrence)) {
    id = resolveUsageId(parsed.program, id, occurrence);
  }

  const hit = findOpening(parsed.program, id);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${id}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id,
    });
  }

  const s = new MagicString(source);
  if (attr.startsWith('style.')) {
    editStyleProp(s, hit.opening, attr.slice('style.'.length), value, canvasAbsPath, id);
  } else if (attr === 'data-cd-id') {
    throw new CanvasEditError('data-cd-id is owned by the pipeline; cannot be edited', {
      canvas: canvasAbsPath,
      id,
    });
  } else {
    editStringAttr(s, hit.opening, attr, value, canvasAbsPath, id);
  }

  const out = s.toString();
  return { source: out, delta: out.length - source.length };
}

/**
 * Extra context for editing text that comes from a `{variable}` rather than a
 * literal (unified-text-editing follow-up). `occurrence` = which rendered
 * instance the user edited (index among DOM nodes carrying this same cd-id — a
 * `.map()` renders one source element N×); `before` = the pre-edit rendered
 * text, used both to pick the right `.map()` item when the index drifts (a
 * `.filter().map()` etc.) and to refuse a rewrite we can't confidently target.
 */
export interface DynamicTextOpts {
  occurrence?: number;
  before?: string;
}

/**
 * Pure variant of `editText` — parse, locate the JSXText child, overwrite its
 * source span (preserving the original leading/trailing whitespace so JSX
 * indentation survives), escaping the new text. A single `{'literal'}` child is
 * rewritten in place (DDR-150 P1). A single `{variable}` / `{item.prop}` child
 * is resolved back to its source string (a local `const` or a `.map()`ed array
 * element) when `opts` carries enough to target it unambiguously — otherwise it
 * throws `CanvasEditError` (genuinely dynamic → route to /design:edit), same as
 * mixed content.
 */
export function applyTextEdit(
  canvasAbsPath: string,
  source: string,
  id: string,
  text: string,
  opts?: DynamicTextOpts
): EditResult {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }

  const hit = findOpening(parsed.program, id);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${id}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id,
    });
  }

  const children: AnyNode[] = Array.isArray(hit.element?.children) ? hit.element.children : [];
  // Ignore whitespace-only JSXText siblings (`<button>\n  Save\n</button>` parses
  // as one JSXText; `<a>\n  <b/>\n</a>` parses as ws + element + ws — the ws is
  // noise). What's left is the "real" content.
  const meaningful = children.filter(
    (c) => !(c?.type === 'JSXText' && typeof c.value === 'string' && c.value.trim() === '')
  );
  if (meaningful.length === 0) {
    throw new CanvasEditError(`element "${id}" has no editable text content`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  const only = meaningful[0];
  // A single `{'string literal'}` expression child — `<h1>{'Title'}</h1>` — is
  // editable (DDR-150 P1): rewrite the literal in place. Written back via
  // JSON.stringify so the result is an inert, correctly-escaped quoted string —
  // the value never leaves the `{...}`, so (unlike JSXText) there is no markup /
  // entity injection surface to guard. Any OTHER expression (identifier,
  // template, call, member — `{title}`, `` {`${n} items`} ``) is genuinely
  // dynamic: refuse and route to /design:edit rather than delete the binding.
  if (meaningful.length === 1 && only?.type === 'JSXExpressionContainer') {
    const expr = (only as AnyNode).expression;
    // A single `{'string literal'}` — rewrite the literal in place (DDR-150 P1).
    if (isStringLit(expr)) {
      if (expr.value === text) return { source, delta: 0 };
      const s = new MagicString(source);
      s.overwrite(expr.start as number, expr.end as number, JSON.stringify(text));
      const out = s.toString();
      return { source: out, delta: out.length - source.length };
    }
    // A single `{variable}` / `{item.prop}` — trace it back to its source string
    // (a local const, or a `.map()`ed array element) and rewrite THERE. The
    // literal that comes back is a JS string, so it round-trips through
    // JSON.stringify like the `{'literal'}` case above (no JSX-entity surface).
    const span = resolveDynamicTextSpan(parsed.program, hit.element, expr, id, opts);
    if (span) {
      const s = new MagicString(source);
      s.overwrite(span.start as number, span.end as number, JSON.stringify(text));
      const out = s.toString();
      return { source: out, delta: out.length - source.length };
    }
    throw new CanvasEditError(`element "${id}" has dynamic content — edit it via /design:edit`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  if (meaningful.length > 1 || only?.type !== 'JSXText') {
    throw new CanvasEditError(
      `element "${id}" has mixed or expression content — edit it via /design:edit`,
      { canvas: canvasAbsPath, id }
    );
  }

  const start = only.start as number;
  const end = only.end as number;
  const raw = source.slice(start, end);
  // The text it already shows is not an edit (plan T23): a multi-line JSX text
  // renders as its lines joined by one space, and rewriting it with that same
  // text used to fold the author's line breaks into one line.
  if (jsxRenderedText(raw) === escapeJsxText(text)) return { source, delta: 0 };
  // Preserve the original indentation/newline framing; swap only the visible text.
  const lead = /^\s*/.exec(raw)?.[0] ?? '';
  const trail = /\s*$/.exec(raw)?.[0] ?? '';
  const s = new MagicString(source);
  s.overwrite(start, end, `${lead}${escapeJsxText(text)}${trail}`);
  const out = s.toString();
  return { source: out, delta: out.length - source.length };
}

// ---------------------------------------------------------------------------
// Dynamic-text resolution (unified-text-editing follow-up). A `{variable}` /
// `{item.prop}` text child has no literal to rewrite at the element — the
// string lives in a `const` or a `.map()`ed data array. These helpers trace it
// back to that source StringLiteral so inline editing works there too, WITHOUT
// ever risking the wrong rewrite: the occurrence index picks the `.map()` item,
// and the pre-edit text (`before`) both verifies that pick and rescues it when
// the index drifts (`.filter().map()`, reorders). Anything we can't target
// unambiguously returns null → the caller throws → routes to /design:edit.

/**
 * JSX's own whitespace rule for a text child, on the raw source: each line is
 * trimmed (inner lines on both sides), empty lines drop, and the rest join with
 * one space. Entities stay encoded — the caller compares against escaped text.
 */
function jsxRenderedText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw.trim();
  return lines
    .map((line, i) => {
      let l = line;
      if (i !== 0) l = l.replace(/^[ \t]+/, '');
      if (i !== lines.length - 1) l = l.replace(/[ \t]+$/, '');
      return l;
    })
    .filter((l) => l.length > 0)
    .join(' ')
    .trim();
}

function isStringLit(n: AnyNode): boolean {
  return !!(
    n &&
    (n.type === 'Literal' || n.type === 'StringLiteral') &&
    typeof n.value === 'string'
  );
}

/** Depth-first visit every AST node (skips location metadata keys). */
function walkAst(root: AnyNode, fn: (node: AnyNode) => void): void {
  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    fn(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  }
  visit(root);
}

/** The innermost `xs.map((param) => …)` whose callback param is `paramName`
 *  and whose body byte-range encloses `element`. Returns the mapped array
 *  expression (an Identifier or an inline ArrayExpression), or null. */
function findEnclosingMapArray(
  program: AnyNode,
  element: AnyNode,
  paramName: string
): AnyNode | null {
  const es = element.start as number;
  const ee = element.end as number;
  let best: AnyNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  walkAst(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression' || callee.computed) return;
    if (callee.property?.name !== 'map') return;
    const cb = node.arguments?.[0];
    if (cb?.type !== 'ArrowFunctionExpression' && cb?.type !== 'FunctionExpression') return;
    const p0 = cb.params?.[0];
    if (p0?.type !== 'Identifier' || p0.name !== paramName) return;
    const body = cb.body;
    if (typeof body?.start !== 'number' || typeof body?.end !== 'number') return;
    if (!(body.start <= es && ee <= body.end)) return;
    const size = (body.end as number) - (body.start as number);
    if (size < bestSize) {
      bestSize = size;
      best = callee.object;
    }
  });
  return best;
}

/** Resolve an array expression (an inline `[…]` or an Identifier bound to a
 *  `const xs = […]`) to its ArrayExpression node. */
function resolveArrayExpr(program: AnyNode, arrayExpr: AnyNode): AnyNode | null {
  if (arrayExpr?.type === 'ArrayExpression') return arrayExpr;
  if (arrayExpr?.type === 'Identifier') {
    let found: AnyNode | null = null;
    walkAst(program, (node) => {
      if (
        node.type === 'VariableDeclarator' &&
        node.id?.type === 'Identifier' &&
        node.id.name === arrayExpr.name &&
        node.init?.type === 'ArrayExpression'
      ) {
        found = node.init;
      }
    });
    return found;
  }
  return null;
}

/** The value node of property `propName` on an ObjectExpression, or null. */
function objPropValue(objExpr: AnyNode, propName: string): AnyNode | null {
  if (objExpr?.type !== 'ObjectExpression') return null;
  for (const p of objExpr.properties ?? []) {
    if (p?.type !== 'Property' || p.computed) continue;
    const keyOk =
      (p.key?.type === 'Identifier' && p.key.name === propName) ||
      (isStringLit(p.key) && p.key.value === propName);
    if (keyOk) return p.value ?? null;
  }
  return null;
}

/**
 * Bounded expression evaluator — resolve `expr` to a concrete value node
 * (a StringLiteral, ObjectExpression, or ArrayExpression) by following const
 * bindings, numeric array indices (`XS[0]`), and object-field access
 * (`obj.field`). Returns null for anything genuinely computed (calls, template
 * strings, arithmetic). Depth-capped so a cyclic const can't loop.
 */
function resolveValueNode(program: AnyNode, expr: AnyNode, depth = 0): AnyNode | null {
  if (!expr || depth > 8) return null;
  // Unwrap `x as T` / `x satisfies T` type-cast wrappers (e.g. a shared
  // `print={A1_PRINT as any}` prop, or a `const X = {...} as const`
  // declaration) — the cast carries no runtime value, so the wrapped
  // expression is what every branch below actually needs to match against.
  while (expr && (expr.type === 'TSAsExpression' || expr.type === 'TSSatisfiesExpression')) {
    expr = expr.expression;
  }
  if (!expr) return null;
  if (isStringLit(expr)) return expr;
  if (expr.type === 'ObjectExpression' || expr.type === 'ArrayExpression') return expr;
  if (expr.type === 'Identifier') {
    let init: AnyNode | null = null;
    walkAst(program, (n) => {
      if (
        n.type === 'VariableDeclarator' &&
        n.id?.type === 'Identifier' &&
        n.id.name === expr.name &&
        n.init
      ) {
        init = n.init;
      }
    });
    return init ? resolveValueNode(program, init, depth + 1) : null;
  }
  if (expr.type === 'MemberExpression') {
    const obj = resolveValueNode(program, expr.object, depth + 1);
    if (!obj) return null;
    if (expr.computed) {
      const idx = expr.property;
      if (
        (idx?.type === 'Literal' || idx?.type === 'NumericLiteral') &&
        typeof idx.value === 'number' &&
        obj.type === 'ArrayExpression'
      ) {
        return resolveValueNode(program, obj.elements?.[idx.value], depth + 1);
      }
      return null;
    }
    if (expr.property?.type === 'Identifier') {
      return resolveValueNode(program, objPropValue(obj, expr.property.name), depth + 1);
    }
    return null;
  }
  return null;
}

/** Ordered value-expressions of a `<CompName propName={…}>` usage, one per
 *  usage in source order (aligns with the DOM occurrence of the element the
 *  prop feeds). null slot = a usage that omits the prop. */
function componentUsageValues(
  program: AnyNode,
  componentName: string,
  propName: string
): Array<AnyNode | null> | null {
  if (!componentName) return null;
  const out: Array<AnyNode | null> = [];
  walkAst(program, (node) => {
    if (node.type !== 'JSXElement') return;
    const name = node.openingElement?.name;
    if (name?.type !== 'JSXIdentifier' || name.name !== componentName) return;
    let val: AnyNode | null = null;
    for (const a of node.openingElement?.attributes ?? []) {
      if (
        a?.type === 'JSXAttribute' &&
        a.name?.type === 'JSXIdentifier' &&
        a.name.name === propName
      ) {
        val =
          a.value?.type === 'JSXExpressionContainer'
            ? a.value.expression
            : isStringLit(a.value)
              ? a.value
              : null;
        break;
      }
    }
    out.push(val);
  });
  return out.length ? out : null;
}

/**
 * Trace a single `{base}` / `{base.field}` text expression back to the
 * StringLiteral node that holds its text, or null when it can't be targeted
 * confidently. `base` is resolved through three bindings — a `.map()` callback
 * param (array items), a component PROP (each `<Comp prop={…}>` usage), or a
 * local `const` — and each candidate is run through the bounded evaluator
 * (`beat.caption` where `beat={BEATS[0]}` → `BEATS[0].caption`). The occurrence
 * index picks the slot; `before` verifies it and rescues a drifted index; ties
 * are never guessed. `occurrence`/`before` come from the edited DOM instance.
 */
function resolveDynamicTextSpan(
  program: AnyNode,
  element: AnyNode,
  expr: AnyNode,
  id: string,
  opts?: DynamicTextOpts
): AnyNode | null {
  // Decompose into base Identifier + optional single field.
  let baseName: string;
  let field: string | null;
  if (expr?.type === 'Identifier') {
    baseName = expr.name;
    field = null;
  } else if (
    expr?.type === 'MemberExpression' &&
    !expr.computed &&
    expr.object?.type === 'Identifier' &&
    expr.property?.type === 'Identifier'
  ) {
    baseName = expr.object.name;
    field = expr.property.name;
  } else {
    return null;
  }

  // Candidate value-expressions for `base`, one per rendered slot.
  let candidates: Array<AnyNode | null> | null = null;
  // (1) a `.map()` callback param → the array items.
  const arrExpr = findEnclosingMapArray(program, element, baseName);
  if (arrExpr) {
    const arr = resolveArrayExpr(program, arrExpr);
    candidates = arr ? (arr.elements ?? []) : null;
  }
  // (2) a component prop → each `<Comp base={…}>` usage's value.
  if (!candidates) {
    const componentName =
      collectElementsFull(program).find((e) => e.id === id)?.componentName ?? '';
    candidates = componentUsageValues(program, componentName, baseName);
  }
  // (3) a local const → a single candidate.
  if (!candidates) {
    let init: AnyNode | null = null;
    walkAst(program, (n) => {
      if (
        n.type === 'VariableDeclarator' &&
        n.id?.type === 'Identifier' &&
        n.id.name === baseName
      ) {
        init = n.init ?? null;
      }
    });
    candidates = init ? [init] : null;
  }
  if (!candidates) return null;
  // Complexity cap (ethical-hacker F-C): each candidate runs a full-program
  // walkAst per resolution step, so an attacker-authored canvas with a huge
  // array of `{identifier}` items could make this O(N × program). A real
  // `.map()`/usage list is tiny; anything past the cap is refused (a single
  // edit couldn't confidently target one of thousands of slots anyway).
  const MAX_CANDIDATES = 1000;
  if (candidates.length > MAX_CANDIDATES) return null;

  // Resolve each candidate to a StringLiteral (applying `.field` when present).
  const lits: Array<AnyNode | null> = candidates.map((c) => {
    const base = resolveValueNode(program, c);
    if (!base) return null;
    if (field) {
      const v = resolveValueNode(program, objPropValue(base, field));
      return isStringLit(v) ? v : null;
    }
    return isStringLit(base) ? base : null;
  });

  // Pick: occurrence index (verified by `before`), else the UNIQUE `before`
  // match, else — only with no `before` to verify — the raw index. No guessing.
  const beforeTrim = (opts?.before ?? '').trim();
  const occ = typeof opts?.occurrence === 'number' && opts.occurrence >= 0 ? opts.occurrence : null;
  const at = occ != null ? lits[occ] : null;
  if (at && (!beforeTrim || String(at.value).trim() === beforeTrim)) return at;
  if (beforeTrim) {
    const hits = lits.filter((c): c is AnyNode => !!c && String(c.value).trim() === beforeTrim);
    return hits.length === 1 ? (hits[0] ?? null) : null;
  }
  return at ?? null;
}

// ---------------------------------------------------------------------------
// Node-move reorder (DDR-138, phase-12.1). Moving a whole JSXElement to a new
// sibling/parent position — the one structural edit `editAttribute`/`editText`
// don't do. Remove the element's line-span + insert a re-indented copy at an
// anchor derived from `refId` + `position`. A same-parent reorder is the
// degenerate case where source/target indent match (no re-indent). Reparenting
// works because we re-indent (not raw magic-string.move). Guardrails refuse
// structurally-unsafe moves; a post-move reparse gate guarantees we never write
// corrupt source. The move response recomputes the moved element's positional
// id (matches what the pipeline assigns on the next pass) + surfaces its
// author-semantic `data-dc-element` handle so the client can re-settle the
// selection through the id churn.

export type MovePosition = 'before' | 'after' | 'inside-start' | 'inside-end';

export interface MoveResult extends EditResult {
  /** Recomputed positional id of the moved element (== the DOM `data-cd-id`
   *  after the next pipeline pass). Best-effort — null if not resolvable. */
  movedId: string | null;
  /** The moved element's `data-dc-element` value (DDR-007), if it has one — a
   *  stable re-select key that survives the id churn byte-for-byte. */
  semanticId: string | null;
}

/** Read a plain-string JSX attribute value off an opening element (null when
 *  absent or not a string literal). */
function getStringAttr(opening: AnyNode, name: string): string | null {
  const attr = findAttribute(opening, name);
  if (!attr) return null;
  const v = attr.value;
  if (v == null) return '';
  if (v.type === 'Literal' || v.type === 'StringLiteral') return String(v.value);
  return null;
}

/** Info about the line a byte offset sits on: the whitespace indentation, where
 *  it begins, and whether a newline immediately precedes it. */
export function lineStartInfo(
  source: string,
  pos: number
): { indent: string; indentStart: number; newlineBefore: boolean } {
  let i = pos;
  while (i > 0 && (source[i - 1] === ' ' || source[i - 1] === '\t')) i--;
  return {
    indent: source.slice(i, pos),
    indentStart: i,
    newlineBefore: i > 0 && source[i - 1] === '\n',
  };
}

/** Detect the file's indentation unit (tab vs N spaces). Canvases are Prettier
 *  2-space by default; fall back to that. */
function detectIndentUnit(source: string): string {
  if (/\n\t/.test(source)) return '\t';
  const m = /\n( +)\S/.exec(source);
  return m ? m[1] : '  ';
}

/** Re-indent an element's source text from `fromIndent` (its old line indent) to
 *  `toIndent` (the target depth). The first line carries no leading indent in
 *  `elText` (it starts at the element), so only continuation lines shift, by the
 *  same delta, preserving the element's internal structure. */
function reindentBlock(elText: string, fromIndent: string, toIndent: string): string {
  if (fromIndent === toIndent) return elText;
  const lines = elText.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
      const rest = line.slice(lead.length);
      if (rest === '') return line; // blank line — leave as-is
      const rel = lead.startsWith(fromIndent) ? lead.slice(fromIndent.length) : lead;
      return toIndent + rel + rest;
    })
    .join('\n');
}

/** Normalize element text for duplicate-tolerant matching: trim each line so
 *  re-indentation differences don't defeat the match. */
function normalizeForMatch(t: string): string {
  return t
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
}

/** Walk the program with the SAME component + jsxIndex bookkeeping the pipeline
 *  uses (canvas-pipeline.ts walkInjectIds), collecting every JSXElement with the
 *  id it will be assigned. Reused to recompute the moved element's post-move id. */
function collectElements(program: AnyNode): Array<{ id: string; node: AnyNode }> {
  interface Frame {
    componentName: string;
    jsxIndex: number;
  }
  const stack: Frame[] = [{ componentName: '', jsxIndex: 0 }];
  const out: Array<{ id: string; node: AnyNode }> = [];

  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;

    const newComp = componentNameOf(node);
    let pushed = false;
    if (newComp !== null) {
      stack.push({ componentName: newComp, jsxIndex: 0 });
      pushed = true;
    }

    if (node.type === 'JSXElement') {
      const frame = stack[stack.length - 1] as Frame;
      const idx = frame.jsxIndex;
      frame.jsxIndex += 1;
      out.push({
        id: authoredCdId(node.openingElement) ?? computeId(frame.componentName, idx),
        node,
      });
      if (node.openingElement) visit(node.openingElement.attributes);
      visit(node.children);
      if (pushed) stack.pop();
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
    if (pushed) stack.pop();
  }

  visit(program);
  return out;
}

/**
 * Every JSX element with its enclosing-component frame + tag. Superset of
 * collectElements used to resolve a reused-component INSTANCE to its parent
 * USAGE (see resolveUsageId).
 */
function collectElementsFull(
  program: AnyNode
): Array<{ id: string; componentName: string; isFrameRoot: boolean; tag: string | null }> {
  interface Frame {
    componentName: string;
    jsxIndex: number;
  }
  const stack: Frame[] = [{ componentName: '', jsxIndex: 0 }];
  const out: Array<{
    id: string;
    componentName: string;
    isFrameRoot: boolean;
    tag: string | null;
  }> = [];
  function tagOf(node: AnyNode): string | null {
    const n = node?.openingElement?.name;
    if (n?.type === 'JSXIdentifier' && typeof n.name === 'string') return n.name;
    return null;
  }
  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    const newComp = componentNameOf(node);
    let pushed = false;
    if (newComp !== null) {
      stack.push({ componentName: newComp, jsxIndex: 0 });
      pushed = true;
    }
    if (node.type === 'JSXElement') {
      const frame = stack[stack.length - 1] as Frame;
      const idx = frame.jsxIndex;
      frame.jsxIndex += 1;
      out.push({
        id: authoredCdId(node.openingElement) ?? computeId(frame.componentName, idx),
        componentName: frame.componentName,
        isFrameRoot: idx === 0,
        tag: tagOf(node),
      });
      if (node.openingElement) visit(node.openingElement.attributes);
      visit(node.children);
      if (pushed) stack.pop();
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
    if (pushed) stack.pop();
  }
  visit(program);
  return out;
}

/**
 * feature-4 T7a (layers purple instances, DDR-187 scope note) — the component
 * map the shell's Layers panel renders instance rows from. For every element id
 * whose ENCLOSING component is actually instantiated as a JSX element in this
 * file (`<Card/>` — i.e. a reusable component, not the top-level canvas
 * component, which is exported/mounted but never referenced as JSX here),
 * report `{ component, root, usages }`. `root` marks the component's own frame
 * root (the "instance" row in Figma terms — ◆-adjacent); inner members get the
 * same purple treatment at lower prominence. Elements of never-instantiated
 * components (the canvas root) are omitted — keeps the payload proportional to
 * actual instances.
 */
export function componentMapForCanvas(
  canvasAbsPath: string,
  source: string
): Record<string, { component: string; root: boolean; usages: number }> {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) return {};
  const all = collectElementsFull(parsed.program);
  // Usage count per component name = JSX elements whose TAG is that name.
  const usages = new Map<string, number>();
  for (const e of all) {
    if (e.tag && /^[A-Z]/.test(e.tag)) {
      usages.set(e.tag, (usages.get(e.tag) ?? 0) + 1);
    }
  }
  const out: Record<string, { component: string; root: boolean; usages: number }> = {};
  for (const e of all) {
    if (!e.componentName) continue;
    const n = usages.get(e.componentName) ?? 0;
    if (n < 1) continue; // top-level canvas component — not an instance
    // First writer wins — repeated ids (a `.map`) share one source element; the
    // map is keyed by source id, which is exactly what the Layers rows carry.
    if (!out[e.id]) out[e.id] = { component: e.componentName, root: e.isFrameRoot, usages: n };
  }
  return out;
}

/**
 * Resolve a reused-component INSTANCE id to the parent's `<Component>` USAGE id.
 *
 * A component used N times (`<Column/>` … `<Column/>`) renders N DOM nodes that
 * all carry ONE data-cd-id — the id of an element INSIDE the component's
 * definition. That id can't be moved (there's only one, inside the loop-free
 * component body). But each USAGE in the parent is a distinct, movable JSX
 * element. So when `domId` names an element that lives inside a component with
 * multiple usages, map it to the `occurrenceIndex`-th usage (the occurrence index
 * of ANY element in the component equals the instance index = the usage index).
 * Falls through to `domId` for a normal element, or a `.map()`ed single-usage
 * element (one usage → can't split). Reordering elements WITHIN a reused
 * component's definition isn't reachable via drag (edit the component source).
 */
function resolveUsageId(
  program: AnyNode,
  domId: string,
  occurrenceIndex: number | undefined
): string {
  const all = collectElementsFull(program);
  const target = all.find((e) => e.id === domId);
  if (!target?.componentName) return domId;
  const usages = all.filter((e) => e.tag === target.componentName);
  if (usages.length <= 1) return domId; // single usage (or `.map`) — not splittable
  const i =
    typeof occurrenceIndex === 'number' && occurrenceIndex >= 0 && occurrenceIndex < usages.length
      ? occurrenceIndex
      : 0;
  return usages[i]?.id ?? domId;
}

/**
 * Edit-scope verdict for the INV-3 predictability badge (feature-element-editing-
 * robustness Stage H). Tells the Inspector whether a style/attr edit to `domId`
 * stays LOCAL (this one rendered place) or is SHARED (changes N places).
 */
export interface EditScope {
  scope: 'local' | 'shared';
  /** Enclosing reused-component name when the element lives inside one, else null. */
  componentName: string | null;
  /** How many rendered places an edit to this element touches. */
  affects: number;
  /** single = a lone element · component = inside an N-usage component · mapped =
   *  one source element rendered N× via `.map()` (DDR-139 §1). */
  reason: 'single' | 'component' | 'mapped';
}

/**
 * Resolve whether an edit to `domId` is local or shared — composing the SAME
 * primitives `resolveUsageId` ships: the element's enclosing `componentName` plus
 * the source usage count of that component. `renderedCount` is the number of DOM
 * nodes carrying this cd-id (the client knows it): a single source element
 * rendered N× through `.map()` is `shared` ('mapped') even with one source usage,
 * so the badge never lies. A parse failure degrades to `local` (a badge must
 * never crash selection). Pure — unit-tested without a DOM.
 */
export function resolveEditScope(
  canvasAbsPath: string,
  source: string,
  domId: string,
  renderedCount = 1
): EditScope {
  const rendered =
    Number.isFinite(renderedCount) && renderedCount > 0 ? Math.floor(renderedCount) : 1;
  let program: AnyNode;
  try {
    const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
    if (parsed.errors && parsed.errors.length > 0) {
      return { scope: 'local', componentName: null, affects: 1, reason: 'single' };
    }
    program = parsed.program;
  } catch {
    return { scope: 'local', componentName: null, affects: 1, reason: 'single' };
  }
  const all = collectElementsFull(program);
  const target = all.find((e) => e.id === domId);
  const compName = target?.componentName || '';
  // Usages of the enclosing component = distinct `<Component/>` tags in the tree.
  // 0 for a top-level artboard element (the Canvas fn is never `<Canvas/>`'d).
  const usages = compName ? all.filter((e) => e.tag === compName).length : 0;
  if (usages > 1) {
    return {
      scope: 'shared',
      componentName: compName,
      affects: Math.max(usages, rendered),
      reason: 'component',
    };
  }
  if (rendered > 1) {
    return {
      scope: 'shared',
      componentName: compName || null,
      affects: rendered,
      reason: 'mapped',
    };
  }
  return { scope: 'local', componentName: null, affects: 1, reason: 'single' };
}

/**
 * Move the element with `data-cd-id === id` to a position relative to the element
 * with `data-cd-id === refId`. Async wrapper: read, apply, atomic write under the
 * per-file mutex — identical persistence to `editAttribute`.
 *
 * `idIndex` / `refIndex` are the DOM occurrence indices — which rendered instance
 * of a reused component the id refers to (0 for a normal, single-render element).
 */
export async function moveElement(
  canvasAbsPath: string,
  id: string,
  refId: string,
  position: MovePosition,
  idIndex?: number,
  refIndex?: number
): Promise<MoveResult> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    const next = applyMove(canvasAbsPath, source, id, refId, position, idIndex, refIndex);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Pure variant of `moveElement` — exposed for tests. Never mutates disk. */
export function applyMove(
  canvasAbsPath: string,
  source: string,
  id: string,
  refId: string,
  position: MovePosition,
  idIndex?: number,
  refIndex?: number
): MoveResult {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }

  // Map reused-component INSTANCE ids to their parent USAGE elements before the
  // move (a shared internal id isn't movable per-instance; the usage is).
  id = resolveUsageId(parsed.program, id, idIndex);
  refId = resolveUsageId(parsed.program, refId, refIndex);

  if (id === refId) {
    throw new CanvasEditError('cannot move an element relative to itself', {
      canvas: canvasAbsPath,
      id,
    });
  }

  const moved = findOpening(parsed.program, id);
  if (!moved) {
    throw new CanvasEditError(`data-cd-id "${id}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  const ref = findOpening(parsed.program, refId);
  if (!ref) {
    throw new CanvasEditError(`reference data-cd-id "${refId}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: refId,
    });
  }

  const movedEl = moved.element;
  const refEl = ref.element;
  const mStart = movedEl.start as number;
  const mEnd = movedEl.end as number;
  const rStart = refEl.start as number;
  const rEnd = refEl.end as number;

  // Guardrail: the reference must not live inside the moved element's subtree —
  // that would splice the node into itself.
  if (rStart >= mStart && rEnd <= mEnd) {
    throw new CanvasEditError('cannot move an element into its own subtree', {
      canvas: canvasAbsPath,
      id,
    });
  }

  const inside = position === 'inside-start' || position === 'inside-end';
  if (inside && (refEl.openingElement?.selfClosing || !refEl.closingElement)) {
    throw new CanvasEditError(
      `target "${refId}" is self-closing — cannot nest an element inside it`,
      { canvas: canvasAbsPath, id: refId }
    );
  }

  const indentUnit = detectIndentUnit(source);
  const elText = source.slice(mStart, mEnd);
  const movedLine = lineStartInfo(source, mStart);
  const removeStart = movedLine.newlineBefore ? movedLine.indentStart - 1 : movedLine.indentStart;

  // Resolve the target indent + insertion anchor per position.
  let targetIndent: string;
  let anchor: number;
  let insertText: string;

  if (position === 'after') {
    targetIndent = lineStartInfo(source, rStart).indent;
    const reText = reindentBlock(elText, movedLine.indent, targetIndent);
    anchor = rEnd;
    insertText = `\n${targetIndent}${reText}`;
  } else if (position === 'before') {
    const rLine = lineStartInfo(source, rStart);
    targetIndent = rLine.indent;
    const reText = reindentBlock(elText, movedLine.indent, targetIndent);
    if (rLine.newlineBefore) {
      anchor = rLine.indentStart - 1;
      insertText = `\n${targetIndent}${reText}`;
    } else {
      anchor = rLine.indentStart;
      insertText = `${targetIndent}${reText}\n`;
    }
  } else if (position === 'inside-start') {
    targetIndent = lineStartInfo(source, rStart).indent + indentUnit;
    const reText = reindentBlock(elText, movedLine.indent, targetIndent);
    anchor = refEl.openingElement.end as number;
    insertText = `\n${targetIndent}${reText}`;
  } else {
    // inside-end — insert as the last child, before the closing tag's own line.
    targetIndent = lineStartInfo(source, rStart).indent + indentUnit;
    const reText = reindentBlock(elText, movedLine.indent, targetIndent);
    const cStart = refEl.closingElement.start as number;
    const cLine = lineStartInfo(source, cStart);
    if (cLine.newlineBefore) {
      anchor = cLine.indentStart - 1;
      insertText = `\n${targetIndent}${reText}`;
    } else {
      anchor = cStart;
      insertText = `${reText}`;
    }
  }

  const s = new MagicString(source);
  s.remove(removeStart, mEnd);
  s.appendLeft(anchor, insertText);
  const out = s.toString();

  // Reparse gate: never write source that doesn't parse. This is the catch-all
  // that lets us keep the guardrail set small.
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    const first = check.errors[0];
    throw new CanvasEditError(
      `move would produce invalid source (${first?.message ?? 'parse error'}); aborted`,
      { canvas: canvasAbsPath, id }
    );
  }

  // Re-settle hints. semanticId survives the move verbatim; movedId is the
  // recomputed positional id (matches the post-reload DOM).
  const semanticId = getStringAttr(movedEl.openingElement, 'data-dc-element');
  let movedId: string | null = null;
  const wanted = normalizeForMatch(reindentBlock(elText, movedLine.indent, targetIndent));
  for (const { id: eid, node } of collectElements(check.program)) {
    if (normalizeForMatch(out.slice(node.start as number, node.end as number)) === wanted) {
      movedId = eid;
      break;
    }
  }

  return { source: out, delta: out.length - source.length, movedId, semanticId };
}

// ---------------------------------------------------------------------------
// DDR-148 — Timeline drag-to-retime. Rewrites a `<...Sequence>`'s
// `durationInFrames` / `from` to a new frame count. Sequences are addressed by
// their document ORDER (the same order timeline-parse.js tokenizes them), not a
// data-cd-id — a member-expression element (`TransitionSeries.Sequence`) has no
// stable cd-id, and the order is what the Timeline UI already knows.

export interface RetimePatch {
  durationInFrames?: number;
  from?: number;
}

const SEQ_TAG_RE = /<(?:TransitionSeries\.Sequence|Series\.Sequence|Sequence)\b[^>]*>/g;

/**
 * Rewrite one attribute on a sequence tag. Prefers editing a referenced const
 * (`durationInFrames={A}` → bump `const A = …`) so a derived total
 * (`const TOTAL = A + B - XF`) updates in lock-step; falls back to editing a
 * literal in place; refuses a non-trivial expression (returns false).
 */
function retimeAttr(
  s: MagicString,
  source: string,
  tag: string,
  tagStart: number,
  key: 'durationInFrames' | 'from',
  newVal: number
): boolean {
  const am = tag.match(new RegExp(`\\b${key}=\\{\\s*([^}]*?)\\s*\\}`));
  if (!am || am.index == null) {
    // Attr absent. For `from`, INSERT it — moving a cursor-implicit clip
    // (`<Sequence durationInFrames={…}>`) to a new start needs an explicit
    // `from` (DDR-150 P3 Task 6). durationInFrames is required on a clip, so
    // never auto-insert it.
    if (key === 'from') {
      const nameMatch = tag.match(/^<([A-Za-z][\w.]*)/);
      if (nameMatch) {
        s.appendLeft(tagStart + nameMatch[0].length, ` from={${newVal}}`);
        return true;
      }
    }
    return false;
  }
  const inner = am[1].trim();
  if (/^[A-Za-z_$][\w$]*$/.test(inner)) {
    const cm = source.match(new RegExp(`\\bconst\\s+${inner}\\s*=\\s*(-?\\d+)`));
    if (cm && cm.index != null && cm[1]) {
      const numStart = cm.index + cm[0].lastIndexOf(cm[1]);
      s.overwrite(numStart, numStart + cm[1].length, String(newVal));
      return true;
    }
  }
  if (/^-?\d+$/.test(inner)) {
    const innerRel = am[0].indexOf(inner, am[0].indexOf('{'));
    const valStart = tagStart + am.index + innerRel;
    s.overwrite(valStart, valStart + inner.length, String(newVal));
    return true;
  }
  return false;
}

/** Pure retime — exposed for tests. Never mutates disk. */
export function applyRetimeSequence(
  canvasAbsPath: string,
  source: string,
  seqIndex: number,
  patch: RetimePatch
): { source: string } {
  const s = new MagicString(source);
  SEQ_TAG_RE.lastIndex = 0;
  let i = 0;
  let touched = false;
  let m: RegExpExecArray | null = SEQ_TAG_RE.exec(source);
  while (m) {
    if (i === seqIndex) {
      const tag = m[0];
      const tagStart = m.index;
      for (const [key, val] of [
        ['durationInFrames', patch.durationInFrames],
        ['from', patch.from],
      ] as const) {
        if (val == null || !Number.isFinite(val)) continue;
        if (retimeAttr(s, source, tag, tagStart, key, Math.max(0, Math.round(val)))) touched = true;
      }
      break;
    }
    i += 1;
    m = SEQ_TAG_RE.exec(source);
  }
  if (!touched) {
    throw new CanvasEditError(`no retimable sequence at index ${seqIndex}`, {
      canvas: canvasAbsPath,
      id: String(seqIndex),
    });
  }
  const next = s.toString();
  const parsed = parseSync(canvasAbsPath, next, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `retime produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id: String(seqIndex) }
    );
  }
  return { source: next };
}

/** Retime a sequence on disk (atomic write + per-file lock, like moveElement). */
export async function retimeSequence(
  canvasAbsPath: string,
  seqIndex: number,
  patch: RetimePatch
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: String(seqIndex),
      });
    }
    const source = await file.text();
    const next = applyRetimeSequence(canvasAbsPath, source, seqIndex, patch);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Retime a clip addressed by the enumerator's `stableId` (comp-scoped) instead of
 * a whole-file index — the DDR-150 P2 fix for the multi-comp mis-hit. Verifies
 * the content-hash fingerprint (refuse a stale/raced target), patches the clip's
 * own tag via `retimeAttr` (const-preferring), then reparse + semantic gate.
 */
export function applyRetimeSequenceByClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  patch: RetimePatch
): { source: string } {
  const clip = resolveClip(canvasAbsPath, source, artboardId, stableId, expectedHash);
  // A `from` move is STANDALONE-<Sequence>-only. `<TransitionSeries.Sequence>` /
  // `<Series.Sequence>` compute their own offsets — Remotion silently IGNORES a
  // `from` prop on them, so patching/inserting one writes a lie: the timeline
  // draws a gap while the rendered video never changes (the dogfood bug —
  // "video je furt stejné, ať klipem pohnu jakkoliv"). Refuse loudly instead.
  if (patch.from != null && clip.tag !== 'Sequence') {
    throw new CanvasEditError(
      `"${stableId}" is a ${clip.tag} — the series computes its position, so moving it has no effect. Trim its duration instead, or reorder the beats.`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  const s = new MagicString(source);
  SEQ_TAG_RE.lastIndex = 0;
  let touched = false;
  let m: RegExpExecArray | null = SEQ_TAG_RE.exec(source);
  while (m) {
    if (m.index === clip.start) {
      for (const [key, val] of [
        ['durationInFrames', patch.durationInFrames],
        ['from', patch.from],
      ] as const) {
        if (val == null || !Number.isFinite(val)) continue;
        if (retimeAttr(s, source, m[0], m.index, key, Math.max(0, Math.round(val)))) touched = true;
      }
      break;
    }
    m = SEQ_TAG_RE.exec(source);
  }
  if (!touched) {
    throw new CanvasEditError(`clip "${stableId}" has no retimable from/durationInFrames`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const next = s.toString();
  const parsed = parseSync(canvasAbsPath, next, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `retime produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  assertCompSemantics(canvasAbsPath, next);
  return { source: next };
}

/** Retime a clip by stableId on disk (atomic write + cross-process lock). */
export async function retimeSequenceByClip(
  canvasAbsPath: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined,
  patch: RetimePatch
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const source = await file.text();
    const next = applyRetimeSequenceByClip(
      canvasAbsPath,
      source,
      artboardId,
      stableId,
      expectedHash,
      patch
    );
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Clip addressing (DDR-150 P2). The SINGLE authoritative tokenizer for a
// video-comp's clips. The Timeline UI addresses every op through the `stableId`
// this returns, NOT its own regex position — killing the two-tokenizer
// document-order disagreement that made destructive ops corrupt the wrong clip
// on a multi-comp canvas (the debate's headline defect). AST-based, so it skips
// tags inside comments/strings (the regex parser didn't) and scopes cleanly to
// one comp's body even when several comps share a file.

/** Sequence-family "clip" tags (the timeline rows). */
const CLIP_TAGS = new Set(['Sequence', 'Series.Sequence', 'TransitionSeries.Sequence']);
/** Transition tags (occupy a slot between clips inside a TransitionSeries). */
const TRANSITION_TAGS = new Set(['Series.Transition', 'TransitionSeries.Transition']);
/** Media tags that carry a `src` (the replace-media + drop targets). */
// `Maude*` spellings are the collision-avoidance ALIASES clip-ops emits when a
// canvas already declares a component of that name (e.g. `export default
// function Video()`). They are the same elements and must tokenize the same,
// or the Timeline silently loses the clip's media (RCA
// issue-mp4-audio-export-html5audio-silent-degrade follow-up).
const MEDIA_TAGS = new Set([
  'Video',
  'OffthreadVideo',
  'Audio',
  'Img',
  'Image',
  'MaudeVideo',
  'MaudeAudio',
  'MaudeImg',
]);
/** Remotion/layout primitives that are structural, not their own timeline layer. */
const LAYER_SKIP_TAGS = new Set([
  'AbsoluteFill',
  'Sequence',
  'Series',
  'Series.Sequence',
  'Series.Transition',
  'TransitionSeries',
  'TransitionSeries.Sequence',
  'TransitionSeries.Transition',
  'Loop',
  'Freeze',
  'Fragment',
]);

/** Full tag string of a JSXElement: `Sequence` | `TransitionSeries.Sequence` | … */
function jsxTagName(node: AnyNode): string | null {
  const n = node?.openingElement?.name;
  if (!n) return null;
  if (n.type === 'JSXIdentifier') return typeof n.name === 'string' ? n.name : null;
  if (n.type === 'JSXMemberExpression') {
    const obj = n.object?.type === 'JSXIdentifier' ? n.object.name : null;
    const prop = n.property?.type === 'JSXIdentifier' ? n.property.name : null;
    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

/** Evaluate a numeric AST expression against a resolved const map (literal,
 *  negation, const identifier, or simple arithmetic of them). null if not
 *  resolvable — from/duration are best-effort labels, never load-bearing for
 *  addressing (that's stableId + contentHash). */
function evalNum(n: AnyNode, consts: Record<string, number>): number | null {
  if (!n || typeof n !== 'object') return null;
  const t = n.type;
  if ((t === 'Literal' || t === 'NumericLiteral') && typeof n.value === 'number') return n.value;
  if (t === 'UnaryExpression' && n.operator === '-') {
    const v = evalNum(n.argument, consts);
    return v == null ? null : -v;
  }
  if (t === 'Identifier') return Object.hasOwn(consts, n.name) ? (consts[n.name] as number) : null;
  if (t === 'BinaryExpression') {
    const l = evalNum(n.left, consts);
    const r = evalNum(n.right, consts);
    if (l == null || r == null) return null;
    switch (n.operator) {
      case '+':
        return l + r;
      case '-':
        return l - r;
      case '*':
        return l * r;
      case '/':
        return r ? l / r : null;
      default:
        return null;
    }
  }
  return null;
}

/** Top-level numeric const bindings (3 passes so a derived `TOTAL = A + B` resolves). */
function collectNumericConsts(program: AnyNode): Record<string, number> {
  const consts: Record<string, number> = {};
  const decls: Array<{ name: string; init: AnyNode }> = [];
  for (const node of program?.body ?? []) {
    if (node?.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations ?? []) {
      if (d?.id?.type === 'Identifier' && d.init) decls.push({ name: d.id.name, init: d.init });
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const { name, init } of decls) {
      if (Object.hasOwn(consts, name)) continue;
      const v = evalNum(init, consts);
      if (v != null && Number.isFinite(v)) consts[name] = Math.round(v);
    }
  }
  return consts;
}

/** Resolve a numeric JSX attribute (`from={20}` / `durationInFrames={A}`). */
function numAttr(opening: AnyNode, name: string, consts: Record<string, number>): number | null {
  const a = findAttribute(opening, name);
  let v = a?.value;
  if (!v) return null;
  if (v.type === 'JSXExpressionContainer') v = v.expression;
  const n = evalNum(v, consts);
  return n == null ? null : Math.round(n);
}

/** First media descendant of a clip (its `<Video>`/`<Audio>`/`<Img>` — the replace target). */
function firstMediaDescendant(clip: AnyNode): AnyNode | null {
  let found: AnyNode | null = null;
  function walk(n: AnyNode): void {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) {
        if (found) return;
        walk(c);
      }
      return;
    }
    if (n.type === 'JSXElement' && MEDIA_TAGS.has(jsxTagName(n) ?? '')) {
      found = n;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      walk(n[k]);
    }
  }
  walk(clip.children ?? []);
  return found;
}

/** Map every top-level component name → its render body root (for nested-media resolution). */
function collectComponentBodies(program: AnyNode): Map<string, AnyNode> {
  const out = new Map<string, AnyNode>();
  const body = (program?.body ?? []) as AnyNode[];
  for (const stmt of body) {
    if (stmt?.type === 'FunctionDeclaration' && isPascalIdent(stmt.id?.name)) {
      out.set(stmt.id.name, stmt.body);
    } else if (stmt?.type === 'VariableDeclaration') {
      for (const d of stmt.declarations ?? []) {
        const name = componentNameOf(d);
        if (name && d.init?.body) out.set(name, d.init.body);
      }
    }
  }
  return out;
}

/** Map every top-level `const NAME = [ {…}, … ]` → its ArrayExpression (for `CLIPS[i].src`). */
function collectArrayLiterals(program: AnyNode): Map<string, AnyNode> {
  const out = new Map<string, AnyNode>();
  for (const stmt of (program?.body ?? []) as AnyNode[]) {
    if (stmt?.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations ?? []) {
      if (d?.id?.type === 'Identifier' && d.init?.type === 'ArrayExpression') {
        out.set(d.id.name, d.init);
      }
    }
  }
  return out;
}

/** The first JSXElement child of `clip` whose tag is a PascalCase component (not a primitive). */
function firstComponentChild(clip: AnyNode): AnyNode | null {
  for (const child of (clip.children ?? []) as AnyNode[]) {
    if (child?.type === 'JSXElement') {
      const tag = jsxTagName(child);
      if (tag && isPascalIdent(tag) && !MEDIA_TAGS.has(tag)) return child;
    }
  }
  return null;
}

/** A media element's `src` attr node (JSX value), or null. */
function srcAttrValue(mediaEl: AnyNode): AnyNode | null {
  const attr = findAttribute(mediaEl.openingElement, 'src');
  return attr?.value ?? null;
}

/**
 * Resolve a clip's media even when it's nested one level inside a wrapper
 * component whose `src` is fed by an array element (the showreel
 * `<ClipShot clip={CLIPS[2]} />` → `<Video src={clip.src} />` pattern). Returns
 * the media tag + a replace target: a direct `cdId` (literal src), an
 * `arrayRef` (edit `NAME[i].field`), or `shared` (literal src in a reused comp).
 */
function resolveNestedMedia(
  clip: AnyNode,
  componentBodies: Map<string, AnyNode>,
  arrays: Map<string, AnyNode>,
  cdIdOf: Map<AnyNode, string>
): {
  el: AnyNode;
  tag: string;
  src: string | null;
  cdId: string | null;
  arrayRef: { arrayName: string; index: number; field: string } | null;
  shared: boolean;
} | null {
  // 1. Direct media descendant (literal or prop src).
  const direct = firstMediaDescendant(clip);
  if (direct) {
    return {
      el: direct,
      tag: jsxTagName(direct) ?? 'Video',
      src: getStringAttr(direct.openingElement, 'src'),
      cdId: cdIdOf.get(direct) ?? null,
      arrayRef: null,
      shared: false,
    };
  }
  // 2. Wrapper component: <Comp propName={ARR[i]} /> → Comp body → media <X src={param.field}>.
  const wrapper = firstComponentChild(clip);
  if (!wrapper) return null;
  const compName = jsxTagName(wrapper);
  const body = compName ? componentBodies.get(compName) : null;
  if (!body) return null;
  const media = firstMediaDescendant({ children: [body] });
  if (!media) return null;
  const tag = jsxTagName(media) ?? 'Video';
  const srcVal = srcAttrValue(media);
  // Literal src inside the shared component → replaceable, but shared.
  if (srcVal?.type === 'Literal' || srcVal?.type === 'StringLiteral') {
    return {
      el: media,
      tag,
      src: String(srcVal.value),
      cdId: cdIdOf.get(media) ?? null,
      arrayRef: null,
      shared: true,
    };
  }
  // Prop-bound src: `src={param.field}` where `param` is the component's first
  // destructured/parameter name, bound at the call site to `ARR[i]`.
  if (srcVal?.type === 'JSXExpressionContainer') {
    const expr = srcVal.expression;
    // member: param.field
    if (
      expr?.type === 'MemberExpression' &&
      expr.object?.type === 'Identifier' &&
      expr.property?.type === 'Identifier'
    ) {
      const field = expr.property.name;
      // Find the call-site prop bound to this component's param: <Comp X={ARR[i]}>.
      // The wrapper's first attribute value that is `ARR[i]` gives the array + index.
      for (const attr of (wrapper.openingElement?.attributes ?? []) as AnyNode[]) {
        const v = attr?.value;
        if (v?.type !== 'JSXExpressionContainer') continue;
        const e = v.expression;
        if (
          e?.type === 'MemberExpression' &&
          e.object?.type === 'Identifier' &&
          arrays.has(e.object.name) &&
          e.property?.type === 'Literal' &&
          typeof e.property.value === 'number'
        ) {
          const arr = arrays.get(e.object.name);
          const el = (arr?.elements ?? [])[e.property.value] as AnyNode | undefined;
          const prop =
            el?.type === 'ObjectExpression'
              ? (el.properties ?? []).find(
                  (p: AnyNode) => p?.key?.name === field || p?.key?.value === field
                )
              : null;
          const litSrc =
            prop?.value && (prop.value.type === 'Literal' || prop.value.type === 'StringLiteral')
              ? String(prop.value.value)
              : null;
          return {
            el: media,
            tag,
            src: litSrc,
            cdId: null,
            arrayRef: { arrayName: e.object.name, index: e.property.value, field },
            shared: false,
          };
        }
      }
    }
  }
  // Media exists but src isn't resolvable to a replaceable target.
  return { el: media, tag, src: null, cdId: null, arrayRef: null, shared: false };
}

/** One visually-meaningful layer inside a clip (a media element or a named
 *  sub-component) — so the Timeline can show a ClipShot's mp4 background and its
 *  title/lower-third as SEPARATE rows instead of one opaque "ClipShot". */
export interface ClipLayer {
  kind: 'video' | 'image' | 'audio' | 'component';
  /** Human label — the media filename, or the sub-component's tag. */
  label: string;
  mediaTag: string | null;
  mediaSrc: string | null;
  mediaCdId: string | null;
  mediaArrayRef: { arrayName: string; index: number; field: string } | null;
  mediaShared: boolean;
}

/**
 * Decompose a clip into its stacked layers (media elements + named sub-components),
 * resolving through a wrapper component (the showreel `<ClipShot clip={CLIPS[i]}>`
 * → its `<Video>` + `<LowerThird>`). Ordered by source position. Skips Remotion/
 * layout primitives (AbsoluteFill, Sequence, …). Returns [] when the clip has no
 * decomposable structure (a pure inline card).
 */
function collectClipLayers(
  clip: AnyNode,
  componentBodies: Map<string, AnyNode>,
  arrays: Map<string, AnyNode>,
  cdIdOf: Map<AnyNode, string>
): ClipLayer[] {
  // Resolve the root to walk: the wrapper component's body if the clip wraps one,
  // else the clip's own children. Carry the wrapper element so prop-fed src (the
  // component's `clip` param → `CLIPS[i]`) resolves against the call site.
  const wrapper = firstComponentChild(clip);
  const wrapperTag = wrapper ? jsxTagName(wrapper) : null;
  const body = wrapperTag ? componentBodies.get(wrapperTag) : null;
  const root: AnyNode = body ? { children: [body] } : clip;

  const layers: ClipLayer[] = [];
  (function walk(n: AnyNode): void {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (n.type === 'JSXElement') {
      const tag = jsxTagName(n) ?? '';
      if (MEDIA_TAGS.has(tag)) {
        // Media layer — resolve src the same way replace does (literal / prop / array).
        const m = wrapper
          ? resolveMediaSrcThroughWrapper(n, wrapper, arrays, cdIdOf)
          : {
              src: getStringAttr(n.openingElement, 'src'),
              cdId: cdIdOf.get(n) ?? null,
              arrayRef: null as ClipLayer['mediaArrayRef'],
              shared: false,
            };
        const kind: ClipLayer['kind'] =
          tag === 'Audio' ? 'audio' : tag === 'Img' || tag === 'Image' ? 'image' : 'video';
        layers.push({
          kind,
          label: m.src ? String(m.src).split('/').pop() || tag : tag,
          mediaTag: tag,
          mediaSrc: m.src,
          mediaCdId: m.cdId,
          mediaArrayRef: m.arrayRef,
          mediaShared: m.shared,
        });
      } else if (
        /^[A-Z]/.test(tag) &&
        !LAYER_SKIP_TAGS.has(tag) &&
        tag !== wrapperTag &&
        componentBodies.has(tag) // a KNOWN locally-defined component → a real layer
      ) {
        // A named sub-component (LowerThird, TitleBadge, …) → a component layer.
        // Only surface locally-defined components (skip unknown/library tags to
        // avoid noise); its media (if any) is walked below and attributed to it.
        layers.push({
          kind: 'component',
          label: tag,
          mediaTag: null,
          mediaSrc: null,
          mediaCdId: null,
          mediaArrayRef: null,
          mediaShared: false,
        });
      }
    }
    // Generic recursion (mirrors firstMediaDescendant) so wrapped/parenthesized
    // arrow bodies + all child positions are traversed, not just `children`.
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      walk(n[k]);
    }
  })(root);
  return layers;
}

/** Resolve a media element's src (literal / prop-fed-from-array) via its wrapper's call site. */
function resolveMediaSrcThroughWrapper(
  media: AnyNode,
  wrapper: AnyNode,
  arrays: Map<string, AnyNode>,
  cdIdOf: Map<AnyNode, string>
): {
  src: string | null;
  cdId: string | null;
  arrayRef: ClipLayer['mediaArrayRef'];
  shared: boolean;
} {
  const srcVal = srcAttrValue(media);
  if (srcVal?.type === 'Literal' || srcVal?.type === 'StringLiteral') {
    return {
      src: String(srcVal.value),
      cdId: cdIdOf.get(media) ?? null,
      arrayRef: null,
      shared: true,
    };
  }
  if (
    srcVal?.type === 'JSXExpressionContainer' &&
    srcVal.expression?.type === 'MemberExpression' &&
    srcVal.expression.property?.type === 'Identifier'
  ) {
    const field = srcVal.expression.property.name;
    for (const attr of (wrapper.openingElement?.attributes ?? []) as AnyNode[]) {
      const v = attr?.value;
      const e = v?.type === 'JSXExpressionContainer' ? v.expression : null;
      if (
        e?.type === 'MemberExpression' &&
        e.object?.type === 'Identifier' &&
        arrays.has(e.object.name) &&
        e.property?.type === 'Literal' &&
        typeof e.property.value === 'number'
      ) {
        const arr = arrays.get(e.object.name);
        const el = (arr?.elements ?? [])[e.property.value] as AnyNode | undefined;
        const prop =
          el?.type === 'ObjectExpression'
            ? (el.properties ?? []).find(
                (p: AnyNode) => p?.key?.name === field || p?.key?.value === field
              )
            : null;
        const lit =
          prop?.value && (prop.value.type === 'Literal' || prop.value.type === 'StringLiteral')
            ? String(prop.value.value)
            : null;
        return {
          src: lit,
          cdId: null,
          arrayRef: { arrayName: e.object.name, index: e.property.value, field },
          shared: false,
        };
      }
    }
  }
  return { src: null, cdId: cdIdOf.get(media) ?? null, arrayRef: null, shared: false };
}

/** The child span [start, end] of a clip element (between its `>` and `</`), or null (self-closing). */
function clipChildrenSpan(node: AnyNode): { start: number; end: number } | null {
  const oe = node.openingElement;
  const ce = node.closingElement;
  if (!oe || !ce || typeof oe.end !== 'number' || typeof ce.start !== 'number') return null;
  return { start: oe.end as number, end: ce.start as number };
}

/** True when a clip's children are gated behind `{false && (…)}` (the hide marker). */
function clipChildrenHidden(node: AnyNode, source: string): boolean {
  const span = clipChildrenSpan(node);
  if (!span) return false;
  return /^\s*\{false && \(/.test(source.slice(span.start, span.end));
}

/** Stable content fingerprint of a clip's exact source span (optimistic-concurrency check). */
function hashSpan(source: string, start: number, end: number): string {
  return Bun.hash(source.slice(start, end)).toString(16).padStart(16, '0').slice(0, 12);
}

/** One clip (timeline row) + everything an op needs to address + label it. */
export interface ClipInfo {
  /** Durable identity: `name:<Sequence name>` → `mclip:<sentinel>` → `<comp>#<indexInComp>`. */
  stableId: string;
  kind: 'sequence' | 'transition';
  tag: string;
  from: number | null;
  durationInFrames: number | null;
  mediaTag: string | null;
  mediaSrc: string | null;
  /** Positional cd-id of the media element (for `editAttribute` src-replace). */
  mediaCdId: string | null;
  /**
   * When the clip's media lives inside a wrapper component whose `src` is fed by
   * an array element (`<ClipShot clip={CLIPS[2]} />` → `<Video src={clip.src}>`),
   * this points at the array-literal string to edit for a replace (the showreel
   * pattern). `mediaCdId` is then null (the element's src is a prop, not literal).
   */
  mediaArrayRef: { arrayName: string; index: number; field: string } | null;
  /**
   * True when the media's literal `src` lives in a SHARED wrapper component (every
   * instance renders the same element) — replacing it changes every clip using
   * that component. The client warns before applying.
   */
  mediaShared: boolean;
  /** Positional cd-id of the clip's OWN `<Sequence>` node (for `moveElement` z-order reorder). */
  clipCdId: string | null;
  /** feature-enhanced-video-editing — the media element's parametric props, so
   *  the clip inspector shows authoritative current values (two-tokenizer rule:
   *  the enumerator is the display source of truth). Null when the clip has no
   *  direct media element. */
  mediaProps: {
    playbackRate: number | null;
    volume: number | null;
    muted: boolean;
    trimBefore: number | null;
    /** The style `filter` string (grade), when a literal. */
    filter: string | null;
    /** Crop/reposition wrapper marker (`data-mframe="scale,x,y"`). */
    framing: { scale: number; x: number; y: number } | null;
  } | null;
  /** The clip's stacked layers (mp4 background + title/lower-third + …) for the
   *  expandable timeline rows. Empty for a pure inline card. */
  layers: ClipLayer[];
  /** True when the clip's body is gated behind `{false && (…)}` (hidden — renders
   *  nothing but keeps its time slot + the TransitionSeries alternation). */
  hidden: boolean;
  /** enhanced-video-editing (Task 21) — a prompt-carrying `<AIPlaceholder>`
   *  slate clip, awaiting generation. Null for ordinary clips. */
  placeholder: { prompt: string | null; kind: string } | null;
  /** Fingerprint of the clip's source span — refuse an op if it no longer matches. */
  contentHash: string;
  start: number;
  end: number;
}

/** A media element sitting DIRECTLY in the comp body (not inside a clip) — an
 *  `<Audio>` music bed under the reel, a full-length `<Video>` background, … .
 *  Not a clip (no from/duration semantics of its own), but it IS addressable:
 *  the Timeline's audio rows use `cdId` for a replace (`editAttribute` on src). */
export interface LooseMediaInfo {
  tag: string;
  src: string | null;
  cdId: string | null;
  contentHash: string;
}

export interface CompClips {
  compName: string | null;
  artboardId: string | null;
  fps: number | null;
  durationInFrames: number | null;
  clips: ClipInfo[];
  /** DDR-150 dogfood #5 — loose media beds (document order), for audio replace. */
  media: LooseMediaInfo[];
}

/**
 * Enumerate the clips of ONE video-comp (scoped by `artboardId` → its
 * `<VideoComp component={X}>` → component X's body). The Timeline UI renders
 * rows from this and addresses every op by `clip.stableId` — so UI and engine
 * can never disagree about which clip is which (the multi-comp defect). Throws
 * `CanvasEditError` on unparseable source.
 */
export function enumerateClips(
  canvasAbsPath: string,
  source: string,
  artboardId?: string
): CompClips {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId ?? '' }
    );
  }
  const program = parsed.program;
  const consts = collectNumericConsts(program);
  const cdIdOf = new Map<AnyNode, string>();
  for (const { id, node } of collectElements(program)) cdIdOf.set(node, id);

  interface Usage {
    compName: string | null;
    artboardId: string | null;
    fps: number | null;
    duration: number | null;
  }
  interface RawClip {
    tag: string;
    kind: 'sequence' | 'transition';
    node: AnyNode;
    comp: string;
    indexInComp: number;
    start: number;
    end: number;
  }
  interface RawMedia {
    tag: string;
    node: AnyNode;
    comp: string;
    start: number;
    end: number;
  }
  const usages: Usage[] = [];
  const clips: RawClip[] = [];
  const mediaEls: RawMedia[] = [];
  const compClipCount: Record<string, number> = {};
  const compStack: string[] = [''];
  const artboardStack: Array<string | null> = [];

  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    const newComp = componentNameOf(node);
    let pushedComp = false;
    if (newComp !== null) {
      compStack.push(newComp);
      pushedComp = true;
    }
    if (node.type === 'JSXElement') {
      const tag = jsxTagName(node);
      let pushedArt = false;
      if (tag === 'DCArtboard') {
        artboardStack.push(getStringAttr(node.openingElement, 'id'));
        pushedArt = true;
      }
      if (tag === 'VideoComp') {
        const compAttr = findAttribute(node.openingElement, 'component');
        const cv = compAttr?.value;
        const cn =
          cv?.type === 'JSXExpressionContainer' && cv.expression?.type === 'Identifier'
            ? cv.expression.name
            : null;
        usages.push({
          compName: cn,
          artboardId: artboardStack.length ? artboardStack[artboardStack.length - 1] : null,
          fps: numAttr(node.openingElement, 'fps', consts),
          duration: numAttr(node.openingElement, 'durationInFrames', consts),
        });
      }
      if (tag && (CLIP_TAGS.has(tag) || TRANSITION_TAGS.has(tag))) {
        const comp = compStack[compStack.length - 1] as string;
        const idx = compClipCount[comp] ?? 0;
        compClipCount[comp] = idx + 1;
        clips.push({
          tag,
          kind: TRANSITION_TAGS.has(tag) ? 'transition' : 'sequence',
          node,
          comp,
          indexInComp: idx,
          start: node.start as number,
          end: node.end as number,
        });
      }
      if (tag && MEDIA_TAGS.has(tag)) {
        // Every media element, with its owning comp — loose beds are filtered
        // out of clip spans below (an <Audio> under the reel vs inside a clip).
        mediaEls.push({
          tag,
          node,
          comp: compStack[compStack.length - 1] as string,
          start: node.start as number,
          end: node.end as number,
        });
      }
      if (node.openingElement) visit(node.openingElement.attributes);
      visit(node.children);
      if (pushedArt) artboardStack.pop();
      if (pushedComp) compStack.pop();
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
    if (pushedComp) compStack.pop();
  }
  visit(program);

  // Resolve which comp to scope to. Preference mirrors timeline-parse.js:
  // the selected artboard's comp → a comp with clips → the first usage.
  const target =
    (artboardId && usages.find((u) => u.artboardId === artboardId && u.compName)) ||
    usages.find((u) => u.compName && clips.some((c) => c.comp === u.compName)) ||
    usages.find((u) => u.compName) ||
    null;
  const targetComp = target?.compName ?? clips[0]?.comp ?? null;

  const componentBodies = collectComponentBodies(program);
  const arrays = collectArrayLiterals(program);
  const scoped = targetComp == null ? [] : clips.filter((c) => c.comp === targetComp);
  const clipInfos: ClipInfo[] = scoped.map((c) => {
    const opening = c.node.openingElement;
    const nameAttr = getStringAttr(opening, 'name');
    const before = source.slice(Math.max(0, c.start - 160), c.start);
    const sentinel = before.match(/\{\/\*\s*@mclip\s+([A-Za-z0-9_-]+)\s*\*\/\}\s*$/);
    const stableId =
      nameAttr != null && nameAttr !== ''
        ? `name:${nameAttr}`
        : sentinel
          ? `mclip:${sentinel[1]}`
          : `${targetComp}#${c.indexInComp}`;
    // Resolve media even through a wrapper component (the showreel pattern) so
    // the Timeline can badge the clip video/image/audio AND replace its source.
    const m = resolveNestedMedia(c.node, componentBodies, arrays, cdIdOf);
    // Parametric media props (enhanced-video-editing) — only for a DIRECT media
    // element (wrapper media is shared; the verbs refuse it anyway).
    let mediaProps: ClipInfo['mediaProps'] = null;
    const direct = firstMediaDescendant(c.node);
    if (direct) {
      const mo = direct.openingElement;
      let filter: string | null = null;
      const st = findAttribute(mo, 'style');
      if (
        st?.value?.type === 'JSXExpressionContainer' &&
        st.value.expression?.type === 'ObjectExpression'
      ) {
        for (const p of st.value.expression.properties ?? []) {
          const key = p?.key?.name ?? p?.key?.value;
          if (
            key === 'filter' &&
            (p.value?.type === 'Literal' || p.value?.type === 'StringLiteral')
          ) {
            filter = String(p.value.value);
          }
        }
      }
      let framing: { scale: number; x: number; y: number } | null = null;
      const fm = source.slice(c.start, c.end).match(/data-mframe="([-\d.]+),([-\d.]+),([-\d.]+)"/);
      if (fm) framing = { scale: Number(fm[1]), x: Number(fm[2]), y: Number(fm[3]) };
      mediaProps = {
        playbackRate: numAttr(mo, 'playbackRate', consts),
        volume: numAttr(mo, 'volume', consts),
        muted: !!findAttribute(mo, 'muted'),
        trimBefore: numAttr(mo, 'trimBefore', consts) ?? numAttr(mo, 'startFrom', consts),
        filter,
        framing,
      };
    }
    return {
      stableId,
      kind: c.kind,
      tag: c.tag,
      from: numAttr(opening, 'from', consts),
      durationInFrames: numAttr(opening, 'durationInFrames', consts),
      mediaTag: m ? m.tag : null,
      mediaSrc: m ? m.src : null,
      mediaCdId: m ? m.cdId : null,
      mediaArrayRef: m ? m.arrayRef : null,
      mediaShared: m ? m.shared : false,
      clipCdId: cdIdOf.get(c.node) ?? null,
      mediaProps,
      placeholder: (() => {
        // Direct <AIPlaceholder> child → a slate clip (Task 21). The prompt is
        // authored as `prompt={"…"}` (JSON.stringify — DDR-150 P1), so read
        // both the expression-container and plain-string spellings.
        for (const child of (c.node.children ?? []) as AnyNode[]) {
          if (child?.type !== 'JSXElement' || jsxTagName(child) !== 'AIPlaceholder') continue;
          const po = child.openingElement;
          const pAttr = findAttribute(po, 'prompt');
          let prompt: string | null = null;
          let pv = pAttr?.value;
          if (pv?.type === 'JSXExpressionContainer') pv = pv.expression;
          if (pv && (pv.type === 'Literal' || pv.type === 'StringLiteral')) {
            prompt = String(pv.value);
          }
          if (prompt == null) {
            // Paired-tag form: the prompt is a `{"…"}` literal inside a child
            // element (the inline-editable <span>). First string-literal
            // expression anywhere under the placeholder wins.
            const scan = (n: AnyNode | null | undefined): string | null => {
              if (!n || typeof n !== 'object') return null;
              if (n.type === 'JSXExpressionContainer') {
                const e = (n as AnyNode).expression;
                if (
                  e &&
                  (e.type === 'Literal' || e.type === 'StringLiteral') &&
                  typeof e.value === 'string'
                ) {
                  return String(e.value);
                }
                return null;
              }
              for (const kid of ((n as AnyNode).children ?? []) as AnyNode[]) {
                const hit = scan(kid);
                if (hit != null) return hit;
              }
              return null;
            };
            prompt = scan(child);
          }
          return { prompt, kind: getStringAttr(po, 'kind') ?? 'veo' };
        }
        return null;
      })(),
      layers: collectClipLayers(c.node, componentBodies, arrays, cdIdOf),
      hidden: clipChildrenHidden(c.node, source),
      contentHash: hashSpan(source, c.start, c.end),
      start: c.start,
      end: c.end,
    };
  });

  // Loose media beds — media in the target comp OUTSIDE every clip span
  // (an <Audio> music bed, a background <Video>). Document order.
  const media: LooseMediaInfo[] = mediaEls
    .filter(
      (mel) =>
        mel.comp === targetComp && !scoped.some((c) => mel.start >= c.start && mel.end <= c.end)
    )
    .map((mel) => ({
      tag: mel.tag,
      src: getStringAttr(mel.node.openingElement, 'src'),
      cdId: cdIdOf.get(mel.node) ?? null,
      contentHash: hashSpan(source, mel.start, mel.end),
    }));

  return {
    compName: targetComp,
    artboardId: target?.artboardId ?? null,
    fps: target?.fps ?? null,
    durationInFrames: target?.duration ?? null,
    clips: clipInfos,
    media,
  };
}

/**
 * Resolve a `stableId` (from `enumerateClips`) to its live clip in `source`,
 * verifying the caller's `expectedHash` still matches (optimistic concurrency —
 * a stale UI index or a concurrent edit is refused, not silently mis-applied).
 * Returns the ClipInfo (with current start/end for the patch). Throws on a
 * missing id or a hash mismatch.
 */
export function resolveClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash?: string
): ClipInfo {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const hit = clips.find((c) => c.stableId === stableId);
  if (!hit) {
    throw new CanvasEditError(`clip "${stableId}" not found`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  if (expectedHash != null && expectedHash !== hit.contentHash) {
    throw new CanvasEditError(
      `clip "${stableId}" changed since it was read (concurrent edit); reload and retry`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  return hit;
}

/**
 * The semantic gate (DDR-150 P2). Parse-clean is NOT correct: a wrong-clip
 * delete, an orphaned/leading/double `<TransitionSeries.Transition>`, all parse
 * fine yet render wrong. After any structural clip edit, assert every
 * `<TransitionSeries>` strictly alternates Sequence/Transition and begins + ends
 * with a Sequence. Throws `CanvasEditError` on a violation.
 */
export function assertCompSemantics(canvasAbsPath: string, source: string): { ok: true } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: '' }
    );
  }
  const series: AnyNode[] = [];
  (function find(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) find(c);
      return;
    }
    if (node.type === 'JSXElement' && jsxTagName(node) === 'TransitionSeries') series.push(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      find(node[k]);
    }
  })(parsed.program);

  for (const s of series) {
    const kinds: Array<'sequence' | 'transition'> = [];
    for (const child of s.children ?? []) {
      if (child?.type !== 'JSXElement') continue;
      const tag = jsxTagName(child);
      if (tag && TRANSITION_TAGS.has(tag)) kinds.push('transition');
      else if (tag && CLIP_TAGS.has(tag)) kinds.push('sequence');
    }
    if (kinds.length === 0) continue;
    // Adjacent SEQUENCES are valid Remotion (a hard cut — no transition between
    // beats); real shipped canvases use them, so the gate refuses only what
    // actually breaks the renderer: a transition at the head/tail, or two
    // transitions back-to-back (enhanced-video-editing relaxation of the
    // original strict-alternation check, which refused every op on a
    // hard-cut comp).
    const bad =
      kinds[0] === 'transition' ||
      kinds[kinds.length - 1] === 'transition' ||
      kinds.some((k, i) => i > 0 && k === 'transition' && kinds[i - 1] === 'transition');
    if (bad) {
      throw new CanvasEditError(
        'TransitionSeries must begin + end with a Sequence and never stack two Transitions (a leading, trailing, or doubled Transition is invalid Remotion)',
        { canvas: canvasAbsPath, id: '' }
      );
    }
  }
  return { ok: true };
}

/** Source span of an element extended back over its leading indent + newline
 *  (so removing it doesn't leave a blank line) — mirrors moveElement's removeStart. */
export function spanWithFraming(source: string, start: number, end: number): [number, number] {
  const line = lineStartInfo(source, start);
  const rs = line.newlineBefore ? line.indentStart - 1 : line.indentStart;
  return [rs, end];
}

/**
 * Remove a clip (DDR-150 P3), addressed by the enumerator's stableId. Verifies
 * the content-hash fingerprint; refuses removing the ONLY clip; when the clip
 * lives in a `<TransitionSeries>` also removes ONE adjacent transition so the
 * series stays valid; then reparse + semantic gate (the backstop that refuses a
 * remove which would leave a dangling/doubled transition, rather than corrupt).
 */
export function applyRemoveClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string } {
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const idx = clips.findIndex((c) => c.stableId === stableId);
  if (idx < 0) {
    throw new CanvasEditError(`clip "${stableId}" not found`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const clip = clips[idx] as ClipInfo;
  if (expectedHash != null && expectedHash !== clip.contentHash) {
    throw new CanvasEditError(
      `clip "${stableId}" changed since it was read (concurrent edit); reload and retry`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  if (clip.kind !== 'sequence') {
    throw new CanvasEditError(`"${stableId}" is a transition, not a removable clip`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  if (clips.filter((c) => c.kind === 'sequence').length <= 1) {
    throw new CanvasEditError('cannot remove the only clip — delete the comp instead', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const spans: Array<[number, number]> = [spanWithFraming(source, clip.start, clip.end)];
  if (clip.tag.startsWith('TransitionSeries.')) {
    const next = clips[idx + 1];
    const prev = clips[idx - 1];
    const t = next?.kind === 'transition' ? next : prev?.kind === 'transition' ? prev : null;
    if (t) spans.push(spanWithFraming(source, t.start, t.end));
  }
  const s = new MagicString(source);
  for (const [a, b] of spans) s.remove(a, b);
  const out = s.toString();
  const parsed = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `remove produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id: stableId }
    );
  }
  assertCompSemantics(canvasAbsPath, out); // refuse a dangling/doubled transition
  return { source: out };
}

/** Remove a clip on disk (atomic write + cross-process lock). */
export async function removeClip(
  canvasAbsPath: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const source = await file.text();
    const nextSrc = applyRemoveClip(canvasAbsPath, source, artboardId, stableId, expectedHash);
    if (nextSrc.source === source) return nextSrc;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, nextSrc.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return nextSrc;
  });
}

/**
 * Reorder a clip among its STANDALONE `<Sequence>` siblings (DDR-150 P5) — the
 * z-order / render-stacking gesture (later sibling paints on top), distinct from
 * the horizontal `from`-move. Reuses the shipped `applyMove` (re-indent + reparse
 * + re-settle-through-id-churn) addressed by each clip's own cd-id, then runs the
 * semantic gate. Refuses a `<TransitionSeries.Sequence>`/`<Series.Sequence>`
 * (reordering those breaks the transition/back-to-back timing — not a stacking
 * op) and a self-move. Both `stableId`s are fingerprint-checked. Returns the moved
 * clip's stableId (recomputed from disk — a pure reorder leaves its content hash
 * unchanged, so it's found even when addressed by scoped index).
 */
export function applyReorderClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  movedStableId: string,
  movedHash: string | undefined,
  refStableId: string,
  refHash: string | undefined,
  position: MovePosition
): { source: string; stableId: string } {
  if (movedStableId === refStableId) {
    throw new CanvasEditError('cannot reorder a clip relative to itself', {
      canvas: canvasAbsPath,
      id: movedStableId,
    });
  }
  const moved = resolveClip(canvasAbsPath, source, artboardId, movedStableId, movedHash);
  const ref = resolveClip(canvasAbsPath, source, artboardId, refStableId, refHash);
  const bothSeries =
    (moved.tag === 'TransitionSeries.Sequence' || moved.tag === 'Series.Sequence') &&
    (ref.tag === 'TransitionSeries.Sequence' || ref.tag === 'Series.Sequence');
  // TransitionSeries/Series clips play in ORDER (not z-stacked) — "reorder" means
  // change PLAY order. Physically moving the tag would break the S/T/S/T
  // alternation, so instead SWAP the two sequences' spans in place: the
  // transitions between them stay put, alternation is preserved, and the beats
  // change order (DDR-150 dogfood — "reorder klip vrstvy" on a showreel).
  if (bothSeries) {
    const a = moved.start <= ref.start ? moved : ref;
    const b = moved.start <= ref.start ? ref : moved;
    const s = new MagicString(source);
    s.overwrite(a.start, a.end, source.slice(b.start, b.end));
    s.overwrite(b.start, b.end, source.slice(a.start, a.end));
    const out = s.toString();
    const parsed = parseSync(canvasAbsPath, out, { sourceType: 'module' });
    if (parsed.errors && parsed.errors.length > 0) {
      throw new CanvasEditError(
        `reorder produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
        { canvas: canvasAbsPath, id: movedStableId }
      );
    }
    assertCompSemantics(canvasAbsPath, out);
    const after = enumerateClips(canvasAbsPath, out, artboardId);
    const settled = after.clips.find((c) => c.contentHash === moved.contentHash);
    return { source: out, stableId: settled?.stableId ?? movedStableId };
  }
  if (moved.tag !== 'Sequence' || ref.tag !== 'Sequence') {
    throw new CanvasEditError(
      'reorder needs two sequences of the same kind (standalone ↔ standalone, or series ↔ series)',
      { canvas: canvasAbsPath, id: movedStableId }
    );
  }
  if (!moved.clipCdId || !ref.clipCdId) {
    throw new CanvasEditError('clip has no addressable node to reorder', {
      canvas: canvasAbsPath,
      id: movedStableId,
    });
  }
  const res = applyMove(canvasAbsPath, source, moved.clipCdId, ref.clipCdId, position);
  assertCompSemantics(canvasAbsPath, res.source);
  // A pure reorder never touches the clip body → its content hash is preserved.
  // Re-address by that hash so a scoped-index stableId still resolves post-move.
  const after = enumerateClips(canvasAbsPath, res.source, artboardId);
  const settled = after.clips.find((c) => c.contentHash === moved.contentHash);
  return { source: res.source, stableId: settled?.stableId ?? movedStableId };
}

/** Reorder a clip on disk (atomic write + cross-process lock). */
export async function reorderClip(
  canvasAbsPath: string,
  artboardId: string | undefined,
  movedStableId: string,
  movedHash: string | undefined,
  refStableId: string,
  refHash: string | undefined,
  position: MovePosition
): Promise<{ source: string; stableId: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: movedStableId,
      });
    }
    const source = await file.text();
    const next = applyReorderClip(
      canvasAbsPath,
      source,
      artboardId,
      movedStableId,
      movedHash,
      refStableId,
      refHash,
      position
    );
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Toggle a clip's visibility (DDR-150 dogfood — "hide clip"). Gates the clip's
 * children behind `{false && (…)}` (hide) or strips it (show). The clip TAG stays
 * — so it keeps its time slot and, inside a `<TransitionSeries>`, the S/T/S
 * alternation stays valid — only its content stops rendering. Reversible.
 * Fingerprint-checked. Returns the new hidden state.
 */
export function applyToggleClipHidden(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): { source: string; hidden: boolean } {
  resolveClip(canvasAbsPath, source, artboardId, stableId, expectedHash); // validate + fingerprint
  // Re-parse to locate the clip's node (need its opening/closing tag spans).
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(`oxc-parser failed: ${parsed.errors[0]?.message ?? 'unknown'}`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const { clips } = enumerateClips(canvasAbsPath, source, artboardId);
  const info = clips.find((c) => c.stableId === stableId);
  if (!info)
    throw new CanvasEditError(`clip "${stableId}" not found`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  // Walk for the JSXElement whose span matches the resolved clip.
  let node: AnyNode | null = null;
  (function find(n: AnyNode): void {
    if (node || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) find(c);
      return;
    }
    if (n.type === 'JSXElement' && n.start === info.start && n.end === info.end) {
      node = n;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      find(n[k]);
    }
  })(parsed.program);
  if (!node)
    throw new CanvasEditError(`clip "${stableId}" node not found`, {
      canvas: canvasAbsPath,
      id: stableId,
    });
  const span = clipChildrenSpan(node);
  if (!span) {
    throw new CanvasEditError('this clip has no body to hide (self-closing)', {
      canvas: canvasAbsPath,
      id: stableId,
    });
  }
  const children = source.slice(span.start, span.end);
  const s = new MagicString(source);
  let hidden: boolean;
  if (/^\s*\{false && \(/.test(children)) {
    // Unhide — strip the exact wrapper we added.
    const inner = children.replace(/^(\s*)\{false && \(/, '$1').replace(/\)\}(\s*)$/, '$1');
    s.overwrite(span.start, span.end, inner);
    hidden = false;
  } else {
    s.overwrite(span.start, span.end, `{false && (${children})}`);
    hidden = true;
  }
  const out = s.toString();
  const re = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (re.errors && re.errors.length > 0) {
    throw new CanvasEditError(
      `hide produced invalid source: ${re.errors[0]?.message ?? 'parse error'}`,
      {
        canvas: canvasAbsPath,
        id: stableId,
      }
    );
  }
  assertCompSemantics(canvasAbsPath, out);
  return { source: out, hidden };
}

/** Toggle a clip's hidden state on disk (atomic write + cross-process lock). */
export async function toggleClipHidden(
  canvasAbsPath: string,
  artboardId: string | undefined,
  stableId: string,
  expectedHash: string | undefined
): Promise<{ source: string; hidden: boolean }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: stableId,
      });
    }
    const source = await file.text();
    const next = applyToggleClipHidden(canvasAbsPath, source, artboardId, stableId, expectedHash);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Media tags a caller may insert as a clip's child (also gated at the api layer). */
const INSERTABLE_MEDIA = new Set(['Video', 'Audio', 'Img', 'OffthreadVideo']);

/**
 * Insert a new `<Sequence>` clip into a comp (DDR-150 P4), addressed by
 * artboardId. Appends after the comp's LAST clip (matching its indentation),
 * optionally with a media child. Scoped to STANDALONE `<Sequence>` comps —
 * refuses a `<TransitionSeries>` (its overlap/transition math isn't a clean
 * append) and a comp with no existing clip to anchor to. Reparse + semantic
 * gate; `src` contained (no ../ or script schemes). Returns the new stableId.
 */
export function applyInsertClip(
  canvasAbsPath: string,
  source: string,
  artboardId: string | undefined,
  opts: { from: number; durationInFrames: number; mediaTag?: string | null; src?: string | null }
): { source: string; stableId: string | null } {
  const { clips, compName } = enumerateClips(canvasAbsPath, source, artboardId);
  if (!compName) {
    throw new CanvasEditError('no video-comp for this artboard', {
      canvas: canvasAbsPath,
      id: artboardId ?? '',
    });
  }
  if (clips.length === 0) {
    throw new CanvasEditError('comp has no existing clip to anchor the insert', {
      canvas: canvasAbsPath,
      id: artboardId ?? '',
    });
  }
  const last = clips[clips.length - 1] as ClipInfo;
  const from = Math.max(0, Math.round(opts.from));
  const dur = Math.max(1, Math.round(opts.durationInFrames));
  const indent = lineStartInfo(source, last.start).indent;
  const srcTrim = (opts.src ?? '').trim();
  if (
    opts.mediaTag &&
    INSERTABLE_MEDIA.has(opts.mediaTag) &&
    srcTrim &&
    (/\.\./.test(srcTrim) || /^\s*(javascript|vbscript|file|data):/i.test(srcTrim))
  ) {
    throw new CanvasEditError(
      'media src must be a contained asset path (no ../ or script schemes)',
      {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      }
    );
  }
  const s = new MagicString(source);
  if (last.tag.startsWith('TransitionSeries.') || last.tag.startsWith('Series.')) {
    // DDR-150 dogfood — append INTO a TransitionSeries: add a transition + a new
    // TransitionSeries.Sequence, keeping the S/T/S alternation. The transition is
    // CLONED verbatim from an existing one in the series so its
    // presentation/timing imports are already satisfied (we can't invent a
    // `fade()` the comp may not import). Series sequences carry no `from`.
    const seriesPrefix = last.tag.split('.')[0]; // 'TransitionSeries' | 'Series'
    const proto = clips.find(
      (c) => c.kind === 'transition' && c.tag.startsWith(`${seriesPrefix}.`)
    );
    if (!proto) {
      throw new CanvasEditError(
        `cannot append into a <${seriesPrefix}> with no existing transition to clone — add a beat via chat`,
        { canvas: canvasAbsPath, id: artboardId ?? '' }
      );
    }
    const transitionText = source.slice(proto.start, proto.end);
    const media =
      opts.mediaTag && INSERTABLE_MEDIA.has(opts.mediaTag)
        ? `\n${indent}  <${opts.mediaTag} src="${escapeAttr(srcTrim)}" />\n${indent}`
        : '';
    const clipText =
      `\n${indent}${transitionText}` +
      `\n${indent}<${seriesPrefix}.Sequence durationInFrames={${dur}}>${media}</${seriesPrefix}.Sequence>`;
    s.appendLeft(last.end, clipText);
  } else {
    const media =
      opts.mediaTag && INSERTABLE_MEDIA.has(opts.mediaTag)
        ? `\n${indent}  <${opts.mediaTag} src="${escapeAttr(srcTrim)}" />\n${indent}`
        : '';
    const clipText = `\n${indent}<Sequence from={${from}} durationInFrames={${dur}}>${media}</Sequence>`;
    s.appendLeft(last.end, clipText);
  }
  const out = s.toString();
  const parsed = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `insert produced invalid source: ${parsed.errors[0]?.message ?? 'parse error'}`,
      { canvas: canvasAbsPath, id: artboardId ?? '' }
    );
  }
  assertCompSemantics(canvasAbsPath, out);
  const after = enumerateClips(canvasAbsPath, out, artboardId);
  const newStableId = after.clips.length
    ? (after.clips[after.clips.length - 1]?.stableId ?? null)
    : null;
  return { source: out, stableId: newStableId };
}

/** Insert a clip on disk (atomic write + cross-process lock). */
export async function insertClip(
  canvasAbsPath: string,
  artboardId: string | undefined,
  opts: { from: number; durationInFrames: number; mediaTag?: string | null; src?: string | null }
): Promise<{ source: string; stableId: string | null }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId ?? '',
      });
    }
    const source = await file.text();
    const next = applyInsertClip(canvasAbsPath, source, artboardId, opts);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Replace a media `src` that lives in an array-of-objects literal
 * (`const CLIPS = [{ src: 'assets/a.mp4', … }, …]`) — the showreel pattern where
 * a clip's `<Video src={clip.src}>` is fed by `<ClipShot clip={CLIPS[i]} />`.
 * Pure. Rewrites `NAME[index].field`'s string to `value` (contained asset path).
 * Throws `CanvasEditError` on a bad path / missing target.
 */
export function applyEditArrayElementString(
  canvasAbsPath: string,
  source: string,
  arrayName: string,
  index: number,
  field: string,
  value: string
): { source: string } {
  const v = value.trim();
  if (!v || /\.\./.test(v) || /^\s*(javascript|vbscript|file|data|https?):/i.test(v)) {
    throw new CanvasEditError('src must be a contained asset path (no ../ or scheme)', {
      canvas: canvasAbsPath,
      id: `${arrayName}[${index}].${field}`,
    });
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(`oxc-parser failed: ${parsed.errors[0]?.message ?? 'unknown'}`, {
      canvas: canvasAbsPath,
      id: arrayName,
    });
  }
  let arr: AnyNode | null = null;
  for (const stmt of (parsed.program?.body ?? []) as AnyNode[]) {
    if (stmt?.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations ?? []) {
      if (
        d?.id?.type === 'Identifier' &&
        d.id.name === arrayName &&
        d.init?.type === 'ArrayExpression'
      ) {
        arr = d.init;
      }
    }
  }
  if (!arr)
    throw new CanvasEditError(`array "${arrayName}" not found`, {
      canvas: canvasAbsPath,
      id: arrayName,
    });
  const el = (arr.elements ?? [])[index] as AnyNode | undefined;
  if (!el || el.type !== 'ObjectExpression') {
    throw new CanvasEditError(`${arrayName}[${index}] is not an object literal`, {
      canvas: canvasAbsPath,
      id: `${arrayName}[${index}]`,
    });
  }
  const prop = (el.properties ?? []).find(
    (p: AnyNode) => p?.key?.name === field || p?.key?.value === field
  );
  const valNode = prop?.value;
  if (!valNode || (valNode.type !== 'Literal' && valNode.type !== 'StringLiteral')) {
    throw new CanvasEditError(`${arrayName}[${index}].${field} is not a string literal`, {
      canvas: canvasAbsPath,
      id: `${arrayName}[${index}].${field}`,
    });
  }
  const s = new MagicString(source);
  s.overwrite(valNode.start as number, valNode.end as number, JSON.stringify(v));
  const out = s.toString();
  const re = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (re.errors && re.errors.length > 0) {
    throw new CanvasEditError(
      `edit produced invalid source: ${re.errors[0]?.message ?? 'parse error'}`,
      {
        canvas: canvasAbsPath,
        id: arrayName,
      }
    );
  }
  return { source: out };
}

/** Edit an array-element src on disk (atomic write + cross-process lock). */
export async function editArrayElementString(
  canvasAbsPath: string,
  arrayName: string,
  index: number,
  field: string,
  value: string
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: arrayName,
      });
    }
    const source = await file.text();
    const next = applyEditArrayElementString(canvasAbsPath, source, arrayName, index, field, value);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

// ---------------------------------------------------------------------------
// General element structural edits — delete / insert / new-artboard (Stage I,
// feature-element-editing-robustness). These extend the DDR-138/139 move/reorder
// model (and the DDR-150 clip delete/insert) from video-comp <Sequence> clips to
// ARBITRARY canvas elements + whole artboards. Every op is a whole-file
// {before, after} write (a structural edit renumbers positional data-cd-ids, so
// an inverse *descriptor* goes stale — the caller logs before/after under a seq
// and Cmd+Z reverts by whole-file swap through /_api/reorder-revert). Each runs
// the same reparse gate as `applyMove`: never write source that doesn't parse.

/** Kind of element the insert palette can synthesize. */
export type InsertKind = 'div' | 'text' | 'image';

/** Synthesize a minimal, self-styled JSX element for an insert. No `data-cd-id`
 *  — the pipeline stamps it on the next transpile (canvas-pipeline stamping is
 *  unconditional). The new element lands selectable + immediately styleable. */
function synthInsertElement(kind: InsertKind, src?: string): string {
  if (kind === 'text') return `<p style={{ margin: 0 }}>Text</p>`;
  if (kind === 'image') {
    const s = (src ?? '').trim();
    return `<img src="${escapeAttr(s)}" alt="" style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 8 }} />`;
  }
  // div — a visible neutral placeholder box the user can immediately restyle.
  return `<div style={{ width: 120, height: 80, background: 'var(--bg-2)', borderRadius: 8 }} />`;
}

/**
 * Delete the element with `data-cd-id === id` from a canvas. Pure; never mutates
 * disk (the async `deleteElement` wraps this under the per-file lock). For a
 * reused-component INSTANCE the id names an element inside the component
 * definition (shared across N usages); `occurrence` maps it to the specific
 * `<Component/>` USAGE so deleting one instance is artboard-local — deleting the
 * shared internal element is inherently global (there is only one). Mirrors
 * `applyRemoveClip`: remove the framed span (leading indent + newline), then the
 * reparse gate refuses a delete that would leave invalid JSX (e.g. an element
 * that was the sole child of a `{expr}` that now dangles).
 */
export function applyDeleteElement(
  canvasAbsPath: string,
  source: string,
  id: string,
  occurrence?: number
): { source: string; deletedId: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }
  const targetId = resolveUsageId(parsed.program, id, occurrence);
  const hit = findOpening(parsed.program, targetId);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${targetId}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: targetId,
    });
  }
  const el = hit.element;
  const [rs, re] = spanWithFraming(source, el.start as number, el.end as number);
  const s = new MagicString(source);
  s.remove(rs, re);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `delete would produce invalid source (${check.errors[0]?.message ?? 'parse error'}); aborted — the element may be the sole child a parent requires`,
      { canvas: canvasAbsPath, id: targetId }
    );
  }
  return { source: out, deletedId: targetId };
}

/** Delete an element on disk (atomic write + cross-process lock). */
export async function deleteElement(
  canvasAbsPath: string,
  id: string,
  occurrence?: number
): Promise<{ source: string; deletedId: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    const next = applyDeleteElement(canvasAbsPath, source, id, occurrence);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Insert a synthesized element (`div` / `text` / `image`) relative to the
 * element with `data-cd-id === refId`. Pure. Reuses `applyMove`'s per-position
 * anchor + indentation logic (the new element is a single line, so no
 * continuation re-indent is needed). The inserted element carries NO
 * `data-cd-id`; after the reparse gate we recompute its post-transpile
 * positional id (the id the DOM will carry once the pipeline stamps it) by
 * locating the freshly-inserted node, and return it so the caller can select the
 * new element. An `image` needs a contained asset `src` (the AssetPicker
 * supplies one — never a remote hotlink, which the CSP split origin blocks).
 */
export function applyInsertElement(
  canvasAbsPath: string,
  source: string,
  refId: string,
  position: MovePosition,
  kind: InsertKind,
  opts?: { src?: string; occurrence?: number }
): { source: string; newId: string | null } {
  if (kind === 'image') {
    if (!opts?.src?.trim()) {
      throw new CanvasEditError('insert image requires a contained asset src (assets/…)', {
        canvas: canvasAbsPath,
        id: refId,
      });
    }
    assertContainedAssetSrc(opts.src, canvasAbsPath);
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: refId }
    );
  }
  const targetRef = resolveUsageId(parsed.program, refId, opts?.occurrence);
  const ref = findOpening(parsed.program, targetRef);
  if (!ref) {
    throw new CanvasEditError(`reference data-cd-id "${targetRef}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: targetRef,
    });
  }
  const refEl = ref.element;
  const rStart = refEl.start as number;
  const rEnd = refEl.end as number;
  const inside = position === 'inside-start' || position === 'inside-end';
  if (inside && (refEl.openingElement?.selfClosing || !refEl.closingElement)) {
    throw new CanvasEditError(
      `target "${targetRef}" is self-closing — cannot nest an element inside it`,
      { canvas: canvasAbsPath, id: targetRef }
    );
  }

  const indentUnit = detectIndentUnit(source);
  const newText = synthInsertElement(kind, opts?.src);

  let targetIndent: string;
  let anchor: number;
  let insertText: string;
  if (position === 'after') {
    targetIndent = lineStartInfo(source, rStart).indent;
    anchor = rEnd;
    insertText = `\n${targetIndent}${newText}`;
  } else if (position === 'before') {
    const rLine = lineStartInfo(source, rStart);
    targetIndent = rLine.indent;
    if (rLine.newlineBefore) {
      anchor = rLine.indentStart - 1;
      insertText = `\n${targetIndent}${newText}`;
    } else {
      anchor = rLine.indentStart;
      insertText = `${targetIndent}${newText}\n`;
    }
  } else if (position === 'inside-start') {
    targetIndent = lineStartInfo(source, rStart).indent + indentUnit;
    anchor = refEl.openingElement.end as number;
    insertText = `\n${targetIndent}${newText}`;
  } else {
    // inside-end — last child, before the closing tag's own line.
    targetIndent = lineStartInfo(source, rStart).indent + indentUnit;
    const cStart = refEl.closingElement.start as number;
    const cLine = lineStartInfo(source, cStart);
    if (cLine.newlineBefore) {
      anchor = cLine.indentStart - 1;
      insertText = `\n${targetIndent}${newText}`;
    } else {
      anchor = cStart;
      insertText = `${newText}`;
    }
  }

  const s = new MagicString(source);
  s.appendLeft(anchor, insertText);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `insert would produce invalid source (${check.errors[0]?.message ?? 'parse error'}); aborted`,
      { canvas: canvasAbsPath, id: targetRef }
    );
  }
  // Recompute the new element's post-insert positional id. There's a single
  // append (no removes), so the new element's `<` lands at `anchor + prefixLen`
  // in `out`; match by that exact offset (robust when the inserted text is a
  // duplicate of a sibling), falling back to a text match.
  const prefixLen = insertText.indexOf(newText);
  const elemStart = anchor + prefixLen;
  let newId: string | null = null;
  let fallback: string | null = null;
  for (const { id: eid, node } of collectElements(check.program)) {
    if ((node.start as number) === elemStart) {
      newId = eid;
      break;
    }
    if (out.slice(node.start as number, node.end as number) === newText) fallback = eid;
  }
  return { source: out, newId: newId ?? fallback };
}

/** Insert an element on disk (atomic write + cross-process lock). */
export async function insertElement(
  canvasAbsPath: string,
  refId: string,
  position: MovePosition,
  kind: InsertKind,
  opts?: { src?: string; occurrence?: number }
): Promise<{ source: string; newId: string | null }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: refId,
      });
    }
    const source = await file.text();
    const next = applyInsertElement(canvasAbsPath, source, refId, position, kind, opts);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Insert a synthesized element as a child of the `<DCArtboard id="…">` itself —
 * the empty-artboard fallback for the tool-palette "+ Element" affordance
 * (Stage I3 tail addendum). `applyInsertElement` needs a sibling `data-cd-id`
 * to anchor on; a freshly-scaffolded or fully-cleared artboard has none, so
 * this variant anchors on the DCArtboard JSX node itself (addressed by its
 * `id` PROP, same convention as `applyResizeArtboard`/`applyDeleteArtboard` —
 * an artboard's rendered `<article data-dc-screen>` carries no `data-cd-id`).
 * Only `inside-start`/`inside-end` make sense here (no sibling to be
 * before/after). Pure; reparse-gated like `applyInsertElement`.
 */
export function applyInsertElementIntoArtboard(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  position: 'inside-start' | 'inside-end',
  kind: InsertKind,
  opts?: { src?: string }
): { source: string; newId: string | null } {
  if (kind === 'image') {
    if (!opts?.src?.trim()) {
      throw new CanvasEditError('insert image requires a contained asset src (assets/…)', {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    assertContainedAssetSrc(opts.src, canvasAbsPath);
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  if (target.openingElement?.selfClosing || !target.closingElement) {
    throw new CanvasEditError(
      `<DCArtboard id="${artboardId}"> is self-closing — cannot nest an element inside it`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }

  const rStart = target.start as number;
  const indentUnit = detectIndentUnit(source);
  const newText = synthInsertElement(kind, opts?.src);
  const targetIndent = lineStartInfo(source, rStart).indent + indentUnit;

  let anchor: number;
  let insertText: string;
  if (position === 'inside-start') {
    anchor = target.openingElement.end as number;
    insertText = `\n${targetIndent}${newText}`;
  } else {
    const cStart = target.closingElement.start as number;
    const cLine = lineStartInfo(source, cStart);
    if (cLine.newlineBefore) {
      anchor = cLine.indentStart - 1;
      insertText = `\n${targetIndent}${newText}`;
    } else {
      anchor = cStart;
      insertText = `${newText}`;
    }
  }

  const s = new MagicString(source);
  s.appendLeft(anchor, insertText);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `insert would produce invalid source (${check.errors[0]?.message ?? 'parse error'}); aborted`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  // Same post-insert id recomputation as applyInsertElement — single append,
  // no removes, so the new element's `<` lands at this exact offset in `out`.
  const prefixLen = insertText.indexOf(newText);
  const elemStart = anchor + prefixLen;
  let newId: string | null = null;
  let fallback: string | null = null;
  for (const { id: eid, node } of collectElements(check.program)) {
    if ((node.start as number) === elemStart) {
      newId = eid;
      break;
    }
    if (out.slice(node.start as number, node.end as number) === newText) fallback = eid;
  }
  return { source: out, newId: newId ?? fallback };
}

/** Insert an element into an artboard by artboardId (no ref sibling) on disk. */
export async function insertElementIntoArtboard(
  canvasAbsPath: string,
  artboardId: string,
  position: 'inside-start' | 'inside-end',
  kind: InsertKind,
  opts?: { src?: string }
): Promise<{ source: string; newId: string | null }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applyInsertElementIntoArtboard(
      canvasAbsPath,
      source,
      artboardId,
      position,
      kind,
      opts
    );
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Duplicate the element with `data-cd-id === id` — insert a verbatim copy of its
 * source as the next sibling (Cmd+D, Task L3). Since the SOURCE carries no
 * data-cd-id (they're injected at transpile, not stored on disk), the clone gets
 * a fresh positional id on the next transpile — no id collision. Reused-component
 * instances resolve via resolveUsageId so the copy is the `<Card/>` USAGE
 * (artboard-local), consistent with the Stage-H scope model.
 */
export function applyDuplicateElement(
  canvasAbsPath: string,
  source: string,
  id: string,
  occurrence?: number
): { source: string; newId: string | null } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }
  const targetId = resolveUsageId(parsed.program, id, occurrence);
  const hit = findOpening(parsed.program, targetId);
  if (!hit) {
    throw new CanvasEditError(`data-cd-id "${targetId}" not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: targetId,
    });
  }
  const el = hit.element;
  const elStart = el.start as number;
  const elEnd = el.end as number;
  // The clone is the element's own source, placed at the same indent as the next
  // sibling (its internal lines are already indented relative to that level).
  const cloneText = source.slice(elStart, elEnd);
  const targetIndent = lineStartInfo(source, elStart).indent;
  const insertText = `\n${targetIndent}${cloneText}`;
  const s = new MagicString(source);
  s.appendLeft(elEnd, insertText);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `duplicate would produce invalid source (${check.errors[0]?.message ?? 'parse error'}); aborted`,
      { canvas: canvasAbsPath, id: targetId }
    );
  }
  // Single append (no removes) → the copy's `<` lands at this exact offset.
  const elemStart = elEnd + insertText.indexOf(cloneText);
  let newId: string | null = null;
  let fallback: string | null = null;
  for (const { id: eid, node } of collectElements(check.program)) {
    if ((node.start as number) === elemStart) {
      newId = eid;
      break;
    }
    if (out.slice(node.start as number, node.end as number) === cloneText) fallback = eid;
  }
  return { source: out, newId: newId ?? fallback };
}

/** Duplicate an element on disk (atomic write + cross-process lock). */
export async function duplicateElement(
  canvasAbsPath: string,
  id: string,
  occurrence?: number
): Promise<{ source: string; newId: string | null }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    const next = applyDuplicateElement(canvasAbsPath, source, id, occurrence);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Collect every JSXElement whose opening tag is `tagName` (document order). */
function collectJsxByTag(program: AnyNode, tagName: string): AnyNode[] {
  const out: AnyNode[] = [];
  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'JSXElement') {
      const n = node.openingElement?.name;
      if (n?.type === 'JSXIdentifier' && n.name === tagName) out.push(node);
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
  }
  visit(program);
  return out;
}

/**
 * Write a NUMERIC JSX attribute (`width={430}`) — the shape `<DCArtboard>` size
 * props take (DDR-027). Distinct from `editStringAttr`, which would emit
 * `width="430"` and break the numeric prop. Overwrites an existing `{expr}` or
 * `"literal"`, or inserts the attribute after the tag name if missing.
 */
function writeNumericAttr(
  s: MagicString,
  opening: AnyNode,
  name: string,
  value: number,
  min = 1
): void {
  const num = Math.max(min, Math.round(value));
  const attr = findAttribute(opening, name);
  if (attr) {
    const v = attr.value;
    if (!v) {
      s.appendLeft(attr.end as number, `={${num}}`);
      return;
    }
    // Any value shape (expression container or string literal) → a numeric expr.
    s.overwrite(v.start as number, v.end as number, `{${num}}`);
    return;
  }
  const insertAt: number | undefined = opening?.name?.end;
  if (typeof insertAt !== 'number') throw new Error('Opening element has no resolvable name range');
  s.appendLeft(insertAt, ` ${name}={${num}}`);
}

/**
 * Free-hand artboard resize (Stage D4). Rewrites the `width` / `height` NUMERIC
 * props on the `<DCArtboard>` whose `id` prop equals `artboardId` — per DDR-027
 * artboard size is JSX-authoritative (not a `layout` field), and an artboard's
 * rendered `<article data-dc-screen>` carries no `data-cd-id`, so it's addressed
 * by its own `id` prop, not the cd-id lane. Pure; reparse-gated.
 */
export function applyResizeArtboard(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  width: number | undefined,
  height: number | undefined
): { source: string } {
  if (width == null && height == null) return { source };
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  if (typeof width === 'number') writeNumericAttr(s, target.openingElement, 'width', width);
  if (typeof height === 'number') writeNumericAttr(s, target.openingElement, 'height', height);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard resize produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Resize an artboard on disk (atomic write + cross-process lock). */
export async function resizeArtboard(
  canvasAbsPath: string,
  artboardId: string,
  width: number | undefined,
  height: number | undefined
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applyResizeArtboard(canvasAbsPath, source, artboardId, width, height);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Write/clear a BARE JSX boolean attribute (`<DCArtboard fixed>`, not
 * `fixed={true}` or a string). `value=false` reuses `removeStringAttr`'s
 * generic span-plus-leading-whitespace removal (it doesn't care whether the
 * attribute it's removing has a value) — only the `true` insert path is new.
 */
function writeBooleanAttr(
  s: MagicString,
  opening: AnyNode,
  name: string,
  value: boolean,
  source: string
): void {
  if (!value) {
    removeStringAttr(s, opening, name, source);
    return;
  }
  if (findAttribute(opening, name)) return; // already present in some form
  const insertAt: number | undefined = opening?.name?.end;
  if (typeof insertAt !== 'number') throw new Error('Opening element has no resolvable name range');
  s.appendLeft(insertAt, ` ${name}`);
}

/**
 * Toggle an artboard's height sizing mode (Hug ⇄ Fixed CSS-panel control).
 * `fixed=true` adds the bare `fixed` prop and, when `freezeHeight` is given
 * (the board's current measured height), also writes it as the exact
 * `height` — so pinning to Fixed doesn't snap the box back to whatever the
 * JSX `height` floor happened to be. `fixed=false` removes the `fixed` prop;
 * `height` is left as-is (it resumes being the hug floor). Same id-prop
 * addressing as applyResizeArtboard (DDR-027 — an artboard frame carries no
 * data-cd-id). Pure; reparse-gated.
 */
export function applySetArtboardHug(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  fixed: boolean,
  freezeHeight?: number
): { source: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  writeBooleanAttr(s, target.openingElement, 'fixed', fixed, source);
  if (fixed && typeof freezeHeight === 'number') {
    writeNumericAttr(s, target.openingElement, 'height', freezeHeight);
  }
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard hug-toggle produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Set an artboard's Hug/Fixed mode on disk (atomic write + cross-process lock). */
export async function setArtboardHug(
  canvasAbsPath: string,
  artboardId: string,
  fixed: boolean,
  freezeHeight?: number
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applySetArtboardHug(canvasAbsPath, source, artboardId, fixed, freezeHeight);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Patch shape for {@link applySetArtboardStyle} — `null` resets/removes that
 *  prop back to the engine default; `undefined`/absent leaves it untouched.
 *  padding/gap accept a `var(--token)` STRING alongside raw px numbers
 *  (dogfood: the Inspector's artboard panel binds space tokens the same way
 *  the CSS panel's ValueTokenField does) — validation of the string shape
 *  lives at the api.ts layer, same split as every other artboard writer. */
export interface ArtboardStylePatch {
  background?: string | null;
  padding?: number | string | null;
  layout?: string | null;
  gap?: number | string | null;
}

/**
 * Write the artboard "more settings" props (background / padding / layout /
 * gap) — applied to `.dc-artboard-body` by DCArtboard, not the frame chrome.
 * String props (background/layout) reuse `editStringAttr`/`removeStringAttr`;
 * numeric props (padding/gap) reuse `writeNumericAttr` with a 0 floor (unlike
 * width/height, 0 padding/gap is a normal value, not a degenerate one). Same
 * id-prop addressing + reparse-gate as applyResizeArtboard/applySetArtboardHug.
 */
export function applySetArtboardStyle(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  patch: ArtboardStylePatch
): { source: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  const opening = target.openingElement;
  if ('background' in patch) {
    if (patch.background == null) removeStringAttr(s, opening, 'background', source);
    else editStringAttr(s, opening, 'background', patch.background, canvasAbsPath, artboardId);
  }
  if ('layout' in patch) {
    if (patch.layout == null) removeStringAttr(s, opening, 'layout', source);
    else editStringAttr(s, opening, 'layout', patch.layout, canvasAbsPath, artboardId);
  }
  if ('padding' in patch) {
    if (patch.padding == null) removeStringAttr(s, opening, 'padding', source);
    else if (typeof patch.padding === 'string')
      editStringAttr(s, opening, 'padding', patch.padding, canvasAbsPath, artboardId);
    else writeNumericAttr(s, opening, 'padding', patch.padding, 0);
  }
  if ('gap' in patch) {
    if (patch.gap == null) removeStringAttr(s, opening, 'gap', source);
    else if (typeof patch.gap === 'string')
      editStringAttr(s, opening, 'gap', patch.gap, canvasAbsPath, artboardId);
    else writeNumericAttr(s, opening, 'gap', patch.gap, 0);
  }
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard style edit produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Set an artboard's style props on disk (atomic write + cross-process lock). */
export async function setArtboardStyle(
  canvasAbsPath: string,
  artboardId: string,
  patch: ArtboardStylePatch
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applySetArtboardStyle(canvasAbsPath, source, artboardId, patch);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

const ARTBOARD_KIND_VALUES = new Set(['digital', 'print', 'web', 'video']);

/**
 * Write/clear the DCArtboard `kind` prop (feature-1-artboard-kinds-foundation
 * T5/T8) — kind-switch surfaces (context menu, Inspector) route here. Plain
 * string prop, so this reuses the same `editStringAttr`/`removeStringAttr`
 * toolkit + id-prop addressing as `applySetArtboardStyle`. `kind: null` clears
 * back to the implicit default (`digital`, or the `subtreeHasVideoComp`
 * fallback). Pure; reparse-gated.
 */
export function applySetArtboardKind(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  kind: string | null
): { source: string } {
  if (kind !== null && !ARTBOARD_KIND_VALUES.has(kind)) {
    throw new CanvasEditError(`invalid artboard kind "${kind}"`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  const opening = target.openingElement;
  if (kind === null) removeStringAttr(s, opening, 'kind', source);
  else editStringAttr(s, opening, 'kind', kind, canvasAbsPath, artboardId);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard kind edit produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Longest artboard name the label edit accepts (the chrome truncates long ones). */
export const MAX_ARTBOARD_LABEL = 80;

/**
 * Rename an artboard — write its DCArtboard `label` string prop (plan T25/L08,
 * the double-click-the-name gesture). Addressed by the `id` prop like every
 * other artboard verb; the label is a JSX string attribute, so `editStringAttr`
 * escapes it. Pure; reparse-gated.
 */
export function applySetArtboardLabel(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  label: string
): { source: string } {
  // Control characters never reach a JSX attribute.
  const clean = [...label]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  if (!clean || clean.length > MAX_ARTBOARD_LABEL) {
    throw new CanvasEditError(`artboard name must be 1–${MAX_ARTBOARD_LABEL} characters`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const target = collectJsxByTag(parsed.program, 'DCArtboard').find(
    (a) => getStringAttr(a.openingElement, 'id') === artboardId
  );
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  editStringAttr(s, target.openingElement, 'label', clean, canvasAbsPath, artboardId);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard rename produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Rename an artboard on disk (atomic write + cross-process lock). */
export async function setArtboardLabel(
  canvasAbsPath: string,
  artboardId: string,
  label: string
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applySetArtboardLabel(canvasAbsPath, source, artboardId, label);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Set an artboard's `kind` on disk (atomic write + cross-process lock). */
export async function setArtboardKind(
  canvasAbsPath: string,
  artboardId: string,
  kind: string | null
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applySetArtboardKind(canvasAbsPath, source, artboardId, kind);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Write/clear an object-VALUED DCArtboard prop (`guides={{ columns: {...} }}`,
 * `print={{ paper: 'a4' }}`), unlike every other artboard writer above.
 * Per the plan's own gotcha, object-prop editing via AST is the hard part;
 * this scopes to REPLACE-WHOLE-PROP (stringify the given object and overwrite
 * the entire `{{...}}` span), not a deep merge — a caller that wants to keep
 * one key while adding another must read the current value back (Inspector
 * pre-fill reads `data-dc-*`-style attrs same as every other artboard knob)
 * and send the full merged object. `value: null` removes the prop entirely.
 * `JSON.stringify` output is valid as a JS object-literal expression (quoted
 * keys are legal JS, not just JSON), so no separate JS-literal serializer is
 * needed. Shape validation lives at the api.ts layer; this is pure AST
 * surgery. Pure; reparse-gated. Shared by `applySetArtboardGuides` and
 * `applySetArtboardPrint` (feature-2-print-artboards T2) below.
 */
function applySetArtboardObjectProp(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  propName: string,
  value: Record<string, unknown> | null
): { source: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const s = new MagicString(source);
  const opening = target.openingElement;
  if (value === null) {
    removeStringAttr(s, opening, propName, source);
  } else {
    const literal = JSON.stringify(value);
    const attr = findAttribute(opening, propName);
    if (!attr) {
      const insertAt: number | undefined = opening?.name?.end;
      if (typeof insertAt !== 'number') {
        throw new Error('Opening element has no resolvable name range');
      }
      s.appendLeft(insertAt, ` ${propName}={${literal}}`);
    } else if (attr.value?.type === 'JSXExpressionContainer') {
      s.overwrite(attr.value.start, attr.value.end, `{${literal}}`);
    } else {
      throw new CanvasEditError(
        `${propName} attribute is not a {{...}} expression — refusing to edit`,
        {
          canvas: canvasAbsPath,
          id: artboardId,
        }
      );
    }
  }
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard ${propName} edit produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Set an artboard's object-valued prop on disk (atomic write + cross-process lock). */
async function setArtboardObjectProp(
  canvasAbsPath: string,
  artboardId: string,
  propName: string,
  value: Record<string, unknown> | null
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applySetArtboardObjectProp(canvasAbsPath, source, artboardId, propName, value);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

export function applySetArtboardGuides(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  guides: Record<string, unknown> | null
): { source: string } {
  return applySetArtboardObjectProp(canvasAbsPath, source, artboardId, 'guides', guides);
}

/** Set an artboard's `guides` on disk (atomic write + cross-process lock). */
export function setArtboardGuides(
  canvasAbsPath: string,
  artboardId: string,
  guides: Record<string, unknown> | null
): Promise<{ source: string }> {
  return setArtboardObjectProp(canvasAbsPath, artboardId, 'guides', guides);
}

/**
 * Write/clear the DCArtboard `print` prop (feature-2-print-artboards T2) —
 * see `applySetArtboardObjectProp`'s doc comment for the shared shape.
 * `print: null` removes the prop entirely (e.g. reverting an artboard to a
 * non-print kind).
 */
export function applySetArtboardPrint(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  print: Record<string, unknown> | null
): { source: string } {
  return applySetArtboardObjectProp(canvasAbsPath, source, artboardId, 'print', print);
}

/** Set an artboard's `print` on disk (atomic write + cross-process lock). */
export function setArtboardPrint(
  canvasAbsPath: string,
  artboardId: string,
  print: Record<string, unknown> | null
): Promise<{ source: string }> {
  return setArtboardObjectProp(canvasAbsPath, artboardId, 'print', print);
}

/**
 * Read a JS object-literal AST node into a plain object WITHOUT eval —
 * `print` (like every other canvas-authored JSX prop) is part of the
 * DDR-054 untrusted-canvas surface, so evaluating its source text
 * (`Function('return ' + src)()`) would be a code-injection hole. Handles
 * string/numeric/boolean/null literals and nested object literals; any other
 * value shape (identifiers, calls, template strings, arrays) is silently
 * skipped — conservative by design, since a print-geometry reader should
 * degrade to "field absent" rather than guess. Depth-capped defensively,
 * though `print`'s own shape never nests past marginsMm (depth 2).
 */
function objectExpressionToPlain(node: AnyNode, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 6 || node?.type !== 'ObjectExpression') return out;
  for (const p of node.properties ?? []) {
    if ((p?.type !== 'Property' && p?.type !== 'ObjectProperty') || p.computed) continue;
    const key =
      p.key?.type === 'Identifier'
        ? (p.key.name as string)
        : isStringLit(p.key)
          ? String(p.key.value)
          : null;
    if (key === null) continue;
    const v = p.value;
    if (!v) continue;
    if (v.type === 'ObjectExpression') {
      out[key] = objectExpressionToPlain(v, depth + 1);
    } else if (
      (v.type === 'Literal' ||
        v.type === 'StringLiteral' ||
        v.type === 'NumericLiteral' ||
        v.type === 'BooleanLiteral') &&
      (typeof v.value === 'string' ||
        typeof v.value === 'number' ||
        typeof v.value === 'boolean' ||
        v.value === null)
    ) {
      out[key] = v.value;
    }
    // else: unsupported value shape — key silently omitted.
  }
  return out;
}

/**
 * Read an artboard's `print` JSX prop as a plain object — used by the PDF
 * exporter (T5) to resolve bleed/paper geometry for the artboard being
 * exported. Read-only (no lock, no write). Returns null when the canvas/
 * artboard/prop doesn't exist, `kind` isn't the literal string `"print"` — a
 * `print` prop left over from a prior kind switch (or hand-authored on a
 * non-print artboard) must NOT leak bleed/marks into an export; `kind="print"`
 * is the sole gate (unlike `video`, print has no implicit structural-fallback
 * resolution, so checking the explicit attr is sufficient — see
 * DDR-181/canvas-lib.tsx) — or `print` doesn't resolve to a `{{...}}`
 * object-expression.
 *
 * The prop is accepted either as an inline literal (`print={{ paper: 'a4' }}`)
 * or as a reference to a top-level `const` sharing one spec across several
 * artboards (`print={A1_PRINT}` / `print={A1_PRINT as any}`) — resolved via
 * `resolveValueNode`'s same no-eval identifier lookup used elsewhere in this
 * file. Anything else genuinely computed (an import, a function call, a
 * spread) still returns null rather than guessing (RCA
 * issue-pdf-print-export-marks-missing).
 */
export function readArtboardPrintProp(
  canvasAbsPath: string,
  source: string,
  artboardId: string
): Record<string, unknown> | null {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) return null;
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) return null;
  if (getStringAttr(target.openingElement, 'kind') !== 'print') return null;
  const attr = findAttribute(target.openingElement, 'print');
  if (attr?.value?.type !== 'JSXExpressionContainer') return null;
  const expr = attr.value.expression as AnyNode | undefined;
  if (!expr) return null;
  const resolved = resolveValueNode(parsed.program, expr);
  if (resolved?.type !== 'ObjectExpression') return null;
  return objectExpressionToPlain(resolved);
}

/**
 * Every print artboard's `print` prop in a canvas, keyed by artboard id.
 *
 * The per-id reader above is what the PDF adapter uses when it has the checkout
 * on disk. A render worker (DDR-230) does NOT — it holds no tenant files by
 * design — so the cell resolves these up front and ships them inside the job
 * (`options.printProps`, exporters/jobs.ts). Until it did, a cloud print PDF
 * silently came back with no BleedBox/TrimBox and no marks: the adapter's
 * `readFileSync` failed against the worker's empty scratch root and the
 * fall-through was "not a print artboard" (DDR-232 follow-up, found by the
 * worker-lane export E2E).
 */
export function readAllArtboardPrintProps(
  canvasAbsPath: string,
  source: string
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) return out;
  for (const ab of collectJsxByTag(parsed.program, 'DCArtboard')) {
    const id = getStringAttr(ab.openingElement, 'id');
    if (!id || getStringAttr(ab.openingElement, 'kind') !== 'print') continue;
    const attr = findAttribute(ab.openingElement, 'print');
    if (attr?.value?.type !== 'JSXExpressionContainer') continue;
    const expr = attr.value.expression as AnyNode | undefined;
    if (!expr) continue;
    const resolved = resolveValueNode(parsed.program, expr);
    if (resolved?.type !== 'ObjectExpression') continue;
    out[id] = objectExpressionToPlain(resolved);
  }
  return out;
}

/**
 * Delete the `<DCArtboard id="…">` whose `id` prop equals `artboardId` — the
 * artboard counterpart of applyDeleteElement (an artboard is addressed by its id
 * PROP, since the rendered `<article data-dc-screen>` has no data-cd-id; same
 * convention as applyResizeArtboard). Removes the framed span + reparse-gates,
 * and refuses to delete the LAST artboard (a canvas with zero artboards renders
 * nothing). Whole-file-snapshot undo, like the other structural ops.
 */
export function applyDeleteArtboard(
  canvasAbsPath: string,
  source: string,
  artboardId: string
): { source: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  if (artboards.length <= 1) {
    throw new CanvasEditError('cannot delete the last artboard on the canvas', {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const [rs, re] = spanWithFraming(source, target.start as number, target.end as number);
  const s = new MagicString(source);
  s.remove(rs, re);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `artboard delete produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out };
}

/** Delete an artboard on disk (atomic write + cross-process lock). */
export async function deleteArtboard(
  canvasAbsPath: string,
  artboardId: string
): Promise<{ source: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applyDeleteArtboard(canvasAbsPath, source, artboardId);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** Artboard id must be a safe JSX-attribute identifier (no quotes/markup). */
const ARTBOARD_ID_RE = /^[A-Za-z][\w-]*$/;

/**
 * Insert a new EMPTY `<DCArtboard>` after the canvas's last artboard (Stage I4).
 * Pure. The size props (`width`/`height`) are JSX-authoritative (DDR-027); the
 * grid position is left to the caller's `patchCanvasMeta` (DDR-027 default-grid
 * places an unpositioned artboard at the next free slot). The artboard is empty
 * — a clean frame the user fills via insert-element — and non-self-closing so an
 * `inside-end` insert can target it. Reparse-gated. Rejects a duplicate `id`.
 */
export function applyInsertArtboard(
  canvasAbsPath: string,
  source: string,
  opts: { id: string; label: string; width: number; height: number }
): { source: string; artboardId: string } {
  const id = opts.id.trim();
  const label = opts.label.trim();
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  if (!ARTBOARD_ID_RE.test(id)) {
    throw new CanvasEditError(`invalid artboard id "${id}" (must match ${ARTBOARD_ID_RE})`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  if (artboards.length === 0) {
    throw new CanvasEditError(
      'no <DCArtboard> to anchor a new artboard — scaffold a canvas first',
      { canvas: canvasAbsPath, id }
    );
  }
  for (const a of artboards) {
    if (getStringAttr(a.openingElement, 'id') === id) {
      throw new CanvasEditError(`artboard id "${id}" already exists`, {
        canvas: canvasAbsPath,
        id,
      });
    }
  }
  const last = artboards[artboards.length - 1] as AnyNode;
  const indent = lineStartInfo(source, last.start as number).indent;
  const newText = `<DCArtboard id="${escapeAttr(id)}" label="${escapeAttr(label)}" width={${width}} height={${height}}></DCArtboard>`;
  const s = new MagicString(source);
  s.appendLeft(last.end as number, `\n${indent}${newText}`);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `insert-artboard produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id }
    );
  }
  return { source: out, artboardId: id };
}

/** Insert a new empty artboard on disk (atomic write + cross-process lock). */
export async function insertArtboard(
  canvasAbsPath: string,
  opts: { id: string; label: string; width: number; height: number }
): Promise<{ source: string; artboardId: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: opts.id,
      });
    }
    const source = await file.text();
    const next = applyInsertArtboard(canvasAbsPath, source, opts);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/**
 * Duplicate the `<DCArtboard id="…">` whose `id` prop equals `artboardId` at
 * a NEW width — feature-3-web-artboards T3 "Duplicate at width…". Clones the
 * artboard's full source span (opening tag through children through closing
 * tag) as the NEXT sibling in source order, then patches the clone's `id`
 * (suffixed with the new width, de-duped against every existing artboard id),
 * `label` (suffixed `" (WIDTHpx)"`), and `width` attributes. Every other prop
 * (`kind`, `guides`, `print`, `background`, `layout`, `gap`, `fixed`, and the
 * children themselves) carries over verbatim — this is a structural copy, not
 * a linked variant (Design Decision 3): the agent or the clone's own
 * `@container` rules adapt the content afterward.
 *
 * Unlike `applyDuplicateElement` (whose target has no explicit source `id` —
 * data-cd-id is transpile-time positional, so a byte-verbatim clone never
 * collides), an artboard's `id`/`label`/`width` ARE explicit JSX attributes
 * that WOULD collide verbatim — they're rewritten in the clone text via a
 * small isolated MagicString pass keyed off the original attribute nodes'
 * offsets translated into clone-relative coordinates (offset - elStart),
 * rather than re-parsing the extracted substring.
 *
 * Splicing the clone right after the SOURCE (not appended at the end of the
 * file, unlike applyInsertArtboard) is what gives it a "beside the source"
 * position for free: an artboard with no explicit `layout.artboards[]` entry
 * places via the runtime's index-ordered default-grid (DDR-027,
 * canvas-lib.tsx VP_GRID) — the very next index after the source is the next
 * default-grid cell, so the clone lands beside the original with no extra
 * position-writing plumbing. An artboard that DOES carry an explicit
 * `layout.artboards[]` entry is unaffected by its index (position is keyed by
 * id, not order).
 *
 * Reparse-gated. Whole-file-snapshot undo, like the other structural ops.
 */
export function applyDuplicateArtboard(
  canvasAbsPath: string,
  source: string,
  artboardId: string,
  newWidth: number
): { source: string; artboardId: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${parsed.errors[0]?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  const artboards = collectJsxByTag(parsed.program, 'DCArtboard');
  const target = artboards.find((a) => getStringAttr(a.openingElement, 'id') === artboardId);
  if (!target) {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> not found in ${canvasAbsPath}`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const width = Math.max(1, Math.round(newWidth));

  const existingIds = new Set(
    artboards
      .map((a) => getStringAttr(a.openingElement, 'id'))
      .filter((x): x is string => typeof x === 'string')
  );
  let newId = `${artboardId}-${width}`;
  let suffix = 2;
  while (existingIds.has(newId)) {
    newId = `${artboardId}-${width}-${suffix}`;
    suffix += 1;
  }

  const sourceLabel = getStringAttr(target.openingElement, 'label') ?? artboardId;
  const newLabel = `${sourceLabel} (${width}px)`;

  const elStart = target.start as number;
  const elEnd = target.end as number;
  const cloneText = source.slice(elStart, elEnd);

  const idAttr = findAttribute(target.openingElement, 'id');
  if (!idAttr || typeof idAttr.start !== 'number' || typeof idAttr.end !== 'number') {
    throw new CanvasEditError(`<DCArtboard id="${artboardId}"> has no readable id attribute`, {
      canvas: canvasAbsPath,
      id: artboardId,
    });
  }
  const labelAttr = findAttribute(target.openingElement, 'label');
  const widthAttr = findAttribute(target.openingElement, 'width');

  const cs = new MagicString(cloneText);
  cs.overwrite(idAttr.start - elStart, idAttr.end - elStart, `id="${escapeAttr(newId)}"`);
  if (labelAttr && typeof labelAttr.start === 'number' && typeof labelAttr.end === 'number') {
    cs.overwrite(
      labelAttr.start - elStart,
      labelAttr.end - elStart,
      `label="${escapeAttr(newLabel)}"`
    );
  } else {
    cs.appendLeft(idAttr.end - elStart, ` label="${escapeAttr(newLabel)}"`);
  }
  if (widthAttr && typeof widthAttr.start === 'number' && typeof widthAttr.end === 'number') {
    cs.overwrite(widthAttr.start - elStart, widthAttr.end - elStart, `width={${width}}`);
  } else {
    cs.appendLeft(idAttr.end - elStart, ` width={${width}}`);
  }
  const patchedClone = cs.toString();

  const targetIndent = lineStartInfo(source, elStart).indent;
  const insertText = `\n${targetIndent}${patchedClone}`;
  const s = new MagicString(source);
  s.appendLeft(elEnd, insertText);
  const out = s.toString();
  const check = parseSync(canvasAbsPath, out, { sourceType: 'module' });
  if (check.errors && check.errors.length > 0) {
    throw new CanvasEditError(
      `duplicate-artboard produced invalid source (${check.errors[0]?.message ?? 'parse error'})`,
      { canvas: canvasAbsPath, id: artboardId }
    );
  }
  return { source: out, artboardId: newId };
}

/** Duplicate an artboard on disk (atomic write + cross-process lock). */
export async function duplicateArtboard(
  canvasAbsPath: string,
  artboardId: string,
  newWidth: number
): Promise<{ source: string; artboardId: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: artboardId,
      });
    }
    const source = await file.text();
    const next = applyDuplicateArtboard(canvasAbsPath, source, artboardId, newWidth);
    if (next.source === source) return next;
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return next;
  });
}

/** A clip in an assemble request — a dropped reference chip's src + kind. */
export interface AssembleClip {
  src: string;
  mediaKind: 'video' | 'audio';
  /** Intrinsic duration probed client-side; falls back to fps*3 when absent. */
  durationInFrames?: number | null;
}

/** Reject a src that isn't a contained relative asset path (no ../, no scheme). */
function assertContainedAssetSrc(src: string, canvasAbsPath: string): void {
  const t = src.trim();
  // ALLOWLIST (G3 security, DDR-152 — hardened from a scheme denylist per the
  // adversarial review): a contained asset src MUST be `assets/<flat-name>` and
  // nothing else. This structurally excludes `..` traversal, absolute (`/etc/…`)
  // and protocol-relative (`//evil/x.png`) hosts, and every URL scheme in ONE
  // positive rule — the denylist the comment used to imply was never the real
  // control (CSP was); this makes the source-write gate match that intent.
  // Content-addressed assets are always flat (`assets/<sha8>.<ext>`).
  if (!t || /\.\./.test(t) || !/^assets\/[A-Za-z0-9._-]+$/.test(t)) {
    throw new CanvasEditError(
      'asset src must be a contained path (assets/<name>, no ../ or scheme)',
      { canvas: canvasAbsPath, id: '' }
    );
  }
}

/**
 * Generate a full video-comp canvas TSX from a set of dropped reference clips
 * (DDR-150 P4 Task 12 — the "udělej z toho video" one-click). Video clips are
 * laid back-to-back as named `<Sequence>`s (explicit from/durationInFrames — so
 * they're immediately hand-editable on the Timeline, DDR-150); audio clips become
 * `<Audio>` beds under the whole reel. Only bundled Remotion imports are used
 * (skill invariant). `componentName` is the exported Canvas component; every src
 * is escaped + contained. The comp is a genuine frame-driven composition, never a
 * frozen preview. Throws `CanvasEditError` on an empty set / bad src.
 */
export function assembleCompSource(
  componentName: string,
  clips: AssembleClip[],
  opts: { fps?: number; width?: number; height?: number; allowEmpty?: boolean } = {}
): string {
  const fps = Math.max(1, Math.round(opts.fps ?? 30));
  const width = Math.max(1, Math.round(opts.width ?? 1280));
  const height = Math.max(1, Math.round(opts.height ?? 720));
  const videos = clips.filter((c) => c.mediaKind === 'video');
  const audios = clips.filter((c) => c.mediaKind === 'audio');
  if (videos.length === 0 && audios.length === 0 && !opts.allowEmpty) {
    throw new CanvasEditError('assemble needs at least one clip', {
      canvas: componentName,
      id: '',
    });
  }
  for (const c of clips) assertContainedAssetSrc(c.src, componentName);

  // enhanced-video-editing (Task 20, Blueprint default-container rule): video
  // beats land in a <TransitionSeries> STORYLINE (hard cuts — series membership
  // is what makes clips butt magnetically + accept seam transitions later).
  const defDur = fps * 3;
  let cursor = 0;
  const seqLines: string[] = [];
  if (videos.length) {
    seqLines.push('      <TransitionSeries>');
    videos.forEach((c, i) => {
      const dur = Math.max(1, Math.round(c.durationInFrames ?? defDur));
      seqLines.push(
        `        <TransitionSeries.Sequence name="clip-${i + 1}" durationInFrames={${dur}}>`,
        `          <Video src="${escapeAttr(c.src)}" />`,
        `        </TransitionSeries.Sequence>`
      );
      cursor += dur;
    });
    seqLines.push('      </TransitionSeries>');
  } else if (audios.length === 0) {
    // Greenfield empty comp — the drop-first hint (the first storyline drop
    // authors the <TransitionSeries> around it).
    seqLines.push(
      `      <AbsoluteFill style={{ display: 'grid', placeItems: 'center' }}>`,
      `        <div style={{ color: 'var(--fg-2, #888)', fontFamily: 'system-ui', fontSize: 24 }}>Drop clips on the timeline to start the cut</div>`,
      `      </AbsoluteFill>`
    );
  }
  // Audio beds run under the whole reel (no seek — a bed, not a clip).
  audios.forEach((c) => {
    seqLines.push(`      <Audio src="${escapeAttr(c.src)}" />`);
  });
  // Empty (greenfield) comps get a 5 s canvas to scrub; a real reel's total is
  // the cursor (with the historical defDur floor for degenerate inputs).
  const total = videos.length || audios.length ? Math.max(cursor, defDur) : fps * 5;

  // Media elements come from @remotion/media, NEVER from 'remotion'. The export's
  // only audio-capable path (renderMediaOnWeb) rejects `remotion`'s `Audio`
  // (= Html5Audio) and `OffthreadVideo` outright, so a reel assembled with those
  // exports MUTED — and ~40x slower, on the frame-step fallback. Every reel this
  // function emits has a music bed by default, which made it the widest carrier
  // of the bug. RCA issue-mp4-audio-export-html5audio-silent-degrade.
  const remotionImports = ['AbsoluteFill'];
  const mediaImports: string[] = [];
  if (videos.length) mediaImports.push('Video');
  if (audios.length) mediaImports.push('Audio');
  const transitionsImport = videos.length
    ? `import { TransitionSeries } from '@remotion/transitions';\n`
    : '';
  const mediaImport = mediaImports.length
    ? `import { ${mediaImports.join(', ')} } from '@remotion/media';\n`
    : '';

  return [
    `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';`,
    `${transitionsImport}${mediaImport}import { ${remotionImports.join(', ')} } from 'remotion';`,
    ``,
    `const Comp = () => (`,
    `  <AbsoluteFill style={{ background: 'var(--bg-0)' }}>`,
    ...seqLines,
    `  </AbsoluteFill>`,
    `);`,
    ``,
    `export default function ${componentName}() {`,
    `  return (`,
    `    <DesignCanvas>`,
    `      <DCSection title="Assembled reel">`,
    `        <DCArtboard id="reel" label="Reel" width={${width}} height={${height}}>`,
    `          <VideoComp component={Comp} durationInFrames={${total}} fps={${fps}} width={${width}} height={${height}} />`,
    `        </DCArtboard>`,
    `      </DCSection>`,
    `    </DesignCanvas>`,
    `  );`,
    `}`,
    ``,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Edit shapes.

/**
 * The literal an attribute expression IS — a string, number or boolean (a
 * negative number arrives as a unary minus) — or null for anything computed.
 */
function literalOfExpression(expr: AnyNode): string | number | boolean | null {
  if (!expr) return null;
  if (expr.type === 'Literal' || expr.type === 'StringLiteral') {
    const v = expr.value;
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
  }
  if (expr.type === 'NumericLiteral') return typeof expr.value === 'number' ? expr.value : null;
  if (expr.type === 'BooleanLiteral') return typeof expr.value === 'boolean' ? expr.value : null;
  if (
    expr.type === 'UnaryExpression' &&
    expr.operator === '-' &&
    (expr.argument?.type === 'Literal' || expr.argument?.type === 'NumericLiteral') &&
    typeof expr.argument.value === 'number'
  )
    return -expr.argument.value;
  return null;
}

function editStringAttr(
  s: MagicString,
  opening: AnyNode,
  name: string,
  value: string,
  canvasAbsPath: string,
  id: string
): void {
  const attr = findAttribute(opening, name);
  if (attr) {
    // Replace existing value. JSX attribute value forms we handle:
    //   - <Tag name="literal" />           → replace inside the quotes
    //   - <Tag name={'literal'} />         → wrap quotes around new value
    //   - <Tag name={expr} />              → replace the whole expression text
    //     (ONLY when the expression is itself a trivial string literal — a
    //     non-trivial expression is a BINDING, not a static value, and
    //     blindly overwriting it would silently discard the binding. See the
    //     `src` guard below.)
    //   - <Tag name />                     → no value node; add `="..."`
    const v = attr.value;
    if (!v) {
      // <Tag name /> → <Tag name="value" />
      s.appendLeft(attr.end, `="${escapeAttr(value)}"`);
      return;
    }
    if (v.type === 'Literal' || v.type === 'StringLiteral') {
      // Setting the value it already has is not an edit (plan T23): keep the
      // author's bytes, quote style included.
      if (typeof v.value === 'string' && v.value === value) return;
      // Replace the whole `"value"` (quotes included) so we control the escaping.
      // The value lands in a JSX *attribute*, where `"` must become `&quot;` and
      // `<`/`>` their entities — NOT JS backslash escaping. `JSON.stringify` would
      // emit `\"`, which is invalid in a JSX attribute and corrupts the source on
      // any value containing a double quote. Use the same `escapeAttr` as the two
      // insert branches so all four paths agree. See DDR-103 / DDR-105.
      s.overwrite(v.start, v.end, `"${escapeAttr(value)}"`);
      return;
    }
    if (v.type === 'JSXExpressionContainer') {
      const inner = v.expression;
      // feature-element-editing-robustness Stage F2 — `src={someVar}` (or any
      // other non-literal binding) is NOT a static value; overwriting it with a
      // plain string literal would silently discard the binding, corrupting the
      // author's intent (the exact "Replace image…" gotcha the plan calls out —
      // canvas-shell.tsx's context-menu item assumed this refusal already
      // existed; it didn't). `{'literal'}`/`{"literal"}` IS a trivial, safely
      // overwritable case — only refuse a genuinely dynamic expression.
      if (name === 'src' && !(inner?.type === 'Literal' || inner?.type === 'StringLiteral')) {
        throw new CanvasEditError(
          `"${name}" is bound to a JS expression ({…}), not a static value — edit it via /design:edit`,
          { canvas: canvasAbsPath, id }
        );
      }
      // A NUMBER OR BOOLEAN STAYS ONE (plan T23). `height={400}`,
      // `durationInFrames={30}`, `aria-pressed={false}` used to come back as
      // `"400"` / `"30"` / `"false"` — a different type, which a component that
      // does arithmetic on its prop (every Remotion timing prop) silently
      // mis-reads — and even an edit to the value it already had rewrote the
      // bytes. The same value is now no edit; a new number or boolean is
      // written into the braces it came in.
      const lit = literalOfExpression(inner);
      if (lit !== null) {
        if (String(lit) === value) return;
        if (typeof lit === 'number' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
          s.overwrite(inner.start, inner.end, value);
          return;
        }
        if (typeof lit === 'boolean' && (value === 'true' || value === 'false')) {
          s.overwrite(inner.start, inner.end, value);
          return;
        }
      }
      // Replace the whole `{...}` with a plain quoted literal — keeps the
      // resulting JSX readable. Same JSX-attribute escaping as above (NOT
      // `JSON.stringify`, which would JS-escape a `"` and corrupt the source).
      s.overwrite(v.start, v.end, `"${escapeAttr(value)}"`);
      return;
    }
    // Unknown shape — refuse rather than corrupt.
    throw new CanvasEditError(`Unsupported JSX attribute value shape: ${v.type}`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  // Attribute missing — insert right after the tag name (mirrors pipeline's
  // injection point so attribute order stays predictable).
  const insertAt: number | undefined = opening?.name?.end;
  if (typeof insertAt !== 'number') {
    throw new Error('Opening element has no resolvable name range');
  }
  s.appendLeft(insertAt, ` ${name}="${escapeAttr(value)}"`);
}

export function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Escape JSX-significant characters so user-typed text lands in source `.tsx`
 * as inert TEXT, never as markup or an expression. The text is written between
 * an element's tags (`<button>HERE</button>`), where `<`/`>` would start a tag
 * and `{`/`}` would open a JSX expression — so all four (plus a bare `&`, which
 * begins an entity) are encoded. This is the load-bearing guard that keeps the
 * inline text editor (Phase 12) from being a source-injection vector. See
 * DDR-103.
 */
function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function editStyleProp(
  s: MagicString,
  opening: AnyNode,
  prop: string,
  value: string,
  canvasAbsPath: string,
  id: string
): void {
  const attr = findAttribute(opening, 'style');
  if (!attr) {
    // No style prop yet — insert one with a single key.
    const insertAt: number | undefined = opening?.name?.end;
    if (typeof insertAt !== 'number') {
      throw new Error('Opening element has no resolvable name range');
    }
    s.appendLeft(insertAt, ` style={{ ${jsKey(prop)}: ${value} }}`);
    return;
  }
  const v = attr.value;
  if (v?.type !== 'JSXExpressionContainer') {
    throw new CanvasEditError(
      `style attribute on ${id} is not a {{...}} expression — refusing to edit`,
      { canvas: canvasAbsPath, id }
    );
  }
  const obj = v.expression;
  if (obj?.type !== 'ObjectExpression') {
    throw new CanvasEditError(
      `style={...} on ${id} is not an inline ObjectExpression — refusing to edit`,
      { canvas: canvasAbsPath, id }
    );
  }

  // Search for an existing property with the same key. JSX styles permit
  // camelCase identifiers (paddingTop) AND quoted strings ("padding-top").
  // Compare both forms.
  const propCamel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const p of obj.properties as AnyNode[]) {
    if (p?.type !== 'Property' && p?.type !== 'ObjectProperty') continue;
    const k = p.key;
    if (!k) continue;
    const kname = k.type === 'Identifier' ? k.name : k.type === 'Literal' ? String(k.value) : null;
    if (kname === prop || kname === propCamel) {
      s.overwrite(p.value.start, p.value.end, value);
      return;
    }
  }

  // Key missing — append before the closing `}`. ObjectExpression's last char
  // is the `}`; magic-string appendLeft at end keeps the brace in place.
  //
  // TRAILING-COMMA guard: a frame-driven inline style often ends the last
  // property with a trailing comma (`opacity: o,\n}`). Unconditionally
  // prepending `, ` there produced `opacity: o, , color: X` — a double comma =
  // syntax error, so the canvas failed to rebuild and the Player kept rendering
  // the OLD source (the "my CSS edit resets when I replay the video" bug).
  // Detect an existing trailing comma between the last property and the `}` and
  // omit our separating comma when one is already there.
  const props = obj.properties as AnyNode[];
  let sep = ' ';
  if (props.length > 0) {
    const lastEnd = props[props.length - 1].end as number;
    const between = s.original.slice(lastEnd, (obj.end as number) - 1);
    sep = /,/.test(between) ? ' ' : ', ';
  }
  // The object's textual end is `obj.end - 1` for `}` after the chars.
  // appendLeft at obj.end -1 puts new text before the `}`.
  s.appendLeft((obj.end as number) - 1, `${sep}${jsKey(prop)}: ${value} `);
}

/**
 * feature-4 T8 (convert-to-absolute, DDR-188) — set SEVERAL inline-style props on
 * ONE opening element in ONE MagicString pass. `editStyleProp` can't be called
 * N× per element on a fresh (style-less) element: it re-reads the ORIGINAL AST
 * each call (which still shows no `style` attr) and would emit N duplicate
 * `style={{…}}` attributes. So the no-style case is handled here with a single
 * combined insert; the existing-style case safely delegates per-prop to
 * `editStyleProp` (distinct keys → non-overlapping overwrites; new-key appends
 * stack correctly before the closing brace). `entries` values are ALREADY
 * source-ready (e.g. `'"absolute"'`, `JSON.stringify("12px")`).
 */
function setMultipleStyleProps(
  s: MagicString,
  opening: AnyNode,
  entries: Array<[string, string]>,
  canvasAbsPath: string,
  id: string
): void {
  if (entries.length === 0) return;
  const attr = findAttribute(opening, 'style');
  if (!attr) {
    const insertAt: number | undefined = opening?.name?.end;
    if (typeof insertAt !== 'number') {
      throw new Error('Opening element has no resolvable name range');
    }
    const body = entries.map(([k, v]) => `${jsKey(k)}: ${v}`).join(', ');
    s.appendLeft(insertAt, ` style={{ ${body} }}`);
    return;
  }
  for (const [k, v] of entries) {
    editStyleProp(s, opening, k, v, canvasAbsPath, id);
  }
}

/**
 * feature-4 T8 (convert-to-absolute, DDR-188) — the "Remove auto layout" analogue.
 * Pure AST batch write: rewrite each stamped CHILD to `position:absolute` with the
 * frozen `left/top/width/height` the client measured (border-box, world units),
 * and set the CONTAINER to `position:relative` when it's currently static — all in
 * ONE MagicString pass so a single whole-file snapshot reverts the whole operation.
 *
 * Guards (all-or-nothing, throws `CanvasEditError` — the shell surfaces the reason
 * and writes nothing):
 *   - Every child id must be a plain, UNIQUE, in-source element. If any child's
 *     `idIndex` resolves to a different `<Component/>` usage (a shared instance),
 *     we refuse — converting one usage's props doesn't generalize, and doing it
 *     silently would move every instance (the DDR-188 shared-instance abort; the
 *     "affects N instances" confirm path is a deferred follow-up).
 *   - The caller (canvas iframe) already refuses unstamped or duplicate-cd-id
 *     (`.map`ed) direct children before it ever posts — this is the server-side
 *     backstop for the component-usage case it can't see.
 */
export interface ConvertChildBox {
  id: string;
  idIndex?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ConvertContainerSpec {
  /** Absent for the artboard-body ROOT level — `.dc-artboard-body` is already
   *  `position:relative` engine chrome with no `data-cd-id`, so its children
   *  get absolute boxes with no container write. */
  containerId?: string;
  containerIdIndex?: number;
  containerSetRelative: boolean;
  /** feature-4 (dogfood round 4) — freeze the container's OWN border-box size.
   *  Needed for the element-level subtree ROOT: it keeps its flow position but
   *  its auto height would collapse once every child goes absolute. */
  freezeSize?: { width: number; height: number };
  children: ConvertChildBox[];
}

export function applyConvertToAbsolute(
  canvasAbsPath: string,
  source: string,
  spec: {
    containerId?: string;
    containerIdIndex?: number;
    containerSetRelative?: boolean;
    /** feature-4 T8b — user CONFIRMED converting component-instance children:
     *  each child's `idIndex` routes the write to that occurrence's own
     *  `<Component/>` USAGE (the Stage-H3 local-instance model — the usage
     *  element carries the frozen box; the component must forward `style` for
     *  it to paint, same assumption as instance drag-reposition). Without the
     *  flag a shared child still throws (the pre-confirm abort). */
    allowShared?: boolean;
    children?: ConvertChildBox[];
    /** feature-4 artboard-level convert (2026-07-19) — MULTI-container batch:
     *  the whole artboard's layout flattened to absolute in ONE pass / ONE
     *  undo seq. When present, the legacy single-container fields above are
     *  ignored. */
    containers?: ConvertContainerSpec[];
    /** feature-4 TRUE FLATTEN (user steer 2026-07-20) — ids of UNSTYLED layout
     *  wrappers to DISSOLVE: their opening+closing tags are removed from the
     *  JSX (children hoist textually into the parent), so the tree genuinely
     *  flattens. The client only nominates visually-inert wrappers (no
     *  background/border/shadow/radius/clip) whose id is unique in the
     *  artboard; their children's boxes are measured against the nearest
     *  SURVIVING ancestor. */
    dissolve?: string[];
  }
): EditResult {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      {
        canvas: canvasAbsPath,
        id: spec.containerId ?? 'artboard',
      }
    );
  }
  const containers: ConvertContainerSpec[] = Array.isArray(spec.containers)
    ? spec.containers
    : [
        {
          containerId: spec.containerId,
          containerIdIndex: spec.containerIdIndex,
          containerSetRelative: spec.containerSetRelative === true,
          children: spec.children ?? [],
        },
      ];
  const totalChildren = containers.reduce((n, c) => n + c.children.length, 0);
  if (totalChildren === 0) {
    throw new CanvasEditError('convert-to-absolute: no children to convert', {
      canvas: canvasAbsPath,
      id: spec.containerId ?? 'artboard',
    });
  }
  const s = new MagicString(source);
  // Shared across ALL containers — a `.map()`ed child (two DOM children
  // resolving to the SAME source element) can never convert: N rendered copies
  // of ONE source element can't hold N absolute positions.
  const writtenTargets = new Set<string>();
  // A container may legitimately receive BOTH a `position:relative` write and
  // (as a child of ITS parent container) an absolute box — track containers we
  // already touched so the batch never double-writes `position` on one element.
  const relativeWritten = new Set<string>();

  for (const c of containers) {
    // Container → position:relative (only when the client says it's currently
    // static; already-positioned containers are left as-is; the artboard-body
    // root level has no container to write).
    if (c.containerId && (c.containerSetRelative || c.freezeSize)) {
      const cid =
        typeof c.containerIdIndex === 'number' && Number.isFinite(c.containerIdIndex)
          ? resolveUsageId(parsed.program, c.containerId, c.containerIdIndex)
          : c.containerId;
      if (!relativeWritten.has(cid) && !writtenTargets.has(cid)) {
        relativeWritten.add(cid);
        const chit = findOpening(parsed.program, cid);
        if (!chit) {
          throw new CanvasEditError(`container "${c.containerId}" not found in ${canvasAbsPath}`, {
            canvas: canvasAbsPath,
            id: c.containerId,
          });
        }
        const entries: Array<[string, string]> = [];
        if (c.containerSetRelative) entries.push(['position', '"relative"']);
        if (c.freezeSize) {
          entries.push(
            ['width', JSON.stringify(`${c.freezeSize.width}px`)],
            ['height', JSON.stringify(`${c.freezeSize.height}px`)],
            ['box-sizing', '"border-box"']
          );
        }
        setMultipleStyleProps(s, chit.opening, entries, canvasAbsPath, cid);
      }
    }

    // Each child → absolute + frozen box. A shared-component usage either
    // routes to its own `<Component/>` usage (allowShared — the user
    // confirmed) or throws (the pre-confirm abort).
    for (const child of c.children) {
      let cid = child.id;
      if (typeof child.idIndex === 'number' && Number.isFinite(child.idIndex)) {
        cid = resolveUsageId(parsed.program, child.id, child.idIndex);
        if (cid !== child.id && !spec.allowShared) {
          throw new CanvasEditError(
            `convert-to-absolute: "${child.id}" is a shared component instance — confirm required`,
            { canvas: canvasAbsPath, id: child.id }
          );
        }
      }
      if (writtenTargets.has(cid)) {
        throw new CanvasEditError(
          `convert-to-absolute: "${child.id}" renders from a repeated (.map) source element — cannot convert`,
          { canvas: canvasAbsPath, id: child.id }
        );
      }
      writtenTargets.add(cid);
      const hit = findOpening(parsed.program, cid);
      if (!hit) {
        throw new CanvasEditError(`child "${child.id}" not found in ${canvasAbsPath}`, {
          canvas: canvasAbsPath,
          id: child.id,
        });
      }
      // A COMPONENT-INSTANCE child (cid routed to a `<Component/>` usage):
      // writing `style` on the usage tag only works when the component
      // forwards it — most don't (live-dogfood 2026-07-20: the frozen Cards
      // piled at the artboard's top-left). WRAP the usage in a positioned div
      // instead — correct for ANY component, no forwarding assumption. The
      // wrapper gets its own data-cd-id on the next transpile.
      if (cid !== child.id) {
        const elStart = hit.element?.start as number;
        const elEnd = hit.element?.end as number;
        // appendRight for the OPEN + appendLeft for the CLOSE: at a shared
        // boundary between two ADJACENT usages (`<Card /><Card />`), MagicString
        // renders the appendLeft bucket before the appendRight bucket, so the
        // previous usage's close always lands before the next usage's open.
        s.appendRight(
          elStart,
          `<div style={{ position: "absolute", left: ${JSON.stringify(`${child.left}px`)}, top: ${JSON.stringify(`${child.top}px`)}, width: ${JSON.stringify(`${child.width}px`)}, height: ${JSON.stringify(`${child.height}px`)} }}>`
        );
        s.appendLeft(elEnd, '</div>');
        continue;
      }
      const entries: Array<[string, string]> = [
        ['position', '"absolute"'],
        ['left', JSON.stringify(`${child.left}px`)],
        ['top', JSON.stringify(`${child.top}px`)],
        ['width', JSON.stringify(`${child.width}px`)],
        ['height', JSON.stringify(`${child.height}px`)],
        ['box-sizing', '"border-box"'],
      ];
      // If this element was already made `relative` as a container in this
      // batch, drop the child-role `position:absolute` write for it — one
      // element gets ONE position key. (Deeper-level nesting keeps the
      // relative context; children of an absolute element also resolve fine —
      // absolute IS a positioning context — but never write both.)
      if (relativeWritten.has(cid)) entries.shift();
      setMultipleStyleProps(s, hit.opening, entries, canvasAbsPath, cid);
    }
  }

  // feature-4 TRUE FLATTEN — dissolve nominated layout wrappers: strip the
  // opening + closing tags, leaving the children's JSX in place (they hoist
  // into the wrapper's parent). Style writes above never target a dissolved
  // id (the client keeps the sets disjoint; enforced here as a hard error so
  // a drifted client can't half-write a removed element).
  if (Array.isArray(spec.dissolve) && spec.dissolve.length > 0) {
    for (const did of spec.dissolve) {
      if (writtenTargets.has(did) || relativeWritten.has(did)) {
        throw new CanvasEditError(
          `convert-to-absolute: "${did}" is both a style target and a dissolve target`,
          { canvas: canvasAbsPath, id: did }
        );
      }
      const hit = findOpening(parsed.program, did);
      if (!hit) {
        throw new CanvasEditError(`dissolve target "${did}" not found in ${canvasAbsPath}`, {
          canvas: canvasAbsPath,
          id: did,
        });
      }
      const opening = hit.opening;
      const closing = hit.element?.closingElement;
      if (!closing || typeof closing.start !== 'number' || typeof closing.end !== 'number') {
        throw new CanvasEditError(`dissolve target "${did}" is self-closing — nothing to hoist`, {
          canvas: canvasAbsPath,
          id: did,
        });
      }
      s.remove(opening.start as number, opening.end as number);
      s.remove(closing.start as number, closing.end as number);
    }
  }

  const out = s.toString();
  return { source: out, delta: out.length - source.length };
}

/**
 * Async wrapper for {@link applyConvertToAbsolute} — read, apply, atomic write,
 * per-file lock (same shape as `editAttribute`). Returns the changed source.
 */
export async function convertToAbsolute(
  canvasAbsPath: string,
  spec: Parameters<typeof applyConvertToAbsolute>[2]
): Promise<EditResult> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id: spec.containerId ?? 'artboard',
      });
    }
    const source = await file.text();
    const next = applyConvertToAbsolute(canvasAbsPath, source, spec);
    if (next.source === source) return { source, delta: 0, changed: false };
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return { ...next, changed: true };
  });
}

/**
 * feature-4 detach-component (user steer 2026-07-19) — make ONE component
 * instance independently editable without inlining its JSX. Strategy: CLONE the
 * component's definition under a fresh name (`<C>Detached`, `<C>Detached2`, …)
 * and repoint THIS usage's tags at the clone. 100% behavior-preserving for ANY
 * component (props/children/expressions flow unchanged — no substitution
 * heuristics), and every subsequent edit lands on the clone's single-usage
 * definition, so `resolveEditScope` reports it LOCAL. This is the answer to
 * "moving an absolute child inside a shared component moved it in every
 * artboard" — detach first, then edit freely.
 */
export function applyDetachComponent(
  canvasAbsPath: string,
  source: string,
  id: string,
  occurrence?: number
): { source: string; delta: number; detachedName: string } {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CanvasEditError(
      `oxc-parser failed on ${canvasAbsPath}: ${first?.message ?? 'unknown'}`,
      { canvas: canvasAbsPath, id }
    );
  }
  const usageId = resolveUsageId(parsed.program, id, occurrence ?? 0);
  if (usageId === id) {
    throw new CanvasEditError('detach: this element is not part of a reused component instance', {
      canvas: canvasAbsPath,
      id,
    });
  }
  const hit = findOpening(parsed.program, usageId);
  if (!hit) {
    throw new CanvasEditError(`detach: usage "${usageId}" not found`, {
      canvas: canvasAbsPath,
      id,
    });
  }
  const nameNode = hit.opening?.name;
  if (nameNode?.type !== 'JSXIdentifier' || typeof nameNode.name !== 'string') {
    throw new CanvasEditError('detach: usage tag is not a plain component identifier', {
      canvas: canvasAbsPath,
      id,
    });
  }
  const componentName: string = nameNode.name;

  // Locate the component's top-level definition (function declaration or a
  // const initialized with a function/arrow), unwrapping an export wrapper.
  let defStart: number | null = null;
  let defEnd: number | null = null;
  let nameStart: number | null = null;
  let nameEnd: number | null = null;
  const body: AnyNode[] = Array.isArray(parsed.program?.body) ? parsed.program.body : [];
  for (const stmtRaw of body) {
    const stmt =
      stmtRaw?.type === 'ExportNamedDeclaration' || stmtRaw?.type === 'ExportDefaultDeclaration'
        ? (stmtRaw.declaration ?? stmtRaw)
        : stmtRaw;
    if (!stmt || typeof stmt !== 'object') continue;
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === componentName) {
      defStart = stmt.start as number;
      defEnd = stmt.end as number;
      nameStart = stmt.id.start as number;
      nameEnd = stmt.id.end as number;
      break;
    }
    if (stmt.type === 'VariableDeclaration' && Array.isArray(stmt.declarations)) {
      const d = stmt.declarations.find(
        (dd: AnyNode) => dd?.id?.type === 'Identifier' && dd.id.name === componentName
      );
      if (
        d &&
        (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression')
      ) {
        defStart = stmt.start as number;
        defEnd = stmt.end as number;
        nameStart = d.id.start as number;
        nameEnd = d.id.end as number;
        break;
      }
    }
  }
  if (defStart === null || defEnd === null || nameStart === null || nameEnd === null) {
    throw new CanvasEditError(
      `detach: definition of <${componentName}> not found in this canvas (imported components can't be detached here)`,
      { canvas: canvasAbsPath, id }
    );
  }

  // Fresh, collision-free clone name. A plain substring check is sufficient —
  // false positives only bump the counter.
  let detachedName = `${componentName}Detached`;
  let n = 2;
  while (source.includes(detachedName)) {
    detachedName = `${componentName}Detached${n}`;
    n += 1;
  }

  const defText = source.slice(defStart, defEnd);
  const cloned =
    defText.slice(0, nameStart - defStart) + detachedName + defText.slice(nameEnd - defStart);

  const s = new MagicString(source);
  s.appendRight(defEnd, `\n\n${cloned}`);
  // Repoint the usage's opening (and closing, when present) tag name.
  s.overwrite(nameNode.start as number, nameNode.end as number, detachedName);
  const closingName = hit.element?.closingElement?.name;
  if (closingName?.type === 'JSXIdentifier') {
    s.overwrite(closingName.start as number, closingName.end as number, detachedName);
  }
  const out = s.toString();
  return { source: out, delta: out.length - source.length, detachedName };
}

/** Async wrapper for {@link applyDetachComponent} — read, apply, atomic write,
 *  per-file lock (same shape as `editAttribute`). */
export async function detachComponent(
  canvasAbsPath: string,
  id: string,
  occurrence?: number
): Promise<{ source: string; delta: number; changed: boolean; detachedName: string }> {
  return withLock(canvasAbsPath, async () => {
    const file = Bun.file(canvasAbsPath);
    if (!(await file.exists())) {
      throw new CanvasEditError(`Canvas not found: ${canvasAbsPath}`, {
        canvas: canvasAbsPath,
        id,
      });
    }
    const source = await file.text();
    const next = applyDetachComponent(canvasAbsPath, source, id, occurrence);
    if (next.source === source) {
      return { source, delta: 0, changed: false, detachedName: next.detachedName };
    }
    const tmp = `${canvasAbsPath}.tmp.${Math.random().toString(36).slice(2, 10)}`;
    await Bun.write(tmp, next.source);
    const { rename } = await import('node:fs/promises');
    await rename(tmp, canvasAbsPath);
    return { ...next, changed: true };
  });
}

/**
 * Remove a single inline-style property (the "reset to original" path — DDR-104
 * Phase 12.3). No-op when the style attribute or the key is absent. When the key
 * was the object's ONLY property, the whole `style={{…}}` attribute is removed so
 * we don't leave an empty `style={{}}` behind.
 */
function removeStyleProp(s: MagicString, opening: AnyNode, prop: string, source: string): boolean {
  const attr = findAttribute(opening, 'style');
  if (!attr) return false;
  const v = attr.value;
  if (v?.type !== 'JSXExpressionContainer') return false;
  const obj = v.expression;
  if (obj?.type !== 'ObjectExpression') return false;
  const props = (obj.properties as AnyNode[]).filter(
    (p) => p?.type === 'Property' || p?.type === 'ObjectProperty'
  );
  const propCamel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const idx = props.findIndex((p) => {
    const k = p.key;
    const kname =
      k?.type === 'Identifier' ? k.name : k?.type === 'Literal' ? String(k.value) : null;
    return kname === prop || kname === propCamel;
  });
  if (idx === -1) return false;

  // Only property → drop the whole `style={{…}}` attribute (plus the leading space).
  if (props.length === 1) {
    const start = source[attr.start - 1] === ' ' ? attr.start - 1 : attr.start;
    s.remove(start, attr.end);
    return true;
  }
  // Otherwise remove the one property + one adjacent comma/whitespace run so the
  // remaining object stays well-formed: consume forward to the next prop's start
  // (eats the trailing `, `), or — for the last prop — backward from the previous
  // prop's end (eats the leading `, `).
  const target = props[idx];
  if (idx < props.length - 1) {
    s.remove(target.start as number, props[idx + 1].start as number);
  } else {
    s.remove(props[idx - 1].end as number, target.end as number);
  }
  return true;
}

/**
 * Remove a plain JSX attribute (the custom-attribute "reset" path). No-op when
 * absent. Refuses `data-cd-id` / `style` (pipeline-owned / wrong endpoint).
 */
function removeStringAttr(s: MagicString, opening: AnyNode, name: string, source: string): boolean {
  if (name === 'data-cd-id' || name === 'style') return false;
  const attr = findAttribute(opening, name);
  if (!attr) return false;
  const start = source[attr.start - 1] === ' ' ? attr.start - 1 : attr.start;
  s.remove(start, attr.end);
  return true;
}

/**
 * Render a JS object key — bare identifier when the prop is camelCase + valid
 * JS id, quoted otherwise. Mirrors how authors write JSX styles.
 */
function jsKey(prop: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) return prop;
  return JSON.stringify(prop);
}

// ---------------------------------------------------------------------------
// CLI entry. Invoked by bin/canvas-edit.sh — keeps Bun startup off the hot
// path of /design:edit when the orchestrator shells out.
//
// Layout:  bun run canvas-edit.ts --invoke <canvas> <id> <attr> <value>

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--invoke' && argv.length === 5) {
    const [, canvas, id, attr, value] = argv;
    if (!canvas || !id || !attr || value === undefined) {
      console.error('canvas-edit: --invoke needs <canvas> <id> <attr> <value>');
      process.exit(2);
    }
    try {
      const r = await editAttribute(canvas, id, attr, value);
      console.log(JSON.stringify({ canvas, id, delta: r.delta }));
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`canvas-edit: ${msg}`);
      process.exit(2);
    }
  } else {
    console.error('Usage: bun run canvas-edit.ts --invoke <canvas> <id> <attr> <value>');
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Position-independent element identity — plan T23/T24 (DDR-241).
//
// `data-cd-id` is positional (component + pre-order index), so a sibling a
// teammate inserted earlier in the same component renumbers everything after
// it. An edit made through the UI is re-applied onto the project's newer
// version when its own proposal lost a race (sync/source-ops.ts); before it
// touches anything there, it has to find THE SAME element — by what the
// element is, not where it was.
//
// A print is the enclosing component, the tag, the chain of ancestor tags and
// the element's literal attributes (minus the one being edited, minus the
// pipeline's own `data-cd-*`). It identifies an element when exactly one
// element in the newer source carries it; anything else is ambiguous, and an
// ambiguous edit is never guessed at.

export interface ElementPrint {
  component: string;
  tag: string;
  chain: string[];
  attrs: string;
  /** The element's own literal text (bounded) — absent for a text edit, whose text is what changes. */
  text?: string;
}

function ownText(node: AnyNode): string {
  let t = '';
  for (const c of Array.isArray(node?.children) ? node.children : []) {
    if (c?.type === 'JSXText') t += String(c.value);
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function literalAttrs(opening: AnyNode, ignore: string | null): string {
  const out: string[] = [];
  for (const a of Array.isArray(opening?.attributes) ? opening.attributes : []) {
    if (a?.type !== 'JSXAttribute' || a.name?.type !== 'JSXIdentifier') continue;
    const name = String(a.name.name);
    if (name.startsWith('data-cd-') || name === 'style' || name === ignore || name === 'key')
      continue;
    const v = a.value;
    const lit =
      v?.type === 'Literal' || v?.type === 'StringLiteral'
        ? String(v.value)
        : v?.type === 'JSXExpressionContainer' &&
            (v.expression?.type === 'Literal' || v.expression?.type === 'StringLiteral')
          ? String(v.expression.value)
          : v === null || v === undefined
            ? 'true'
            : '{expr}';
    out.push(`${name}=${lit}`);
  }
  return out.sort().join('|');
}

function printAll(
  canvasAbsPath: string,
  source: string,
  ignoreAttr: string | null,
  withText = true
): Array<{ id: string; print: ElementPrint }> {
  const parsed = parseSync(canvasAbsPath, source, { sourceType: 'module' });
  if (parsed.errors && parsed.errors.length > 0) return [];
  const frames: Array<{ componentName: string; jsxIndex: number }> = [
    { componentName: '', jsxIndex: 0 },
  ];
  const chain: string[] = [];
  const out: Array<{ id: string; print: ElementPrint }> = [];
  function visit(node: AnyNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (typeof node.type !== 'string') return;
    const comp = componentNameOf(node);
    if (comp !== null) frames.push({ componentName: comp, jsxIndex: 0 });
    if (node.type === 'JSXElement') {
      const frame = frames[frames.length - 1] as { componentName: string; jsxIndex: number };
      const idx = frame.jsxIndex;
      frame.jsxIndex += 1;
      const tag = jsxTagName(node) ?? '?';
      out.push({
        id: authoredCdId(node.openingElement) ?? computeId(frame.componentName, idx),
        print: {
          component: frame.componentName,
          tag,
          chain: [...chain],
          attrs: literalAttrs(node.openingElement, ignoreAttr),
          ...(withText ? { text: ownText(node) } : {}),
        },
      });
      chain.push(tag);
      if (node.openingElement) visit(node.openingElement.attributes);
      visit(node.children);
      chain.pop();
      if (comp !== null) frames.pop();
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      visit(node[k]);
    }
    if (comp !== null) frames.pop();
  }
  visit(parsed.program);
  return out;
}

const samePrint = (a: ElementPrint, b: ElementPrint) =>
  a.component === b.component &&
  a.tag === b.tag &&
  a.attrs === b.attrs &&
  (a.text ?? null) === (b.text ?? null) &&
  a.chain.length === b.chain.length &&
  a.chain.every((t, i) => t === b.chain[i]);

/** The print of the element `id` in `source`, or null. */
export function elementPrint(
  canvasAbsPath: string,
  source: string,
  id: string,
  ignoreAttr: string | null = null,
  withText = true
): ElementPrint | null {
  return (
    printAll(canvasAbsPath, source, ignoreAttr, withText).find((e) => e.id === id)?.print ?? null
  );
}

/**
 * The id the element printed `print` has in `source` — `hint` first (the
 * common case: nothing moved), else the ONE element carrying the print. Null
 * when it is gone or ambiguous.
 */
export function relocateElement(
  canvasAbsPath: string,
  source: string,
  hint: string,
  print: ElementPrint,
  ignoreAttr: string | null = null
): string | null {
  const all = printAll(canvasAbsPath, source, ignoreAttr, print.text !== undefined);
  const atHint = all.find((e) => e.id === hint);
  if (atHint && samePrint(atHint.print, print)) return hint;
  const matches = all.filter((e) => samePrint(e.print, print));
  return matches.length === 1 ? (matches[0] as { id: string }).id : null;
}

/** T23 — every JSX element of `source` with its id and print (corpus checks). */
export function listElements(
  canvasAbsPath: string,
  source: string
): Array<{ id: string; print: ElementPrint }> {
  return printAll(canvasAbsPath, source, null);
}

/** T23 — how many elements of `source` carry a print no other element shares. */
export function printUniqueness(
  canvasAbsPath: string,
  source: string
): { elements: number; unique: number } {
  const all = printAll(canvasAbsPath, source, null);
  const key = (p: ElementPrint) =>
    `${p.component}|${p.tag}|${p.chain.join('>')}|${p.attrs}|${p.text ?? ''}`;
  const counts = new Map<string, number>();
  for (const e of all) counts.set(key(e.print), (counts.get(key(e.print)) ?? 0) + 1);
  return { elements: all.length, unique: all.filter((e) => counts.get(key(e.print)) === 1).length };
}

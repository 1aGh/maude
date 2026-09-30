/**
 * @file       undo-stack.ts — per-canvas in-memory command stack
 * @scope      apps/studio/undo-stack.ts
 * @purpose    Pure state + reducer for canvas Cmd+Z / Cmd+Shift+Z. No React,
 *             no DOM, no fetch — `EditCommand.do()` / `.undo()` are caller-
 *             supplied side-effects so this file stays trivially testable
 *             under `bun:test`.
 *
 * Scope (DDR-050 rev 2):
 *   - **Persistent per-canvas, in-memory, session-scoped.** The stack lives
 *     in `window.top.__maude_undo_stacks` keyed by canvas file path so it
 *     survives canvas switches (close Foo.tsx, open Bar.tsx, come back to
 *     Foo.tsx → history still there). Reload destroys it. The original
 *     "per-iframe-ephemeral" rule from rev 1 was UX-wrong.
 *   - Stack stores SERIALIZABLE `CommandRecord`s (kind + label + payload),
 *     NOT EditCommand closures. Closures captured by patchFn/putFn point
 *     to the iframe's React state — when that iframe unmounts (canvas
 *     switch), the closures become invalid. Rebuilding from the record
 *     using the fresh iframe's sinks side-steps the lifecycle issue.
 *   - Command-pattern semantics intact: each kind ships its own builder
 *     that turns a payload + sinks into a runnable EditCommand.
 *   - Depth cap = 50 per canvas. Future-discarded on push. Viewport +
 *     selection NOT undoable (Figma convention).
 *
 * Async note. `cmd.do()` and `cmd.undo()` may return a Promise (server
 * PATCH/PUT). The reducer itself is synchronous and never awaits — the
 * runner inside `use-undo-stack.tsx` awaits the side-effect BEFORE
 * dispatching the state transition. Reducer-pure keeps reasoning + tests
 * trivial.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Runtime command shape

/**
 * A single reversible edit, ready to execute. Built on demand from a
 * `CommandRecord` + `CommandSinks` via the registry below. Holds closures
 * bound to the CURRENT iframe's React state — never persist this; persist
 * the `CommandRecord` instead.
 */
export interface EditCommand {
  readonly kind: string;
  readonly label: string;
  do(): Promise<void> | void;
  undo(): Promise<void> | void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent record shape — what the stack actually stores

/**
 * Serializable description of a reversible edit. Each `kind` corresponds
 * to a registered builder (see `registerCommand` below). Payload shape is
 * the kind's contract — see `commands/*-command.ts` for definitions.
 */
export interface CommandRecord<P = unknown> {
  readonly kind: string;
  readonly label: string;
  readonly payload: P;
}

/**
 * Per-iframe side-effect surface. Populated by descendants of the
 * `UndoStackProvider` via `useUndoSinks().setSinks(...)`. Each consumer
 * provides only the sink it owns; the provider merges. Unbound sinks are
 * `undefined` — builders fail gracefully (returning `null` makes the
 * runner skip the entry with a warning rather than crash).
 */
export interface CommandSinks {
  /** Wired by canvas-lib `DesignCanvasInner`. */
  layoutPatchFn?: unknown;
  /** Wired by `AnnotationsLayer`. */
  strokesPutFn?: unknown;
  /** Wired by the element-native annotation layer (DDR-242): apply + send an op batch. */
  annotationOpsFn?: unknown;
  /**
   * Wired by `CanvasShell` (canvas-shell.tsx). Applies a single inline source
   * edit (CSS / text / attr) by posting `dgn:'apply-edit'` to the parent shell,
   * which owns the main-origin-only `/_api/edit-*` write (DDR-054 — the canvas
   * iframe can't call those routes directly). Drives undo/redo of inspector
   * CSS edits, inline text rewrites, and custom-attribute edits, which write
   * the canvas `.tsx` source and were previously unrecoverable (no command, no
   * snapshot). See `commands/edit-source-command.ts`.
   */
  editSourceApplyFn?: unknown;
  /**
   * Wired by `CanvasShell`. Reverts/re-applies a Phase 12.1 element reorder by
   * posting `dgn:'reorder-revert'` to the parent shell, which owns the
   * main-origin-only `/_api/reorder-revert` write. See `commands/reorder-command.ts`.
   */
  reorderRevertFn?: unknown;
}

export type CommandBuilder<P = unknown> = (
  record: CommandRecord<P>,
  sinks: CommandSinks
) => EditCommand | null;

// ─────────────────────────────────────────────────────────────────────────────
// Reducer state + actions

export interface UndoStackState {
  past: readonly CommandRecord[];
  future: readonly CommandRecord[];
}

export type UndoAction =
  | { type: 'push'; record: CommandRecord }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'hydrate'; state: UndoStackState };

// ─────────────────────────────────────────────────────────────────────────────
// Constants

/**
 * Ring cap per canvas. When `past.length === MAX_DEPTH` and a new record
 * arrives, the oldest entry is dropped. 50 ≈ 3–5 minutes of intense
 * iteration before the user can no longer undo to the start.
 */
export const MAX_DEPTH = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Builder registry

const BUILDERS = new Map<string, CommandBuilder>();

/** Register a builder for a command kind. Idempotent. */
export function registerCommand<P>(kind: string, builder: CommandBuilder<P>): void {
  BUILDERS.set(kind, builder as CommandBuilder);
}

/**
 * Rebuild a runnable `EditCommand` from a persisted record + the iframe's
 * current sinks. Returns `null` when the kind isn't registered or the
 * required sink isn't bound — the runner treats `null` as "skip this entry,
 * something's misconfigured" rather than crashing.
 */
export function rebuildCommand(record: CommandRecord, sinks: CommandSinks): EditCommand | null {
  const builder = BUILDERS.get(record.kind);
  if (!builder) return null;
  return builder(record, sinks);
}

/** Test seam — reset the registry between bun:test cases. */
export function _clearBuilderRegistry(): void {
  BUILDERS.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory + reducer

export function createUndoStackState(): UndoStackState {
  return { past: [], future: [] };
}

export function undoReducer(state: UndoStackState, action: UndoAction): UndoStackState {
  switch (action.type) {
    case 'push': {
      const next = state.past.length >= MAX_DEPTH ? state.past.slice(1) : state.past;
      return { past: [...next, action.record], future: [] };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const top = state.past[state.past.length - 1];
      if (!top) return state;
      return {
        past: state.past.slice(0, -1),
        future: [...state.future, top],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const top = state.future[state.future.length - 1];
      if (!top) return state;
      return {
        past: [...state.past, top],
        future: state.future.slice(0, -1),
      };
    }
    case 'clear':
      return createUndoStackState();
    case 'hydrate':
      return action.state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Selectors — keep state-shape inspection out of consumers.

export function canUndo(state: UndoStackState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: UndoStackState): boolean {
  return state.future.length > 0;
}

/** Top of `past` — the record an `undo` will invert. */
export function peekUndo(state: UndoStackState): CommandRecord | null {
  return state.past[state.past.length - 1] ?? null;
}

/** Top of `future` — the record a `redo` will re-apply. */
export function peekRedo(state: UndoStackState): CommandRecord | null {
  return state.future[state.future.length - 1] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-iframe persistent store (DDR-050 rev 2)
//
// Lives on the topmost window of the dev-server (same-origin — all canvas
// iframes are children of /index.html). The map is keyed by canvas file path,
// so switching from Foo.tsx → Bar.tsx → Foo.tsx replays the original Foo
// history into the freshly-mounted iframe.

interface StoreHost {
  __maude_undo_stacks?: Map<string, UndoStackState>;
}

/**
 * Prefer `window.top` so all canvas iframes (children of the dev-server
 * shell) read + write the same Map. Falls back to `window` when top is
 * cross-origin — which IS the case under the T2 (9.1-A) segregated canvas
 * origin: the canvas iframe and the shell are different origins, so any
 * PROPERTY access on `window.top` throws SecurityError. Then `globalThis`
 * (Node / Bun test runtime where window is absent).
 *
 * Note: merely reading `window.top` (the reference) never throws — only
 * touching a property of a cross-origin window does. So the guard MUST poke a
 * property inside the try, or the cross-origin throw escapes into React render
 * (it did: the UndoStackProvider's useRef initializer crashed the whole canvas
 * mount to 0 children). Under A1 each iframe falls back to its own `window`
 * store — undo works per-session; cross-close/reopen sharing via window.top is
 * intentionally dropped for the origin isolation (see DDR-0xx / phase-9.1).
 */
function getStoreHost(): StoreHost {
  if (typeof window !== 'undefined') {
    try {
      const top = window.top;
      if (top && top !== window) {
        // Poke a property — throws if `top` is a cross-origin window.
        void (top as unknown as StoreHost).__maude_undo_stacks;
        return top as unknown as StoreHost;
      }
      return window as unknown as StoreHost;
    } catch {
      return window as unknown as StoreHost;
    }
  }
  return globalThis as unknown as StoreHost;
}

function ensureStoreMap(): Map<string, UndoStackState> {
  const host = getStoreHost();
  if (!host.__maude_undo_stacks) host.__maude_undo_stacks = new Map();
  return host.__maude_undo_stacks;
}

// ── Durable layer: sessionStorage (DDR-050 follow-up) ────────────────────────
// The window/window.top Map above is the fast in-memory path, but it lives on a
// window object — and in the segregated canvas origin (DDR-054) that IS the
// canvas iframe's OWN window, which a full iframe reload destroys. An artboard
// TEXT edit rewrites the `.tsx` → HMR reload of the canvas iframe → the Map is
// wiped → Cmd+Z after the edit finds an empty stack. (Annotation edits write a
// sidecar SVG, never reload the iframe, so their history survives — the exact
// asymmetry users hit.) sessionStorage is per-ORIGIN and survives a reload, so
// it's the durable backstop: every save mirrors here, every load falls back to
// it when the Map misses (i.e. right after a reload rebuilt the window).
const SS_PREFIX = 'maude-undo:';
const SS_MAX_BYTES = 512 * 1024;

function getSessionStore(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null; // sessionStorage can throw in sandboxed / disabled contexts
  }
}

// DDR-054 §2g — strip dangerous keys at parse time so a poisoned sessionStorage
// entry can't seed `__proto__` / `constructor` / `prototype` own-properties into
// a rehydrated record (mirrors the sync-lane reviver, sync/codec.ts).
function parseJsonSafe(s: string): unknown {
  return JSON.parse(s, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });
}

/** A well-formed persisted record — `kind`/`label` strings, a `payload`
 *  property present. Rejects a malformed/poisoned sessionStorage entry BEFORE
 *  it can reach the command rebuilder (defence-in-depth on the durable layer —
 *  the apply boundary is already path-contained + inert-write-only). */
function isCommandRecord(v: unknown): v is CommandRecord {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as CommandRecord).kind === 'string' &&
    typeof (v as CommandRecord).label === 'string' &&
    'payload' in (v as object)
  );
}

function isUndoStackState(v: unknown): v is UndoStackState {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as UndoStackState).past) &&
    Array.isArray((v as UndoStackState).future) &&
    (v as UndoStackState).past.every(isCommandRecord) &&
    (v as UndoStackState).future.every(isCommandRecord)
  );
}

/** Load saved state for a canvas file. Returns empty state on miss. */
export function loadStackState(canvasFile: string): UndoStackState {
  const map = ensureStoreMap();
  const cached = map.get(canvasFile);
  if (cached) return cached;
  // Map missed (fresh window after an iframe reload) — restore from the durable
  // per-origin layer, then warm the Map so subsequent reads are in-memory.
  try {
    const raw = getSessionStore()?.getItem(SS_PREFIX + canvasFile);
    if (raw) {
      const parsed = parseJsonSafe(raw);
      if (isUndoStackState(parsed)) {
        map.set(canvasFile, parsed);
        return parsed;
      }
    }
  } catch {
    /* corrupt / unavailable — fall through to empty */
  }
  return createUndoStackState();
}

/** Persist state for a canvas file — to the in-memory Map AND the durable
 *  sessionStorage layer, so it survives the HMR iframe reload a text edit
 *  triggers. */
export function saveStackState(canvasFile: string, state: UndoStackState): void {
  ensureStoreMap().set(canvasFile, state);
  try {
    const s = JSON.stringify(state);
    if (s.length <= SS_MAX_BYTES) getSessionStore()?.setItem(SS_PREFIX + canvasFile, s);
  } catch {
    /* quota / serialization failure — the in-memory Map still holds it */
  }
}

/** Test seam — wipe the cross-iframe store between bun:test cases. */
export function _clearStackStore(): void {
  getStoreHost().__maude_undo_stacks = new Map();
  try {
    const ss = getSessionStore();
    if (ss) {
      for (let i = ss.length - 1; i >= 0; i--) {
        const k = ss.key(i);
        if (k?.startsWith(SS_PREFIX)) ss.removeItem(k);
      }
    }
  } catch {
    /* no sessionStorage in this runtime */
  }
}

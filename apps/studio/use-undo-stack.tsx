/**
 * @file       use-undo-stack.tsx — React Context + Provider for the undo stack
 * @scope      apps/studio/use-undo-stack.tsx
 * @purpose    Wraps the pure `undoReducer` (undo-stack.ts) in React state,
 *             owns the async runner that awaits side-effects before applying
 *             the next state transition, exposes the `lastLabel` HUD signal,
 *             AND persists the stack across canvas switches via
 *             `window.top.__maude_undo_stacks` keyed by canvas file path
 *             (DDR-050 rev 2).
 *
 * Two roles in one provider:
 *   1. **State authority** — ref-as-store synchronously between awaited
 *      side-effects (Cmd+Z at 30 Hz key-repeat needs to see its own writes).
 *   2. **Sinks registry** — descendants (DesignCanvasInner for layout,
 *      AnnotationsLayer for strokes) register their side-effect functions
 *      via `useUndoSinks().setSink(name, fn)`. The provider merges them
 *      and uses them when rebuilding commands from records.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type CommandRecord,
  type CommandSinks,
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  type EditCommand,
  loadStackState,
  rebuildCommand,
  saveStackState,
  type UndoStackState,
  undoReducer,
} from './undo-stack.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Context shape

export interface UndoStackValue {
  /**
   * Push a fresh command. The runner calls the rebuilt command's `do()` —
   * the new state is committed only after the side-effect resolves.
   * Awaiting the returned promise is optional.
   */
  push: (record: CommandRecord) => Promise<void>;
  /**
   * Record an ALREADY-APPLIED command — appends to `past` + clears `future`
   * WITHOUT running `do()`. Use when the side-effect happened outside the
   * stack (e.g. an inspector CSS commit / inline text edit that already POSTed
   * `/_api/edit-*`), so re-running `do()` would double-apply. `undo()` / `redo()`
   * still drive the command's `undo()` / `do()` normally afterwards.
   */
  record: (record: CommandRecord) => void;
  /** Undo the top of `past`. No-op when empty. */
  undo: () => Promise<void>;
  /** Redo the top of `future`. No-op when empty. */
  redo: () => Promise<void>;
  /** Drop both stacks (external edit). */
  clear: (reason?: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Most recent operation label. HUD reads this. */
  lastLabel: string | null;
  /** Monotonic counter — HUD subscribes to bump dismiss timer per op. */
  lastTick: number;
}

const UndoStackContext = createContext<UndoStackValue | null>(null);

const NOOP_VALUE: UndoStackValue = {
  push: () => Promise.resolve(),
  record: () => {},
  undo: () => Promise.resolve(),
  redo: () => Promise.resolve(),
  clear: () => {},
  canUndo: false,
  canRedo: false,
  lastLabel: null,
  lastTick: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sinks context — descendants register side-effect functions here.

export interface UndoSinksValue {
  /** Register or replace a sink. Pass `undefined` to unregister. */
  setSink: <K extends keyof CommandSinks>(key: K, fn: CommandSinks[K]) => void;
}

const UndoSinksContext = createContext<UndoSinksValue | null>(null);

const NOOP_SINKS: UndoSinksValue = { setSink: () => {} };

// The iframe survives a soft HMR swap, but its Provider does not. Keep pending
// operations serialized across that handoff; remove idle queues so this map
// retains neither closed canvases nor completed command closures.
const canvasFlights = new Map<string, Promise<void>>();

// ─────────────────────────────────────────────────────────────────────────────
// Provider

export interface UndoStackProviderProps {
  children: ReactNode;
  /**
   * Canvas file path (e.g. `.design/ui/Foo.tsx` or repo-relative). Required
   * for cross-canvas persistence — the stack is keyed by this string in the
   * `window.top.__maude_undo_stacks` Map. Two iframes with the same canvas
   * file share one stack; switching canvases gets a fresh stack keyed under
   * a different path.
   *
   * Optional only because some test harnesses mount the provider standalone;
   * an empty / undefined value disables persistence (stack is ephemeral).
   */
  canvasFile?: string;
  /**
   * Optional async-failure hook. Fires when a command's `do()` / `undo()`
   * throws or rejects. The reducer never commits the transition for a failed
   * side-effect (push: cmd not appended; undo: stays in past; redo: stays in
   * future). Defaults to a console.warn.
   */
  onCommandError?: (err: unknown, op: 'do' | 'undo', record: CommandRecord) => void;
}

export function UndoStackProvider({
  children,
  canvasFile,
  onCommandError,
}: UndoStackProviderProps) {
  // Ref is the authoritative store — the async runner reads + writes it
  // synchronously between awaited side-effects.
  const stateRef = useRef<UndoStackState>(
    canvasFile ? loadStackState(canvasFile) : { past: [], future: [] }
  );
  const [, setRenderToken] = useState(0);

  // Sinks live in a ref so writes don't churn re-renders; the runner reads
  // them on every push/undo/redo.
  const sinksRef = useRef<CommandSinks>({});

  // canvasFile ref tracks the current key — used for persistence + for
  // re-hydration when the consumer remounts under a different file.
  const fileRef = useRef<string | undefined>(canvasFile);

  // Re-hydrate state when canvasFile changes (e.g. parent shell remounts
  // the provider for a new canvas). For the typical iframe lifecycle the
  // provider unmounts entirely on canvas switch so this branch is rarely
  // hit — it's a safety net for test harnesses that swap files in place.
  useEffect(() => {
    if (canvasFile === fileRef.current) return;
    fileRef.current = canvasFile;
    stateRef.current = canvasFile ? loadStackState(canvasFile) : { past: [], future: [] };
    setRenderToken((t) => t + 1);
  }, [canvasFile]);

  const writeState = useCallback((next: UndoStackState) => {
    stateRef.current = next;
    if (fileRef.current) saveStackState(fileRef.current, next);
    setRenderToken((t) => t + 1);
  }, []);

  const [lastLabel, setLastLabel] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState(0);

  // Serialize concurrent ops. Cmd+Z held down can repeat at ~30 Hz; the
  // runner awaits each side-effect before applying state.
  const inFlightRef = useRef<Promise<void>>(Promise.resolve());

  const reportError = useCallback(
    (err: unknown, op: 'do' | 'undo', record: CommandRecord) => {
      if (onCommandError) {
        onCommandError(err, op, record);
        return;
      }
      console.warn(`[undo-stack] ${op} failed for "${record.label}":`, err);
    },
    [onCommandError]
  );

  const bumpLabel = useCallback((label: string | null) => {
    setLastLabel(label);
    setLastTick((t) => t + 1);
  }, []);

  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const file = fileRef.current;
    const previous = (file && canvasFlights.get(file)) || inFlightRef.current;
    const run = async () => {
      // The previous mount may have persisted its ACK after this mount read
      // the initial state. Re-read only at the serialized operation boundary.
      if (file) stateRef.current = loadStackState(file);
      await task();
    };
    const next = previous.then(run, run);
    const settled = next.catch(() => {
      /* swallow — per-op error already reported */
    });
    inFlightRef.current = settled;
    if (file) {
      canvasFlights.set(file, settled);
      void settled.then(() => {
        if (canvasFlights.get(file) === settled) canvasFlights.delete(file);
      });
    }
    return next;
  }, []);

  /**
   * Build a runnable EditCommand from a record using the iframe's current
   * sinks. Returns `null` when the kind isn't registered or its required
   * sink isn't bound — the runner skips the entry and bumps a label so the
   * user sees `"(skipped: …)"` in the HUD instead of silent failure.
   */
  const build = useCallback((record: CommandRecord): EditCommand | null => {
    return rebuildCommand(record, sinksRef.current);
  }, []);

  const push = useCallback(
    (record: CommandRecord): Promise<void> =>
      enqueue(async () => {
        const cmd = build(record);
        if (!cmd) {
          bumpLabel(`(skipped: ${record.kind})`);
          return;
        }
        try {
          await cmd.do();
        } catch (err) {
          reportError(err, 'do', record);
          return;
        }
        writeState(undoReducer(stateRef.current, { type: 'push', record }));
        bumpLabel(record.label);
      }),
    [enqueue, build, reportError, bumpLabel, writeState]
  );

  const record = useCallback(
    (rec: CommandRecord): void => {
      void enqueue(async () => {
        writeState(undoReducer(stateRef.current, { type: 'push', record: rec }));
        bumpLabel(rec.label);
      });
    },
    [enqueue, writeState, bumpLabel]
  );

  const undo = useCallback(
    (): Promise<void> =>
      enqueue(async () => {
        const cur = stateRef.current;
        if (!canUndoOf(cur)) return;
        const top = cur.past[cur.past.length - 1];
        if (!top) return;
        const cmd = build(top);
        if (!cmd) {
          bumpLabel(`(skipped: ${top.kind})`);
          return;
        }
        try {
          await cmd.undo();
        } catch (err) {
          reportError(err, 'undo', top);
          return;
        }
        writeState(undoReducer(stateRef.current, { type: 'undo' }));
        bumpLabel(`Undo: ${top.label}`);
      }),
    [enqueue, build, reportError, bumpLabel, writeState]
  );

  const redo = useCallback(
    (): Promise<void> =>
      enqueue(async () => {
        const cur = stateRef.current;
        if (!canRedoOf(cur)) return;
        const top = cur.future[cur.future.length - 1];
        if (!top) return;
        const cmd = build(top);
        if (!cmd) {
          bumpLabel(`(skipped: ${top.kind})`);
          return;
        }
        try {
          await cmd.do();
        } catch (err) {
          reportError(err, 'do', top);
          return;
        }
        writeState(undoReducer(stateRef.current, { type: 'redo' }));
        bumpLabel(`Redo: ${top.label}`);
      }),
    [enqueue, build, reportError, bumpLabel, writeState]
  );

  const clear = useCallback(
    (reason?: string) => {
      writeState({ past: [], future: [] });
      bumpLabel(reason ?? null);
    },
    [bumpLabel, writeState]
  );

  // External-edit invalidation. Listen for an explicit window event
  // dispatched by client/hmr.mjs when an external .meta.json change arrives.
  // The self-echo guard ignores our own PATCH bouncing back through fs-watch
  // (see canvas-lib's `__maude_last_meta_self_write_at`).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onInvalidate = (ev: Event) => {
      const w = window as unknown as { __maude_last_meta_self_write_at?: number };
      const last = w.__maude_last_meta_self_write_at ?? 0;
      if (Date.now() - last < 500) return;
      const reason =
        (ev as CustomEvent<{ reason?: string }>).detail?.reason ?? 'External edit detected';
      writeState({ past: [], future: [] });
      bumpLabel(reason);
    };
    window.addEventListener('maude:invalidate-undo', onInvalidate);
    return () => window.removeEventListener('maude:invalidate-undo', onInvalidate);
  }, [writeState, bumpLabel]);

  // Sinks API exposed via a sibling context — descendants register their
  // own side-effect functions without prop-drilling.
  const sinksApi = useMemo<UndoSinksValue>(
    () => ({
      setSink: (key, fn) => {
        if (fn === undefined) {
          delete sinksRef.current[key];
        } else {
          (sinksRef.current as Record<string, unknown>)[key] = fn as unknown;
        }
      },
    }),
    []
  );

  const value = useMemo<UndoStackValue>(
    () => ({
      push,
      record,
      undo,
      redo,
      clear,
      canUndo: canUndoOf(stateRef.current),
      canRedo: canRedoOf(stateRef.current),
      lastLabel,
      lastTick,
    }),
    // `stateRef.current` doesn't trigger memo invalidation; we depend on
    // `lastTick` (bumped by every push/undo/redo/clear) as the proxy so the
    // memoized canUndo/canRedo readouts re-evaluate on each transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push, record, undo, redo, clear, lastLabel, lastTick]
  );

  return (
    <UndoStackContext.Provider value={value}>
      <UndoSinksContext.Provider value={sinksApi}>{children}</UndoSinksContext.Provider>
    </UndoStackContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks

export function useUndoStack(): UndoStackValue {
  const ctx = useContext(UndoStackContext);
  if (!ctx) throw new Error('useUndoStack must be used inside <UndoStackProvider>');
  return ctx;
}

export function useUndoStackOptional(): UndoStackValue {
  return useContext(UndoStackContext) ?? NOOP_VALUE;
}

/**
 * Sinks-registration hook. Use a setSink call inside a useEffect — register
 * on mount, unregister on unmount.
 */
export function useUndoSinks(): UndoSinksValue {
  return useContext(UndoSinksContext) ?? NOOP_SINKS;
}

// Re-export the EditCommand type for ergonomic single-import in consumers.
export type { CommandRecord, EditCommand } from './undo-stack.ts';
export { UndoSinksContext, UndoStackContext };

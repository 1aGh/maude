import { afterEach, describe, expect, test } from 'bun:test';

import {
  _clearBuilderRegistry,
  _clearStackStore,
  type CommandRecord,
  canRedo,
  canUndo,
  createUndoStackState,
  loadStackState,
  MAX_DEPTH,
  peekRedo,
  peekUndo,
  rebuildCommand,
  registerCommand,
  saveStackState,
  undoReducer,
} from '../undo-stack.ts';

afterEach(() => {
  _clearStackStore();
});

function rec(label = 'fake', payload: unknown = null): CommandRecord {
  return { kind: 'test', label, payload };
}

describe('undoReducer', () => {
  test('push appends record to past and clears future', () => {
    const a = rec('a');
    const b = rec('b');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    expect(s.past).toEqual([a]);
    expect(s.future).toEqual([]);
    s = undoReducer(s, { type: 'push', record: b });
    expect(s.past).toEqual([a, b]);
    expect(s.future).toEqual([]);
  });

  test('double push preserves order', () => {
    const a = rec('a');
    const b = rec('b');
    const c = rec('c');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    s = undoReducer(s, { type: 'push', record: b });
    s = undoReducer(s, { type: 'push', record: c });
    expect(s.past).toEqual([a, b, c]);
  });

  test('undo pops past top into future', () => {
    const a = rec('a');
    const b = rec('b');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    s = undoReducer(s, { type: 'push', record: b });
    s = undoReducer(s, { type: 'undo' });
    expect(s.past).toEqual([a]);
    expect(s.future).toEqual([b]);
    expect(peekUndo(s)).toBe(a);
    expect(peekRedo(s)).toBe(b);
  });

  test('undo on empty is a no-op (identity)', () => {
    const s = createUndoStackState();
    const next = undoReducer(s, { type: 'undo' });
    expect(next).toBe(s);
    expect(canUndo(next)).toBe(false);
  });

  test('redo pops future top back into past', () => {
    const a = rec('a');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    s = undoReducer(s, { type: 'undo' });
    s = undoReducer(s, { type: 'redo' });
    expect(s.past).toEqual([a]);
    expect(s.future).toEqual([]);
  });

  test('redo on empty future is a no-op', () => {
    const a = rec('a');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    const next = undoReducer(s, { type: 'redo' });
    expect(next).toBe(s);
    expect(canRedo(next)).toBe(false);
  });

  test('push discards future branch (canonical undo-stack semantics)', () => {
    const a = rec('a');
    const b = rec('b');
    const c = rec('c');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    s = undoReducer(s, { type: 'push', record: b });
    s = undoReducer(s, { type: 'undo' });
    expect(s.future.length).toBe(1);
    s = undoReducer(s, { type: 'push', record: c });
    expect(s.past).toEqual([a, c]);
    expect(s.future).toEqual([]);
  });

  test('depth cap drops oldest from past (ring buffer)', () => {
    let s = createUndoStackState();
    const records: CommandRecord[] = [];
    for (let i = 0; i < MAX_DEPTH + 5; i++) {
      const r = rec(`r-${i}`);
      records.push(r);
      s = undoReducer(s, { type: 'push', record: r });
    }
    expect(s.past.length).toBe(MAX_DEPTH);
    // biome-ignore lint/style/noNonNullAssertion: records pushed sequentially above; index guaranteed in range
    expect(s.past[0]).toBe(records[5]!);
    // biome-ignore lint/style/noNonNullAssertion: records pushed sequentially above; index guaranteed in range
    expect(s.past[s.past.length - 1]).toBe(records[records.length - 1]!);
  });

  test('clear resets both stacks', () => {
    const a = rec('a');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'push', record: a });
    s = undoReducer(s, { type: 'undo' });
    s = undoReducer(s, { type: 'clear' });
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  test('hydrate replaces both stacks atomically', () => {
    const a = rec('a');
    const b = rec('b');
    let s = createUndoStackState();
    s = undoReducer(s, { type: 'hydrate', state: { past: [a, b], future: [a] } });
    expect(s.past).toEqual([a, b]);
    expect(s.future).toEqual([a]);
  });
});

describe('command builder registry', () => {
  test('registerCommand + rebuildCommand round-trip', () => {
    _clearBuilderRegistry();
    registerCommand('test', (record, sinks) => {
      const fn = sinks.layoutPatchFn as ((layout: unknown) => void) | undefined;
      if (!fn) return null;
      return {
        kind: record.kind,
        label: record.label,
        do() {
          fn(record.payload);
        },
        undo() {
          fn({ undone: true });
        },
      };
    });
    const record = rec('test-label', { foo: 'bar' });
    const built = rebuildCommand(record, { layoutPatchFn: () => {} } as never);
    expect(built).not.toBeNull();
    expect(built?.label).toBe('test-label');
  });

  test('rebuildCommand returns null for unknown kind', () => {
    _clearBuilderRegistry();
    const out = rebuildCommand({ kind: 'unknown', label: '?', payload: null }, {});
    expect(out).toBeNull();
  });

  test('rebuildCommand returns null when required sink is missing', () => {
    _clearBuilderRegistry();
    registerCommand('needs-sink', (_record, sinks) => {
      if (!sinks.layoutPatchFn) return null;
      return { kind: 'needs-sink', label: '', do() {}, undo() {} };
    });
    const out = rebuildCommand({ kind: 'needs-sink', label: '', payload: null }, {});
    expect(out).toBeNull();
  });
});

describe('cross-iframe persistence (loadStackState / saveStackState)', () => {
  test('round-trips state under a canvas file key', () => {
    const a = rec('a');
    const initial = loadStackState('ui/Foo.tsx');
    expect(initial).toEqual({ past: [], future: [] });
    saveStackState('ui/Foo.tsx', { past: [a], future: [] });
    expect(loadStackState('ui/Foo.tsx').past).toEqual([a]);
  });

  test('isolation across canvas files', () => {
    saveStackState('ui/Foo.tsx', { past: [rec('foo')], future: [] });
    saveStackState('ui/Bar.tsx', { past: [rec('bar-1'), rec('bar-2')], future: [] });
    expect(loadStackState('ui/Foo.tsx').past.length).toBe(1);
    expect(loadStackState('ui/Bar.tsx').past.length).toBe(2);
    expect(loadStackState('ui/Baz.tsx').past).toEqual([]);
  });

  test('survives a "remount" simulation — load → save → reload yields same state', () => {
    // Simulate: iframe A pushes 2 records, iframe A unmounts, iframe B
    // mounts for the same canvas → sees both records.
    saveStackState('ui/Persist.tsx', {
      past: [rec('e1'), rec('e2')],
      future: [rec('redo-me')],
    });
    // Pretend a remount happens — same window store, fresh load.
    const reloaded = loadStackState('ui/Persist.tsx');
    expect(reloaded.past.length).toBe(2);
    expect(reloaded.future.length).toBe(1);
  });

  test('survives a WINDOW-STORE WIPE via sessionStorage (split-origin iframe reload)', () => {
    // Split-origin canvas: the store lives on the iframe window, which a full
    // reload (the HMR reload a `.tsx` text edit triggers) destroys. The durable
    // sessionStorage layer must restore it. Install a fake window + sessionStorage.
    const backing = new Map<string, string>();
    const fakeSS = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => backing.set(k, v),
      removeItem: (k: string) => backing.delete(k),
      key: (i: number) => [...backing.keys()][i] ?? null,
      clear: () => backing.clear(),
      get length() {
        return backing.size;
      },
    };
    const g = globalThis as unknown as { window?: unknown };
    const prev = Object.getOwnPropertyDescriptor(g, 'window');
    g.window = { sessionStorage: fakeSS }; // no `top` → store host = this window
    try {
      _clearStackStore();
      saveStackState('ui/Split.tsx', { past: [rec('kept')], future: [] });
      expect(backing.size).toBe(1); // mirrored to sessionStorage
      // Simulate the iframe reload: the window's in-memory Map is gone.
      (g.window as { __maude_undo_stacks?: unknown }).__maude_undo_stacks = new Map();
      const restored = loadStackState('ui/Split.tsx');
      expect(restored.past.length).toBe(1);
      expect(restored.past[0]?.label).toBe('kept');
    } finally {
      _clearStackStore();
      // Exactly as found: `g.window = undefined` would leave an own `window` key behind.
      if (prev) Object.defineProperty(g, 'window', prev);
      else Reflect.deleteProperty(g, 'window');
    }
  });
});

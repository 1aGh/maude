// use-undo-stack — Provider runner contract. SSR-capture pattern + ref-as-
// store means most of the interesting state lives outside React renders,
// so we exercise the action closures directly. Pure reducer is covered in
// undo-stack.test.ts.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  _clearBuilderRegistry,
  _clearStackStore,
  type CommandRecord,
  type CommandSinks,
  loadStackState,
  registerCommand,
} from '../undo-stack.ts';
import {
  UndoStackProvider,
  useUndoSinks,
  useUndoStack,
  useUndoStackOptional,
} from '../use-undo-stack.tsx';

// Shared spy plumbing for record-builder tests below.
let doSpy: ReturnType<typeof mock>;
let undoSpy: ReturnType<typeof mock>;

beforeEach(() => {
  _clearStackStore();
  _clearBuilderRegistry();
  doSpy = mock(() => {});
  undoSpy = mock(() => {});
  // A single "test" command kind shared across this file. The builder reads
  // `sinks.layoutPatchFn` as a generic "trigger" — when present, do() and
  // undo() fire the spies; when absent, rebuild returns null.
  registerCommand('test', (record, sinks) => {
    if (!sinks.layoutPatchFn) return null;
    return {
      kind: record.kind,
      label: record.label,
      do() {
        doSpy(record.payload);
      },
      undo() {
        undoSpy(record.payload);
      },
    };
  });
});

afterEach(() => {
  _clearStackStore();
});

function rec(label: string, payload: unknown = null): CommandRecord {
  return { kind: 'test', label, payload };
}

function capture<T>(useHook: () => T, tree: (consumer: React.ReactElement) => React.ReactElement) {
  let captured: T | null = null;
  function Consumer() {
    captured = useHook();
    return null;
  }
  renderToStaticMarkup(tree(<Consumer />));
  if (!captured) throw new Error('hook did not capture a value');
  return captured;
}

/**
 * Render a provider tree and capture both the stack value and the sinks API.
 * Sinks are bound during the same SSR render via a sibling capture, so the
 * runner's first push() sees the registered sink.
 */
function captureProvider(canvasFile?: string, sinks?: Partial<CommandSinks>) {
  let stack: ReturnType<typeof useUndoStack> | null = null;
  function Inner() {
    stack = useUndoStack();
    const undoSinks = useUndoSinks();
    if (sinks) {
      for (const [k, v] of Object.entries(sinks)) {
        // biome-ignore lint/suspicious/noExplicitAny: setSink generic indexing
        undoSinks.setSink(k as never, v as any);
      }
    }
    return null;
  }
  renderToStaticMarkup(
    <UndoStackProvider canvasFile={canvasFile}>
      <Inner />
    </UndoStackProvider>
  );
  if (!stack) throw new Error('no provider value captured');
  return stack;
}

describe('use-undo-stack / contract outside provider', () => {
  test('useUndoStack() throws outside provider', () => {
    function Bare() {
      useUndoStack();
      return null;
    }
    expect(() => renderToStaticMarkup(<Bare />)).toThrow(
      /useUndoStack must be used inside <UndoStackProvider>/
    );
  });

  test('useUndoStackOptional() returns no-op value outside provider', () => {
    const value = capture(useUndoStackOptional, (child) => <>{child}</>);
    expect(value.canUndo).toBe(false);
    expect(value.canRedo).toBe(false);
    expect(value.lastLabel).toBeNull();
    expect(() => value.clear()).not.toThrow();
  });

  test('useUndoSinks() outside provider is a silent no-op', () => {
    const value = capture(useUndoSinks, (child) => <>{child}</>);
    expect(() => value.setSink('layoutPatchFn', () => {})).not.toThrow();
  });
});

describe('use-undo-stack / runner side-effects', () => {
  test('HMR replacement waits for the old provider ACK before undoing the next entry', async () => {
    const file = '.design/ui/HmrUndo.tsx';
    const seen: unknown[] = [];
    const confirmations: Array<() => void> = [];
    registerCommand('deferred', (record) => ({
      kind: record.kind,
      label: record.label,
      do() {},
      async undo() {
        seen.push(record.payload);
        if (record.payload === 'second')
          await new Promise<void>((resolve) => {
            confirmations.push(resolve);
          });
      },
    }));
    const old = captureProvider(file);
    old.record({ kind: 'deferred', label: 'first', payload: 'first' });
    old.record({ kind: 'deferred', label: 'second', payload: 'second' });
    const firstUndo = old.undo();
    // Wait until the actual side effect starts, without wall-clock timing.
    for (let i = 0; i < 10 && seen.length === 0; i++) await Promise.resolve();
    expect(seen).toEqual(['second']);
    const replacement = captureProvider(file);
    const secondUndo = replacement.undo();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const beforeAck = [...seen];
    // Release every started request, including duplicates in the failing case.
    for (const confirm of confirmations) confirm();
    await firstUndo;
    await secondUndo;
    expect(beforeAck).toEqual(['second']);
    expect(seen).toEqual(['second', 'first']);
    expect(loadStackState(file).past).toEqual([]);
    expect(loadStackState(file).future.map((r) => r.payload)).toEqual(['second', 'first']);
  });

  test('push() invokes rebuilt cmd.do() exactly once', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('move 1'));
    expect(doSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });

  test('undo() invokes cmd.undo() on the most recently pushed record', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('a', 'A'));
    await v.push(rec('b', 'B'));
    await v.undo();
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy.mock.calls[0]?.[0]).toBe('B');
  });

  test('redo() re-invokes cmd.do() on the most recently undone record', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('a', 'A'));
    await v.undo();
    await v.redo();
    expect(doSpy).toHaveBeenCalledTimes(2);
    expect(doSpy.mock.calls[1]?.[0]).toBe('A');
  });

  test('push without a registered sink skips the do() call (rebuild returned null)', async () => {
    const v = captureProvider(undefined, {}); // no sinks → builder returns null
    await v.push(rec('lonely'));
    // doSpy is the only observable signal here — `lastLabel` is React
    // state that doesn't refresh under SSR-capture.
    expect(doSpy).toHaveBeenCalledTimes(0);
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });
});

describe('use-undo-stack / record (already-applied edits)', () => {
  test('record() appends WITHOUT running do()', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    v.record(rec('inline-edit', 'X'));
    // undo() is enqueued after record(), so awaiting it flushes record first.
    await v.undo();
    expect(doSpy).toHaveBeenCalledTimes(0); // record never runs do()
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy.mock.calls[0]?.[0]).toBe('X');
  });

  test('record() then redo() (after undo) re-runs do()', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    v.record(rec('e', 'Y'));
    await v.undo();
    await v.redo();
    expect(doSpy).toHaveBeenCalledTimes(1); // only redo's do(), not the record
    expect(doSpy.mock.calls[0]?.[0]).toBe('Y');
  });

  test('record() clears the redo future', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('a', 'A')); // doSpy: 1
    await v.undo(); // future = [a]
    v.record(rec('b', 'B')); // clears future
    await v.redo(); // future empty → no-op, no extra do()
    expect(doSpy).toHaveBeenCalledTimes(1);
  });
});

describe('use-undo-stack / cross-canvas persistence', () => {
  test('history under a canvasFile survives a fresh provider mount with the same canvasFile', async () => {
    // First mount: push 2 records.
    {
      const v = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
      await v.push(rec('e1'));
      await v.push(rec('e2'));
    }
    // Second mount (simulates iframe destroy + remount for same canvas).
    const v2 = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
    expect(v2.canUndo).toBe(true);
    expect(v2.lastLabel).toBeNull(); // labels are per-mount session
    // Undo the top — should fire spy with rec('e2') payload.
    await v2.undo();
    expect(undoSpy).toHaveBeenCalledTimes(1);
  });

  test('switching canvases keeps each history independent', async () => {
    {
      const v = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
      await v.push(rec('foo-1'));
      await v.push(rec('foo-2'));
    }
    {
      const v = captureProvider('ui/Bar.tsx', { layoutPatchFn: () => {} });
      await v.push(rec('bar-1'));
    }
    // Come back to Foo.
    const v2 = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
    expect(v2.canUndo).toBe(true);
    await v2.undo();
    // The spy was called for foo-2 last (LIFO).
    const lastCall = undoSpy.mock.calls[undoSpy.mock.calls.length - 1]?.[0];
    expect(lastCall).toBeNull(); // payload is null in `rec(label)` default
  });
});

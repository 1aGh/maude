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

// p8-v1-drop: the canvas keeps NO undo stack (the legacy DDR-050 stack — undo / redo / record / the
// per-canvas sessionStorage history — went with editing/undo-mode.ts). ⌘Z is the shell's projection over
// the op log; the provider only runs a pushed command's side effect. These replace the tests that pinned
// the stack (undo, redo, record, cross-canvas persistence, the HMR ACK hand-over).
describe('use-undo-stack / no stack of its own (p8-v1-drop)', () => {
  test('push() invokes rebuilt cmd.do() exactly once', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('move 1'));
    expect(doSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });

  test('undo() / redo() after a push run nothing: the op log holds the edit', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    await v.push(rec('a', 'A'));
    await v.undo();
    await v.redo();
    expect(undoSpy).toHaveBeenCalledTimes(0);
    expect(doSpy).toHaveBeenCalledTimes(1);
  });

  test('record() keeps nothing: a later undo runs nothing', async () => {
    const v = captureProvider(undefined, { layoutPatchFn: () => {} });
    v.record(rec('inline-edit', 'X'));
    await v.undo();
    expect(doSpy).toHaveBeenCalledTimes(0);
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });

  test('push without a registered sink skips the do() call (rebuild returned null)', async () => {
    const v = captureProvider(undefined, {}); // no sinks → builder returns null
    await v.push(rec('lonely'));
    expect(doSpy).toHaveBeenCalledTimes(0);
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });

  test('nothing is kept under a canvasFile across mounts', async () => {
    {
      const v = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
      await v.push(rec('a', 'A'));
      v.record(rec('b', 'B'));
    }
    expect(loadStackState('ui/Foo.tsx')).toEqual({ past: [], future: [] });
    const again = captureProvider('ui/Foo.tsx', { layoutPatchFn: () => {} });
    await again.undo();
    expect(undoSpy).toHaveBeenCalledTimes(0);
  });
});

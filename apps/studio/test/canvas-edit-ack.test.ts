import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { EditSourceApplyFn } from '../commands/edit-source-command.ts';

// Exercise the actual effect and its cleanup, without mounting the unrelated
// canvas UI. A soft HMR remount runs cleanup while the privileged parent write
// is still in flight; it does NOT close the iframe or cancel that write.
function mountBridge() {
  const source = readFileSync(new URL('../canvas-shell.tsx', import.meta.url), 'utf8');
  const section = source.slice(source.indexOf('// Phase: inline-edit undo'));
  const effect = section.slice(
    section.indexOf('useEffect(() => {'),
    section.indexOf('}, [undoSinks]);') + '}, [undoSinks]);'.length
  );
  const js = new Bun.Transpiler({ loader: 'tsx' }).transformSync(effect);
  const listeners = new Set<(event: MessageEvent) => void>();
  const requests: Array<{ requestId: string }> = [];
  const notices: string[] = [];
  const parent = { postMessage: (data: { requestId: string }) => requests.push(data) };
  let apply: EditSourceApplyFn | undefined;
  let cleanup: (() => void) | undefined;
  const win = {
    parent,
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  };
  new Function('useEffect', 'window', 'undoSinks', 'showCanvasToast', js)(
    (fn: () => () => void) => {
      cleanup = fn();
    },
    win,
    {
      setSink: (_key: string, fn: EditSourceApplyFn | undefined) => {
        apply = fn;
      },
    },
    (message: string) => notices.push(message)
  );
  if (!apply || !cleanup) throw new Error('source edit effect was not mounted');
  return {
    apply,
    cleanup,
    notices,
    listeners,
    reply(ok: boolean, trusted = true) {
      const data = {
        dgn: 'apply-edit-result',
        requestId: requests[0]?.requestId,
        ok,
        conflict: !ok,
        error: 'changed by someone else',
      };
      for (const fn of listeners) fn({ source: trusted ? parent : {}, data } as MessageEvent);
    },
  };
}
const edit = {
  op: 'css',
  canvas: '.design/ui/Example.tsx',
  id: 'cd-1',
  key: 'fontWeight',
  value: '400',
  from: '500',
} as const;

test('an acknowledged source undo survives a soft-remount cleanup', async () => {
  const bridge = mountBridge();
  const result = Promise.resolve(bridge.apply(edit)).then(
    () => 'applied',
    (e: Error) => e.message
  );
  bridge.cleanup();
  bridge.reply(true);
  expect(await result).toBe('applied');
  expect(bridge.listeners.size).toBe(0);
});

test('a conflict arriving after soft remount retains its reason and notice', async () => {
  const bridge = mountBridge();
  const result = Promise.resolve(bridge.apply(edit)).catch((e: Error) => e.message);
  bridge.cleanup();
  bridge.reply(false);
  expect(await result).toBe('changed by someone else');
  expect(bridge.notices).toEqual(['changed by someone else']);
  expect(bridge.listeners.size).toBe(0);
});

test('a non-parent message cannot complete the write', async () => {
  const bridge = mountBridge();
  let settled = false;
  const result = Promise.resolve(bridge.apply(edit)).then(() => {
    settled = true;
  });
  bridge.reply(true, false);
  await Promise.resolve();
  expect(settled).toBe(false);
  bridge.reply(true);
  await result;
  bridge.cleanup();
  expect(bridge.listeners.size).toBe(0);
});

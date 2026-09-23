// A Cmd+Z in the canvas waits for the shell to confirm that every inspector
// write whose `record-edit` is still in flight has posted it. Without the
// barrier an undo pressed right after an edit reached disk inverted the entry
// BELOW the one on screen (surface row L18.css-undo.own-value, native lane).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => GlobalRegistrator.unregister());

async function withParent(
  run: (sent: Array<Record<string, unknown>>, parent: Window) => Promise<void>
) {
  const sent: Array<Record<string, unknown>> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) } as unknown as Window;
  const original = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => parent });
  try {
    await run(sent, parent);
  } finally {
    if (original) Object.defineProperty(window, 'parent', original);
  }
}

const reply = (source: unknown, data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));

test('undo waits for the shell to answer the barrier, not a spoofed answer', async () => {
  const { afterShellRecords } = await import('../canvas-shell.tsx');
  await withParent(async (sent, parent) => {
    let passed = false;
    const barrier = afterShellRecords(5000).then(() => {
      passed = true;
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.dgn).toBe('undo-barrier');
    const requestId = sent[0]?.requestId;
    // The canvas itself (not its parent) cannot release the barrier…
    reply(window, { dgn: 'undo-barrier-ok', requestId });
    // …nor can an answer to a different request.
    reply(parent, { dgn: 'undo-barrier-ok', requestId: 'other' });
    await new Promise((r) => setTimeout(r, 30));
    expect(passed).toBe(false);
    reply(parent, { dgn: 'undo-barrier-ok', requestId });
    await barrier;
    expect(passed).toBe(true);
  });
});

test('a shell that never answers costs a bounded wait, not the undo', async () => {
  const { afterShellRecords } = await import('../canvas-shell.tsx');
  await withParent(async () => {
    const started = performance.now();
    await afterShellRecords(60);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

test('a top-level canvas (no shell) does not wait at all', async () => {
  const { afterShellRecords } = await import('../canvas-shell.tsx');
  const started = performance.now();
  await afterShellRecords(5000);
  expect(performance.now() - started).toBeLessThan(100);
});

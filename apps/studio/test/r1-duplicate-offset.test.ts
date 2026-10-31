// r1 #15 (Michal's call, rc.1 round): ⌘D on a PLACED object puts the copy +10 px right and +10 px down of the
// original, selected, in ONE edit-op (one ⌘Z). An object in a flow keeps the v1 duplicate (`duplicate-request`).
// The real-Chromium half is test/e2e/canvas-tools.e2e.mjs (T15).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import type { EditOpAsk } from '../editing/edit-op.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('r1 #15 — ⌘D: +10 / +10, selected, one op', () => {
  test('duplicateAt: a placed object’s left / top plus 10; an object in a flow has none', async () => {
    const { duplicateAt, DUPLICATE_OFFSET } = await import('../editing/reorder-slot.tsx');
    expect(DUPLICATE_OFFSET).toBe(10);
    document.body.innerHTML = `<div id="a" style="position:absolute;left:100px;top:40px"></div><div id="b"></div>`;
    expect(duplicateAt(document.getElementById('a') as Element)).toEqual({ left: 110, top: 50 });
    expect(duplicateAt(document.getElementById('b') as Element)).toBeNull();
  });

  test('duplicateObject: a placed object is ONE reorder-to copy at +10 / +10 and the copy is selected', async () => {
    const { duplicateObject } = await import('../editing/reorder-slot.tsx');
    document.body.innerHTML = `<div data-dc-screen="a4"><div class="dc-artboard-body">
      <div data-cd-id="rect" style="position:absolute;left:100px;top:100px"></div></div></div>`;
    const el = document.querySelector('[data-cd-id="rect"]') as Element;
    const asks: EditOpAsk[] = [];
    let fellBack = false;
    const selected: unknown[] = [];
    await new Promise<void>((done) => {
      duplicateObject(
        el,
        () => {
          fellBack = true;
          done();
        },
        (created) => {
          selected.push(...created);
          done();
        },
        {
          run: async (ask) => {
            asks.push(ask);
            return {
              ok: true,
              actionId: 'a1',
              created: [{ artboard: 'a4', element: 'rect-2' }],
            } as never;
          },
        }
      );
    });
    expect(fellBack).toBe(false);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.op).toBe('object.reorder-to');
    expect(asks[0]?.params).toEqual({ position: 'after', copy: true, at: { left: 110, top: 110 } });
    expect(selected).toEqual([{ artboard: 'a4', element: 'rect-2' }]);
  });

  test('an object in a flow keeps the v1 duplicate', async () => {
    const { duplicateObject } = await import('../editing/reorder-slot.tsx');
    document.body.innerHTML = `<div data-cd-id="card"></div>`;
    let fellBack = false;
    duplicateObject(document.querySelector('[data-cd-id="card"]'), () => {
      fellBack = true;
    });
    expect(fellBack).toBe(true);
  });

  test('⌘D and the menu’s Duplicate both go through it', async () => {
    const keys = await Bun.file(new URL('../use-keyboard-discipline.tsx', import.meta.url)).text();
    const shell = await Bun.file(new URL('../canvas-shell.tsx', import.meta.url)).text();
    expect(keys).toMatch(/duplicateObject\(\s*resolveSelectionEl\(document, one\)/);
    expect(shell).toMatch(/duplicateObject\(\s*target\.el \?\? null/);
  });
});

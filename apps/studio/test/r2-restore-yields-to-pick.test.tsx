// r2-first-canvas-inspector — a shell restore never undoes a pick the shell has not heard yet.
//
// After every canvas reload the shell re-posts ITS selection on a ladder (selection-scope.js startSelectionRestore,
// rungs 250 / 450 / 1200 / 2500 / 5000 ms; the halo + artboard resync ladders in use-shell-core.jsx alike). A rung
// reads the shell's selection when it fires — but a pick made in the canvas reaches the shell only after the store's
// 50 ms debounce and a postMessage. A rung firing in that gap carried the OLD selection back into the canvas: the
// canvas replaced the fresh pick with it, cancelled the pick's pending post, and the shell never heard the pick.
// Seen as V2-8.3 first-canvas step 2 (2 of 4 runs): Desktop picked, then a ⌘-click on its headline within the gap
// before the 2500 ms rung — Desktop stayed selected and the Inspector never came.
//
// The canvas side now tells the two apart: `replaceFromShell` / `addFromShell` (the `select-by-id` handler) yield
// to a local pick that is still unposted or was posted within RESTORE_YIELD_MS, when they would change it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import {
  RESTORE_YIELD_MS,
  type Selection,
  SelectionSetProvider,
  useSelectionSet,
} from '../use-selection-set.tsx';

const FILE = '.design/ui/Landing page.tsx';
const board = (id: string): Selection => ({
  file: FILE,
  selector: `[data-dc-screen="${id}"]`,
  artboardId: id,
});
const el = (id: string): Selection => ({
  file: FILE,
  id,
  selector: `[data-cd-id="${id}"]`,
  artboardId: 'desktop',
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mount() {
  const posted: Array<{ selection: unknown }> = [];
  const target = { postMessage: (m: unknown) => void posted.push(m as { selection: unknown }) };
  let api: ReturnType<typeof useSelectionSet> | null = null;
  const Probe = () => {
    api = useSelectionSet();
    return null;
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SelectionSetProvider postTarget={target}>
        <Probe />
      </SelectionSetProvider>
    );
  });
  const get = () => api as unknown as ReturnType<typeof useSelectionSet>;
  const lastPosted = () => posted[posted.length - 1]?.selection ?? null;
  return { get, posted, lastPosted, unmount: () => act(async () => root.unmount()) };
}

describe('a shell restore yields to a fresh local pick', () => {
  test('a rung that lands inside the pick’s debounce does not put the old artboard back', async () => {
    const m = await mount();
    // the artboard pick, heard by the shell
    await act(async () => m.get().replace(board('desktop')));
    await act(async () => wait(RESTORE_YIELD_MS + 80));
    expect(m.lastPosted()).toEqual(board('desktop'));
    // ⌘-click on the headline — and, before its post leaves, the shell's ladder re-posts the artboard
    await act(async () => m.get().replace(el('desktop-headline')));
    let applied = true;
    await act(async () => {
      applied = m.get().replaceFromShell(board('desktop'));
    });
    expect(applied).toBe(false);
    await act(async () => wait(80));
    expect(m.get().selected).toEqual([el('desktop-headline')]);
    expect(m.lastPosted()).toEqual(el('desktop-headline'));
    await m.unmount();
  });

  test('just after the post (the shell may not have rendered it yet) a different restore still yields', async () => {
    const m = await mount();
    await act(async () => m.get().replace(el('desktop-headline')));
    await act(async () => wait(80)); // posted, inside the yield window
    let applied = true;
    await act(async () => {
      applied = m.get().replaceFromShell(board('desktop'));
    });
    expect(applied).toBe(false);
    expect(m.get().selected).toEqual([el('desktop-headline')]);
    await m.unmount();
  });

  test('the same selection, or a restore after the window, applies as before', async () => {
    const m = await mount();
    await act(async () => m.get().replace(el('desktop-headline')));
    let same = false;
    await act(async () => {
      same = m.get().replaceFromShell(el('desktop-headline'));
    });
    expect(same).toBe(true); // idempotent: nothing to yield to
    await act(async () => wait(RESTORE_YIELD_MS + 80));
    let later = false;
    await act(async () => {
      later = m.get().replaceFromShell(board('desktop'));
    });
    expect(later).toBe(true);
    await act(async () => wait(80));
    expect(m.get().selected).toEqual([board('desktop')]);
    expect(m.lastPosted()).toEqual(board('desktop'));
    await m.unmount();
  });

  test('a fresh canvas (nothing picked yet — the reload case the ladder exists for) takes the restore', async () => {
    const m = await mount();
    let applied = false;
    await act(async () => {
      applied = m.get().replaceFromShell(board('desktop'));
    });
    expect(applied).toBe(true);
    expect(m.get().selected).toEqual([board('desktop')]);
    // a restore is not a pick: the next rung, a moment later and different, is not refused because of it
    let next = false;
    await act(async () => {
      next = m.get().replaceFromShell(board('tablet'));
    });
    expect(next).toBe(true);
    await m.unmount();
  });

  test('addFromShell (a place that selects what it made) yields the same way', async () => {
    const m = await mount();
    await act(async () => m.get().replace(el('desktop-headline')));
    let applied = true;
    await act(async () => {
      applied = m.get().addFromShell(el('desktop-cta'));
    });
    expect(applied).toBe(false);
    expect(m.get().selected).toEqual([el('desktop-headline')]);
    await m.unmount();
  });
});

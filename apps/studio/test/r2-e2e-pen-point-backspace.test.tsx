// r2-e2e-fix — 14 ed-pen: ⌫ on a SELECTED point removes that point and nothing else. The point editor heard the key
// on document capture, the same node as the canvas's own ⌫ owner (use-keyboard-discipline.tsx, mounted at canvas
// boot, so registered FIRST): that one posted `delete-request` for the selected path before the point editor
// ran, and its stopPropagation could not stop a listener on its own node. The desktop e2e (edit-pen) saw ONE ⌫
// send `path.edit` (the point gone) and `delete-request` (the whole path gone). The editor now takes its keys
// on window capture, ahead of every document listener.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  for (const c of cleanups.splice(0)) c();
  document.body.innerHTML = '';
});

const D = 'M20 120 C 100 170, 180 170, 280 170 S 700 90, 800 50';
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function mountWithCanvasDeleteOwner() {
  // the canvas-wide ⌫ owner, registered before the point editor exists (as at canvas boot)
  const canvasDeletes: string[] = [];
  const owner = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') canvasDeletes.push(e.key);
  };
  document.addEventListener('keydown', owner, true);
  cleanups.push(() => document.removeEventListener('keydown', owner, true));

  const { SelectionSetProvider } = await import('../use-selection-set.tsx');
  const { PointEdit } = await import('../editing/pen/points.tsx');
  document.body.innerHTML = `<div data-dc-screen="post"><div class="dc-artboard-body">
    <svg data-cd-id="swoosh" data-shape="path" width="800" height="170" viewBox="0 0 800 170"
      style="position: absolute; left: 100px; top: 400px"><path d="${D}" /></svg></div></div>`;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <SelectionSetProvider postTarget={{ postMessage: () => {} }}>
        <PointEdit />
      </SelectionSetProvider>
    )
  );
  const path = document.querySelector('svg[data-shape="path"] path') as Element;
  await act(async () => {
    path.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await wait(80);
  return canvasDeletes;
}

describe('14 ed-pen: the point editor owns ⌫ / ↵ while it is open', () => {
  test('⌫ on a selected point never reaches the canvas-wide delete', async () => {
    const canvasDeletes = await mountWithCanvasDeleteOwner();
    const pt = q('edit-pen-point-0-1');
    expect(pt).not.toBeNull();
    await act(async () => {
      pt?.dispatchEvent(
        new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    });
    await wait(60);
    const before = document.querySelectorAll('.ed-pen-pt').length;
    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      );
    });
    await wait(60);
    expect(canvasDeletes).toEqual([]);
    // the point itself went
    expect(document.querySelectorAll('.ed-pen-pt').length).toBe(before - 1);
  });

  test('↵ finishes point editing and is not also the canvas’s Enter (first child)', async () => {
    const canvasDeletes = await mountWithCanvasDeleteOwner();
    expect(q('edit-pen-points')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await wait(60);
    expect(canvasDeletes).toEqual([]);
    expect(q('edit-pen-points')).toBeNull();
  });
});

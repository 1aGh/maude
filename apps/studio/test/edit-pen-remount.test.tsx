// 14 ed-pen: point editing outlives the remount its own write causes. A double-click on a point flips it and writes
// the file; the soft reload then re-renders the canvas from the file (~100 ms with the shared canvas-lib) — a fresh
// subtree whose svg is a new node and whose selection is empty. The editor comes back on the same path with the same
// point selected, so the next key (⌫) still means "this point". The desktop e2e (edit-pen) saw the chip gone.
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
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const D = 'M20 120 C 100 170, 180 170, 280 170 S 700 90, 800 50';
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function mountFresh() {
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
  await wait(80);
}

describe('14 ed-pen: point editing survives its own write’s reload', () => {
  test('a fresh editor resumes on the held path, with the held point selected', async () => {
    const { holdPointEdit } = await import('../editing/pen/points.tsx');
    const { refOfElement } = await import('../editing/object-actions.ts');
    // the svg the write was made on (gone after the reload: only its ref is held)
    const old = document.createElement('div');
    old.innerHTML = `<div data-dc-screen="post"><svg data-cd-id="swoosh" data-shape="path"><path d="${D}" /></svg></div>`;
    document.body.append(old);
    const ref = refOfElement(old.querySelector('svg') as Element);
    expect(ref).not.toBeNull();
    old.remove();
    holdPointEdit(ref as NonNullable<typeof ref>, { sub: 0, i: 1 });
    await mountFresh();
    expect(q('edit-pen-points')).not.toBeNull();
    expect(q('edit-pen-chip-type')?.textContent ?? '').toMatch(/^(Smooth|Sharp)$/);
  });

  test('a hold is taken once, and one past its time resumes nothing', async () => {
    const { holdPointEdit } = await import('../editing/pen/points.tsx');
    const { refOfElement } = await import('../editing/object-actions.ts');
    const old = document.createElement('div');
    old.innerHTML = `<div data-dc-screen="post"><svg data-cd-id="swoosh" data-shape="path"><path d="${D}" /></svg></div>`;
    document.body.append(old);
    const ref = refOfElement(old.querySelector('svg') as Element) as NonNullable<
      ReturnType<typeof refOfElement>
    >;
    old.remove();
    holdPointEdit(ref, { sub: 0, i: 1 }, Date.now() - 60_000);
    await mountFresh();
    expect(q('edit-pen-points')).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    holdPointEdit(ref, null);
    await mountFresh();
    expect(q('edit-pen-points')).not.toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await mountFresh();
    expect(q('edit-pen-points')).toBeNull();
  });
});

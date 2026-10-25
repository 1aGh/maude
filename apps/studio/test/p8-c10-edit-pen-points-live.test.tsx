// P8 stage C round 10 (14 ed-pen): point editing, mounted — a click on a point keeps the path selected and tells the shell
// WHICH point (the selection is re-posted with `data-dc-pen-point`), and a point under the pointer says Smooth or Sharp in a
// quiet tag. (The marquee rule that used to drop the selection on that click is test/p8-c10-edit-pen-click.test.ts.)
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

async function mount() {
  const { SelectionSetProvider } = await import('../use-selection-set.tsx');
  const { PointEdit } = await import('../editing/pen/points.tsx');
  document.body.innerHTML = `<div data-dc-screen="post"><div class="dc-artboard-body">
    <svg data-cd-id="swoosh" data-shape="path" width="800" height="170" viewBox="0 0 800 170"
      style="position: absolute; left: 100px; top: 400px"><path d="${D}" /></svg></div></div>`;
  const posts: unknown[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <SelectionSetProvider postTarget={{ postMessage: (m: unknown) => posts.push(m) }}>
        <PointEdit />
      </SelectionSetProvider>
    )
  );
  const path = document.querySelector('svg[data-shape="path"] path') as Element;
  await act(async () => {
    path.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await wait(80);
  return posts;
}

const last = (posts: unknown[]) => {
  const m = posts.filter((p) => (p as { dgn?: string }).dgn === 'select-set').at(-1) as
    | { selection?: { attrs?: Record<string, string> } | null }
    | undefined;
  return m?.selection?.attrs ?? null;
};

describe('14 ed-pen: point editing on the page', () => {
  test('before a point is picked the payload carries no point; picking one says which', async () => {
    const posts = await mount();
    expect(q('edit-pen-points')).not.toBeNull();
    expect(last(posts)?.['data-dc-pen-point']).toBeUndefined();
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
    await wait(120);
    expect(q('edit-pen-chip-type')?.textContent).toBe('Smooth');
    const attr = last(posts)?.['data-dc-pen-point'];
    expect(attr).toMatch(/^0,1,smooth,/);
    // the point is where the svg's box (left 100, top 400) plus the local 280,170 puts it
    expect(attr).toBe('0,1,smooth,380,570');
  });

  test('a point under the pointer says what it is, in a quiet tag; leaving it takes the tag away', async () => {
    await mount();
    const end = q('edit-pen-point-0-2');
    await act(async () => {
      end?.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
    });
    expect(q('edit-pen-chip-hover')?.textContent).toMatch(/^(Smooth|Sharp)$/);
    await act(async () => {
      end?.dispatchEvent(new window.MouseEvent('pointerout', { bubbles: true }));
    });
    expect(q('edit-pen-chip-hover')).toBeNull();
  });
});

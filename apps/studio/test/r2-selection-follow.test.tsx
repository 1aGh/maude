// r2-text-tool (UX audit design D3, user-advocate U11) — after a drag, a nudge, an undo or a redo the Inspector
// showed the object's OLD X / Y ("X 57 · Y 286" while it sat at 846): the selection payload it reads was measured
// at the pick and never again. The canvas now re-posts the same selection when a selected object's own style
// changes or it is remounted, and only then.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50));
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FIXTURE = `
<article class="dc-artboard" data-dc-screen="mobile">
  <div class="dc-artboard-body" style="position: relative">
    <div data-cd-id="rectangle" data-shape="rectangle" style="position: absolute; left: 57px; top: 286px; width: 100px; height: 100px"></div>
    <div data-cd-id="other" style="left: 1px"></div>
  </div>
</article>`;

type Posted = { dgn?: string; selection?: { authored?: Record<string, string> } | null };

async function mount() {
  const { SelectionSetProvider, useSelectionSet } = await import('../use-selection-set.tsx');
  const { SelectionFollowsDom } = await import('../editing/selection-follow.tsx');
  const { selectionOf } = await import('../editing/object-actions.ts');
  document.body.innerHTML = FIXTURE;
  const posts: Posted[] = [];
  const postTarget = { postMessage: (m: unknown) => posts.push(m as Posted) };
  let api: ReturnType<typeof useSelectionSet> | null = null;
  function Grab() {
    api = useSelectionSet();
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <SelectionSetProvider postTarget={postTarget}>
        <Grab />
        <SelectionFollowsDom />
      </SelectionSetProvider>
    );
  });
  const rect = document.querySelector('[data-cd-id="rectangle"]') as HTMLElement;
  await act(async () => api?.replace(selectionOf(rect)));
  await act(async () => new Promise((r) => setTimeout(r, 120)));
  return { posts, rect, api: () => api };
}
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const lastLeft = (posts: Posted[]) =>
  posts.filter((p) => p.dgn === 'select-set').at(-1)?.selection?.authored?.left;

describe('the Inspector reads where the object is now', () => {
  test('a drag (or a nudge) moves the selected object: the same selection is posted again, at its new X / Y', async () => {
    const { posts, rect } = await mount();
    expect(lastLeft(posts)).toBe('57px');
    rect.style.left = '846px';
    await wait(400);
    expect(lastLeft(posts)).toBe('846px');
    const last = posts.filter((p) => p.dgn === 'select-set').at(-1)?.selection as
      | { authored?: Record<string, string>; id?: string }
      | undefined;
    expect(last?.id).toBe('rectangle');
    expect(last?.authored?.top).toBe('286px');
  });

  test('an undo / redo remounts it: the new element is measured', async () => {
    const { posts, rect } = await mount();
    const again = rect.cloneNode() as HTMLElement;
    again.style.left = '12px';
    rect.replaceWith(again);
    await wait(400);
    expect(lastLeft(posts)).toBe('12px');
  });

  test('a change to something else, or to nothing the Inspector reads, posts nothing', async () => {
    const { posts, rect } = await mount();
    const before = posts.length;
    (document.querySelector('[data-cd-id="other"]') as HTMLElement).style.left = '99px';
    rect.setAttribute('class', 'dc-hovered');
    await wait(400);
    expect(posts.length).toBe(before);
  });
});

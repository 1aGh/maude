// S4.17 — the annotation list rendered: the host reads ONE canvas's board, the chips post
// `annotation-filter`, a row posts `annotation-select`, the foot names what is hidden, and the gate
// swaps the Layers panel for the list only in Preview.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const ME = { name: 'Michal' };
const sticky = (id: string, text: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  index: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  fill: '#fce8a6',
  text,
  author: { kind: 'human', name },
  ...extra,
});
const BOARD = [
  {
    id: 'sec',
    type: 'section',
    index: 'a',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    label: 'Zpětná vazba Tereza',
    author: { kind: 'human', name: 'Tereza' },
  },
  sticky('t1', 'Logo výš', 'Tereza', { parent: 'sec', index: 'b1' }),
  sticky('t2', 'Datum tučně', 'Tereza', { parent: 'sec', index: 'b2', locked: true }),
  sticky('j1', 'Jonas says', 'Jonas', { index: 'c1' }),
  sticky('m1', 'Mine', 'Michal', { index: 'c2' }),
];

const realFetch = globalThis.fetch;
let asked: string[] = [];
function installBoard(per: Record<string, unknown[]>) {
  asked = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    const file = decodeURIComponent(String(url).split('file=')[1] ?? '');
    return new Response(
      JSON.stringify({ format: 'maude-annotations', v: 2, elements: per[file] ?? [] }),
      {
        status: 200,
      }
    );
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}
const all = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const click = (el: Element | undefined) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const names = (host: HTMLElement) =>
  all(host, 'annotation-list-row').map((r) => r.querySelector('.al-name')?.textContent);
const chip = (host: HTMLElement, key: string) =>
  all(host, 'annotation-list-chip').find((c) => c.dataset.person === key);

describe('S4.17 · AnnotationListHost', () => {
  test('lists this canvas only, with the count, the section and its rows', async () => {
    installBoard({
      '.design/ui/A.tsx': BOARD,
      '.design/ui/B.tsx': [sticky('x', 'Elsewhere', 'Jonas')],
    });
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={() => {}} me={ME} />
    );
    expect(all(host, 'annotation-list-count')[0].textContent).toBe('4');
    expect(all(host, 'annotation-list-section-count')[0].textContent).toBe('2');
    expect(names(host)).toEqual(['Logo výš', 'Datum tučně', 'Jonas says', 'Mine']);
    expect(all(host, 'annotation-list-lock')).toHaveLength(1);
    // never aggregates: one read, for the open canvas
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(encodeURIComponent('.design/ui/A.tsx'));
  });

  test('a resolved sticky says so beyond its colour: a tick, a word for a screen reader, a strike (a11y A3)', async () => {
    installBoard({
      '.design/ui/A.tsx': [
        sticky('d1', 'Done thing', 'Jonas', { resolved: true }),
        sticky('o1', 'Open thing', 'Jonas'),
      ],
    });
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={() => {}} me={ME} />
    );
    const rows = all(host, 'annotation-list-row');
    const done = rows.find((r) => r.dataset.id === 'd1') as HTMLElement;
    const open = rows.find((r) => r.dataset.id === 'o1') as HTMLElement;
    expect(done.querySelector('[data-testid="annotation-list-resolved"]')?.textContent).toContain(
      'Resolved'
    );
    expect(open.querySelector('[data-testid="annotation-list-resolved"]')).toBeNull();
    const css = (await Bun.file(
      new URL('../client/v2/annotations/annotation-list.css', import.meta.url).pathname
    ).text()) as string;
    expect(css).toMatch(/\.al-row\[data-resolved\] \.al-name \{[^}]*line-through/);
  });

  test('the Tereza chip hides the rest, posts the filter, and the foot says who is hidden', async () => {
    installBoard({ '.design/ui/A.tsx': BOARD });
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const posted: unknown[] = [];
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={(m: unknown) => posted.push(m)} me={ME} />
    );
    await click(chip(host, 'h:Tereza'));
    expect(names(host)).toEqual(['Logo výš', 'Datum tučně']);
    expect(all(host, 'annotation-list-count')[0].textContent).toBe('4'); // the filter hides, it does not remove
    expect(all(host, 'annotation-list-foot')[0].textContent).toBe(
      'Hidden by the filter: Jonas 1 · You 1'
    );
    expect(posted.at(-1)).toEqual({ dgn: 'annotation-filter', v: 1, authors: ['h:Tereza'] });
    await click(chip(host, 'everyone'));
    expect(all(host, 'annotation-list-foot')).toHaveLength(0);
    expect(all(host, 'annotation-list-row')).toHaveLength(4);
    expect(posted.at(-1)).toEqual({ dgn: 'annotation-filter', v: 1, authors: [] });
  });

  test('a row posts annotation-select; a locked selection offers Unlock', async () => {
    installBoard({ '.design/ui/A.tsx': BOARD });
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const posted: unknown[] = [];
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={(m: unknown) => posted.push(m)} me={ME} />
    );
    await click(all(host, 'annotation-list-row')[1]); // the locked one
    expect(posted.at(-1)).toEqual({ dgn: 'annotation-select', v: 1, ids: ['t2'] });
    expect(all(host, 'annotation-locked-toolbar')).toHaveLength(1);
    await click(host.querySelector('[data-testid="annotation-locked-toolbar"] button'));
    expect(posted.at(-1)).toEqual({ dgn: 'run-action', v: 1, id: 'annotation.lock' });
    await click(all(host, 'annotation-list-row')[0]);
    expect(all(host, 'annotation-locked-toolbar')).toHaveLength(0);
  });

  test('the twisty folds a section without touching the board', async () => {
    installBoard({ '.design/ui/A.tsx': BOARD });
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={() => {}} me={ME} />
    );
    await click(host.querySelector('.al-tw'));
    expect(all(host, 'annotation-list-row').map((r) => r.dataset.id)).toEqual(['j1', 'm1']);
    expect(all(host, 'annotation-list-section-count')[0].textContent).toBe('2');
  });

  test('an unreadable board says so and offers Try again', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 409 })) as unknown as typeof fetch;
    const { AnnotationListHost } = await import('../client/v2/annotations/annotation-list.jsx');
    const host = await mount(
      <AnnotationListHost file=".design/ui/A.tsx" post={() => {}} me={ME} />
    );
    expect(host.textContent).toContain('Couldn’t read the annotations.');
  });
});

describe('S4.17 · the mount', () => {
  test('Preview swaps the Layers panel for the list; Edit and other panels keep their children', async () => {
    installBoard({ '.design/ui/A.tsx': BOARD });
    const { AnnotationLayersGate } = await import('../client/v2/annotations/annotation-list.jsx');
    const { shellMode } = await import('../client/v2/shell/use-canvas-mode-lane.js');
    const kids = <p data-testid="design-tree">tree</p>;
    shellMode.select('edit');
    const host = await mount(
      <AnnotationLayersGate panel="layers" file=".design/ui/A.tsx" post={() => {}} me={ME}>
        {kids}
      </AnnotationLayersGate>
    );
    expect(all(host, 'design-tree')).toHaveLength(1);
    expect(all(host, 'annotation-list')).toHaveLength(0);

    await act(async () => {
      shellMode.select('preview');
    });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(all(host, 'design-tree')).toHaveLength(0);
    expect(all(host, 'annotation-list')).toHaveLength(1);
    expect(all(host, 'layers-panel')).toHaveLength(1);

    const other = await mount(
      <AnnotationLayersGate panel="inspector" file=".design/ui/A.tsx" post={() => {}} me={ME}>
        {kids}
      </AnnotationLayersGate>
    );
    expect(all(other, 'design-tree')).toHaveLength(1);
    await act(async () => {
      shellMode.select('edit');
    });
  });
});

// gate-b-c4h — the shell's half of "a canvas importing another canvas opens read-only":
//
//  · canvas-url.js frames such a canvas `ro=1` (and no `cm=1`: its frame writes no comment either),
//    from the index's `canvasImportsCanvases`; any other canvas's URL is unchanged;
//  · the callout stack says why, once, quietly (info, no action), while that canvas is the open one;
//    closing it hides it for that canvas and those imports only.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasImportsOf, canvasUrl } from '../client/canvas-url.js';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { ShellCallouts } from '../client/v2/shell/callouts-host.jsx';
import { calloutStack, canvasImportsCallout } from '../client/v2/shell/callouts-model.js';

const A = '.design/ui/imp-b.tsx';
const H = '.design/ui/uses-helper.tsx';
const cfg = { designRel: '.design', canvasImportsCanvases: { [A]: ['ui/canary-b-zx.tsx'] } };
const params = (url: string) => new URL(url, 'http://x').searchParams;

describe('canvas-url — the frame boots read-only', () => {
  test('a canvas importing another canvas gets ro=1 and no cm=1, whatever the role', () => {
    for (const c of [cfg, { ...cfg, readOnly: true, canComment: true }]) {
      const p = params(canvasUrl(A, c));
      expect(p.get('ro')).toBe('1');
      expect(p.get('cm')).toBeNull();
    }
  });
  test('a canvas importing only helpers is unchanged', () => {
    expect(params(canvasUrl(H, cfg)).get('ro')).toBeNull();
    expect(canvasUrl(H, cfg)).toBe(canvasUrl(H, { designRel: '.design' }));
  });
  test('a malformed map names nothing', () => {
    expect(canvasImportsOf({ canvasImportsCanvases: { [A]: 'ui/b.tsx' } }, A)).toEqual([]);
    expect(canvasImportsOf({ canvasImportsCanvases: { [A]: [1, '', 'ui/b.tsx'] } }, A)).toEqual([
      'ui/b.tsx',
    ]);
    expect(canvasImportsOf(null, A)).toEqual([]);
  });
});

describe('the callout — what happened · what to do', () => {
  test('one import: names it, info, no action', () => {
    const c = canvasImportsCallout(A, ['ui/canary-b-zx.tsx']);
    expect(c).toMatchObject({ kind: 'canvas-imports', tone: 'info' });
    expect(c?.title).toBe(
      'This canvas imports another canvas (ui/canary-b-zx.tsx), so it opens read-only.'
    );
    expect(c?.detail).toBe('Move the shared part into a component file to edit here.');
    expect((c as { action?: unknown }).action).toBeUndefined();
  });
  test('several imports read for one and for many', () => {
    expect(canvasImportsCallout(A, ['ui/b.tsx', 'ui/c.tsx'])?.title).toContain(
      '(ui/b.tsx and 1 other)'
    );
    expect(canvasImportsCallout(A, ['ui/b.tsx', 'ui/c.tsx', 'ui/d.tsx'])?.title).toContain(
      '(ui/b.tsx and 2 others)'
    );
  });
  test('nothing for a canvas without canvas imports; the stack carries it when there are', () => {
    expect(canvasImportsCallout(H, [])).toBeNull();
    expect(canvasImportsCallout(null, ['ui/b.tsx'])).toBeNull();
    const items = calloutStack({ activeCanvas: A, canvasImports: ['ui/b.tsx'] });
    expect(items.map((i) => i.kind)).toEqual(['canvas-imports']);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
async function mount(activePath: string) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const core = {
    activePath,
    cfg,
    gitLifecycle: null,
    setGitLifecycle: () => {},
    setUpdateReady: () => {},
    syncStatus: null,
    updateReady: null,
  };
  await act(async () => {
    root?.render(
      <ShellStoreContext.Provider value={{ shellCore: core } as never}>
        <ShellCallouts />
      </ShellStoreContext.Provider>
    );
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('the host', () => {
  test('the open canvas imports another canvas: the notice is on the stack', async () => {
    await mount(A);
    expect(q('callout-canvas-imports')?.textContent).toContain(
      'This canvas imports another canvas (ui/canary-b-zx.tsx), so it opens read-only.'
    );
    expect(q('callout-canvas-imports-action')).toBeNull();
    await act(async () => {
      q('callout-canvas-imports-dismiss')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    expect(q('callout-canvas-imports')).toBeNull();
  });
  test('a helper-only canvas: no notice', async () => {
    await mount(H);
    expect(q('callout-canvas-imports')).toBeNull();
  });
});

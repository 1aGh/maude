// r4 #2 — a picture dropped in Preview (Michal: "abych mohl neco pridat do canvasu jako annotation") becomes an
// annotation on the board, never an edit of the design: an Assets tile on the catcher asks the canvas for an
// annotation picture (`insert-annotation-media`, placed at the drop point), and a Finder drop over an artboard is
// left to the annotation layer's own media intake instead of FinderDrop's design write. Edit keeps both as they were.
// The OS half (a hidden tab above the active one took every drag) is apps/desktop/scripts/check-real-drop.mjs +
// tabs.rs `tab_visibility_goes_through_set_tab_shown`.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { annotationDropPoint } from '../annotations-layer.tsx';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import {
  _createSessionForTest,
  createCatcherLane,
} from '../client/v2/assets/asset-drop-session.js';
import { FinderDrop } from '../editing/finder-drop.tsx';
import { SelectionSetProvider } from '../use-selection-set.tsx';

describe('the catcher lane in Preview: the dragged picture becomes an annotation', () => {
  const setup = (preview: boolean) => {
    const session = _createSessionForTest();
    const posts: Array<Record<string, unknown>> = [];
    const placed: unknown[] = [];
    const lane = createCatcherLane({
      session,
      canvas: () => 'ui/feed.tsx',
      post: (m: Record<string, unknown>) => posts.push(m),
      accept: () => null,
      place: async (req: unknown) => {
        placed.push(req);
        return { ok: true, created: [] };
      },
      preview: () => preview,
    });
    return { session, posts, placed, lane };
  };

  test('Preview: the drop point, then insert-annotation-media with the DRAGGED path; nothing asked of the design', () => {
    const { session, posts, placed, lane } = setup(true);
    session.begin({ asset: 'assets/a.png', w: 40, h: 30 });
    expect(lane.drop(200.4, 150.6)).toBeNull();
    expect(posts).toEqual([
      { dgn: 'asset-drag-over', x: 200, y: 151 },
      { dgn: 'insert-annotation-media', paths: ['assets/a.png'] },
    ]);
    expect(placed).toEqual([]);
    expect(lane.pendingId()).toBeNull();
  });

  test('Edit: unchanged — the canvas is asked what lies there (asset-drop-at)', () => {
    const { session, posts, lane } = setup(false);
    session.begin({ asset: 'assets/a.png' });
    const id = lane.drop(10, 20);
    expect(typeof id).toBe('string');
    expect(posts.at(-1)).toEqual({ dgn: 'asset-drop-at', requestId: id, x: 10, y: 20 });
  });

  test('the canvas keeps the last drag point for a moment, so the annotation lands where it was dropped', () => {
    const at = annotationDropPoint();
    expect(at.take(1000)).toBeNull();
    at.see({ x: 12, y: 34 }, 1000);
    expect(at.take(1500)).toEqual({ x: 12, y: 34 });
    expect(at.take(1500)).toBeNull(); // one drop uses it once
    at.see({ x: 1, y: 2 }, 1000);
    expect(at.take(1000 + 5000)).toBeNull(); // a stale point (a drag that ended long ago) is not reused
    at.see({ x: 1, y: 2 }, 1000);
    at.see(null, 1100); // the drag left the canvas
    expect(at.take(1200)).toBeNull();
  });
});

describe('FinderDrop in Preview leaves the drop to the annotation layer', () => {
  const roots: Root[] = [];
  const fakeParent = { postMessage: () => {} };
  let realParent: PropertyDescriptor | undefined;
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  const setMode = (mode: string) => {
    const store = canvasModeStore(window);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: store.get().modeSeq + 1,
            mode,
            present: null,
            caps: { edit: true, annotate: true, comment: true },
          },
        })
      );
    });
  };
  const artboard = () => {
    const art = document.createElement('article');
    art.setAttribute('data-dc-screen', 'match');
    art.innerHTML = '<header class="dc-artboard-label">Match</header>';
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    art.appendChild(body);
    document.body.appendChild(art);
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [
      body,
      art,
    ];
  };
  const mount = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <SelectionSetProvider postTarget={null}>
          <FinderDrop />
        </SelectionSetProvider>
      );
    });
  };
  const drag = (type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
      clientX?: number;
      clientY?: number;
    };
    e.dataTransfer = {
      types: ['Files'],
      items: [{ kind: 'file', type: 'image/png' }],
      files: [new File(['x'], 'a.png', { type: 'image/png' })],
      dropEffect: 'none',
    };
    e.clientX = 5;
    e.clientY = 5;
    return e;
  };

  test('Edit: a photo over an artboard is FinderDrop’s (it lights up, takes the event)', async () => {
    setMode('edit');
    artboard();
    await mount();
    const e = drag('dragover');
    await act(async () => {
      document.body.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-testid="edit-drop-hint"]')).not.toBeNull();
  });

  test('Preview: the same dragover and drop pass through untaken, no hint', async () => {
    setMode('preview');
    artboard();
    await mount();
    const over = drag('dragover');
    const drop = drag('drop');
    let reachedBelow = 0;
    const below = () => reachedBelow++;
    document.addEventListener('dragover', below);
    document.addEventListener('drop', below);
    await act(async () => {
      document.body.dispatchEvent(over);
      document.body.dispatchEvent(drop);
    });
    document.removeEventListener('dragover', below);
    document.removeEventListener('drop', below);
    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(reachedBelow).toBe(2);
    expect(document.querySelector('[data-testid="edit-drop-hint"]')).toBeNull();
  });
});

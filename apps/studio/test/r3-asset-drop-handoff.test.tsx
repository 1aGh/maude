// r3 — an Assets tile dropped on the canvas in WebKit (Michal: "porad mi nejde delat drag and drop z assets do canvasu").
//
// Cause, measured with a real WebKit drag (scripts/test/webkit-asset-drop.mjs): WebKit hands NO drag event of a drag the
// shell page started to a frame of another origin — the canvas never saw dragenter/dragover/drop, whatever the drag
// carried, so r1-10's plain-text twin could not help. The shell now owns the drag: a catcher over the frame takes it,
// the canvas names only what lies under the point, and the shell places the path it started dragging.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { acceptFromCanvas, acceptFromShell } from '../bridge/dgn-protocol.ts';
import {
  _createSessionForTest,
  assetDragSession,
  createCatcherLane,
  placeRequestFor,
} from '../client/v2/assets/asset-drop-session.js';
import {
  CATCHER_TESTID,
  CanvasDropCatcher,
  catcherReadOnly,
} from '../client/v2/assets/canvas-drop-catcher.jsx';
import { placeAsset } from '../client/v2/assets/place-asset.js';
import { tileDragProps } from '../client/v2/assets/tile-drag.js';
import { ASSET_DRAG_MIME } from '../editing/asset-drag.ts';
import { askForDrop, type DropTarget, dropTargetMessage } from '../editing/image-drop.tsx';

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

const tileEvent = (type: string, init: Record<string, unknown> = {}, types = [ASSET_DRAG_MIME]) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, 'dataTransfer', { value: { types, dropEffect: 'none' } });
  return ev;
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const CANVAS_ORIGIN = 'http://127.0.0.1:9999';

describe('the bridge rows: the canvas names a target, never an asset', () => {
  const fromCanvas = (data: unknown, source: unknown = 'frame') =>
    acceptFromCanvas({ origin: CANVAS_ORIGIN, source, data } as unknown as MessageEvent, {
      canvasOrigin: CANVAS_ORIGIN,
      active: 'frame' as unknown as Window,
    });

  test('asset-drop-target keeps kind + ref, strips anything else (a forged asset path)', () => {
    const m = fromCanvas({
      dgn: 'asset-drop-target',
      requestId: 'ad_1',
      asset: 'assets/evil.png',
      target: { kind: 'frame', artboard: 'post', element: 'hero', asset: 'assets/evil.png' },
    });
    expect(m).toEqual({
      dgn: 'asset-drop-target',
      requestId: 'ad_1',
      target: { kind: 'frame', artboard: 'post', element: 'hero' },
    } as never);
  });

  test('a bad kind, a missing target, or another frame is refused', () => {
    expect(
      fromCanvas({ dgn: 'asset-drop-target', requestId: 'a', target: { kind: 'x', artboard: 'p' } })
    ).toBeNull();
    expect(fromCanvas({ dgn: 'asset-drop-target', requestId: 'a' })).toBeNull();
    expect(
      fromCanvas({ dgn: 'asset-drop-target', requestId: 'a', target: null }, 'sibling')
    ).toBeNull();
  });
});

describe('the drag session (shell)', () => {
  test('only an assets/<name> path starts one; end clears it', () => {
    const s = _createSessionForTest();
    expect(s.begin({ asset: '../secret.png' })).toBeNull();
    expect(s.current()).toBeNull();
    expect(s.begin({ asset: 'assets/a.png', w: 4032, h: 3024 })).toEqual({
      asset: 'assets/a.png',
      w: 4032,
      h: 3024,
    });
    s.end();
    expect(s.current()).toBeNull();
  });

  test('a tile’s dragstart starts it and its dragend ends it', () => {
    const props = tileDragProps('assets/cafe0001.png');
    const data = new Map<string, string>();
    props.onDragStart({
      currentTarget: { querySelector: () => null },
      dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' },
    } as never);
    expect(assetDragSession.current()?.asset).toBe('assets/cafe0001.png');
    props.onDragEnd();
    expect(assetDragSession.current()).toBeNull();
  });
});

describe('the hand-off: the shell asks, the canvas answers, the SHELL places what it dragged', () => {
  const setup = () => {
    const session = _createSessionForTest();
    const posts: Array<Record<string, unknown>> = [];
    const placed: unknown[] = [];
    let canvas: string | null = 'ui/feed.tsx';
    const lane = createCatcherLane({
      session,
      canvas: () => canvas,
      post: (m: Record<string, unknown>) => posts.push(m),
      accept: (e: MessageEvent) =>
        acceptFromCanvas(e, { canvasOrigin: CANVAS_ORIGIN, active: 'frame' as unknown as Window }),
      place: async (req: unknown) => {
        placed.push(req);
        return { ok: true, created: [{ artboard: 'post', element: 'img-1' }] };
      },
    });
    const answer = (data: Record<string, unknown>, source = 'frame') =>
      lane.onMessage({
        origin: CANVAS_ORIGIN,
        source,
        data: { dgn: 'asset-drop-target', ...data },
      } as unknown as MessageEvent);
    return { session, posts, placed, lane, answer, setCanvas: (c: string | null) => (canvas = c) };
  };

  test('over → the canvas is told where (frame coordinates); no drag → nothing', () => {
    const { session, posts, lane } = setup();
    expect(lane.over(10, 10)).toBe(false);
    session.begin({ asset: 'assets/a.png' });
    lane.over(120.4, 80.6);
    lane.leave();
    expect(posts).toEqual([
      { dgn: 'asset-drag-over', x: 120, y: 81 },
      { dgn: 'asset-drag-over', x: null },
    ]);
  });

  test('drop → asset-drop-at; the answer places the DRAGGED path on the named frame, then done', async () => {
    const { session, posts, placed, lane, answer } = setup();
    session.begin({ asset: 'assets/a.png', w: 40, h: 30 });
    const id = lane.drop(200, 150);
    expect(posts.at(-1)).toEqual({ dgn: 'asset-drop-at', requestId: id, x: 200, y: 150 });
    session.end(); // dragend fires right after drop: the pending ask keeps its own copy
    await answer({
      requestId: id,
      target: { kind: 'frame', artboard: 'post', element: 'hero', asset: 'assets/evil.png' },
    });
    expect(placed).toEqual([
      {
        asset: 'assets/a.png',
        target: { canvas: 'ui/feed.tsx', artboardId: 'post', frameId: 'hero' },
        mode: 'fill',
      },
    ]);
    expect(posts.at(-1)).toEqual({
      dgn: 'asset-drop-done',
      requestId: id,
      ok: true,
      created: [{ artboard: 'post', element: 'img-1' }],
    });
  });

  test('the canvas cannot make the shell place anything unasked', async () => {
    const { session, placed, lane, answer, setCanvas } = setup();
    // no drop asked
    await answer({ requestId: 'ad_forged', target: { kind: 'artboard', artboard: 'post' } });
    // a drop asked, answered with another id, or from another frame
    session.begin({ asset: 'assets/a.png' });
    const id = lane.drop(1, 1);
    await answer({ requestId: 'ad_other', target: { kind: 'artboard', artboard: 'post' } });
    await answer({ requestId: id, target: { kind: 'artboard', artboard: 'post' } }, 'sibling');
    expect(placed).toEqual([]);
    // the right answer once places once; a replay places nothing more
    await answer({ requestId: id, target: { kind: 'artboard', artboard: 'post' } });
    await answer({ requestId: id, target: { kind: 'artboard', artboard: 'post' } });
    expect(placed.length).toBe(1);
    // the canvas switched while the answer was in flight: nothing is placed on the new one
    const id2 = lane.drop(1, 1);
    setCanvas('ui/other.tsx');
    await answer({ requestId: id2, target: { kind: 'artboard', artboard: 'post' } });
    expect(placed.length).toBe(1);
  });

  test('a refusal comes back as one line for the canvas to say', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const session = _createSessionForTest();
    const lane = createCatcherLane({
      session,
      canvas: () => 'ui/feed.tsx',
      post: (m: Record<string, unknown>) => posts.push(m),
      accept: (e: MessageEvent) =>
        acceptFromCanvas(e, { canvasOrigin: CANVAS_ORIGIN, active: 'frame' as unknown as Window }),
      place: async () => ({ ok: false, message: 'Not placed. That is locked; unlock it first.' }),
    });
    session.begin({ asset: 'assets/a.png' });
    const id = lane.drop(1, 1);
    await lane.onMessage({
      origin: CANVAS_ORIGIN,
      source: 'frame',
      data: {
        dgn: 'asset-drop-target',
        requestId: id,
        target: { kind: 'artboard', artboard: 'p' },
      },
    } as unknown as MessageEvent);
    expect(posts.at(-1)).toEqual({
      dgn: 'asset-drop-done',
      requestId: id,
      ok: false,
      message: 'Not placed. That is locked; unlock it first.',
    });
  });
});

describe('the shell’s ask is the ask the canvas’s own drop made (one image.place, same params)', () => {
  const art = () => {
    const a = document.createElement('article');
    a.setAttribute('data-dc-screen', 'post');
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    a.appendChild(body);
    const frame = document.createElement('div');
    frame.setAttribute('data-cd-id', 'hero');
    body.appendChild(frame);
    document.body.appendChild(a);
    return { a, body, frame };
  };
  const bodyOf = async (req: unknown) => {
    let sent: Record<string, unknown> | null = null;
    await placeAsset(req as never, {
      fetch: (async (_u: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return new Response(JSON.stringify({ ok: true, writeId: 'w_1', actionId: 'a1' }));
      }) as never,
    });
    return sent as unknown as Record<string, unknown>;
  };

  test('frame (fill) and bare artboard (loose, natural size)', async () => {
    const { a, body, frame } = art();
    const drag = { asset: 'assets/deadbeef.jpg', w: 4032, h: 3024 };
    for (const t of [
      { kind: 'frame', el: frame, ref: { artboard: 'post', element: 'hero' }, artboard: 'post' },
      { kind: 'artboard', el: body, ref: null, artboard: 'post' },
    ] as DropTarget[]) {
      const ask = askForDrop(drag, t);
      const sent = await bodyOf(placeRequestFor(drag, dropTargetMessage(t), 'ui/feed.tsx'));
      expect(sent).toEqual({
        file: 'ui/feed.tsx',
        op: ask.op,
        targets: ask.targets,
        params: ask.params,
      });
    }
    a.remove();
  });
});

describe('the canvas half (editing/image-drop.tsx): it rings, and answers only the shell', () => {
  test('asset-drop-at is answered with what lies at the point; a locked frame answers nothing', async () => {
    const { ImageDrop } = await import('../editing/image-drop.tsx');
    const { SelectionSetProvider } = await import('../use-selection-set.tsx');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <SelectionSetProvider>
          <ImageDrop />
        </SelectionSetProvider>
      )
    );
    const a = document.createElement('article');
    a.setAttribute('data-dc-screen', 'post');
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    a.appendChild(body);
    const frame = document.createElement('div');
    frame.setAttribute('data-cd-id', 'hero');
    body.appendChild(frame);
    document.body.appendChild(a);
    const realFrom = document.elementsFromPoint;
    document.elementsFromPoint = () => [frame, body, a];
    const answers: unknown[] = [];
    const onAnswer = (e: MessageEvent) => {
      if ((e.data as { dgn?: string })?.dgn === 'asset-drop-target') answers.push(e.data);
    };
    window.addEventListener('message', onAnswer);
    const fromShell = (data: Record<string, unknown>) =>
      window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));
    try {
      // the ring follows the shell's pointer
      await act(async () => fromShell({ dgn: 'asset-drag-over', x: 5, y: 5 }));
      expect(
        document.querySelector('[data-testid="edit-drop-target"]')?.getAttribute('data-kind')
      ).toBe('frame');
      await act(async () => fromShell({ dgn: 'asset-drag-over', x: null }));
      expect(document.querySelector('[data-testid="edit-drop-target"]')).toBeNull();
      // the drop is answered with the frame — an acceptFromShell-gated reply, never an asset
      await act(async () => {
        fromShell({ dgn: 'asset-drop-at', requestId: 'ad_7', x: 5, y: 5 });
        await tick(10);
      });
      expect(answers).toEqual([
        {
          dgn: 'asset-drop-target',
          requestId: 'ad_7',
          target: { kind: 'frame', artboard: 'post', element: 'hero' },
        },
      ]);
      // a message from anything but the shell is not this table's: nothing answered
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { dgn: 'asset-drop-at', requestId: 'ad_8', x: 5, y: 5 },
            source: null,
          })
        );
        await tick(10);
      });
      expect(answers.length).toBe(1);
      expect(
        acceptFromShell(
          new MessageEvent('message', {
            data: { dgn: 'asset-drop-at', requestId: 'x', x: 1, y: 1 },
          }),
          window
        )
      ).toBeNull();
    } finally {
      window.removeEventListener('message', onAnswer);
      document.elementsFromPoint = realFrom;
      await act(async () => root.unmount());
      host.remove();
      a.remove();
    }
  });
});

describe('the catcher (Viewport): there only while a tile is dragged, and the drop is the shell’s', () => {
  test('appears on a tile drag, takes the drop, and goes on dragend', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const posted: unknown[] = [];
    const frameEl = {
      contentWindow: { postMessage: (m: unknown) => posted.push(m) },
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    };
    await act(async () =>
      root.render(
        <CanvasDropCatcher
          frame={() => frameEl as never}
          canvas="ui/feed.tsx"
          canvasOrigin={CANVAS_ORIGIN}
        />
      )
    );
    expect(document.querySelector(`[data-testid="${CATCHER_TESTID}"]`)).toBeNull();
    await act(async () => {
      assetDragSession.begin({ asset: 'assets/a.png' });
      await tick(10);
    });
    const catcher = document.querySelector(`[data-testid="${CATCHER_TESTID}"]`) as HTMLElement;
    expect(catcher).not.toBeNull();
    await act(async () => {
      catcher.dispatchEvent(tileEvent('drop', { clientX: 300, clientY: 250 }));
    });
    expect(posted.at(-1)).toMatchObject({ dgn: 'asset-drop-at', x: 200, y: 200 });
    await act(async () => assetDragSession.end());
    expect(document.querySelector(`[data-testid="${CATCHER_TESTID}"]`)).toBeNull();
    expect(posted.at(-1)).toEqual({ dgn: 'asset-drag-over', x: null });
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('a drag the tile cannot end must not leave the catcher behind (security review r3)', () => {
  const win = () => globalThis.window as unknown as EventTarget;

  test('the session ends on a window dragend, a pointerdown, and after the idle timeout', async () => {
    const s = _createSessionForTest({ idleMs: 30 });
    s.begin({ asset: 'assets/a.png' });
    win().dispatchEvent(new Event('dragend'));
    expect(s.current()).toBeNull();
    s.begin({ asset: 'assets/a.png' });
    win().dispatchEvent(new Event('pointerdown'));
    expect(s.current()).toBeNull();
    s.begin({ asset: 'assets/a.png' });
    await tick(60);
    expect(s.current()).toBeNull();
    // a dragover keeps it alive
    s.begin({ asset: 'assets/a.png' });
    for (let i = 0; i < 4; i++) {
      await tick(15);
      s.touch();
    }
    expect(s.current()).not.toBeNull();
    s.end();
  });

  test('a drop ends it one tick later (the catcher still reads it); a stale begin timer cannot resurrect it', async () => {
    const s = _createSessionForTest();
    let n = 0;
    s.subscribe(() => n++);
    s.begin({ asset: 'assets/a.png' });
    win().dispatchEvent(new Event('drop'));
    expect(s.current()).not.toBeNull();
    await tick(5);
    expect(s.current()).toBeNull();
    // begin → end before the deferred emit: nothing is emitted for the dead drag, and no drag comes back
    const before = n;
    s.begin({ asset: 'assets/a.png' });
    s.end();
    const afterEnd = n;
    await tick(5);
    expect(n).toBe(afterEnd);
    expect(afterEnd).toBe(before + 1);
    expect(s.current()).toBeNull();
  });

  test('the catcher: a stale tile after an unmount, then a Finder drop → nothing placed, the event passes, the catcher is gone', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const posted: unknown[] = [];
    const frameEl = {
      contentWindow: { postMessage: (m: unknown) => posted.push(m) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    await act(async () =>
      root.render(
        <CanvasDropCatcher
          frame={() => frameEl as never}
          canvas="ui/feed.tsx"
          canvasOrigin={CANVAS_ORIGIN}
        />
      )
    );
    await act(async () => {
      assetDragSession.begin({ asset: 'assets/stale.png' });
      await tick(10);
    });
    const catcher = () =>
      document.querySelector(`[data-testid="${CATCHER_TESTID}"]`) as HTMLElement;
    expect(catcher()).not.toBeNull();
    // the tile unmounted: no dragend ever arrives. A Finder file is dropped on the catcher.
    const reached: Event[] = [];
    const spy = (e: Event) => reached.push(e);
    document.body.addEventListener('drop', spy);
    const finder = tileEvent('drop', { clientX: 10, clientY: 10 }, ['Files']);
    await act(async () => {
      catcher().dispatchEvent(finder);
      await tick(10);
    });
    document.body.removeEventListener('drop', spy);
    expect(posted.filter((m) => (m as { dgn?: string }).dgn === 'asset-drop-at')).toEqual([]);
    expect(finder.defaultPrevented).toBe(false);
    expect(reached.length).toBe(1); // it was not swallowed
    expect(assetDragSession.current()).toBeNull();
    expect(catcher()).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('a drop on the catcher keeps the undo step (security review r3)', () => {
  const run = async (answerBody: Record<string, unknown>) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(answerBody))) as unknown as typeof fetch;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const posted: Array<Record<string, unknown>> = [];
    const contentWindow = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const frameEl = {
      contentWindow,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    try {
      await act(async () =>
        root.render(
          <CanvasDropCatcher
            frame={() => frameEl as never}
            canvas="ui/feed.tsx"
            canvasOrigin={CANVAS_ORIGIN}
          />
        )
      );
      await act(async () => {
        assetDragSession.begin({ asset: 'assets/a.png' });
        await tick(10);
      });
      const catcher = document.querySelector(`[data-testid="${CATCHER_TESTID}"]`) as HTMLElement;
      await act(async () => {
        catcher.dispatchEvent(tileEvent('drop', { clientX: 5, clientY: 5 }));
      });
      const ask = posted.find((m) => m.dgn === 'asset-drop-at') as { requestId: string };
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: CANVAS_ORIGIN,
            source: contentWindow as never,
            data: {
              dgn: 'asset-drop-target',
              requestId: ask.requestId,
              target: { kind: 'artboard', artboard: 'post' },
            },
          })
        );
        await tick(20);
      });
      return posted;
    } finally {
      globalThis.fetch = realFetch;
      assetDragSession.end();
      await act(async () => root.unmount());
      host.remove();
    }
  };

  test('a legacy-link drop records the edit-op for ⌘Z', async () => {
    const posted = await run({ ok: true, writeId: 'w_9' });
    expect(posted.filter((m) => m.dgn === 'record-edit')).toEqual([
      { dgn: 'record-edit', payload: { op: 'edit-op', writeId: 'w_9', label: 'Place picture' } },
    ]);
  });

  test('on the op log the write is a kernel action: nothing recorded', async () => {
    const posted = await run({ ok: true, writeId: 'w_9', actionId: 'a_1' });
    expect(posted.filter((m) => m.dgn === 'record-edit')).toEqual([]);
    expect(posted.find((m) => m.dgn === 'asset-drop-done')).toMatchObject({ ok: true });
  });
});

describe('a past version or a design-system preview takes no drop', () => {
  test('catcherReadOnly', () => {
    const base = {
      readOnly: false,
      role: 'editor',
      viewing: null as { path: string } | null,
      canvasTab: 'a.tsx',
      dsPreview: null as string | null,
    };
    expect(catcherReadOnly(base)).toBe(false);
    expect(catcherReadOnly({ ...base, viewing: { path: 'a.tsx' } })).toBe(true);
    expect(catcherReadOnly({ ...base, viewing: { path: 'b.tsx' } })).toBe(false);
    // #170 D4: stepping through another system ("Preview in …") is the same live file under other tokens — a drop still places
    expect(catcherReadOnly({ ...base, dsPreview: 'Studyfi' })).toBe(false);
    expect(catcherReadOnly({ ...base, role: 'viewer' })).toBe(true);
    expect(catcherReadOnly({ ...base, readOnly: true })).toBe(true);
  });
});

describe('the Viewport raises no catcher over a canvas held at a past version', () => {
  test('a tile drag shows the catcher; the same drag while Viewing shows none', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ canvas: { path: 'ui/Smoke.tsx', state: 'present' } }),
      }) as Response) as unknown as typeof fetch;
    const { Viewport } = await import('../client/shell/viewport.jsx');
    const { shellMode } = await import('../client/v2/shell/use-canvas-mode-lane.js');
    const PATH = '.design/ui/Smoke.tsx';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const catcher = () => document.querySelector(`[data-testid="${CATCHER_TESTID}"]`);
    try {
      await act(async () =>
        root.render(
          <Viewport
            tabs={[{ path: PATH }]}
            activePath={PATH}
            registerIframe={() => {}}
            cfg={{ designRel: '.design' }}
            canvasReloadNonce={0}
            renderSignal={{}}
          />
        )
      );
      await act(async () => tick(20));
      await act(async () => {
        assetDragSession.begin({ asset: 'assets/a.png' });
        await tick(10);
      });
      expect(catcher()).not.toBeNull();
      await act(async () => assetDragSession.end());
      await act(async () => {
        shellMode.view({ at: 'r41', path: PATH, when: 'x', who: 'J' } as never);
        assetDragSession.begin({ asset: 'assets/a.png' });
        await tick(10);
      });
      expect(catcher()).toBeNull();
    } finally {
      shellMode.leaveViewing();
      assetDragSession.end();
      globalThis.fetch = realFetch;
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

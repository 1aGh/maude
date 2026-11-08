// #128 §5 (T3.6b) — the canvas half of the on-canvas pan / zoom handle for the selected video clip.
//
// `<Video>` is no `data-cd-id` element, so crop mode can not take it. The shell names the clip over `video-frame-handle`
// (its artboard, its source size, its zoom and focus); the canvas draws a frame and the whole picture's outline over that
// artboard's video, a drag pans, a corner or the wheel / pinch zooms, and on release it reports ONE `video-frame-commit`
// back — the shell writes it through the inspector's own `video.reframe` pipe. The geometry is crop mode's
// (editing/crop-geometry.ts); the renderer's `<Reframe>` box must come out the same.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { acceptFromCanvas, acceptFromShell, DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { pan } from '../editing/crop-geometry.ts';
import {
  cropOfFocus,
  focusOfCrop,
  VideoFrameHandle,
  videoBox,
  wheelZoom,
} from '../editing/video-frame-handle.tsx';
import { reframeBox } from '../video/framing.ts';

const SRC = { w: 1920, h: 1080 };
const BOX = { w: 270, h: 480 }; // a 9:16 artboard on screen

describe('the bridge rows', () => {
  const parent = {} as Window;
  const win = { parent } as unknown as Window;
  const ev = (data: unknown, source: unknown, origin = 'https://c') =>
    ({ data, source, origin }) as unknown as MessageEvent;
  const open = {
    dgn: 'video-frame-handle',
    v: 1,
    artboardId: 'reels',
    stableId: 'name:two',
    label: 'two',
    src: { w: 1920, h: 1080 },
    zoom: 1.5,
    focus: [0.3, 0.5],
  };

  test('video-frame-handle: from the shell only, a clip or a clear; junk refused whole', () => {
    expect(DGN_TABLE.s2c['video-frame-handle'].gate).toBe('parent');
    expect(acceptFromShell(ev(open, parent), win)).toEqual(open);
    const clear = { dgn: 'video-frame-handle', v: 1, artboardId: null };
    expect(acceptFromShell(ev(clear, parent), win)).toEqual(clear);
    expect(acceptFromShell(ev({ ...open, src: null }, parent), win)).toEqual({
      ...open,
      src: null,
    });
    expect(acceptFromShell(ev(open, {}), win)).toBeNull(); // not the shell
    for (const bad of [
      { zoom: 0.5 },
      { zoom: 9 },
      { focus: [0.3] },
      { focus: [0.3, 1.2] },
      { focus: ['a', 0.5] },
      { stableId: 'x'.repeat(300) },
      { stableId: 'a\u0000b' },
      { label: 'x'.repeat(200) },
      { src: { w: -1, h: 5 } },
      { artboardId: 'no spaces' },
      { v: 2 },
    ])
      expect(acceptFromShell(ev({ ...open, ...bad }, parent), win)).toBeNull();
  });

  test('video-frame-commit: from the ACTIVE canvas only, a whole report or nothing', () => {
    expect(DGN_TABLE.c2s['video-frame-commit'].gate).toBe('active');
    const active = {} as Window;
    const ctx = { canvasOrigin: 'https://c', active };
    const good = {
      dgn: 'video-frame-commit',
      v: 1,
      artboardId: 'reels',
      stableId: 'name:two',
      zoom: 2,
      focus: [0.4, 0.6],
    };
    expect(acceptFromCanvas(ev(good, active), ctx)).toEqual(good);
    expect(acceptFromCanvas(ev(good, {}), ctx)).toBeNull(); // a background frame
    expect(acceptFromCanvas(ev(good, active, 'https://evil'), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...good, zoom: 20 }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...good, focus: [0.4, 0.6, 1] }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...good, stableId: undefined }, active), ctx)).toBeNull();
  });
});

describe('the geometry is crop mode’s, and lands where the renderer draws', () => {
  test('a focus turns into the crop whose picture is the <Reframe> box (output scale)', () => {
    for (const [zoom, focus] of [
      [1, [0.5, 0.5]],
      [1, [0.3, 0.5]],
      [2, [0.7, 0.2]],
      [1.4, [0.05, 0.95]], // clamped to the picture like the renderer
    ] as const) {
      const c = cropOfFocus(BOX, SRC, zoom, focus);
      const r = reframeBox(focus, SRC, BOX, zoom);
      const fromCrop = {
        // pictureRect rule: left = (box − w) · X / 100
        left: ((BOX.w - r.width) * c.x) / 100,
        top: ((BOX.h - r.height) * c.y) / 100,
      };
      expect(c.zoom).toBe(zoom);
      expect(fromCrop.left).toBeCloseTo(r.left, 6);
      expect(fromCrop.top).toBeCloseTo(r.top, 6);
    }
  });

  test('and back: the focus is the picture point under the frame’s centre; an axis with no room keeps its value', () => {
    expect(focusOfCrop(BOX, SRC, cropOfFocus(BOX, SRC, 1, [0.3, 0.5]), [0.3, 0.5])).toEqual([
      0.3, 0.5,
    ]);
    // at 1× a 16:9 picture in a 9:16 frame is exactly as tall as the frame: y can not move, so it keeps 0.42
    expect(focusOfCrop(BOX, SRC, cropOfFocus(BOX, SRC, 1, [0.5, 0.42]), [0.5, 0.42])[1]).toBe(0.42);
  });

  test('a drag to the right moves the picture right, so the frame looks further left', () => {
    const from = cropOfFocus(BOX, SRC, 1, [0.5, 0.5]);
    const moved = pan(BOX, SRC, from, 40, 0);
    expect(focusOfCrop(BOX, SRC, moved, [0.5, 0.5])[0]).toBeLessThan(0.5);
  });

  test('the wheel: down zooms out, up zooms in, pinch is finer, held to 1–8×', () => {
    expect(wheelZoom(1, -100, false)).toBeGreaterThan(1);
    expect(wheelZoom(2, 100, false)).toBeLessThan(2);
    expect(wheelZoom(1, 100, false)).toBe(1);
    expect(wheelZoom(7.9, -10000, true)).toBe(8);
  });
});

describe('the handle on the canvas', () => {
  function artboard(id: string) {
    const el = document.createElement('div');
    el.setAttribute('data-dc-screen', id);
    const comp = document.createElement('div');
    comp.className = 'dc-video-comp';
    comp.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: BOX.w,
        height: BOX.h,
        right: 0,
        bottom: 0,
        x: 100,
        y: 50,
      }) as DOMRect;
    el.appendChild(comp);
    document.body.appendChild(el);
    return el;
  }
  const say = async (data: Record<string, unknown>) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));
    });
  };
  const OPEN = {
    dgn: 'video-frame-handle',
    v: 1,
    artboardId: 'reels',
    stableId: 'name:two',
    label: 'two',
    src: SRC,
    zoom: 1,
    focus: [0.5, 0.5],
  };

  test('the box is the artboard’s video; no video, no box', () => {
    const el = artboard('reels');
    expect(videoBox(document, 'reels')).toEqual({ left: 100, top: 50, w: BOX.w, h: BOX.h });
    expect(videoBox(document, 'other')).toBeNull();
    el.remove();
  });

  async function mount(readOnly = false) {
    const el = artboard('reels');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const sent: Array<Record<string, unknown>> = [];
    // happy-dom's window.parent is the window itself: catch what the canvas posts up, synchronously
    const w = window.parent as unknown as { postMessage: (d: unknown, o?: string) => void };
    const had = Object.hasOwn(w, 'postMessage');
    const orig = w.postMessage;
    w.postMessage = (d: unknown) => {
      if ((d as { dgn?: string })?.dgn === 'video-frame-commit')
        sent.push(d as Record<string, unknown>);
    };
    await act(async () => root.render(<VideoFrameHandle readOnly={readOnly} />));
    return {
      sent,
      done: async () => {
        if (had) w.postMessage = orig;
        else Reflect.deleteProperty(w, 'postMessage');
        await act(async () => root.unmount());
        host.remove();
        el.remove();
      },
    };
  }
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  test('the shell names the clip: frame, the picture’s outline, four corners and the tag; the clear takes it down', async () => {
    const m = await mount();
    expect(q('edit-video-frame')).toBeNull();
    await say(OPEN);
    expect(q('edit-video-frame')).not.toBeNull();
    expect(q('edit-video-frame-box')).not.toBeNull();
    expect(q('edit-video-frame-picture')).not.toBeNull();
    for (const c of ['nw', 'ne', 'se', 'sw'])
      expect(q(`edit-video-frame-handle-${c}`)).not.toBeNull();
    expect(q('edit-video-frame-tag')?.textContent).toBe('two · move and zoom');
    // the picture at 1× covers the 9:16 frame: as tall as it, wider than it, centred
    const pic = q('edit-video-frame-picture') as HTMLElement;
    expect(Number.parseFloat(pic.style.height)).toBeCloseTo(BOX.h, 3);
    expect(Number.parseFloat(pic.style.width)).toBeCloseTo((BOX.h * 16) / 9, 3);
    await say({ dgn: 'video-frame-handle', v: 1, artboardId: null });
    expect(q('edit-video-frame')).toBeNull();
    await m.done();
  });

  test('a message from anyone but the shell draws nothing; a read-only canvas never draws', async () => {
    const m = await mount();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: OPEN, source: null }));
    });
    expect(q('edit-video-frame')).toBeNull();
    await m.done();
    const ro = await mount(true);
    await say(OPEN);
    expect(q('edit-video-frame')).toBeNull();
    await ro.done();
  });

  test('drag the picture: nothing while the pointer is down, ONE report on release', async () => {
    const m = await mount();
    await say(OPEN);
    const pic = q('edit-video-frame-picture') as HTMLElement;
    await act(async () => {
      pic.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 })
      );
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, clientY: 200 }));
    });
    expect(m.sent).toEqual([]);
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 240, clientY: 200 }));
    });
    expect(m.sent.length).toBe(1);
    const r = m.sent[0] as { artboardId: string; stableId: string; zoom: number; focus: number[] };
    expect(r.artboardId).toBe('reels');
    expect(r.stableId).toBe('name:two');
    expect(r.zoom).toBe(1);
    expect(r.focus[0]).toBeLessThan(0.5);
    expect(r.focus[1]).toBe(0.5);
    await m.done();
  });

  test('a click without a drag writes nothing', async () => {
    const m = await mount();
    await say(OPEN);
    const pic = q('edit-video-frame-picture') as HTMLElement;
    await act(async () => {
      pic.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 })
      );
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 201, clientY: 200 }));
    });
    expect(m.sent).toEqual([]);
    await m.done();
  });

  test('a corner zooms (the opposite corner stays): one report with the new zoom', async () => {
    const m = await mount();
    await say(OPEN);
    const se = q('edit-video-frame-handle-se') as HTMLElement;
    const left = Number.parseFloat(se.style.left);
    const top = Number.parseFloat(se.style.top);
    await act(async () => {
      se.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: left, clientY: top })
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', { clientX: left + 200, clientY: top + 120 })
      );
      document.dispatchEvent(
        new PointerEvent('pointerup', { clientX: left + 200, clientY: top + 120 })
      );
    });
    expect(m.sent.length).toBe(1);
    expect((m.sent[0] as { zoom: number }).zoom).toBeGreaterThan(1);
    await m.done();
  });

  test('the wheel over the frame zooms and keeps the canvas camera still; it reports once it settles', async () => {
    const m = await mount();
    await say(OPEN);
    let reachedCanvas = 0;
    const camera = () => {
      reachedCanvas += 1;
    };
    document.addEventListener('wheel', camera);
    // happy-dom's WheelEvent drops clientX / clientY from its init: set them as a browser would
    const wheelAt = (x: number, y: number) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });
      Object.defineProperty(e, 'clientX', { value: x });
      Object.defineProperty(e, 'clientY', { value: y });
      return e;
    };
    const wheel = wheelAt(200, 200);
    await act(async () => {
      document.body.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(reachedCanvas).toBe(0);
    // outside the frame the wheel is the canvas's again
    await act(async () => {
      document.body.dispatchEvent(wheelAt(5, 5));
    });
    expect(reachedCanvas).toBe(1);
    expect(m.sent).toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(m.sent.length).toBe(1);
    expect((m.sent[0] as { zoom: number }).zoom).toBeGreaterThan(1);
    document.removeEventListener('wheel', camera);
    await m.done();
  });
});

describe('the shell’s lane for the reports', () => {
  test('only the active canvas, on the canvas origin, with a whole report, reaches the write', async () => {
    const { createFrameCommitLane } = await import('../client/v2/timeline/frame-handle.jsx');
    const active = {} as Window;
    const got: unknown[] = [];
    const lane = createFrameCommitLane({
      canvasOrigin: () => 'https://c',
      activeWin: () => active,
      onCommit: (m: unknown) => got.push(m),
    });
    const report = {
      dgn: 'video-frame-commit',
      v: 1,
      artboardId: 'reels',
      stableId: 'name:two',
      zoom: 1.2,
      focus: [0.4, 0.5],
    };
    const ev = (data: unknown, source: unknown, origin = 'https://c') =>
      ({ data, source, origin }) as unknown as MessageEvent;
    lane.onMessage(ev(report, active));
    lane.onMessage(ev(report, {})); // a background canvas
    lane.onMessage(ev(report, active, 'https://other'));
    lane.onMessage(ev({ ...report, focus: [2, 0] }, active));
    lane.onMessage(ev({ dgn: 'timeline-peers', peers: [] }, active));
    expect(got).toEqual([report]);
  });
});

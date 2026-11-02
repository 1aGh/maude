// P8 c6 (14 ed-ab-resize) — the inspector follows an artboard edge drag: the canvas says the size the drag asks for
// (`artboard-live-size`), the shell believes it only from the ACTIVE canvas, and the selection the inspector reads
// wears that size while the drag lasts.
import { describe, expect, test } from 'bun:test';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { createLiveSizeLane, overlayLiveSize } from '../client/v2/inspector/live-size.js';
import { liveSizeMessage } from '../editing/artboard-handles.tsx';

const win = {} as Window;
const msg = (data: Record<string, unknown>, source: unknown = win, origin = 'http://c.test') =>
  ({ data, source, origin }) as unknown as MessageEvent;
const lane = () =>
  createLiveSizeLane({
    canvasOrigin: () => 'http://c.test',
    activePath: () => '.design/a.tsx',
    frameOf: () => ({ contentWindow: win }),
  });

describe('artboard-live-size into the shell', () => {
  test('the active canvas moves the live size; null id / the end clears it', () => {
    const l = lane();
    let n = 0;
    l.subscribe(() => n++);
    l.onMessage(
      msg({ dgn: 'artboard-live-size', id: 'desktop', w: 1280, h: 1052, preset: 'Laptop' })
    );
    expect(l.get()).toEqual({ id: 'desktop', w: 1280, h: 1052, preset: 'Laptop' });
    l.onMessage(msg({ dgn: 'artboard-live-size', id: null }));
    expect(l.get()).toBeNull();
    expect(n).toBe(2);
  });

  test('another window or origin changes nothing; numbers are clamped', () => {
    const l = lane();
    l.onMessage(msg({ dgn: 'artboard-live-size', id: 'a', w: 10, h: 10 }, {} as Window));
    l.onMessage(msg({ dgn: 'artboard-live-size', id: 'a', w: 10, h: 10 }, win, 'http://evil.test'));
    expect(l.get()).toBeNull();
    l.onMessage(msg({ dgn: 'artboard-live-size', id: 'a', w: 9e9, h: -4 }));
    expect(l.get()).toMatchObject({ w: 100000, h: 1 });
  });

  test('switching canvas ends a drag', () => {
    const l = lane();
    l.onMessage(msg({ dgn: 'artboard-live-size', id: 'a', w: 800, h: 600 }));
    l.switched();
    expect(l.get()).toBeNull();
  });

  test('the overlay lays the live size over the one artboard it is about, and nothing else', () => {
    const live = { id: 'desktop', w: 1280, h: 1052, preset: 'Laptop' };
    const sel = {
      artboardId: 'desktop',
      worldW: 1440,
      worldH: 1052,
      selector: '[data-dc-screen="desktop"]',
    };
    expect(overlayLiveSize(sel, live)).toMatchObject({
      worldW: 1280,
      worldH: 1052,
      livePreset: 'Laptop',
    });
    expect(overlayLiveSize({ ...sel, artboardId: 'tablet' }, live)).toEqual({
      ...sel,
      artboardId: 'tablet',
    });
    const el = { ...sel, id: 'x1' };
    expect(overlayLiveSize(el, live)).toBe(el);
    expect(overlayLiveSize(sel, null)).toBe(sel);
    expect(overlayLiveSize(null, live)).toBeNull();
  });
});

describe('the canvas posts it', () => {
  test('the message carries the drag box and the snap name; a clear carries only a null id', () => {
    expect(
      liveSizeMessage('desktop', {
        box: { x: 0, y: 0, w: 1280, h: 1052 },
        preset: { w: 1280, label: 'Laptop' },
      } as never)
    ).toEqual({
      dgn: 'artboard-live-size',
      id: 'desktop',
      w: 1280,
      h: 1052,
      preset: 'Laptop',
    });
    expect(
      liveSizeMessage('desktop', { box: { x: 0, y: 0, w: 1111, h: 900 }, preset: null } as never)
    ).toEqual({
      dgn: 'artboard-live-size',
      id: 'desktop',
      w: 1111,
      h: 900,
      preset: null,
    });
    expect(liveSizeMessage('desktop', null)).toEqual({ dgn: 'artboard-live-size', id: null });
  });

  test('the row is live and run() / finish() send it', async () => {
    const row = (
      DGN_TABLE.c2s as Record<string, { status: string; parse: (v: unknown) => unknown }>
    )['artboard-live-size'];
    expect(row.status).toBe('live');
    expect(row.parse({ id: 'a', w: 1, h: 2, preset: null })).toBeTruthy();
    expect(row.parse({ id: 5 })).toBeNull();
    const src = await Bun.file(new URL('../editing/artboard-handles.tsx', import.meta.url)).text();
    expect(src).toContain('postLiveSize(liveSizeMessage(id, d.last))');
    expect(src).toContain('postLiveSize(liveSizeMessage(id, null))');
  });
});

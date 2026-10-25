// S4.16 (an-video, an-print) — what a sticky wears on the canvas: the time chip "0:12" and the fade off its
// range on a video artboard, "Not printed" over a print artboard. Rendered through the real scene, with the
// artboards and the clip standing where the canvas puts them (DOM `data-dc-kind`, the window's comp registry).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AnnotationScene } from '../annotations/ui/scene.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  (window as unknown as { __maudeVideoComps?: unknown }).__maudeVideoComps = undefined;
});

const sticky = (id: string, over: Record<string, unknown> = {}) => ({
  el: {
    id,
    type: 'sticky',
    index: 'a0',
    x: 0,
    y: 0,
    w: 140,
    h: 100,
    fill: '#f7c5c0',
    text: 'Logo naskočí moc brzo',
    ...over,
  },
});

async function mount(items: unknown[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(AnnotationScene, {
        items: items as never,
        interactive: false,
        quiet: false,
        editingId: null,
        edit: null,
        pending: null,
        resolveAsset: (h: string) => h,
      })
    );
  });
  return host;
}

function artboard(id: string, kind: string) {
  const el = document.createElement('article');
  el.setAttribute('data-dc-screen', id);
  el.setAttribute('data-dc-kind', kind);
  document.body.appendChild(el);
}

/** A clip on `reel`, 30 s at 30 fps, parked at `seconds`. */
function clipAt(seconds: number) {
  (window as unknown as { __maudeVideoComps: Map<string, unknown> }).__maudeVideoComps = new Map([
    [
      'videocomp-1',
      {
        id: 'videocomp-1',
        artboardId: 'reel',
        fps: 30,
        durationInFrames: 900,
        ref: { current: { getCurrentFrame: () => Math.round(seconds * 30) } },
      },
    ],
  ]);
}

const PIN = { artboard: 'reel', start: 12, end: 15 };
const node = (host: Element, id: string) => host.querySelector(`[data-id="${id}"]`) as HTMLElement;

describe('a sticky pinned to a moment of a video', () => {
  test('wears the chip "0:12", and is full while the playhead is inside its range', async () => {
    clipAt(13);
    const host = await mount([sticky('s1', { parentArtboard: 'reel', timeRange: PIN })]);
    const tag = host.querySelector('[data-pin-tag="time"]');
    expect(tag?.textContent).toBe('0:12');
    expect(node(host, 's1').getAttribute('data-pin')).toBe('on');
  });

  test('fades off its range (the CSS paints the ≈ 0.32), and the chip stays', async () => {
    clipAt(21);
    const host = await mount([sticky('s1', { parentArtboard: 'reel', timeRange: PIN })]);
    expect(node(host, 's1').getAttribute('data-pin')).toBe('off');
    expect(host.querySelector('[data-pin-tag="time"]')?.textContent).toBe('0:12');
  });

  test('an unpinned note, and a pin whose clip is not mounted, carry no fade at all', async () => {
    clipAt(21);
    const host = await mount([
      sticky('plain', { parentArtboard: 'reel' }),
      sticky('orphan', { timeRange: { artboard: 'gone', start: 1, end: 2 } }),
    ]);
    expect(node(host, 'plain').hasAttribute('data-pin')).toBe(false);
    expect(host.querySelector('[data-id="plain"] [data-pin-tag]')).toBeNull();
    // a pin without its clip still says WHEN, but is never dimmed (there is no playhead to be outside of)
    expect(node(host, 'orphan').getAttribute('data-pin')).toBe('on');
  });
});

describe('a note over a print artboard', () => {
  test('the tag is a dark pill just below the note (never on its text), not a white one above it (15 an-print)', async () => {
    const { TIME_PIN_CSS } = await import('../annotations/ui/time-pins.tsx');
    const at = TIME_PIN_CSS.indexOf('.dc-annot-pintag[data-pin-tag="print"] {');
    const rule = TIME_PIN_CSS.slice(at, TIME_PIN_CSS.indexOf('}', at));
    expect(rule).toContain('top: 100%');
    expect(rule).toContain('bottom: auto');
    expect(rule).toContain('--maude-chrome-fg-1');
  });
  test('the note is ghosted a little (the board draws .88), and a note over a screen is not', async () => {
    artboard('flyer', 'print');
    artboard('home', 'digital');
    const host = await mount([
      sticky('over-print', { parentArtboard: 'flyer' }),
      sticky('over-screen', { parentArtboard: 'home' }),
    ]);
    expect(node(host, 'over-print').hasAttribute('data-unprinted')).toBe(true);
    expect(node(host, 'over-screen').hasAttribute('data-unprinted')).toBe(false);
    const { TIME_PIN_CSS } = await import('../annotations/ui/time-pins.tsx');
    expect(TIME_PIN_CSS).toMatch(/\.dc-annot-el\[data-unprinted\] \{ opacity: 0\.88; \}/);
  });
  test('says "Not printed"; over a screen, or nothing, it says nothing', async () => {
    artboard('flyer', 'print');
    artboard('home', 'digital');
    const host = await mount([
      sticky('over-print', { parentArtboard: 'flyer' }),
      sticky('over-screen', { parentArtboard: 'home' }),
      sticky('loose'),
    ]);
    expect(host.querySelector('[data-id="over-print"] [data-pin-tag="print"]')?.textContent).toBe(
      'Not printed'
    );
    expect(host.querySelector('[data-id="over-screen"] [data-pin-tag]')).toBeNull();
    expect(host.querySelector('[data-id="loose"] [data-pin-tag]')).toBeNull();
  });
});

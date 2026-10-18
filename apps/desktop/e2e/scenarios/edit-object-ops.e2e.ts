import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.6 (artboard ed-obj-order) — the object ops on a real canvas: ⌥⌘G frame / ⇧⌘G remove frame,
 * z-order, ⇧⌘L lock (with the badge), all as bytes in the canvas `.tsx`.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is
 * on): objects are found by COORDINATES from `window.__maudeCanvasRects()` (the whiteboard toolkit's
 * manifest), clicks and chords are synthetic events dispatched on the frame's document, and every
 * assertion is on the file on disk or on a `data-testid` the editing layer draws.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-object-ops', [CANVAS]);
const source = () => readFileSync(CANVAS, 'utf8');

/** The rect (client coords inside the frame) of the first stamped element whose text starts with `text`. */
function rectOf(text: string): Promise<{ x: number; y: number; id: string | null } | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    if (!hit) return null;
    const el = frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, id: hit.cdId } : null;
  }, text);
}

/** A pointer click on the frame's document at (x, y), then a chord on its body. */
async function click(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0 })
        );
      }
    },
    x,
    y
  );
}

async function chord(key: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> {
  await browser.execute(
    (k, m) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (frame.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    mods
  );
}

const inFrame = (testid: string) =>
  browser.execute((id) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return !!frame.contentDocument?.querySelector(`[data-testid="${id}"]`);
  }, testid);

describe('object ops on a canvas (S2.6)', () => {
  before(async () => {
    await waitForSidecar();
    await (await canvasRow('smoke')).click();
  });
  after(() => fixtures.restore());

  it('⇧⌘L locks the object in the file; the pointer on it shows the badge; ⇧⌘L again unlocks', async () => {
    const report = startReport('edit-object-ops-lock');
    const h1 = await rectOf('Maude desktop E2E');
    expect(h1).not.toBeNull();
    await click(h1!.x, h1!.y);
    await chord('L', { metaKey: true, shiftKey: true });
    await browser.waitUntil(async () => /data-cd-locked/.test(source()), { timeout: 8000 });
    await browser.execute(
      (px, py) => {
        const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
        const doc = frame.contentDocument as Document;
        (doc.elementFromPoint(px, py) ?? doc.body).dispatchEvent(
          new PointerEvent('pointermove', { bubbles: true, clientX: px, clientY: py })
        );
      },
      h1!.x,
      h1!.y
    );
    await browser.waitUntil(async () => inFrame('edit-lock-badge'), { timeout: 4000 });
    await capture(report, 'locked-badge');
    await chord('L', { metaKey: true, shiftKey: true });
    await browser.waitUntil(async () => !/data-cd-locked/.test(source()), { timeout: 8000 });
  });

  it('⌥⌘G frames the selection with a NEW frame id and keeps every other id; ⇧⌘G undoes it byte for byte', async () => {
    const before = source();
    const h1 = await rectOf('Maude desktop E2E');
    await click(h1!.x, h1!.y);
    await chord('g', { metaKey: true, altKey: true, code: 'KeyG' });
    await browser.waitUntil(async () => /data-cd-id="frame"/.test(source()), { timeout: 8000 });
    expect(source()).toMatch(/display: 'flex', flexDirection: 'column'/);
    await chord('g', { metaKey: true, shiftKey: true });
    await browser.waitUntil(async () => !/data-cd-id="frame"/.test(source()), { timeout: 8000 });
    // the frame is gone; what it held is back where it was (ids the dispatcher stamped may remain)
    expect(source().replace(/ data-cd-id="[a-z0-9-]+"/g, '')).toBe(
      before.replace(/ data-cd-id="[a-z0-9-]+"/g, '')
    );
  });

  it('⌘] sends the object to the end of its parent; ⌘[ brings it back', async () => {
    const h1 = await rectOf('Maude desktop E2E');
    await click(h1!.x, h1!.y);
    const order = () => source().indexOf('smoke-h1');
    const start = order();
    await chord(']', { metaKey: true });
    await browser.waitUntil(async () => order() !== start, { timeout: 8000 });
    await chord('[', { metaKey: true });
    await browser.waitUntil(async () => order() === start, { timeout: 8000 });
  });
});

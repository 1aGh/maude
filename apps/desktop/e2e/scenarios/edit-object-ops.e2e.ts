import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
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

/**
 * A ⌘-click on the frame's document at (x, y): a bare click selects the TOP-level object (here the
 * artboard's content wrapper), ⌘ the deepest element under the pointer — the heading itself.
 */
async function click(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: px,
            clientY: py,
            button: 0,
            metaKey: true,
          })
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

/**
 * Select the object at `text`, press the chord, and wait for the file to show `done`. The file write
 * re-renders the frame a beat later and the new DOM starts with nothing selected, so a chord pressed
 * in that gap goes nowhere — select again and press again until the effect lands.
 */
async function pressOn(
  text: string,
  key: string,
  mods: Partial<KeyboardEventInit>,
  done: () => boolean
): Promise<void> {
  await browser.waitUntil(
    async () => {
      if (done()) return true;
      const at = await rectOf(text);
      if (at) {
        await click(at.x, at.y);
        await chord(key, mods);
      }
      await browser.pause(400);
      return done();
    },
    { timeout: 15000, timeoutMsg: `${key} on "${text}" never reached the file` }
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
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
  });
  after(async () => {
    fixtures.restore();
    // the unlock went through the Layers tab; hand the dock back on Files for the next spec
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-testid="panel-tab-tree"]')?.click();
    });
  });

  it('⇧⌘L locks the object in the file; the pointer on it shows the badge; ⇧⌘L again unlocks', async () => {
    const report = startReport('edit-object-ops-lock');
    const h1 = await rectOf('Maude desktop E2E');
    expect(h1).not.toBeNull();
    await click(h1!.x, h1!.y);
    await chord('L', { metaKey: true, shiftKey: true });
    await browser.waitUntil(async () => /data-cd-locked/.test(source()), { timeout: 8000 });
    // The file is written first and the frame re-renders from it a beat later (the lock attribute is
    // on the NEW element), so the pointer is moved again until the badge answers — one move at the
    // moment of the write lands on the element that is about to be replaced.
    await browser.waitUntil(
      async () => {
        await browser.execute(
          (px, py) => {
            const frame = document.querySelector(
              '[data-testid="canvas-frame"]'
            ) as HTMLIFrameElement;
            const doc = frame.contentDocument as Document;
            (doc.elementFromPoint(px, py) ?? doc.body).dispatchEvent(
              new PointerEvent('pointermove', { bubbles: true, clientX: px, clientY: py })
            );
          },
          h1!.x,
          h1!.y
        );
        await browser.pause(150);
        return inFrame('edit-lock-badge');
      },
      { timeout: 8000, timeoutMsg: 'the lock badge never showed under the pointer' }
    );
    await capture(report, 'locked-badge');
    // A click on a locked object selects its parent (feature-4 T7b), so it is the Layers row — the
    // one door the product leaves open to it — that selects the object to unlock.
    await browser.waitUntil(
      async () => {
        if (!/data-cd-locked/.test(source())) return true;
        await browser.execute(() => {
          // Layers is a tab of the left dock (Files · Layers · Assets)
          if (!document.querySelector('.sh-layer'))
            document.querySelector<HTMLElement>('[data-testid="panel-tab-layers"]')?.click();
          const lock = document.querySelector('.sh-layer-lock[data-on="true"]');
          (lock?.closest('.sh-layer') as HTMLElement | null)?.click();
        });
        await chord('L', { metaKey: true, shiftKey: true });
        await browser.pause(400);
        return !/data-cd-locked/.test(source());
      },
      { timeout: 15000, timeoutMsg: '⇧⌘L on the Layers-selected object never unlocked it' }
    );
  });

  it('⌥⌘G frames the selection with a NEW frame id and keeps every other id; ⇧⌘G undoes it byte for byte', async () => {
    const before = source();
    const h1 = await rectOf('Maude desktop E2E');
    await click(h1!.x, h1!.y);
    await chord('g', { metaKey: true, altKey: true, code: 'KeyG' });
    await browser.waitUntil(async () => /data-cd-id="frame"/.test(source()), { timeout: 8000 });
    expect(source()).toMatch(/display: 'flex', flexDirection: 'column'/);
    // the new frame is the selection after the write; a fresh ⌘-click on the heading would pick the
    // heading again, so ⇧⌘G goes to whatever the write left selected — retried like the others
    await browser.waitUntil(
      async () => {
        if (!/data-cd-id="frame"/.test(source())) return true;
        await chord('g', { metaKey: true, shiftKey: true });
        await browser.pause(400);
        return !/data-cd-id="frame"/.test(source());
      },
      { timeout: 15000, timeoutMsg: '⇧⌘G never took the frame off' }
    );
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
    await pressOn('Maude desktop E2E', ']', { metaKey: true }, () => order() !== start);
    await pressOn('Maude desktop E2E', '[', { metaKey: true }, () => order() === start);
  });
});

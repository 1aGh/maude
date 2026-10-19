import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { focusCanvasFrame, focusShell, waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { Key } from '../helpers/parity';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.20 / S2.20b (artboard ed-edge-undo) — ⌘Z is the shell's projection of the op log (V2-1.5 §5.4):
 * a ⌘Z pressed with the CANVAS focused goes to the shell (`undo-key`), the iframe keeps no durable
 * stack (no `maude-undo:` sessionStorage entry), a ⌘Z the instant after an edit undoes THAT edit
 * (the local home waits on the studio's noted write), ⇧⌘Z redoes it, and Undo history lists it.
 *
 * The fixture project has no hub, so it runs on the LOCAL home (sync/local-kernel.ts) — U21.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is
 * on): objects are found by COORDINATES from `window.__maudeCanvasRects()` (the whiteboard toolkit's
 * manifest), clicks and chords are synthetic events dispatched on the frame's document, and every
 * assertion is on the file on disk or on a shell `data-testid`. Synthetic events move no focus, so the
 * canvas is given REAL focus first (`focusCanvasFrame`): the shell runs a canvas's ⌘Z only while the
 * canvas frame holds focus in the active window (sec-a, decision maude/v2-sec-a-undo-key-focus-rate).
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const META = join(HERE, '../fixtures/project/.design/ui/Smoke.meta.json');
const fixtures = createFixtureGuard('edit-undo', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');
const locked = () => /data-cd-locked/.test(source());

/** The rect (client coords inside the frame) of the first stamped element whose text starts with `text`. */
function rectOf(text: string): Promise<{ x: number; y: number } | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    if (!hit) return null;
    const el = frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, text);
}

/** ⌘-click: a bare click selects the TOP-level object (the content wrapper); ⌘ picks the heading. */
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

/** A chord on the FRAME's body — the canvas has focus, not the shell. */
async function chord(key: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> {
  await browser.execute(
    (k, m) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (frame.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          code: 'KeyZ',
          bubbles: true,
          cancelable: true,
          ...m,
        })
      );
    },
    key,
    mods
  );
}

/** The frame's own DDR-050 stack entries in sessionStorage (op-log mode: none). */
const frameStackKeys = () =>
  browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const ss = frame.contentWindow?.sessionStorage;
    if (!ss) return -1;
    let n = 0;
    for (let i = 0; i < ss.length; i++) if (ss.key(i)?.startsWith('maude-undo:')) n++;
    return n;
  });

/** Every `undo-key` the canvas posts to the shell, counted at the shell's window. */
async function countUndoKeys(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as { __e2eUndoKeys?: number };
    w.__e2eUndoKeys = 0;
    window.addEventListener('message', (e) => {
      if ((e.data as { dgn?: string } | null)?.dgn === 'undo-key') w.__e2eUndoKeys! += 1;
    });
  });
}
const undoKeys = () =>
  browser.execute(() => (window as unknown as { __e2eUndoKeys?: number }).__e2eUndoKeys ?? 0);

async function lockHeading(): Promise<void> {
  const h1 = await rectOf('Maude desktop E2E');
  expect(h1).not.toBeNull();
  await click(h1!.x, h1!.y);
  await chord('L', { metaKey: true, shiftKey: true, code: 'KeyL' });
}

describe('⌘Z from the op log (S2.20 / S2.20b)', () => {
  before(async () => {
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await countUndoKeys();
    // The person is IN the canvas: the shell honours a canvas ⌘Z only then (sec-a). Synthetic clicks
    // and chords move no focus, so this one focus lasts the whole describe (until the palette).
    await focusCanvasFrame();
  });
  after(() => fixtures.restore());

  it('canvas-focus ⌘Z goes through the shell and undoes the edit; the frame keeps no stack', async () => {
    const report = startReport('edit-undo-canvas-focus');
    const before = source();
    await lockHeading();
    await browser.waitUntil(async () => locked(), { timeout: 8000 });
    await chord('z', { metaKey: true });
    await browser.waitUntil(async () => !locked(), { timeout: 8000 });
    expect(await undoKeys()).toBeGreaterThanOrEqual(1);
    expect(await frameStackKeys()).toBe(0);
    expect(source()).toBe(before);
    await capture(report, 'undone');
  });

  it('⇧⌘Z in the canvas redoes it', async () => {
    await chord('Z', { metaKey: true, shiftKey: true });
    await browser.waitUntil(async () => locked(), { timeout: 8000 });
    await chord('z', { metaKey: true });
    await browser.waitUntil(async () => !locked(), { timeout: 8000 });
  });

  it('a ⌘Z the instant after an edit undoes that edit, never the one before it', async () => {
    const before = source();
    await lockHeading();
    // no wait for the watcher: the press races the edit's fs event (the local home's noted write)
    await browser.waitUntil(async () => locked(), { timeout: 8000, interval: 1 });
    await chord('z', { metaKey: true });
    await browser.waitUntil(async () => !locked(), { timeout: 8000 });
    expect(source()).toBe(before);
  });

  it('Undo history lists the edit with ⌘Z on the top row', async () => {
    const report = startReport('edit-undo-history');
    await lockHeading();
    await browser.waitUntil(async () => locked(), { timeout: 8000 });
    // Menu › Edit › Undo history… (edit.undo-history), run from ⌘K like every registry action
    await focusShell();
    await browser.keys([Key.Command, 'k']);
    const input = await $('[data-testid="palette-input"]');
    await input.waitForExist({ timeout: 10_000 });
    await input.setValue('Undo history');
    await $('[data-testid="palette-row-action:edit.undo-history"]').waitForExist({
      timeout: 4000,
    });
    await browser.keys(['\uE007']); // Enter
    const popover = await $('[data-testid="undo-history"]');
    await popover.waitForDisplayed({ timeout: 8000 });
    await expect($('[data-testid="undo-history-row-0"]')).toBeDisplayed();
    await capture(report, 'popover');
    await focusCanvasFrame(); // back in the canvas for its ⌘Z
    await chord('z', { metaKey: true });
    await browser.waitUntil(async () => !locked(), { timeout: 8000 });
  });
});

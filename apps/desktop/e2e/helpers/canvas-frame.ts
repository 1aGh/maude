import { $, browser } from '@wdio/globals';
import { bringAppToFront } from './app-front';

/**
 * Switch WebDriver context INTO the active canvas iframe (`data-testid="canvas-frame"`).
 *
 * The pilot runs with MAUDE_CANVAS_ORIGIN_SPLIT=0 (set in wdio.conf.ts) so the
 * canvas iframe is SAME-ORIGIN and switchFrame works without the DDR-054/063
 * cross-origin barrier. If a future scenario must exercise the split-origin
 * canvas, this helper is where that gets handled (the cross-origin frame may be
 * un-switchable via WebDriver — that's open question 2 in the plan).
 */
export async function enterCanvasFrame(timeout = 30_000): Promise<void> {
  const frame = await $('[data-testid="canvas-frame"]');
  await frame.waitForExist({ timeout });
  await browser.switchFrame(frame);
}

/**
 * Wait until the shell's "Opening <name>…" card has cleared (the canvas posted `canvas-rendered`). A canvas can have
 * drawn its content long before that: the Design system canvas shows its swatches ~10 s (in the loaded lane) before
 * the card goes, and a click on them in between is not taken as a selection.
 */
export async function waitForCanvasOpened(timeout = 90_000): Promise<void> {
  await browser.waitUntil(async () => !(await $('[data-testid="canvas-loading"]').isExisting()), {
    timeout,
    interval: 250,
    timeoutMsg: 'the Opening card never cleared',
  });
}

/** Return WebDriver context to the top-level studio shell. */
export async function exitToTop(): Promise<void> {
  await browser.switchFrame(null);
}

/**
 * Wait until the open canvas has RENDERED: its frame is in the shell and `__maudeCanvasRects()`
 * (canvas-lib's geometry hook) lists elements. Clicking a Files-panel row only starts the load, so a
 * spec that reads an element's box straight after the click races the canvas and gets `null`.
 */
export async function waitForCanvasRects(timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
        const win = frame?.contentWindow as
          | (Window & { __maudeCanvasRects?: () => { elements?: unknown[] } })
          | null
          | undefined;
        try {
          return (win?.__maudeCanvasRects?.().elements?.length ?? 0) > 0;
        } catch {
          return false;
        }
      }),
    { timeout, interval: 250, timeoutMsg: 'the canvas never rendered (no elements in its rects)' }
  );
  await waitForCanvasSettled();
}

/**
 * Wait until what the open canvas shows has stopped MOVING: the camera places the first view a beat after the
 * elements exist (measured: the heading's box jumps ~100 px some 50 ms after `__maudeCanvasRects()` first lists it,
 * on a freshly launched app). A spec that reads a box and clicks it in that gap presses where the element WAS —
 * the frame's padding, so the wrapper is selected instead. Three equal readings 150 ms apart = settled.
 */
export async function waitForCanvasSettled(timeout = 10_000): Promise<void> {
  let last = '';
  let same = 0;
  await browser.waitUntil(
    async () => {
      const now = (await browser.execute(() => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
        const doc = frame?.contentDocument;
        if (!frame || !doc) return '';
        const f = frame.getBoundingClientRect();
        const boxes = Array.from(doc.querySelectorAll('[data-dc-screen], [data-cd-id]'))
          .slice(0, 6)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
          });
        return `${Math.round(f.width)}x${Math.round(f.height)}|${boxes.join('|')}`;
      })) as string;
      same = now !== '' && now === last ? same + 1 : 0;
      last = now;
      return same >= 2;
    },
    { timeout, interval: 150, timeoutMsg: 'the canvas never stopped moving after it rendered' }
  );
}

/**
 * Wait until an ARTBOARD is on the page. `waitForCanvasRects` lists element boxes, so a canvas whose artboards hold
 * nothing with a box (empty frames, a blank video comp) never satisfies it: this reads the artboard itself.
 */
export async function waitForArtboard(id: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((artboard: string) => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
        try {
          return !!frame?.contentDocument?.querySelector(`[data-dc-screen="${artboard}"]`);
        } catch {
          return false;
        }
      }, id),
    { timeout, interval: 250, timeoutMsg: `the artboard "${id}" never rendered` }
  );
  await waitForCanvasSettled();
}

/**
 * `waitForCanvasRects` plus the editing chrome: the toolbar (`toolbar-edit`) mounts a beat after the
 * artboards render, so a spec that clicks a tool straight after opening a canvas can find no slot.
 */
export async function waitForEditChrome(timeout = 30_000): Promise<void> {
  await waitForCanvasRects(timeout);
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
        return !!frame?.contentDocument?.querySelector('[data-testid="toolbar-edit"]');
      }),
    { timeout, interval: 250, timeoutMsg: 'the editing toolbar never mounted in the canvas' }
  );
}

/**
 * Put the person's focus IN the canvas: the app is the active app and the canvas frame holds the
 * shell's focus. The shell honours a canvas's `undo-key` (⌘Z / ⇧⌘Z pressed in the canvas, or a
 * `run-action edit.undo` the canvas hands back on the op log) ONLY in that state — the sec-a gate in
 * `client/v2/undo/use-undo-mode-lane.js` (`document.hasFocus() && activeElement === frame`). Synthetic
 * events move no focus, and the e2e window is not the key window while it runs (`document.hasFocus()`
 * is false), so without this every canvas-origin ⌘Z is dropped, by design. Activating the app brings
 * the test window to the front (the run already needs it on screen).
 */
export async function focusCanvasFrame(timeout = 8000): Promise<void> {
  bringAppToFront(); // the wait below names the failure
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
        if (!frame) return false;
        if (document.activeElement !== frame) frame.focus();
        return document.hasFocus() && document.activeElement === frame;
      }),
    {
      timeout,
      interval: 200,
      timeoutMsg:
        'the canvas frame never held focus in the active window (screen locked, or another app keeps the front)',
    }
  );
}

/** Hand the keyboard back to the shell, so a real `browser.keys` chord lands on the shell, not the canvas. */
export async function focusShell(): Promise<void> {
  await browser.execute(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) a.blur();
  });
}

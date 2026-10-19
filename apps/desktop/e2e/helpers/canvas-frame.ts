import { $, browser } from '@wdio/globals';

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

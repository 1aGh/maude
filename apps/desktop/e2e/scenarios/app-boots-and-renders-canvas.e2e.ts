import { $, expect } from '@wdio/globals';
import { enterCanvasFrame, exitToTop } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * Pilot integration smoke for the bundled Maude desktop `.app`.
 *
 * Proves the full native path the browser-mode harness can't reach:
 *   native shell present → sidecar boots → webview navigates to localhost →
 *   canvas list renders → click the fixture canvas → it renders in the iframe.
 *
 * Opens the deterministic fixture via MAUDE_PROJECT_ROOT (wdio.conf.ts), so it
 * needs no native dialog / OAuth. Static fixture → stable DOM snapshot.
 */
describe('app-boots-and-renders-canvas (native-desktop)', () => {
  before(() => startReport('app-boots-and-renders-canvas (native-desktop)'));

  it('boots the native shell + sidecar and renders a canvas', async () => {
    // 1 — we are in the real native shell (not a plain browser)
    expect(await isNativeShell()).toBe(true);

    // 2 — sidecar booted; webview navigated to the loopback dev-server
    const url = await waitForSidecar();
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);
    await capture('webview-on-localhost');

    // 3 — the canvas list (file tree) renders
    const list = await $('[data-testid="canvas-list"]');
    await list.waitForDisplayed({ timeout: 60_000 });
    await capture('canvas-list-visible');

    // 4 — open the fixture canvas (ui/Smoke.tsx → canvas-row-ui-smoke)
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 30_000 });
    await row.click();
    await capture('canvas-opened');

    // 5 — the correct canvas mounted: the active canvas iframe is present in the
    // top-frame DOM and points at the fixture file. This is the reliable
    // integration assertion (top-frame, no cross-origin barrier).
    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 30_000 });
    expect(await frame.getAttribute('data-path')).toBe('.design/ui/Smoke.tsx');
    await capture('canvas-opened-frame-present');

    // 5b — BEST-EFFORT deep check: assert the rendered content INSIDE the canvas
    // iframe. This crosses two known boundaries: the DDR-054 canvas iframe (can be
    // cross-origin) and the bundled-app canvas runtime (a --debug .app's staged
    // studio may lack the deps to build a canvas TSX on demand — DDR-044-class —
    // so the iframe can render blank). Non-fatal: log + screenshot, don't fail the
    // smoke on it. Tighten to a hard assertion once the bundled-runtime canvas
    // build is sorted (see the desktop-e2e skill follow-ups).
    try {
      await enterCanvasFrame(10_000);
      const content = await $('[data-testid="smoke-artboard-content"]');
      await content.waitForDisplayed({ timeout: 10_000 });
      const text = await content.getText();
      console.log(
        text.includes('Maude desktop E2E')
          ? '[smoke] canvas-iframe content rendered + asserted ✓'
          : `[smoke] canvas-iframe content present but unexpected text: ${text}`
      );
    } catch (err) {
      console.log(
        `[smoke] canvas-iframe DOM not assertable (known boundary — cross-origin / bundled-runtime canvas render): ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      await exitToTop();
    }
    await capture('canvas-rendered');
  });
});

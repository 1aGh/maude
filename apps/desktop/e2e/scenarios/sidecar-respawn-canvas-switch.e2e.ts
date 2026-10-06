import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { killSidecar, waitForRespawn, waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * REGRESSION — issue #115: "switching between canvases, the canvas doesn't load
 * at all. Only white canvas appears."
 *
 * WHY THIS NEEDS THE NATIVE HARNESS. The bug is a three-way interaction between
 * the Rust supervisor, the Bun sidecar's process identity, and a long-lived
 * webview — no browser-mode test can reach it:
 *
 *   1. The canvas iframe is served from a SEPARATE origin on an OS-ASSIGNED
 *      ephemeral port (`startCanvasServer(0)`), so that port is different in
 *      every dev-server process.
 *   2. The studio page reads `/_config` once at boot and caches `canvasOrigin`.
 *   3. When the sidecar crashes and the supervisor respawns it, the main origin
 *      reclaims its deterministic port (4399…) — so the page's WebSocket
 *      reconnects, the status bar goes back to `live`, and the shell keeps
 *      working — while `canvasOrigin` silently points at a port that no longer
 *      exists.
 *   4. The canvas ALREADY on screen was loaded before the crash and keeps
 *      rendering. Only a SWITCH mounts a fresh iframe, which navigates at the
 *      dead port and renders nothing. Silently: the canvas shell document never
 *      loads, so its own `#canvas-mount-error` surface never exists to report.
 *
 * SO THE SCENARIO MUST: run with the canvas-origin split ON (the production
 * default — the rest of the suite turns it off for frame-switching, which would
 * make this bug unreproducible), have a canvas already open, kill the sidecar in
 * a way that leaves a stale `_server.json` behind (SIGKILL, not SIGTERM), and
 * then SWITCH — the step the user takes and the only one that fails.
 *
 * THE ASSERTION is `data-canvas-state="ready"` on the viewport, which is backed
 * by the canvas shell's `dgn:'loaded'` post. Two properties make it the right
 * one here: it is a TOP-frame attribute (so it works with the cross-origin
 * iframe this scenario requires, which WebDriver cannot switch into), and it is
 * posted by the shell's inline script whether or not the canvas TSX went on to
 * build — so it isolates "the canvas origin was reachable" from "the canvas
 * compiled", and does not inherit the bundled-runtime flakiness that keeps the
 * app-boots smoke's in-frame check best-effort.
 *
 * Run: `pnpm test:e2e:desktop:sidecar-respawn`.
 */
describe('sidecar-respawn-canvas-switch (native-desktop, issue #115)', () => {
  before(() => startReport('sidecar-respawn-canvas-switch (native-desktop)'));

  it('keeps canvas switching working after the sidecar crashes and respawns', async () => {
    expect(await isNativeShell()).toBe(true);
    await waitForSidecar();

    const list = await $('[data-testid="canvas-list"]');
    await list.waitForDisplayed({ timeout: 60_000 });

    // 1 — open a canvas and let it fully mount, so we have the "already open"
    //     state the bug preserves (and would otherwise let us mistake a
    //     never-switched canvas for a working one).
    await (await canvasRow('canvas-row-ui-smoke')).click();
    const viewport = await $('[data-tour="viewport"]');
    await browser.waitUntil(
      async () => (await viewport.getAttribute('data-canvas-state')) === 'ready',
      { timeout: 90_000, timeoutMsg: 'first canvas never reached data-canvas-state="ready"' }
    );
    await capture('01-first-canvas-ready');

    // 2 — CRASH the sidecar. SIGKILL specifically: the dev-server unlinks
    //     `_server.json` only on a graceful shutdown, and the dead process's
    //     file being left on disk is the precondition for the whole failure.
    const dead = killSidecar();
    console.log(
      `[#115] killed sidecar pid=${dead.pid} port=${dead.port} canvas=${dead.canvasOrigin ?? '(none)'}`
    );

    // 3 — the supervisor respawns. New PID; the main port is typically the SAME
    //     (deterministic ladder), the canvas origin's ephemeral port is not.
    const fresh = await waitForRespawn(dead);
    console.log(
      `[#115] respawned  pid=${fresh.pid} port=${fresh.port} canvas=${fresh.canvasOrigin ?? '(none)'}`
    );
    expect(fresh.pid).not.toBe(dead.pid);

    // Guard the premise rather than assume it: if the split were off, or the
    // ephemeral port happened to repeat, this run would prove nothing about
    // #115 and should say so instead of passing quietly.
    if (!dead.canvasOrigin || !fresh.canvasOrigin) {
      throw new Error(
        '[#115] no canvasOrigin in _server.json — the canvas-origin split is OFF, so this run ' +
          'cannot reproduce the bug. Check MAUDE_CANVAS_ORIGIN_SPLIT in wdio.sidecar-respawn.conf.ts.'
      );
    }
    if (dead.canvasOrigin === fresh.canvasOrigin) {
      console.log(
        `[#115] NOTE: the ephemeral canvas port repeated (${fresh.canvasOrigin}). A stale cached ` +
          'origin would still have worked by luck, so this particular run is a weaker signal.'
      );
    }

    // 4 — the shell comes back (the supervisor re-navigates the webview once the
    //     FRESH `_server.json` lands — the wait that used to satisfy itself from
    //     the corpse in ~0 ms and fire too early).
    await waitForSidecar();
    await (await $('[data-testid="canvas-list"]')).waitForDisplayed({ timeout: 90_000 });
    await capture('02-shell-recovered');

    // 5 — THE BUG: switch to a DIFFERENT canvas. Pre-fix this mounted a fresh
    //     iframe at the dead ephemeral port and sat there white forever.
    await (await canvasRow('canvas-row-ui-export')).click();
    const viewportAfter = await $('[data-tour="viewport"]');
    await browser.waitUntil(
      async () => (await viewportAfter.getAttribute('data-canvas-state')) === 'ready',
      {
        timeout: 60_000,
        timeoutMsg:
          'issue #115 REGRESSION: after a sidecar respawn the switched-to canvas never loaded ' +
          '(data-canvas-state never became "ready") — the page is holding a stale canvasOrigin.',
      }
    );
    await capture('03-switched-canvas-ready-after-respawn');

    // 6 — and the failure surface is absent, not merely out-competed by a race.
    expect(await (await $('[data-testid="canvas-load-error"]')).isExisting()).toBe(false);

    // 7 — switch BACK, since the bug affected every subsequent switch, not just
    //     the first one after the crash.
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await browser.waitUntil(
      async () => (await viewportAfter.getAttribute('data-canvas-state')) === 'ready',
      { timeout: 60_000, timeoutMsg: 'switching back after the respawn did not load either' }
    );
    await capture('04-switched-back-ready');
  });
});

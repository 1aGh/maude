// _screenshot-playwright.mjs — playwright fallback for screenshot.sh.
// Element-scoped form (playwright CLI has no --selector flag, so we drive
// chromium via the API for that case). Full-page form is also implemented
// here so screenshot.sh has a single fallback entrypoint regardless of mode.
//
// Invocation (called by screenshot.sh — not directly by users):
//   npm exec --package=playwright -- node _screenshot-playwright.mjs \
//     --url <url> [--selector <css>] --out <path> [--timeout 8] [--theme <name>] [--frame <N>]
//
// First invocation may install chromium (~150 MB). Subsequent runs reuse cache.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChromium, newShellContext } from './_pw-launch.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1]]);
    return acc;
  }, [])
);

const { url, selector, out, timeout = '8', theme, frame } = args;
if (!url || !out) {
  console.error(
    'usage: _screenshot-playwright.mjs --url <url> [--selector <css>] --out <path> [--timeout 8]'
  );
  process.exit(2);
}

const timeoutMs = Number(timeout) * 1000;
mkdirSync(dirname(out), { recursive: true });

const browser = await launchChromium();
try {
  // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
  const { ctx, goto: gotoShell } = await newShellContext(browser, {
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await gotoShell(page, url, { waitUntil: 'networkidle', timeout: timeoutMs });

  if (theme) {
    // Dual-theme reality check (/design:new step 9): force every DS artboard
    // theme wrapper to `theme` before capture, deterministically, instead of
    // relying on whatever the canvas is pinned to. No-op if the canvas has no
    // `[data-theme]` elements (e.g. a single-theme DS).
    const n = await page.evaluate((t) => {
      const els = document.querySelectorAll('[data-theme]');
      els.forEach((el) => {
        el.setAttribute('data-theme', t);
      });
      return els.length;
    }, theme);
    console.error(`→ theme override: forced data-theme="${theme}" on ${n} element(s)`);
  }

  if (frame !== undefined) {
    // --frame <N> (issue #128 §6): size the viewport to the target, seek strictly, wait for paint,
    // shoot. A canvas with no seek bridge fails loud — a frame-0 shot looks like a valid one.
    const n = Number(frame);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`✗ --frame ${frame}: needs a whole frame number`);
      process.exit(2);
    }
    try {
      await page.waitForFunction(() => typeof window.__maude_seek__ === 'function', null, {
        timeout: timeoutMs,
      });
    } catch {
      console.error(
        `✗ --frame ${n}: this canvas has no window.__maude_seek__ bridge (is the artboard a video-comp?)`
      );
      process.exit(3);
    }
    if (selector) {
      const box = await page.locator(selector).first().boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        const w = Math.min(8192, Math.ceil(box.width));
        const h = Math.min(8192, Math.ceil(box.height));
        await page.setViewportSize({ width: w, height: h });
        console.error(`→ viewport sized to the artboard: ${w}x${h}`);
      }
    }
    try {
      await page.evaluate((f) => window.__maude_seek__(f, { strict: true }), n);
    } catch (e) {
      console.error(
        `✗ --frame ${n}: the seek did not land (${e instanceof Error ? e.message : e})`
      );
      process.exit(3);
    }
    await page.evaluate(
      () =>
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))
    );
    await page.waitForTimeout(300);
    console.error(`→ seeked to frame ${n}`);
  }

  if (selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: timeoutMs });
    await loc.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
  console.error(`✓ playwright wrote ${out}`);
} finally {
  await browser.close();
}

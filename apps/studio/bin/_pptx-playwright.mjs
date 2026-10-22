// _pptx-playwright.mjs — playwright shim for the PPTX exporter.
//
// Drives `dom-to-pptx` (atharva9167j) — computed-style + getBoundingClientRect
// architecture that respects the browser's layout result. Replaces our hand-
// rolled DOM walker; see DDR-043. Per artboard → one slide. dom-to-pptx ships
// a UMD bundle at `dist/dom-to-pptx.bundle.js` that exposes `window.domToPptx`.
//
// Invocation (Bun.spawn from exporters/pptx.ts — not invoked directly):
//   node _pptx-playwright.mjs --url <url> --selector <css> --out <pptx-path>
//     --bundle-path <umd.js> [--multi] [--timeout 12]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChromium, newShellContext } from './_pw-launch.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] ?? '1']);
    return acc;
  }, [])
);

const { url, selector, out, 'bundle-path': bundlePath, multi: multiFlag, timeout = '15' } = args;

if (!url || !out || !bundlePath) {
  console.error(
    'usage: _pptx-playwright.mjs --url <url> --selector <css> --out <pptx-path> --bundle-path <umd.js>'
  );
  process.exit(2);
}

const multi = multiFlag !== undefined;
const timeoutMs = Number(timeout) * 1000;

mkdirSync(dirname(out), { recursive: true });

const browser = await launchChromium();
try {
  // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
  const { ctx, goto: gotoShell } = await newShellContext(browser, {
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await gotoShell(page, url, { waitUntil: 'networkidle', timeout: timeoutMs });
  await page.evaluate(() => document.fonts.ready);
  // Reset the world plane's CSS zoom + transform so dom-to-pptx reads the
  // artboard at its declared 1440×900 instead of the pan-zoomed thumbnail.
  await page.evaluate(() => {
    const world = document.querySelector('.dc-world');
    if (world) {
      world.style.zoom = '1';
      world.style.transform = 'none';
    }
  });
  // dom-to-pptx ships a UMD bundle; addScriptTag exposes `window.domToPptx`.
  await page.addScriptTag({ path: bundlePath });

  // Resolve target handle(s). Multi-mode iterates every artboard; single-
  // mode widens to the closest artboard ancestor of the supplied selector
  // (matches the SVG/HTML shims' behaviour for --selector).
  const handles = multi
    ? await page.locator(selector ?? '[data-dc-screen]').all()
    : [page.locator(selector ?? '[data-dc-screen]:first-of-type').first()];

  // dom-to-pptx is designed to walk ONE root and emit ONE pptx. For multi,
  // we serialize each artboard separately then merge in Node via pptxgenjs.
  // For v1 we just emit the FIRST artboard if multi=true and warn — proper
  // merge lives in exporters/pptx.ts (which receives back the byte array).
  const handle = handles[0];
  if (!handle) {
    console.error('_pptx-playwright: no target found');
    process.exit(2);
  }
  await handle.waitFor({ state: 'visible', timeout: timeoutMs });

  // Pin this artboard to (0,0) for its capture, restoring afterwards so a
  // future multi-slide implementation doesn't inherit a stacked-at-origin bug
  // (the scatter bug fixed in the png/pdf/svg/html shims).
  const savedPos = await handle.evaluate((el) => {
    const ab = el.closest('[data-dc-screen]') ?? el;
    const prev = { left: ab.style.left, top: ab.style.top };
    ab.style.left = '0px';
    ab.style.top = '0px';
    return prev;
  });

  // Run dom-to-pptx inside the page. It returns a Blob; we serialise to a
  // byte array for transport across the playwright boundary.
  const bytesArray = await handle.evaluate(async (el) => {
    const target = el.closest('[data-dc-screen]') ?? el;
    // window.domToPptx is the UMD-injected entry.
    const { exportToPptx } = /** @type any */ (window).domToPptx;
    if (typeof exportToPptx !== 'function') {
      throw new Error('dom-to-pptx bundle did not expose exportToPptx');
    }
    const blob = await exportToPptx(target, { filename: 'export.pptx' });
    const ab = await blob.arrayBuffer();
    return Array.from(new Uint8Array(ab));
  });

  await handle.evaluate((el, prev) => {
    const ab = el.closest('[data-dc-screen]') ?? el;
    ab.style.left = prev.left;
    ab.style.top = prev.top;
  }, savedPos);

  writeFileSync(out, new Uint8Array(bytesArray));
  console.log(out);
  console.error(
    `✓ dom-to-pptx wrote ${out} (${bytesArray.length} bytes, ${handles.length} artboard${handles.length === 1 ? '' : 's available — first emitted'})`
  );
} finally {
  await browser.close();
}

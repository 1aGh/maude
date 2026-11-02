// _svg-playwright.mjs — playwright shim for the SVG exporter.
//
// Uses `dom-to-svg` (felixfbecker/dom-to-svg) to walk the rendered DOM and
// emit real SVG primitives — <rect>, <text>, <path>, <image> — that vector
// editors like Affinity Designer / Illustrator / Inkscape decompose
// correctly. The previous `<foreignObject>`-wrapping approach (DDR-038)
// renders pixel-perfect in Chrome but Affinity refuses to import it; see
// DDR-042 for the swap rationale.
//
// Bundled IIFE: exporters/_browser-bundles.ts pre-bundles dom-to-svg via
// Bun.build, caches the result under /tmp, and passes the path via
// --bundle-path. The shim loads it with addScriptTag.
//
// Invocation (Bun.spawn from exporters/svg.ts — not invoked directly):
//   node _svg-playwright.mjs --url <url> --selector <css> --out <path>
//     --bundle-path <iife.js> [--widen-to-artboard] [--multi]
//     [--out-dir <dir>] [--timeout 12]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchChromium, newShellContext, safeArtboardFilename } from './_pw-launch.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] ?? '1']);
    return acc;
  }, [])
);

const {
  url,
  selector,
  out,
  'out-dir': outDir,
  'bundle-path': bundlePath,
  'core-path': corePath,
  'widen-to-artboard': widenFlag,
  multi: multiFlag,
  timeout = '12',
} = args;

if (!url || !bundlePath || !corePath) {
  console.error(
    'usage: _svg-playwright.mjs --url <url> --selector <css> --out <path> ' +
      '--bundle-path <iife.js> --core-path <capture-core.js>'
  );
  process.exit(2);
}

const widen = widenFlag !== undefined;
const multi = multiFlag !== undefined;
const timeoutMs = Number(timeout) * 1000;

const browser = await launchChromium();
try {
  // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
  const { ctx, goto: gotoShell } = await newShellContext(browser, {
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await gotoShell(page, url, { waitUntil: 'load', timeout: timeoutMs });
  await page.evaluate(() => document.fonts.ready);
  // `load` fires before React mounts (and a video comp never reaches
  // `networkidle`), so gate on the artboard rendering before we query it —
  // otherwise a multi `.all()` can run against an empty page.
  await page
    .locator(selector ?? '[data-dc-screen]')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs });
  // Reset the world plane's CSS zoom + transform so artboards render at
  // declared dimensions before dom-to-svg walks the layout.
  await page.evaluate(() => {
    const world = document.querySelector('.dc-world');
    if (world) {
      world.style.zoom = '1';
      world.style.transform = 'none';
    }
  });
  // Get dom-to-svg (`window.domToSvg`) and the SHARED capture spine
  // (`window.__maudeCaptureCore`) into the page. The core is the SAME source
  // the canvas runtime's export-capture bridge imports (exporters/
  // capture-core.ts, DDR-231 single-spine): the serializer logic must never be
  // re-inlined here — it forked once and the browser lane would silently drift
  // from this shim.
  //
  // PREFER WHAT THE PAGE ALREADY HAS (DDR-231 Phase 2 T4). A real canvas
  // bundles capture-core through canvas-lib, so `__maudeCaptureCore` is
  // already set, and `dom-to-svg` resolves through the shell's importmap.
  // `addScriptTag({path})` injects an INLINE script, which the canvas origin's
  // strict shell CSP (`script-src 'self' 'sha256-…'`) refuses outright — so on
  // the render-worker lane, where the canvas is ALWAYS loaded from the canvas
  // origin, every SVG export died with "Executing inline script violates the
  // following Content Security Policy directive". Reaching for the in-page
  // copy first fixes that lane without relaxing anyone's CSP, and makes the
  // worker run literally the same code the member's browser runs.
  const reuse = await page.evaluate(async () => {
    const w = window;
    if (!w.domToSvg) {
      try {
        w.domToSvg = await import('dom-to-svg');
      } catch {
        /* no importmap on this page — the injection fallback below covers it */
      }
    }
    return !!w.__maudeCaptureCore && !!w.domToSvg;
  });
  if (!reuse) {
    await page.addScriptTag({ path: bundlePath });
    await page.addScriptTag({ path: corePath, type: 'module' });
  }
  await page.waitForFunction(() => !!window.__maudeCaptureCore && !!window.domToSvg, {
    timeout: timeoutMs,
  });

  const written = [];

  // Pin one artboard to (0,0) for its capture, returning a restore function.
  // Per-target rather than a one-shot reset of every `[data-dc-screen]` — a
  // multi-target loop must not leave an already-captured artboard sitting at
  // the origin, overlapping the next target's geometry (the scatter bug).
  const pinArtboard = async (handle) => {
    const saved = await handle.evaluate((el) => window.__maudeCaptureCore.pinArtboard(el));
    return async () => {
      await handle.evaluate(
        (el, prev) => window.__maudeCaptureCore.restoreArtboard(el, prev),
        saved
      );
    };
  };

  // Single in-page serializer used by BOTH branches (single + multi) so they
  // can't drift again (the `formatXML` 500 bug came from a divergent copy).
  // The ENTIRE capture logic (backdrop rect from the effective background,
  // oklch→sRGB normalization for vector editors, inlineResources) lives in the
  // shared capture spine (exporters/capture-core.ts) injected above — the same
  // code the canvas runtime's export-capture bridge runs in the member's
  // browser (DDR-231). Nothing capture-shaped may be inlined here again.
  const serializeOne = async (handle, widenToArtboard) => {
    return await handle.evaluate(
      (el, opts) =>
        window.__maudeCaptureCore.svgForElement(el, window.domToSvg, {
          widenToArtboard: opts.widenToArtboard,
        }),
      { widenToArtboard }
    );
  };

  if (multi) {
    if (!outDir) {
      console.error('_svg-playwright: --multi requires --out-dir');
      process.exit(2);
    }
    mkdirSync(outDir, { recursive: true });
    const screens = await page.locator(selector ?? '[data-dc-screen]').all();
    for (let i = 0; i < screens.length; i += 1) {
      const handle = screens[i];
      const id = (await handle.getAttribute('data-dc-screen')) ?? `artboard-${i + 1}`;
      const restore = await pinArtboard(handle);
      // Each multi handle is already a `[data-dc-screen]` artboard — no widen.
      const svg = await serializeOne(handle, false);
      await restore();
      // `id` is the tenant-authored `data-dc-screen` (untrusted, DDR-054) — a
      // `../`-laden id in `join(outDir, `${id}.svg`)` is an arbitrary-path
      // write of attacker bytes (security review F1). The png shim already
      // routes through this; the svg/html siblings did not.
      const target = join(outDir, safeArtboardFilename(id, i, 'svg'));
      writeFileSync(target, svg, 'utf8');
      written.push(target);
      console.log(`MAUDE_PROGRESS {"current":${i + 1},"total":${screens.length}}`);
    }
  } else {
    if (!out) {
      console.error('_svg-playwright: --out required when --multi not set');
      process.exit(2);
    }
    mkdirSync(dirname(out), { recursive: true });
    const handle = page.locator(selector ?? '[data-dc-screen]:first-of-type').first();
    await handle.waitFor({ state: 'visible', timeout: timeoutMs });
    const restore = await pinArtboard(handle);
    const svg = await serializeOne(handle, widen);
    await restore();
    writeFileSync(out, svg, 'utf8');
    written.push(out);
  }

  for (const w of written) console.log(w);
  console.error(`✓ dom-to-svg wrote ${written.length} svg file(s)`);
} finally {
  await browser.close();
}

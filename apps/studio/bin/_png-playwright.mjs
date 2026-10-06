// _png-playwright.mjs — playwright shim for the PNG exporter.
//
// Replaces the screenshot.sh / agent-browser path because agent-browser
// applies its own viewport sizing that doesn't honor our 1440x900 setup,
// producing clipped captures. With our own playwright we control the
// viewport exactly and crop to the target element's bounding box.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { launchChromium, safeArtboardFilename } from './_pw-launch.mjs';
import { layoutRegion, parseRegionArg } from './_region.mjs';

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
  'widen-to-artboard': widenFlag,
  multi: multiFlag,
  region: regionArg,
  timeout = '12',
  scale = '1',
} = args;

if (!url) {
  console.error('usage: _png-playwright.mjs --url <url> --selector <css> --out <path>');
  process.exit(2);
}

const widen = widenFlag !== undefined;
const region = parseRegionArg(regionArg);
const multi = multiFlag !== undefined;
const timeoutMs = Number(timeout) * 1000;
// feature-2-print-artboards T4 — ceiling raised 4→8 so a 300dpi export
// (3.125×) AND 600dpi (6.25×) both fit; exporters/png.ts resolveDeviceScale
// is the only caller that can reach beyond 3, via the `dpi` option.
const deviceScaleFactor = Math.max(1, Math.min(8, Number(scale) || 1));
// feature-2-print-artboards T4 — a raster export's actual pixel dimensions
// are only known once the target element's DOM rect is measured below (the
// adapter can't pre-compute them — see png.ts's own comment), so the "too
// big to render" guard lives here rather than in the Node-side adapter.
// 16,000px matches common canvas/texture limits across browser engines;
// ~600MB is a generous RGBA-buffer ceiling (width × height × 4 bytes) well
// under typical CI/desktop RAM, chosen so a legitimate 600dpi A0 poster still
// fits (9933×14043px × 4B ≈ 558MB) while a runaway value fails loud instead
// of OOM-killing the render process.
const MAX_OUTPUT_SIDE_PX = 16000;
const MAX_OUTPUT_BYTES = 600 * 1024 * 1024;
function assertOutputSizeOk(widthCss, heightCss) {
  const outW = Math.ceil(widthCss * deviceScaleFactor);
  const outH = Math.ceil(heightCss * deviceScaleFactor);
  const estBytes = outW * outH * 4;
  if (outW > MAX_OUTPUT_SIDE_PX || outH > MAX_OUTPUT_SIDE_PX || estBytes > MAX_OUTPUT_BYTES) {
    const maxScaleForSide = MAX_OUTPUT_SIDE_PX / Math.max(widthCss, heightCss);
    const maxScaleForBytes = Math.sqrt(MAX_OUTPUT_BYTES / 4 / (widthCss * heightCss));
    const maxScale = Math.min(maxScaleForSide, maxScaleForBytes);
    const maxDpi = Math.floor(maxScale * 96);
    console.error(
      `_png-playwright: requested output ${outW}×${outH}px at ${deviceScaleFactor}× exceeds the ` +
        `render guard (max side ${MAX_OUTPUT_SIDE_PX}px / max ~${Math.round(MAX_OUTPUT_BYTES / 1024 / 1024)}MB). ` +
        `For this artboard size (${Math.round(widthCss)}×${Math.round(heightCss)}px), the max supported DPI is ~${maxDpi}.`
    );
    process.exit(1);
  }
}

const browser = await launchChromium();
try {
  // 1440x900 matches the canvas viewport the design tool uses everywhere;
  // exporters resize per-target before each shot to fit the artboard exactly.
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor,
  });
  const page = await ctx.newPage();
  // Diagnostics for a stuck load (the remote render worker hits a canvas origin
  // the desktop path never does): capture console errors, page exceptions and
  // failed sub-resource requests so a `goto` timeout can name WHY the page never
  // fired `load` instead of just that it didn't. Printed to stderr only on
  // failure, so the success path and desktop output are unchanged.
  const diag = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      diag.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => diag.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) =>
    diag.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText ?? '?'}`)
  );
  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  } catch (e) {
    if (diag.length) console.error(`[page diagnostics]\n${diag.slice(0, 40).join('\n')}`);
    throw e;
  }
  await page.evaluate(() => document.fonts.ready);
  // `load` fires before React mounts (and a video comp never reaches
  // `networkidle`), so gate on the artboard element actually rendering before we
  // query/capture — otherwise a multi `.all()` can run against an empty page.
  await page
    .locator(selector ?? '[data-dc-screen]')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs });

  const written = [];

  const captureHandle = async (handle, target) => {
    // Widen to artboard if requested — the selection's selector points at a
    // descendant, but for "Export this artboard" we want the enclosing
    // [data-dc-screen]. Done browser-side so the locator + bbox align.
    const widenedHandle = widen
      ? await handle.evaluateHandle((el) => el.closest('[data-dc-screen]') ?? el)
      : handle;
    // Reset the world plane's pan/zoom so every artboard renders at its
    // declared native dimensions (1440×900 etc.). The dev-server uses CSS
    // `zoom` (not `transform: scale`) on `.dc-world`, which actually shrinks
    // layout — getBoundingClientRect returns 818×512 instead of 1440×900
    // unless we zero both `zoom` and `transform` here.
    await page.evaluate(() => {
      const world = document.querySelector('.dc-world');
      if (world) {
        world.style.zoom = '1';
        world.style.transform = 'none';
      }
    });
    // Pin the captured element's OWN artboard to (0,0). Previously this reset
    // `[data-dc-screen]:first-of-type` regardless of the target, so capturing
    // artboard #2 (or any non-first selection's host) left the wrong artboard
    // at the origin (item 5 root cause). Each artboard carries
    // `style="left:…; top:…;"` for the world layout — zero the right one so the
    // screenshot clip starts at the viewport origin. Save the prior value so it
    // can be restored after this artboard's capture — otherwise every artboard
    // processed earlier in a `--multi` loop is left stacked at (0,0) and bleeds
    // into every subsequent target's clip region (the scatter bug).
    const savedPos = await widenedHandle.evaluate((el) => {
      const ab = el.closest('[data-dc-screen]') ?? el;
      const prev = { left: ab.style.left, top: ab.style.top };
      ab.style.left = '0px';
      ab.style.top = '0px';
      return prev;
    });
    const rect = await widenedHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    // feature-2-print-artboards T4 — fail loud BEFORE resizing the viewport
    // to a pathological size, not after.
    assertOutputSizeOk(rect.width, rect.height);
    // Resize the viewport to fit the artboard so the screenshot doesn't
    // include the world plane's pan/zoom margin. The artboard then sits at
    // (0,0) with its native dimensions.
    await page.setViewportSize({
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    });
    // Anchor the CAPTURED ELEMENT at (0,0), not just its artboard. For a
    // selection capture the element sits at an offset INSIDE the pinned
    // artboard (padding, layout), while the viewport was just sized to the
    // ELEMENT — so a clip at the element's rect ran past the viewport edge
    // and Playwright refused with "Clipped area is either empty or outside
    // the resulting image". The canvas page doesn't scroll (the world plane
    // owns overflow), so the old scrollIntoView was a no-op there; shifting
    // the pinned artboard by the element's offset is deterministic.
    await widenedHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ab = el.closest('[data-dc-screen]') ?? el;
      if (r.left !== 0 || r.top !== 0) {
        ab.style.left = `${parseFloat(ab.style.left || '0') - r.left}px`;
        ab.style.top = `${parseFloat(ab.style.top || '0') - r.top}px`;
      }
      window.scrollTo(0, 0);
    });
    const finalRect = await widenedHandle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    // Clamp to the viewport — a clip must never extend past it.
    const vp = page.viewportSize();
    const clipX = Math.min(Math.max(0, Math.floor(finalRect.x)), Math.max(0, vp.width - 1));
    const clipY = Math.min(Math.max(0, Math.floor(finalRect.y)), Math.max(0, vp.height - 1));
    await page.screenshot({
      path: target,
      clip: {
        x: clipX,
        y: clipY,
        width: Math.max(1, Math.min(Math.ceil(finalRect.width), vp.width - clipX)),
        height: Math.max(1, Math.min(Math.ceil(finalRect.height), vp.height - clipY)),
      },
    });
    written.push(target);
    // Restore the artboard's original position now that its capture is done,
    // so it doesn't stay pinned at (0,0) and corrupt the next target's clip.
    await widenedHandle.evaluate((el, prev) => {
      const ab = el.closest('[data-dc-screen]') ?? el;
      ab.style.left = prev.left;
      ab.style.top = prev.top;
    }, savedPos);
  };

  if (region) {
    // Issue #125 — one image of a whole region of the world plane (the whole
    // canvas, or the selection's bounding box), layout + annotations intact.
    if (!out) {
      console.error('_png-playwright: --out required with --region');
      process.exit(2);
    }
    mkdirSync(dirname(out), { recursive: true });
    const box = await layoutRegion(page, region);
    assertOutputSizeOk(box.width, box.height);
    await page.setViewportSize({ width: Math.max(1, box.width), height: Math.max(1, box.height) });
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: box.width, height: box.height },
    });
    written.push(out);
  } else if (multi) {
    if (!outDir) {
      console.error('_png-playwright: --multi requires --out-dir');
      process.exit(2);
    }
    mkdirSync(outDir, { recursive: true });
    const screens = await page.locator(selector ?? '[data-dc-screen]').all();
    for (let i = 0; i < screens.length; i += 1) {
      const handle = screens[i];
      const id = await handle.getAttribute('data-dc-screen');
      await captureHandle(handle, join(outDir, safeArtboardFilename(id, i, 'png')));
      console.log(`MAUDE_PROGRESS {"current":${i + 1},"total":${screens.length}}`);
    }
  } else {
    if (!out) {
      console.error('_png-playwright: --out required when --multi not set');
      process.exit(2);
    }
    mkdirSync(dirname(out), { recursive: true });
    const handle = page.locator(selector ?? '[data-dc-screen]:first-of-type').first();
    await handle.waitFor({ state: 'visible', timeout: timeoutMs });
    await captureHandle(handle, out);
  }

  for (const w of written) console.log(w);
  console.error(`✓ playwright wrote ${written.length} png file(s)`);
} finally {
  await browser.close();
}

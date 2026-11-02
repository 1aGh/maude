// _motion-sample-playwright.mjs — the live-motion proof sampler (draw-proof --motion).
//
// A still screenshot CANNOT prove animation — the studyfi-v3 session burned ~3
// rounds because a freeze-frame "confirmed" a dead CSS `d:path()` morph (which
// does not animate live in any shipping browser). This shim closes that gap: it
// loads the proof URL in a real Chromium, samples the animated element's
// geometry/paint signature at TWO distinct wall-clock times, and asserts it
// changed. Freeze-frame pass + over-time NO-CHANGE ⇒ HARD FAIL (DDR-094 M1).
//
// Signature = getBBox() (x/y/width/height — catches morph/scale/translate) +
// computed transform matrix + computed opacity (catches fade-only animation).
// Any component differing beyond epsilon ⇒ the property is animating.
//
// Target selection: an explicit --selector, else auto-detect the parent of the
// first <animate>/<animateTransform> in the document.
//
// Invocation (via draw-proof.sh; never a raw path — DDR-062):
//   node _motion-sample-playwright.mjs --url <url> [--selector <css>]
//        [--gap 600] [--timeout 12]
//
// Exit: 0 motion proven · 1 element/animation not found · 2 bad args
//       3 Chromium binary missing (launchChromium) · 4 NO over-time change (HARD FAIL)

/**
 * Pure signature-delta test (exported for a unit test — no browser needed).
 * Returns true when any component of two samples differs beyond `eps`.
 */
export function signatureChanged(a, b, eps = 0.25) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k.startsWith('__')) continue;
    const av = a[k];
    const bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') {
      if (Math.abs(av - bv) > eps) return true;
    } else if (av !== bv) {
      return true;
    }
  }
  return false;
}

// The in-page sampler: bbox + transform matrix + opacity of the target element.
// Exported so the selector/auto-detect contract is documented + reviewable.
export const SAMPLE_FN = (sel) => {
  let el = null;
  if (sel) {
    el = document.querySelector(sel);
  } else {
    const anim = document.querySelector('animate, animateTransform');
    el = anim ? anim.parentElement : null;
  }
  if (!el) return { __missing: true };
  const box = typeof el.getBBox === 'function' ? el.getBBox() : { x: 0, y: 0, width: 0, height: 0 };
  const cs = getComputedStyle(el);
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    transform: cs.transform || 'none',
    opacity: Number(cs.opacity) || 1,
  };
};

// Entry-point detection that works under BOTH node and bun across versions
// (`import.meta.main` is Node-24-only). True only when run directly, so the
// unit test can `import { signatureChanged }` without launching Chromium.
const { pathToFileURL } = await import('node:url');
const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

// Browser driver — runs ONLY as the entry point, never on import.
if (isEntry) {
  const { launchChromium, newShellContext } = await import('./_pw-launch.mjs');

  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, all) => {
      if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] ?? '1']);
      return acc;
    }, [])
  );

  const { url, selector, gap = '600', timeout = '12' } = args;
  if (!url) {
    console.error('usage: _motion-sample-playwright.mjs --url <url> [--selector <css>] [--gap ms]');
    process.exit(2);
  }
  const gapMs = Number(gap);
  const timeoutMs = Number(timeout) * 1000;

  const browser = await launchChromium();
  try {
    // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
    const { ctx, goto: gotoShell } = await newShellContext(browser, {
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await gotoShell(page, url, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.evaluate(() => document.fonts.ready);

    const first = await page.evaluate(SAMPLE_FN, selector ?? null);
    if (first.__missing) {
      console.error(
        selector
          ? `motion-sample: no element matched "${selector}"`
          : 'motion-sample: no <animate>/<animateTransform> found in the document'
      );
      process.exit(1);
    }

    await page.waitForTimeout(gapMs); // let the runtime advance real wall-clock
    const second = await page.evaluate(SAMPLE_FN, selector ?? null);

    if (signatureChanged(first, second)) {
      console.error(`motion-sample: over-time delta confirmed (gap ${gapMs}ms) — motion proven`);
      await browser.close();
      process.exit(0);
    }
    console.error(
      `motion-sample: NO change over ${gapMs}ms — dead mechanism (freeze-frame may look fine). ` +
        'Check for CSS d:path() or a non-animating property (DDR-094 M1/M2).'
    );
    console.error(`  t0=${JSON.stringify(first)}`);
    console.error(`  t1=${JSON.stringify(second)}`);
    await browser.close();
    process.exit(4);
  } catch (err) {
    await browser.close();
    throw err;
  }
}

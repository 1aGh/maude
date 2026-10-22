// _pw-launch.mjs — shared Chromium launcher for the export / screenshot shims.
//
// Every renderer shim (_png/_pdf/_svg/_html/_pptx/_enumerate-artboards/
// _screenshot-playwright.mjs) opens a Chromium instance with `chromium.launch()`.
// Playwright the npm package can be present while its browser BINARY is not — the
// package install and `npx playwright install chromium` are separate steps, and
// the dependency check `npx playwright --version` only proves the former. When
// the binary is missing, `launch()` rejects with a multi-line stack trace that
// `exporters/*.ts` rethrows and `/_api/export` surfaces verbatim as an opaque
// 500 ("nefunguji exporty"). This helper funnels that one failure mode through a
// single place: it prints one actionable line and exits with a distinct code, so
// the export endpoint's 500 body becomes the remediation instead of a stack. Any
// OTHER launch error is rethrown untouched — real diagnostics are preserved.
//
// See `.ai/logs/rca/issue-nefunguji-exporty.md`.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** Exit code the shims surface for "Chromium browser binary not installed". */
export const NO_BROWSER_EXIT = 3;

/** One-line, copy-pasteable remediation shown in the export 500 body. */
export const INSTALL_HINT =
  "Playwright's Chromium browser isn't installed. Run:  npx playwright install chromium";

/**
 * Resolve a Chrome-family executable to fall back on when Playwright's OWN
 * bundled browser is absent — the packaged desktop case (RCA
 * issue-desktop-export-failures): the app ships the `playwright` JS closure but
 * NOT its ~150 MB browser, so `chromium.launch()` with no `executablePath` finds
 * nothing. Priority: explicit env override → the shared `_ensure-browser.mjs`
 * resolver (the same Chrome / provisioned chrome-headless-shell the screenshot
 * path uses; `--no-download` so an export never silently triggers a 94 MB
 * fetch). Returns `undefined` when nothing is found — the caller then surfaces
 * the install hint. Reachable at runtime because the shim runs under real `node`
 * (its `import.meta.url` is a genuine disk path, unlike the compiled server).
 */
function resolveBrowserExecutable() {
  for (const env of [
    process.env.MAUDE_BROWSER_EXECUTABLE,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
  ]) {
    if (env && existsSync(env)) return env;
  }
  try {
    const ensure = join(dirname(fileURLToPath(import.meta.url)), '_ensure-browser.mjs');
    if (!existsSync(ensure)) return undefined;
    const out = execFileSync(process.execPath, [ensure, '--no-download', '--quiet'], {
      encoding: 'utf8',
    });
    const path = out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    return path && existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when a `chromium.launch()` rejection is the "browser binary not
 * downloaded" case (as opposed to a sandbox / port / crash failure). Pure +
 * exported so it's unit-testable without spawning a browser. Matches the stable
 * fragments Playwright emits across versions:
 *   "browserType.launch: Executable doesn't exist at <path>"
 *   "Please run the following command to download new browsers"
 *   "playwright install"
 */
export function isMissingBrowserError(message) {
  const m = String(message ?? '');
  return (
    /Executable doesn'?t exist/i.test(m) ||
    /please run the following command to download/i.test(m) ||
    /playwright install/i.test(m)
  );
}

/**
 * Launch Chromium, mapping the missing-binary failure to a clean exit. Drop-in
 * for `chromium.launch(opts)` — same signature, same resolved Browser.
 */
export async function launchChromium(opts) {
  try {
    return await chromium.launch(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingBrowserError(msg)) {
      // Playwright's own browser isn't present (packaged desktop app, or a fresh
      // machine that never ran `playwright install`). Retry once against a
      // resolved Chrome-family engine — system Chrome / a provisioned
      // chrome-headless-shell — before giving up. This is what makes render
      // export work in the bundled app, where only the playwright JS ships.
      const executablePath = resolveBrowserExecutable();
      if (executablePath) {
        try {
          return await chromium.launch({ ...opts, executablePath });
        } catch {
          /* fall through to the install hint */
        }
      }
      // Single clean line — the export endpoint pipes shim stderr into the 500
      // body, so this is what the user reads. No stack trace.
      console.error(INSTALL_HINT);
      process.exit(NO_BROWSER_EXIT);
    }
    throw err;
  }
}

// Shared by every multi-artboard export shim (_png/_pdf-playwright.mjs) that
// names its output file after an artboard's `data-dc-screen` id for T5's
// filename-correlation convenience. That id comes straight off a live DOM
// attribute — i.e. from canvas-authored JSX, DDR-054 untrusted content — and
// feeds directly into `path.join(outDir, ...)`, which does NOT sandbox `..`
// segments. Re-validates against the SAME shape api.ts's write-side artboard-id
// ops already enforce (`/^[A-Za-z][\w-]{0,63}$/`) before it's ever used as a
// path segment; anything else (or a `false`y id) falls back to the safe
// positional name so a malformed/malicious id can never escape `outDir`.
const SAFE_ARTBOARD_ID_RE = /^[A-Za-z][\w-]{0,63}$/;
export function safeArtboardFilename(id, index, ext) {
  const safe =
    typeof id === 'string' && SAFE_ARTBOARD_ID_RE.test(id) ? id : `artboard-${index + 1}`;
  return `${safe}.${ext}`;
}

// Shared by every raster-capture export shim (_png/_pdf-playwright.mjs) that
// scales its render surface by `deviceScaleFactor` (feature-2-print-artboards
// T4's DPI support). The requested pixel output is only knowable once the
// target element's DOM rect is measured (the Node-side adapter can't
// pre-compute it), so this guard lives here rather than in exporters/*.ts.
// Applies EQUALLY to the PDF shim: `deviceScaleFactor` scales Chromium's
// whole rendering/rasterization surface for `page.pdf()` too, not just PNG's
// screenshot buffer — the PDF *page* stays vector-sized regardless, but the
// backing store Chromium allocates to paint it does not, so a huge
// artboard + high DPI is exactly as costly to render as it is for PNG, even
// though the resulting PDF bytes are typically far smaller than a raw PNG
// buffer. 16,000px matches common canvas/texture limits across browser
// engines; ~600MB is a generous RGBA-buffer ceiling (width × height × 4
// bytes) chosen so a legitimate 600dpi A0 poster still fits (9933×14043px ×
// 4B ≈ 558MB) while a runaway value fails loud instead of OOM-killing the
// render process.
const MAX_OUTPUT_SIDE_PX = 16000;
const MAX_OUTPUT_BYTES = 600 * 1024 * 1024;
export function assertRenderOutputSizeOk(widthCss, heightCss, deviceScaleFactor, label) {
  const outW = Math.ceil(widthCss * deviceScaleFactor);
  const outH = Math.ceil(heightCss * deviceScaleFactor);
  const estBytes = outW * outH * 4;
  if (outW > MAX_OUTPUT_SIDE_PX || outH > MAX_OUTPUT_SIDE_PX || estBytes > MAX_OUTPUT_BYTES) {
    const maxScaleForSide = MAX_OUTPUT_SIDE_PX / Math.max(widthCss, heightCss);
    const maxScaleForBytes = Math.sqrt(MAX_OUTPUT_BYTES / 4 / (widthCss * heightCss));
    const maxScale = Math.min(maxScaleForSide, maxScaleForBytes);
    const maxDpi = Math.floor(maxScale * 96);
    console.error(
      `${label}: requested output ${outW}×${outH}px at ${deviceScaleFactor}× exceeds the ` +
        `render guard (max side ${MAX_OUTPUT_SIDE_PX}px / max ~${Math.round(MAX_OUTPUT_BYTES / 1024 / 1024)}MB). ` +
        `For this artboard size (${Math.round(widthCss)}×${Math.round(heightCss)}px), the max supported DPI is ~${maxDpi}.`
    );
    process.exit(1);
  }
}

/**
 * Inject a JS bundle into a page whose CSP refuses inline scripts.
 *
 * `page.addScriptTag({ content | path })` writes an INLINE `<script>`, which the
 * canvas origin's shell CSP (`script-src 'self' 'sha256-…'`) refuses outright —
 * and the render worker (DDR-230) always loads the canvas from that origin, so
 * every shim that injected this way failed there (worker-lane SVG, then mp4 /
 * webm / gif: "Executing inline script violates the following Content Security
 * Policy directive"). See DDR-232 §3.
 *
 * This serves the bundle at a SAME-ORIGIN virtual URL through Playwright
 * request interception and adds it as `<script src>`. CSP is enforced on the
 * script's URL origin, which is `'self'`, so it passes — and because the tag is
 * a real module script in the document, bare specifiers still resolve through
 * the shell's importmap (the render lib NEEDS that: it externalizes `remotion`
 * to share the page's instance, DDR-148). Measured, not assumed: a route-
 * fulfilled module under the exact CSP shape resolves an importmap specifier;
 * `addInitScript` cannot (it runs before the importmap exists).
 *
 * No CSP is relaxed. On the main origin (desktop), where the CSP is env-gated
 * off, this is simply equivalent to the inline injection it replaces.
 *
 * @param {import('playwright').Page} page
 * @param {{ content: string, type?: 'module' | undefined, name?: string, timeout?: number }} opts
 */
let injectedSeq = 0;
export async function addScriptCspSafe(page, { content, type, name = 'lib', timeout }) {
  const origin = new URL(page.url()).origin;
  injectedSeq += 1;
  const url = `${origin}/__maude-inject/${injectedSeq}-${name}.js`;
  // `page.route` is per-URL; route each bundle exactly once and unroute after so
  // a long-lived page (the frame-step loop) carries no stale handlers.
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: content,
    })
  );
  try {
    await page.addScriptTag({ url, ...(type ? { type } : {}) });
  } finally {
    await page.unroute(url).catch(() => {});
  }
  void timeout;
}

/**
 * gate-b-c4d — may a shim's page at `pageUrl` make a request to `url`? Only to the origin its main
 * frame committed (the capture origin once the main origin's 307 has landed; the render worker's
 * loopback proxy in a cell), plus `data:` / `blob:`. A page that has not committed an http(s)
 * document (a popup's `about:blank`, no page at all) reaches nothing. Pure, so it is unit-tested.
 *
 * @param {string} url
 * @param {string | null | undefined} pageUrl
 */
export function shellRequestAllowed(url, pageUrl) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!pageUrl) return false;
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return false;
  }
  return origin !== 'null' && u.origin === origin;
}

function sameHref(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/**
 * gate-b-c4d — a browser context for rendering a canvas shell, confined like the thumbnail worker
 * (`_thumbs-playwright.mjs`). THE CANVAS IS UNTRUSTED CODE (DDR-054): in its owner's export it
 * could `window.open` the main origin's shell for ANOTHER canvas and, landing on its own capture
 * origin, read that frame. So every request the context makes is aborted unless it is
 *   - the shim's own navigation (`goto`), to exactly the URL it passed (one-shot per page; the
 *     main origin only 307s it — redirect hops are not routed), or
 *   - to the origin the requesting page's main frame committed (`shellRequestAllowed`).
 * Popups (their first navigation has no committed page), other origins, the main origin once the
 * shell has landed elsewhere, service workers (blocked) and WebSockets (closed) all fail.
 *
 * Use the returned `goto(page, url, opts)` for every navigation the shim makes itself; a bare
 * `page.goto` is refused.
 *
 * @param {import('playwright').Browser} browser
 * @param {import('playwright').BrowserContextOptions} [options]
 */
export async function newShellContext(browser, options = {}) {
  const ctx = await browser.newContext({ ...options, serviceWorkers: 'block' });
  /** @type {Map<import('playwright').Page, string>} */
  const entries = new Map();
  await ctx.route('**/*', (route) => {
    const req = route.request();
    let frame = null;
    let page = null;
    try {
      frame = req.frame();
      page = frame.page();
    } catch {
      /* a service worker, or a navigation issued before its frame exists (a popup) */
    }
    if (
      page &&
      req.isNavigationRequest() &&
      frame === page.mainFrame() &&
      entries.has(page) &&
      sameHref(entries.get(page), req.url())
    ) {
      entries.delete(page);
      return route.continue();
    }
    return shellRequestAllowed(req.url(), page ? page.mainFrame().url() : null)
      ? route.continue()
      : route.abort('blockedbyclient');
  });
  // The capture origin refuses upgrades anyway; nothing a capture renders needs a socket.
  await ctx.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: 'canvas capture' }));
  /**
   * @param {import('playwright').Page} page
   * @param {string} url
   * @param {Parameters<import('playwright').Page['goto']>[1]} [opts]
   */
  const goto = async (page, url, opts) => {
    entries.set(page, url);
    try {
      return await page.goto(url, opts);
    } finally {
      entries.delete(page);
    }
  };
  return { ctx, goto };
}

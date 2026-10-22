#!/usr/bin/env node
// _canvas-rects-playwright.mjs — playwright fallback for the geometry
// manifest (feature-whiteboard-ai-toolkit), used by canvas-rects.sh only when
// agent-browser isn't on PATH. Mirrors _enumerate-artboards-playwright.mjs's
// shape: a subprocess (not a direct import) so `bun build --compile` of the
// dev-server binary doesn't pull in playwright + chromium-bidi deep deps.
//
// Navigates the canvas-shell URL, waits for `window.__maudeCanvasRects` to
// exist (the canvas-lib.tsx module-load side effect), and prints the
// manifest JSON to stdout.
//
// Usage: _canvas-rects-playwright.mjs --url <url> [--timeout <sec>]

import { launchChromium, newShellContext } from './_pw-launch.mjs';

const args = process.argv.slice(2);
let url;
let timeoutSec = 8;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--url') {
    i += 1;
    url = args[i];
  } else if (args[i] === '--timeout') {
    i += 1;
    timeoutSec = Number(args[i]) || timeoutSec;
  }
}
if (!url) {
  console.error('usage: _canvas-rects-playwright.mjs --url <url> [--timeout <sec>]');
  process.exit(2);
}

const timeoutMs = timeoutSec * 1000;
const browser = await launchChromium();
try {
  // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
  const { ctx, goto: gotoShell } = await newShellContext(browser, {
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await gotoShell(page, url, { waitUntil: 'networkidle', timeout: timeoutMs });
  try {
    await page.waitForFunction("typeof window.__maudeCanvasRects === 'function'", {
      timeout: timeoutMs,
    });
  } catch {
    // Non-canvas page (no .dc-canvas) or the hook never installed — the hook
    // itself degrades gracefully (empty manifest), so proceed rather than fail.
  }
  const manifest = await page.evaluate(() =>
    typeof window.__maudeCanvasRects === 'function'
      ? window.__maudeCanvasRects()
      : { artboards: [], elements: [], elementsTruncated: false }
  );
  console.log(JSON.stringify(manifest));
} finally {
  await browser.close();
}

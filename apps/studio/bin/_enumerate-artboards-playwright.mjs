#!/usr/bin/env node
// Tiny playwright shim that lists `[data-dc-screen]` IDs on a canvas-shell URL,
// one per line on stdout. Spawned by `exporters/pptx.ts` for canvas-as-separate
// merge. Lives as a subprocess (not a direct import) so `bun build --compile`
// of the dev-server binary doesn't pull in playwright + chromium-bidi deep deps.

import { launchChromium, newShellContext } from './_pw-launch.mjs';

const args = process.argv.slice(2);
let url;
let timeoutSec = 20;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--url') {
    i += 1;
    url = args[i];
  } else if (args[i] === '--timeout') {
    i += 1;
    timeoutSec = Number(args[i]);
  }
}
if (!url) {
  console.error('usage: _enumerate-artboards-playwright.mjs --url <url> [--timeout <sec>]');
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
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dc-screen]')).map(
      (el) => el.getAttribute('data-dc-screen') ?? ''
    )
  );
  for (const id of ids.filter(Boolean)) console.log(id);
} finally {
  await browser.close();
}

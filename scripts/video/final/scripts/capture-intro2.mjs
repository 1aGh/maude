#!/usr/bin/env node
/**
 * Intro2 product captures (feature-public-site-v2, Task C2).
 *
 * Takes 1920×1080 stills of the REAL Maude studio (light theme) serving a throwaway demo
 * project, for the montage beat of the Intro2 film. Stills, not a screen recording: the film
 * moves them with a slow camera in Remotion, which stays sharp and deterministic.
 *
 * The studio must already run on the demo project, isolated from the real account:
 *   env HOME=<tmp>/home XDG_CONFIG_HOME=<tmp>/home/.config GIT_CONFIG_GLOBAL=<tmp>/home/.gitconfig \
 *       PATH=<stub-claude-dir>:$PATH NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 \
 *       bun run apps/studio/server.ts --root <demo> --port 4473
 * The demo project (see scripts/video/intro2-script.md § Captures) holds:
 *   ui/Landing page.tsx, ui/Launch reel.tsx, ui/Public Site v2.tsx (+ .css),
 *   system/maude-v2, ui/v2/_kit.*.
 *
 * Usage:
 *   STUDIO_URL=http://127.0.0.1:4473/ CHROME=<chromium path> \
 *     node scripts/capture-intro2.mjs [outDir]
 * Playwright is resolved from apps/studio's own install (no new dependency here).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const require = createRequire(path.join(REPO, 'apps/studio/package.json'));
const { chromium } = require('playwright');

const URL = process.env.STUDIO_URL ?? 'http://127.0.0.1:4473/';
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, '../public/intro2/captures'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {}
);
// 2x pixels so the film can push in on a capture and stay sharp.
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
// Follow the system theme (light here) instead of the studio's dark default.
await page.addInitScript(() => localStorage.setItem('maude-theme-auto', '1'));

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const shot = async (name) => {
  if (ONLY && !ONLY.has(name)) return;
  await page.mouse.move(1919, 1079); // park the pointer off every hover state
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`CAPTURE ${name}`);
};
const open = async (slug) => {
  await page.getByTestId(`canvas-row-${slug}`).click();
  await page.waitForTimeout(7000);
};
const fit = async () => {
  await page.mouse.click(1100, 600); // focus the canvas
  await page.keyboard.press('Escape'); // and drop the selection that click may make
  await page.keyboard.press('Meta+0'); // zoom to fit
  await page.waitForTimeout(1500);
};
// Pinch-zoom (ctrl + wheel) around a point of the canvas, the way a trackpad does it.
const zoomAt = async (x, y, ticks) => {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(80);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(1500);
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(4000);

// Screens + print: the demo landing canvas (web, mobile, print and social artboards).
// The film pushes in on its A3 poster for "print".
await open('ui-landing-page');
await fit();
await shot('canvas-landing');

// Screens: the real Public Site v2 canvas, on its Home artboard.
await open('ui-public-site-v2');
await fit();
await zoomAt(985, 520, Number(process.env.SITE_ZOOM ?? 8));
await shot('canvas-site');

// Slides: Present mode on the same canvas. Present opens on the artboard in view, so step
// through the first slides and keep each; the film uses the Home one (no price in the film).
await page.getByTestId('palette-mode-present').click();
await page.waitForTimeout(3500);
for (let i = 0; i < 3; i++) {
  await shot(`present-${i}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2000);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

// Reels: a video canvas, its artboard selected so the timeline shows.
await open('ui-launch-reel');
await fit();
// Click the artboard's name tag (top-left of the fitted artboard), not its content, so the
// artboard itself is selected and the timeline opens.
await page.mouse.click(Number(process.env.REEL_X ?? 818), Number(process.env.REEL_Y ?? 74));
await page.waitForTimeout(2500);
await shot('reels');

// A design system: the maude-v2 system page.
await page.getByTestId('canvases-ds-row').click();
await page.waitForTimeout(7000);
await zoomAt(760, 180, Number(process.env.DS_ZOOM ?? 10));
await shot('design-system');

await browser.close();

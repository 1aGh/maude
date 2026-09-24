#!/usr/bin/env node
// S19 in a real browser against a deployed backend: axe-core WCAG 2/2.1 A/AA
// scans of the studio shell AND the cross-origin canvas document, History and
// the accepted-version preview dialog, in light and dark; plus the keyboard
// contract of that dialog (focus moves in, Tab/Shift+Tab stay inside, Escape
// closes and returns focus to its opener) and the shell's live status regions.
//
//   node s19-browser.mjs --work <selfhost dir> --canvas "ui/Name.tsx" --axe <axe.min.js> --out <dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const fx = JSON.parse(readFileSync(join(arg('work'), 'fixture.json'), 'utf8'));
const rel = arg('canvas');
const axe = readFileSync(arg('axe'), 'utf8');
const out = arg('out');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(join(REPO, 'package.json'))('@playwright/test');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(target, scope) {
  // Measure the settled page, not a frame mid-transition (a fading row blends
  // its colours and reads as low contrast that nobody ever sees at rest).
  await target.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 3000)),
    ])
  );
  await target.evaluate(axe);
  const r = await target.evaluate(
    async (tags) => {
      const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
      return {
        engine: res.testEngine.version,
        violations: res.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.map((n) => n.target.join(' ')).slice(0, 10),
        })),
        passes: res.passes.length,
      };
    },
    TAGS
  );
  return { scope, ...r };
}

const browser = await chromium.launch();
const report = { backend: fx.backend, url: fx.browserUrl, canvas: rel, scans: [], keyboard: {}, live: {} };
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${fx.browserUrl}/studio/signin`);
  report.scans.push(await scan(page, 'sign-in page'));
  await page.locator('input[name=email]').fill(fx.users.owner.email);
  await page.locator('input[name=password]').fill(fx.users.owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const slug = rel.replace(/^ui\//, '').replace(/\.tsx$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await page.locator(`[data-testid="canvas-row-ui-${slug}"]`).click({ timeout: 60000 });
  await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().waitFor({ timeout: 60000 });
  for (const theme of ['light', 'dark']) {
    const current = await page.evaluate(() => document.querySelector('.maude')?.dataset.theme);
    if (current !== theme) await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
    await page.waitForTimeout(400);
    report.scans.push(await scan(page, `shell + open canvas (${theme})`));
    const frame = page.frames().find((f) => /_canvas-shell/.test(f.url()));
    if (frame) report.scans.push(await scan(frame, `canvas document (${theme})`));
    if ((await page.locator('[data-testid="open-changes"][aria-pressed="true"]').count()) === 0)
      await page.locator('[data-testid="open-changes"]').click();
    try {
      await page.locator('[data-testid^="project-history-row-"]').first().waitFor({ timeout: 30000 });
    } catch (error) {
      await page.screenshot({ path: join(out, `history-failure-${theme}.png`) });
      throw error;
    }
    report.scans.push(await scan(page, `history panel (${theme})`));
    const opener = page.locator('[data-testid^="project-history-preview-"]').first();
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="history-preview-version"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    report.scans.push(await scan(page, `accepted-version preview dialog (${theme})`));
    // Nothing from outside the modal may sit on top of its own controls.
    const obscured = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return ['no dialog'];
      return [...dialog.querySelectorAll('button, select, a[href], input, label, h1, h2, h3, [class*="lbl"]')]
        .filter((el) => el.getClientRects().length)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit && !dialog.contains(hit);
        })
        .map((el) => el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40));
    });
    // …and no fixed chrome from outside the modal may paint over its scrim.
    const aboveModal = await page.evaluate(() => {
      const scrim = document.querySelector('[role="dialog"][aria-modal="true"]')?.closest('.st-scrim, [class*="scrim"]');
      if (!scrim) return [];
      return [...document.querySelectorAll('body *')]
        .filter((el) => !scrim.contains(el) && getComputedStyle(el).position === 'fixed' && el.getClientRects().length)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit && el.contains(hit);
        })
        .map((el) => (el.className?.toString?.() || el.tagName).slice(0, 60));
    });
    obscured.push(...aboveModal.map((c) => `above modal: ${c}`));
    await page.screenshot({ path: join(out, `preview-dialog-${theme}.png`) });
    // Keyboard contract of the dialog.
    const inDialog = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [aria-modal="true"]'));
    const k = { focusMovedIn: await inDialog(), tabStayedIn: true, shiftTabStayedIn: true };
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      if (!(await inDialog())) k.tabStayedIn = false;
    }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Shift+Tab');
      if (!(await inDialog())) k.shiftTabStayedIn = false;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    k.escapeClosed = (await page.locator('[data-testid="history-preview-version"]').count()) === 0;
    k.focusReturnedToOpener = await page.evaluate(() =>
      (document.activeElement?.getAttribute('data-testid') ?? '').startsWith('project-history-preview-')
    );
    k.controlsObscured = obscured;
    report.keyboard[theme] = k;
  }
  report.live = await page.evaluate(() => ({
    statusRegions: [...document.querySelectorAll('[role="status"], [aria-live]')].length,
    lang: document.documentElement.lang || null,
    canvasFrameTitle: document.querySelector('[data-testid="canvas-frame"]')?.title ?? null,
  }));
  await page.screenshot({ path: join(out, 'shell-dark.png') });
} finally {
  await browser.close();
}
report.violations = report.scans.reduce((n, s) => n + s.violations.length, 0);
const keysOk = Object.values(report.keyboard).every(
  (k) =>
    k.focusMovedIn &&
    k.tabStayedIn &&
    k.shiftTabStayedIn &&
    k.escapeClosed &&
    k.focusReturnedToOpener &&
    k.controlsObscured.length === 0
);
report.status = report.violations === 0 && keysOk && report.live.statusRegions > 0 && report.live.lang ? 'pass' : 'fail';
writeFileSync(join(out, 's19-browser.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status: report.status,
    violations: report.scans.map((s) => ({ scope: s.scope, v: s.violations.map((v) => `${v.id}:${v.targets.length}`) })),
    keyboard: report.keyboard,
    live: report.live,
  })
);
process.exitCode = report.status === 'pass' ? 0 : 1;

// P8 test round, G2 — two people edit one canvas (14 · ed-edge-tereza) — browser E2E (node --test).
// A real studio server, the real shell and canvas in headless Chromium; each person is their own browser
// context (their own collab peer), named through `/_api/git-user` (see presence-together.e2e.mjs).
//
//   node --test apps/studio/test/e2e/edit-together.e2e.mjs
//
//   H1 Tereza selects See pricing: on my canvas her ring and her name sit on it
//   H2 I select it too: the inspector goes view mode — "Tereza … is editing See pricing. You can look; the
//      fields open when they move on." with one action, Comment; no field opens
//   H3 she moves on (esc): her ring goes and my fields open
//
// Board words differ in one place: the board says "when she moves on"; the product says "they" (it has no
// pronoun for a person) — S2.18 shipped it so, recorded in the hand-back.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { sleep, startServer } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = 'ui/Homepage.tsx';
const SHOTS =
  process.env.E2E_SHOTS_DIR ??
  resolve(
    HERE,
    '../../../../.ai/device/scenario-runs/p8-multiplayer',
    new Date().toISOString().replaceAll(':', '-')
  );

const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
export default function Homepage() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1200} height={700}>
        <section data-cd-id="hero" style={{ padding: 80 }}>
          <h1 data-cd-id="headline" style={{ fontSize: 56, margin: 0 }}>We build calm software</h1>
          <a data-cd-id="see-pricing" style={{ display: "inline-block", marginTop: 40, padding: "14px 28px", border: "2px solid black", borderRadius: 999, fontSize: 20 }}>See pricing</a>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function makeHome() {
  const root = mkdtempSync(join(tmpdir(), 'maude-edit-together-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify({ name: 'edit-together' }));
  writeFileSync(join(root, '.design', FILE), CANVAS);
  writeFileSync(
    join(root, '.design', 'ui', 'Homepage.meta.json'),
    JSON.stringify({ layout: { artboards: [{ id: 'desktop', x: 0, y: 0 }] } })
  );
  return root;
}

async function openPerson(browser, server, name) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    serviceWorkers: 'block',
  });
  await ctx.route(/\/_api\/git-user(\?|$)/, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name, email: null }) })
  );
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  await page.goto(`http://localhost:${server.port}/?open=${FILE}`, {
    waitUntil: 'domcontentloaded',
  });
  for (let i = 0; i < 300; i++) {
    const frame = page.frames().find((f) => f.url().includes('_canvas-shell'));
    const ok = await frame
      ?.evaluate(() => !!document.querySelector('[data-cd-id="see-pricing"]'))
      .catch(() => false);
    if (ok) return { name, ctx, page };
    await page.waitForTimeout(100);
  }
  throw new Error(`${name}: the canvas never mounted`);
}

const frameOf = (w) => w.page.frames().find((f) => f.url().includes('_canvas-shell'));

async function waitFor(fn, what, ms = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}

/** Click See pricing in a person's canvas (the iframe is reached by coordinates, like a person). */
async function selectButton(w) {
  const fb = await w.page.locator('[data-testid="canvas-frame"]').boundingBox();
  const r = await frameOf(w).evaluate(() => {
    const b = document.querySelector('[data-cd-id="see-pricing"]').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await w.page.mouse.click(fb.x + r.x, fb.y + r.y);
  const picked = async () =>
    (await w.page.locator('[data-testid="inspector-crumbs"]').textContent().catch(() => ''))?.includes(
      'See pricing'
    );
  if (!(await waitFor(picked, 'selected', 3_000).catch(() => false))) {
    // a click lands on the artboard first; the second goes in
    await w.page.mouse.dblclick(fb.x + r.x, fb.y + r.y);
    await waitFor(picked, `${w.name} selects See pricing`);
  }
}

async function shot(w, name) {
  mkdirSync(SHOTS, { recursive: true });
  await w.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const rings = (w) =>
  frameOf(w).evaluate(() =>
    [...document.querySelectorAll('[data-testid="edit-hold-ring"]')].map(
      (el) => el.querySelector('.ed-hold-tag')?.textContent ?? ''
    )
  );

describe('two people, one button (14 · ed-edge-tereza)', () => {
  let server;
  let browser;
  let you;
  let tereza;
  before(async () => {
    server = await startServer(makeHome());
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
    you = await openPerson(browser, server, 'Michal Dovrtěl');
    tereza = await openPerson(browser, server, 'Tereza Nováková');
  });
  after(async () => {
    console.log(`edit-together shots: ${SHOTS}`);
    await browser?.close().catch(() => {});
    server?.stop();
  });

  test('H1 Tereza selects See pricing: her ring and her name sit on it on my canvas', async () => {
    await selectButton(tereza);
    // She is EDITING it: a field of her inspector has focus (a selection alone holds nothing — the hold
    // matrix is selected AND app focus AND a focused field or a gesture in the last 30 s).
    const field = tereza.page
      .locator('[class*="insp"] input:not([type="checkbox"]):not([disabled])')
      .first();
    await field.waitFor({ timeout: 10_000 });
    await field.focus();
    const tags = await waitFor(async () => {
      const t = await rings(you);
      return t.length ? t : null;
    }, 'her hold ring on my canvas');
    assert.deepEqual(tags, ['Tereza Nováková']);
    // my own selection makes no ring on HER canvas until I hold it
    assert.deepEqual(await rings(tereza), []);
  });

  test('H2 I select it too: view mode, her line, one action — Comment; no field opens', async () => {
    await selectButton(you);
    const line = you.page.locator('[data-testid="inspector-hold-line"]');
    await line.waitFor({ timeout: 10_000 });
    const text = (await line.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
    assert.match(
      text,
      /^Tereza Nováková is editing See pricing\. You can look; the fields open when they move on\.\s*Comment$/
    );
    assert.deepEqual(
      (await line.locator('button').allTextContents()).map((s) => s.trim()),
      ['Comment']
    );
    // every value is readable but nothing is editable
    const editable = await you.page.evaluate(() => {
      const root = document.querySelector('.ed-insp--view');
      if (!root) return null;
      // the fields sit in a disabled <fieldset> (`.ed-insp-fields`): `:disabled` is the truth, not `.disabled`
      return [...root.querySelectorAll('input, select, textarea')].filter(
        (el) => !el.matches(':disabled') && !el.readOnly
      ).length;
    });
    assert.equal(editable, 0, 'the inspector is in view mode with no open field');
    await shot(you, '14-ed-edge-tereza');
  });

  test('H3 she moves on: her ring goes, my fields open', async () => {
    await frameOf(tereza).evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    );
    await tereza.page.keyboard.press('Escape');
    await waitFor(async () => (await rings(you)).length === 0, 'her ring leaves my canvas', 40_000);
    await waitFor(
      async () => (await you.page.locator('[data-testid="inspector-hold-line"]').count()) === 0,
      'the hold line goes'
    );
    assert.equal(await you.page.locator('.ed-insp--view').count(), 0);
  });
});

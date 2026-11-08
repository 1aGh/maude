// #122 (slice 122-B) — copy / cut / paste of artboards BETWEEN canvases, in a real browser on a real studio server.
//
//   node --test apps/studio/test/e2e/clipboard-cross-canvas.e2e.mjs      (E2E_HEADED=1 to watch)
//
//   X1  ⌘C on Home's "Hero" artboard (it reads `const W = 480` from Home's module scope), a switch to About through
//       the tree, ⌘V → the shell asks on its own toast ("Paste the artboard copied in Home?"), Paste → the board
//       lands in About WITH the constant it reads: the canvas renders it (no error card), and says what came along
//   X2  ⌘Z on About takes the paste (and the carried constant) out in one step
//   X3  ⌘X on Home's Hero: it leaves Home's source (and goes to the Trash); ⌘Z on Home puts it back
//
// The shell holds the clipboard handle in memory, so the canvases are switched through the tree — never a reload.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';

import { e2eProjectConfig, sleep, startServer } from './harness.mjs';

const HOME = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
const W = 480;
export default function Home() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Home">
        <DCArtboard id="hero" label="Hero" width={W} height={240}>
          <div style={{ padding: 16 }}>
            <h2 className="hero-title">Hero width {W}</h2>
          </div>
        </DCArtboard>
        <DCArtboard id="spare" label="Spare" width={320} height={200}>
          <div style={{ padding: 16 }}>
            <p className="spare-copy">Spare</p>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const ABOUT = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function About() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="About">
        <DCArtboard id="intro" label="Intro" width={360} height={200}>
          <div style={{ padding: 16 }}>
            <h2 className="about-title">About us</h2>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'maude-clipx-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      ...e2eProjectConfig('clipx-e2e'),
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      designSystems: [],
    })
  );
  writeFileSync(join(root, '.design', 'ui', 'Home.tsx'), HOME);
  writeFileSync(
    join(root, '.design', 'ui', 'Home.meta.json'),
    JSON.stringify({
      layout: {
        artboards: [
          { id: 'hero', x: 100, y: 120 },
          { id: 'spare', x: 700, y: 120 },
        ],
      },
    })
  );
  writeFileSync(join(root, '.design', 'ui', 'About.tsx'), ABOUT);
  writeFileSync(
    join(root, '.design', 'ui', 'About.meta.json'),
    JSON.stringify({ layout: { artboards: [{ id: 'intro', x: 100, y: 120 }] } })
  );
  return root;
}

async function waitFor(fn, what, ms = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve()
      .then(fn)
      .catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}

let browser;
let root;
let server;
let page;
const src = (name) => readFileSync(join(root, '.design', 'ui', `${name}.tsx`), 'utf8');
const boards = (s) => (s.match(/<DCArtboard\b/g) ?? []).length;
/** The live canvas frame (a write can re-navigate it: always look it up again). */
const frame = () => page.frames().find((f) => f.url().includes('_canvas-shell'));
const inFrame = (fn, arg) => frame()?.evaluate(fn, arg);

/** Open a canvas from the tree (no reload: the shell keeps the clipboard handle in memory). */
async function openFromTree(slug, mounted) {
  await page.locator(`[data-testid="canvas-row-ui-${slug}"]`).first().click({ timeout: 10_000 });
  await waitFor(
    () => inFrame((sel) => !!document.querySelector(sel), mounted),
    `${slug} mounted`,
    30_000
  );
  await sleep(1200);
}

/** Select an artboard by its label button, leaving the keyboard focus in the canvas frame. */
async function selectBoard(id) {
  await waitFor(async () => {
    const b = await inFrame((i) => {
      const el = document.querySelector(`[data-dc-screen="${i}"] .dc-artboard-label`);
      const r = el?.getBoundingClientRect();
      return r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, id);
    if (!b) return false;
    const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
    await page.mouse.move(fb.x + b.x, fb.y + b.y);
    await sleep(80);
    await page.mouse.click(fb.x + b.x, fb.y + b.y);
    await sleep(300);
    return true;
  }, `${id} selected`);
}

const marker = () =>
  page.evaluate(() => navigator.clipboard.readText().catch(() => '')).then((t) => t ?? '');

describe('#122 — artboards travel between canvases with what they read', () => {
  before(async () => {
    root = makeProject();
    server = await startServer(root);
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
    page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mdcc-usage-tour-seen', '1');
        localStorage.setItem('mdcc-collab-tour-seen', '1');
      } catch {}
    });
    await page.goto(`http://localhost:${server.port}/?open=ui/Home.tsx`, {
      waitUntil: 'domcontentloaded',
    });
    await waitFor(
      () => inFrame(() => !!document.querySelector('h2.hero-title')),
      'Home mounted',
      30_000
    );
    await sleep(1500);
  });
  after(async () => {
    await browser?.close();
    server?.stop();
  });

  test('X1 — copy Hero on Home, paste on About: it brings the constant it reads and renders', async () => {
    await selectBoard('hero');
    await page.keyboard.press('Meta+c');
    await waitFor(
      async () => (await marker()).endsWith('(maude-clip)'),
      'the copy left its marker'
    );
    assert.match(await marker(), /1 artboard/);
    assert.equal(boards(src('Home')), 2, 'a copy writes nothing');

    await openFromTree('about', 'h2.about-title');
    // focus back in the canvas, then ⌘V: the paste of a clip copied elsewhere waits for the shell's own toast
    await selectBoard('intro');
    await page.keyboard.press('Meta+v');
    const ask = page.locator('[data-testid="notice-canvas-clip-confirm"]');
    await ask.waitFor({ timeout: 10_000 }).catch(async (e) => {
      const seen = await page.locator('.maude-notice-title').allInnerTexts();
      throw new Error(
        `no confirm toast; notices: ${JSON.stringify(seen)}; clipboard: ${await marker()}; ${e.message}`
      );
    });
    assert.equal(
      await ask.locator('.maude-notice-title').innerText(),
      'Paste the artboard copied in Home?'
    );
    assert.equal(boards(src('About')), 1, 'nothing is pasted before the click on Paste');
    await ask.locator('.maude-notice-action').click();

    await waitFor(() => boards(src('About')) === 2, 'the board reached About.tsx');
    const about = src('About');
    assert.match(about, /const W = 480/, 'the constant the board reads came along');
    assert.equal((about.match(/const W\b/g) ?? []).length, 1, 'declared once');
    // it renders in About: the pasted board's text is on the canvas and no error card replaced the canvas
    await waitFor(
      () => inFrame(() => /Hero width 480/.test(document.body.innerText)),
      'the pasted board rendered in About'
    );
    assert.equal(
      await page.locator('[data-testid="canvas-error-card"]').count(),
      0,
      'no error card'
    );
    // and the canvas says what came along
    const said = page.locator('[data-testid^="notice-canvas-notice-"] .maude-notice-title');
    await waitFor(
      async () =>
        (await said.allInnerTexts()).some((t) => t === 'Pasted the artboard · added 1 declaration'),
      'the carried words'
    );
  });

  test('X2 — ⌘Z on About takes the paste, and what it carried, out in one step', async () => {
    await selectBoard('intro');
    await page.keyboard.press('Meta+z');
    await waitFor(() => boards(src('About')) === 1, 'the paste is undone');
    assert.doesNotMatch(src('About'), /const W/, 'the carried constant left with it');
    assert.equal(boards(src('Home')), 2, 'Home was not touched');
  });

  test('X3 — ⌘X on Home’s Hero takes it out of Home; ⌘Z on Home puts it back', async () => {
    await openFromTree('home', 'h2.hero-title');
    await selectBoard('hero');
    await page.keyboard.press('Meta+x');
    await waitFor(() => !/id="hero"/.test(src('Home')), 'Hero left Home.tsx');
    assert.match(src('Home'), /id="spare"/, 'the other board stays');
    // the cut is a move to the Trash, not a deletion: the clip is on the clipboard, the board is restorable
    assert.match(await marker(), /1 artboard/);
    await waitFor(
      () => inFrame(() => !document.querySelector('h2.hero-title')),
      'Hero left the canvas'
    );

    await selectBoard('spare');
    await page.keyboard.press('Meta+z');
    await waitFor(() => /id="hero"/.test(src('Home')), 'Hero is back in Home.tsx');
    await waitFor(
      () => inFrame(() => !!document.querySelector('h2.hero-title')),
      'Hero is back on the canvas'
    );
    assert.match(src('Home'), /const W = 480/, 'Home still declares what Hero reads');
  });
});

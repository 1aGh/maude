// Browser E2E harness for the annotation layer (annotations v2 plan, Task 29).
//
// Boots a real studio server on a throwaway project, drives the real canvas in
// headless Chromium through Playwright, and reads the board back from DISK — so
// a scenario asserts what the user sees AND what was persisted.
//
//   STUDIO_DIR=<apps/studio of another checkout>  run the same scenarios against
//                                                  a different build (baseline)
//   E2E_HEADED=1                                  watch it
//
// The canvas lives in a cross-origin iframe; Playwright reaches it through
// `page.frames()`. Pointer input is dispatched at PAGE coordinates, so frame-
// relative boxes are offset by the iframe's own box (`toPage`).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STUDIO_DIR = resolve(process.env.STUDIO_DIR ?? join(HERE, '..', '..'));
const require = createRequire(join(HERE, '..', '..', 'package.json'));
const { chromium } = require('playwright');

// A real canvas (the annotation layer mounts into DesignCanvas's world). One
// small artboard parked left of the annotation area, so board clicks land on
// empty canvas the way a whiteboard is used.
const CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="E2E">
        <DCArtboard id="a" label="A" width={200} height={120}>
          <div style={{ padding: 8 }}>artboard</div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const META = { layout: { artboards: [{ id: 'a', x: 700, y: 700 }] } };

async function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/**
 * The same board as a v1 `.annotations.svg` — for running a scenario against a
 * pre-v2 build (STUDIO_DIR=<baseline>). Rendered through this checkout's
 * v1 adapter + canonical v1 serializer.
 */
export async function legacySvgOf(board) {
  const { elementsToStrokes } = await import('../../annotations/v1-adapter.ts');
  const { strokesToSvg } = await import('../../annotations-model.ts');
  return strokesToSvg(elementsToStrokes(board));
}

/** A throwaway project whose `ui/Board.tsx` carries `board` (v2 elements) and/or `legacySvg`. */
export async function makeProjectFor(board) {
  // A pre-v2 baseline reads only the SVG sidecar.
  return process.env.E2E_LEGACY === '1'
    ? makeProject({ legacySvg: await legacySvgOf(board) })
    : makeProject({ board });
}

export function makeProject({ board = null, legacySvg = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'maude-ann-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify({ name: 'ann-e2e' }));
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), CANVAS);
  writeFileSync(join(root, '.design', 'ui', 'Board.meta.json'), JSON.stringify(META));
  if (board) {
    const lines = board.map((e) => JSON.stringify(e));
    writeFileSync(
      join(root, '.design', 'ui-board.annotations.json'),
      `{"format":"maude.annotations","v":2,"elements":[\n${lines.join(',\n')}\n]}\n`
    );
  }
  if (legacySvg) writeFileSync(join(root, '.design', 'ui-board.annotations.svg'), legacySvg);
  return root;
}

export async function startServer(root) {
  const port = await freePort();
  const proc = spawn(
    'bun',
    ['run', join(STUDIO_DIR, 'server.ts'), '--root', root, '--port', String(port)],
    {
      env: { ...process.env, MAUDE_NO_AUTOBUILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 30_000) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!up) throw new Error(`studio server did not start:\n${log}`);
  return { port, root, log: () => log, stop: () => proc.kill('SIGTERM') };
}

/** The board on disk (v2 JSON), keyed by id; null when absent. */
export function readBoard(root) {
  try {
    const doc = JSON.parse(
      readFileSync(join(root, '.design', 'ui-board.annotations.json'), 'utf8')
    );
    return new Map(doc.elements.map((e) => [e.id, e]));
  } catch {
    return null;
  }
}

/** Wait until `pred(board)` holds (disk writes are async). Returns the board. */
export async function waitForBoard(root, pred, ms = 5000) {
  const t0 = Date.now();
  let b = readBoard(root);
  while (Date.now() - t0 < ms) {
    b = readBoard(root);
    if (b && pred(b)) return b;
    await new Promise((r) => setTimeout(r, 100));
  }
  return b;
}

export async function openCanvas(server) {
  const dbg = (m) => process.env.E2E_DEBUG && console.error(`[e2e] ${m}`);
  dbg('launch');
  const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
  const page = await browser.newPage({ viewport: { width: 2600, height: 1500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A returning user: the first-run tour would sit over the canvas.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  dbg('goto');
  await page.goto(`http://localhost:${server.port}/?open=ui/Board.tsx`, {
    waitUntil: 'domcontentloaded',
  });
  dbg('loaded');
  let frame = null;
  const t0 = Date.now();
  while (!frame && Date.now() - t0 < 20_000) {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell')) ?? null;
    if (!frame) await page.waitForTimeout(100);
  }
  if (!frame) throw new Error('canvas frame never appeared');
  dbg(`frame ${frame.url()}`);
  // Poll instead of waitForSelector: the canvas iframe can re-navigate while
  // the canvas module builds, and a detached frame's wait never settles.
  let mounted = false;
  for (let i = 0; i < 60 && !mounted; i++) {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell')) ?? frame;
    const state = await Promise.race([
      frame
        .evaluate(() => ({
          svg: !!document.querySelector('.dc-annot-svg'),
          world: !!document.querySelector('.dc-world'),
          text: document.body?.innerText.slice(0, 120) ?? '',
        }))
        .catch((e) => ({ err: String(e).slice(0, 120) })),
      new Promise((r) => setTimeout(() => r({ err: 'evaluate timeout' }), 2000)),
    ]);
    dbg(`mount poll ${i}: ${JSON.stringify(state)}`);
    mounted = state?.svg === true;
    if (!mounted) await new Promise((r) => setTimeout(r, 500));
  }
  try {
    if (!mounted) throw new Error('not mounted');
  } catch (err) {
    const shot = join(tmpdir(), 'ann-e2e-boot-failure.png');
    await page.screenshot({ path: shot }).catch(() => {});
    const body = await frame
      .evaluate(() => document.body?.innerText.slice(0, 500))
      .catch(() => '?');
    throw new Error(
      `annotation layer never mounted (${frame.url()})\nframe text: ${body}\nerrors: ${errors.join('\n')}\nshot: ${shot}\nserver: ${server.log().slice(-1500)}`
    );
  }
  await page.waitForTimeout(500);
  const frameBox = await page.locator('[data-testid="canvas-frame"]').boundingBox();
  // Fit everything into view: a double-click on empty canvas is the shell's fit().
  await page.mouse.dblclick(frameBox.x + 12, frameBox.y + frameBox.height - 12);
  await page.waitForTimeout(700);
  const c = {
    browser,
    page,
    frame,
    errors,
    /** Frame-relative point → page point. */
    toPage: (x, y) => [x + frameBox.x, y + frameBox.y],
    async box(selector) {
      const b = await frame.locator(selector).first().boundingBox({ timeout: 3000 });
      if (!b) throw new Error(`no box for ${selector}`);
      return b;
    },
    /** Page-coordinate box of an annotation element by id. */
    // Playwright's boundingBox() is already relative to the MAIN frame's
    // viewport, even for elements inside the canvas iframe.
    async pageBox(id) {
      return c.box(`.dc-annot-svg [data-id="${id}"]`);
    },
    async center(id) {
      const b = await c.pageBox(id);
      return [b.x + b.width / 2, b.y + b.height / 2];
    },
    async selection() {
      const v = await frame.locator('.dc-annot-svg').first().getAttribute('data-selection');
      return (v ?? '').split(' ').filter(Boolean).sort();
    },
    /** The open text editor, if any: text + caret info from the frame's DOM selection. */
    async editor() {
      return frame.evaluate(() => {
        const ed = document.querySelector('.dc-annot-editor, [data-annot-editor]');
        if (!ed) return null;
        const sel = window.getSelection();
        let caretRect = null;
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0).cloneRange();
          r.collapse(true);
          const rects = r.getClientRects();
          const rect = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
          caretRect = { x: rect.x, y: rect.y, h: rect.height };
        }
        const fake = document.querySelector('[data-maude-caret]');
        const fr = fake ? fake.getBoundingClientRect() : null;
        return {
          text: ed.innerText,
          caretRect,
          fakeCaret: fr
            ? { x: fr.x, y: fr.y, h: fr.height, display: getComputedStyle(fake).display }
            : null,
          box: ed.getBoundingClientRect().toJSON(),
        };
      });
    },
    /** Click at a page point, holding `modifiers` (page.mouse.click has no modifier option). */
    async click(x, y, { modifiers = [] } = {}) {
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.click(x, y);
      for (const m of modifiers) await page.keyboard.up(m);
    },
    async drag(from, to, { steps = 12, modifiers = [] } = {}) {
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.move(from[0], from[1]);
      await page.mouse.down();
      await page.mouse.move(to[0], to[1], { steps });
      await page.mouse.up();
      for (const m of modifiers) await page.keyboard.up(m);
    },
    async shot(name) {
      await page.screenshot({ path: join(tmpdir(), `ann-e2e-${name}.png`) });
      return join(tmpdir(), `ann-e2e-${name}.png`);
    },
    async close() {
      await browser.close();
    },
  };
  return c;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// #224 — the left panel still scrolls while a big Design system's artboard list is open.
//
// The pinned Design system row opens into its Design system canvas's artboards (2.0.7 B3). Those rows sit in
// `.lp-pinned`, above the windowed canvas list; when the strip could not scroll or shrink, a system with ~60
// artboards pushed the canvas list (the panel's only scroller) out of the clipped panel and no wheel scrolled
// anything. This boots the studio on a throwaway project whose system has 60 artboards and 48 canvases, opens the
// system and its list, and asks the browser: the panel does not overflow, the canvas list keeps real height and
// scrolls under the wheel, and the pinned strip scrolls under the wheel too.
// CSS pin: test/224-ds-pinned-scroll.test.ts.
//
//   node --test apps/studio/test/e2e/ds-pinned-scroll.e2e.mjs          (both engines that are installed)
//   E2E_ENGINES=webkit node --test apps/studio/test/e2e/ds-pinned-scroll.e2e.mjs
// Requires a built `apps/studio/dist` (MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = resolve(process.env.STUDIO_DIR ?? join(HERE, '..', '..'));
const require = createRequire(join(HERE, '..', '..', 'package.json'));
const playwright = require('playwright');
const ENGINES = (process.env.E2E_ENGINES ?? 'webkit,chromium').split(',').filter(Boolean);
const BOARDS = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeProject() {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-224-'));
  const root = join(scratch, 'project');
  const sys = join(root, '.design', 'system', 'big');
  mkdirSync(sys, { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      name: 'ds-224',
      formatVersion: 2,
      designSystems: [{ name: 'big', path: 'system/big' }],
    })
  );
  writeFileSync(join(sys, 'colors_and_type.css'), ':root { --bg-0: #fff; }\n');
  const boards = Array.from(
    { length: BOARDS },
    (_, i) =>
      `      <DCArtboard id="s${i}" label="Section ${i + 1}" width={400} height={300}><div>${i}</div></DCArtboard>`
  ).join('\n');
  writeFileSync(
    join(sys, 'design-system.tsx'),
    `/**\n * @canvas Design system\n * @ds big\n */\nimport { DesignCanvas, DCArtboard } from "@maude/canvas-lib";\n\nexport default function DesignSystem() {\n  return (\n    <DesignCanvas>\n${boards}\n    </DesignCanvas>\n  );\n}\n`
  );
  for (const f of ['a', 'b', 'c', 'd']) {
    const dir = join(root, '.design', 'ui', `folder-${f}`);
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 12; i++)
      writeFileSync(
        join(dir, `screen-${f}-${i}.tsx`),
        `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";\nexport default function C() {\n  return (<DesignCanvas><DCArtboard id="a" label="A" width={400} height={300}><div>${f}${i}</div></DCArtboard></DesignCanvas>);\n}\n`
      );
  }
  // a throwaway HOME/XDG and a signed-out stub claude: never the person's real config, keychain or CLI
  const home = join(scratch, 'home');
  const stubBin = join(scratch, 'stub-bin');
  mkdirSync(join(home, '.config', 'maude'), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, 'claude'), '#!/bin/sh\necho \'{"loggedIn":false}\'\n', {
    mode: 0o755,
  });
  return { scratch, root, home, stubBin };
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function startServer({ root, home, stubBin, scratch }) {
  const port = await freePort();
  const proc = spawn(
    'bun',
    ['run', join(STUDIO, 'server.ts'), '--root', root, '--port', String(port)],
    {
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_MACHINE_FILE: join(scratch, 'machine.json'),
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        MAUDE_UI_PREFS_PATH: join(home, '.config', 'maude', 'prefs.json'),
        MAUDE_CLOUD_CONFIG: join(home, '.config', 'maude', 'cloud.json'),
        HUBS_CONFIG_PATH: join(home, '.config', 'maude', 'hubs.json'),
        MAUDE_CLAUDE_BIN: '',
        PATH: `${stubBin}:${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok)
        return { url: `http://localhost:${port}/`, stop: () => proc.kill('SIGTERM') };
    } catch {}
    await sleep(200);
  }
  proc.kill('SIGTERM');
  throw new Error(`studio server did not start:\n${log.slice(-3000)}`);
}

/** Wheel at the centre of `locator`'s visible part; returns how far the element named by `measure` scrolled. */
async function wheelOver(page, locator, measure) {
  const box = await locator.boundingBox();
  assert.ok(box && box.height > 0, 'the target has a visible box');
  const before = await measure.evaluate((el) => el.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 60));
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 100);
    await sleep(50);
  }
  await sleep(400);
  return (await measure.evaluate((el) => el.scrollTop)) - before;
}

let fx;
let server;
before(async () => {
  fx = makeProject();
  server = await startServer(fx);
});
after(() => {
  server?.stop();
  if (fx) rmSync(fx.scratch, { recursive: true, force: true });
});

for (const engine of ENGINES) {
  describe(`#224 — ${engine}`, () => {
    test('a Design system with its artboard list open leaves the left panel scrollable', async () => {
      const browser = await playwright[engine].launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.goto(server.url);
        const list = page.locator('[data-testid="canvas-list"]');
        await list.waitFor({ timeout: 20_000 });
        // every folder open, so the canvas list is longer than the panel
        for (let k = 0; k < 8; k++) {
          const f = page.locator('[data-testid^="tree-folder-"][aria-expanded="false"]').first();
          if (!(await f.count())) break;
          await f.click();
          await sleep(120);
        }
        // the Design system open, and its row's artboard list open
        const dsRow = page.locator('[data-testid="canvases-ds-row"]').first();
        await dsRow.click();
        await sleep(2500);
        // the system row is whole inside its strip, the list closed and (below) open
        const rowWhole = () =>
          page.evaluate(() => {
            const p = document.querySelector('[data-testid="canvases-pinned"]');
            const r = document
              .querySelector('[data-testid="canvases-ds-row"]')
              .getBoundingClientRect();
            const b = p.getBoundingClientRect();
            return {
              scrollTop: p.scrollTop,
              whole: r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5,
            };
          });
        assert.deepEqual(await rowWhole(), { scrollTop: 0, whole: true }, 'list closed');
        const toggle = page
          .locator('[data-testid="canvases-pinned"] [data-testid^="canvas-jump-toggle-"]')
          .first();
        await dsRow.hover();
        await toggle.click({ force: true });
        const pinned = page.locator('[data-testid="canvases-pinned"]');
        await page.locator('[data-testid="canvases-ds-boards"]').waitFor({ timeout: 5_000 });
        assert.equal(
          await page.locator('[data-testid="canvases-ds-boards"] .lp-ds-board').count(),
          BOARDS
        );
        assert.deepEqual(await rowWhole(), { scrollTop: 0, whole: true }, 'list open');

        const m = await page.evaluate(() => {
          const sb = document.querySelector('.sh-sidebar');
          const tree = document.querySelector('[data-testid="canvas-list"]');
          const sr = sb.getBoundingClientRect();
          const tr = tree.getBoundingClientRect();
          return {
            sbOverflow: sb.scrollHeight - sb.clientHeight,
            treeH: tree.clientHeight,
            treeInside: tr.top >= sr.top - 1 && tr.bottom <= sr.bottom + 1,
            treeLong: tree.scrollHeight > tree.clientHeight,
          };
        });
        // the panel no longer overflows its clip, and the canvas list keeps real room inside it
        assert.ok(m.sbOverflow <= 1, `the left panel overflows by ${m.sbOverflow}px`);
        assert.ok(m.treeInside, 'the canvas list sits inside the left panel');
        assert.ok(m.treeH >= 80, `the canvas list is ${m.treeH}px tall`);
        assert.ok(m.treeLong, 'fixture: the canvas list is longer than its box');
        // a wheel over the canvas list scrolls it; a wheel over the artboard list scrolls the pinned strip
        assert.ok(
          (await wheelOver(page, list, list)) > 0,
          'the canvas list scrolls under the wheel'
        );
        assert.ok(
          (await wheelOver(page, pinned, pinned)) > 0,
          'the artboard list scrolls under the wheel'
        );
      } finally {
        await browser.close();
      }
    });
  });
}

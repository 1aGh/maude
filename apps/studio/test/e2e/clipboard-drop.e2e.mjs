// Browser E2E — Michal's rc.1 items 13 / 10 / 14 (r1-clipboard-drop), on a real studio server + real canvas frame.
//
//   13  ⌘C on an object in artboard A, a click on an object in B, ⌘V → the copy is in B (one write, new id);
//       ⌘X then ⌘Z brings the object back. Before the fix ⌘C left nothing on the clipboard and ⌘V did nothing.
//   10  an Assets drop the canvas sees only as `text/plain` (WebKit hides the shell's custom MIME type from the
//       canvas origin) → the picture is placed in the artboard under the pointer.
//   14  in Edit, a press on a board picture on bare canvas shows "Switch to Preview to move it · ⌥⌘P".
//
//   node apps/studio/test/e2e/clipboard-drop.e2e.mjs      (E2E_HEADED=1 to watch)

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STUDIO_DIR, startServer } from './harness.mjs';

const require = createRequire(join(STUDIO_DIR, 'package.json'));
const { chromium } = require('playwright');

const CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Clip() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Clip">
        <DCArtboard id="a" label="A" width={320} height={200}>
          <div style={{ padding: 16 }}>
            <h2 className="alpha">Alpha heading</h2>
          </div>
        </DCArtboard>
        <DCArtboard id="b" label="B" width={320} height={200}>
          <div style={{ padding: 16 }}>
            <h2 className="beta">Beta heading</h2>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'maude-clip-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'stadium.png'), PNG);
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({
      name: 'clip-e2e',
      designRoot: '.design',
      formatVersion: 2,
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      designSystems: [],
    })
  );
  writeFileSync(join(root, '.design', 'ui', 'Clip.tsx'), CANVAS);
  writeFileSync(
    join(root, '.design', 'ui', 'Clip.meta.json'),
    JSON.stringify({
      layout: {
        artboards: [
          { id: 'a', x: 100, y: 100 },
          { id: 'b', x: 500, y: 100 },
        ],
      },
    })
  );
  // a picture on the board, below the artboards (bare canvas) — what a Finder drop there makes
  writeFileSync(
    join(root, '.design', 'ui-clip.annotations.json'),
    `{"format":"maude.annotations","v":2,"elements":[\n${JSON.stringify({ id: 'pic', type: 'image', index: 'a0', x: 120, y: 420, w: 160, h: 100, href: 'assets/stadium.png' })}\n]}\n`
  );
  return root;
}

const source = (root) => readFileSync(join(root, '.design', 'ui', 'Clip.tsx'), 'utf8');
const count = (s, re) => (s.match(re) || []).length;
async function until(pred, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await Promise.resolve().then(pred).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const root = makeProject();
const server = await startServer(root);
const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await page.addInitScript(() => {
  try {
    localStorage.setItem('mdcc-usage-tour-seen', '1');
    localStorage.setItem('mdcc-collab-tour-seen', '1');
  } catch {}
});
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
};
try {
  await page.goto(`http://localhost:${server.port}/?open=ui/Clip.tsx`);
  let frame;
  await until(async () => {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell'));
    return !!(frame && (await frame.$('h2.alpha').catch(() => null)));
  }, 30_000);
  assert.ok(frame, 'canvas frame mounted');
  await page.waitForTimeout(1500);
  const centre = async (sel) => {
    // a write can re-navigate the frame: always the live one
    frame = page.frames().find((f) => f.url().includes('_canvas-shell')) ?? frame;
    const el = await frame.$(sel);
    if (!el) throw new Error(`${sel} is not in the frame`);
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const click = async (sel) => {
    const p = await centre(sel);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
  };

  await step('13 ⌘C in A, ⌘V on B puts the copy in B with a new id', async () => {
    await click('h2.alpha');
    await page.keyboard.press('Meta+c');
    assert.ok(
      await until(async () =>
        (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))).endsWith(
          '(maude-clip)'
        )
      ),
      'the copy left the Maude marker on the clipboard'
    );
    await click('h2.beta');
    await page.keyboard.press('Meta+v');
    assert.ok(
      await until(() => count(source(root), /Alpha heading/g) === 2),
      'a second Alpha heading'
    );
    const src = source(root);
    const b = src.slice(src.indexOf('id="b"'));
    assert.match(b, /Alpha heading/, 'the copy is inside artboard B');
    const ids = [...src.matchAll(/data-cd-id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'every stamped id is unique');
  });

  await step('13 ⌘X removes the object, ⌘Z brings it back', async () => {
    const before = count(source(root), /Beta heading/g);
    // the paste re-rendered the frame from the file and the new DOM starts with nothing selected: a key pressed
    // in that gap goes nowhere, so select again and press again until the cut lands (as edit-object-ops does)
    const cut = await until(async () => {
      if (count(source(root), /Beta heading/g) === before - 1) return true;
      await click('h2.beta');
      await page.keyboard.press('Meta+x');
      await page.waitForTimeout(600);
      return count(source(root), /Beta heading/g) === before - 1;
    }, 12_000);
    assert.ok(cut, 'cut');
    await page.keyboard.press('Meta+z');
    assert.ok(await until(() => count(source(root), /Beta heading/g) === before), 'undone');
  });

  await step('10 an Assets drop seen only as text/plain places the picture', async () => {
    const at = await centre('h2.alpha');
    const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
    await frame.evaluate(
      ({ x, y }) => {
        const dt = new DataTransfer();
        // what WebKit shows the canvas origin of the tile's drag: the plain-text twin only
        dt.setData('text/plain', 'assets/stadium.png');
        const el = document.elementFromPoint(x, y) ?? document.body;
        for (const type of ['dragenter', 'dragover', 'drop'])
          el.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              dataTransfer: dt,
            })
          );
      },
      { x: at.x - fb.x, y: at.y - fb.y }
    );
    assert.ok(
      await until(() => /stadium\.png/.test(source(root))),
      'the picture is in the canvas source'
    );
  });

  await step('14 a press on a board picture in Edit says to switch to Preview', async () => {
    const tip = await until(async () => {
      const pic = await frame.evaluate(() => {
        const n = document.querySelector('[data-id="pic"], [data-an-id="pic"]');
        const r = n?.getBoundingClientRect();
        return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      });
      if (!pic) return false;
      const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
      await page.mouse.move(fb.x + pic.x, fb.y + pic.y);
      await page.mouse.down();
      const t = await frame
        .locator('[data-testid="annotation-quiet-tip"]')
        .textContent({ timeout: 800 })
        .catch(() => null);
      await page.mouse.up();
      return t === 'Switch to Preview to move it · ⌥⌘P';
    }, 8000);
    assert.ok(tip, 'the quiet tip at the pointer');
  });
} finally {
  await browser.close();
  server.stop();
}
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);

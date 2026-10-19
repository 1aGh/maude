// S4.10 — annotations ride with their artboard (canvas 15 `an-follow`) — browser E2E (node --test).
// Real studio server + real canvas in headless Chromium; assertions on the DOM AND on disk.
//
//   node --test apps/studio/test/e2e/annotations-follow.e2e.mjs
//
//   F1 dragging Desktop past Mobile moves its members on screen, re-routes Tereza's arrow live
//      and refuses the straight line ("the straight line would cross Mobile"); the loose note stays
//   F2 let go: ONE write moves the artboard and its members (a locked one too); the arrow's cached
//      end + host box follow; the loose note is untouched
//   F3 one ⌘Z puts the artboard AND its members back
//   F4 a selected member shows "On Desktop · moves with it" around its artboard
//   F5 a marker stroke drawn over Desktop belongs to it (parentArtboard on disk)
//
// Written for S4.10; the lead runs it at the wave gate (it needs Chromium + a free port).

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  makeProject,
  openCanvas,
  readBoard,
  sleep,
  startServer,
  waitForBoard,
} from './harness.mjs';

// Mobile sits squarely between Tereza's sticky and where Desktop ends up.
const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={720} height={450}>
        <div style={{ padding: 24 }}>Home</div>
      </DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={195} height={422}>
        <div style={{ padding: 12 }}>Mobile</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const META = {
  layout: {
    artboards: [
      { id: 'desktop', x: 100, y: 900 },
      { id: 'mobile', x: 1000, y: 300 },
    ],
  },
};

const BOARD = [
  {
    id: 'tereza',
    type: 'sticky',
    index: 'a0',
    x: 120,
    y: 360,
    w: 150,
    h: 150,
    text: 'Make See the work bigger',
  },
  {
    id: 'note',
    type: 'sticky',
    index: 'a1',
    x: 120,
    y: 80,
    w: 220,
    h: 100,
    text: 'Homepage review · stays',
  },
  {
    id: 'sun',
    type: 'sticky',
    index: 'a2',
    x: 400,
    y: 940,
    w: 92,
    h: 92,
    text: 'Warmer sun?',
    parentArtboard: 'desktop',
  },
  {
    id: 'pin',
    type: 'sticky',
    index: 'a3',
    x: 560,
    y: 940,
    w: 92,
    h: 92,
    text: 'pinned',
    locked: true,
    parentArtboard: 'desktop',
  },
  {
    id: 'arw',
    type: 'arrow',
    index: 'a4',
    start: { el: 'tereza' },
    end: { x: 460, y: 900 },
    endHost: { ref: 'ab:desktop', label: 'Desktop', box: { x: 100, y: 900, w: 720, h: 450 } },
    line: 'elbow',
  },
];

let server;
let c;
let root;

before(async () => {
  root = makeProject({ board: BOARD });
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), CANVAS);
  writeFileSync(join(root, '.design', 'ui', 'Board.meta.json'), JSON.stringify(META));
  server = await startServer(root);
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const disk = () => readBoard(server.root);
const layout = () =>
  JSON.parse(readFileSync(join(root, '.design', 'ui', 'Board.meta.json'), 'utf8')).layout.artboards;
const desktopAt = () => layout().find((a) => a.id === 'desktop');
const label = () => c.frame.locator('[data-dc-screen="desktop"] .dc-artboard-label').first();

async function reset() {
  for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape');
  await sleep(250);
}

/** Press on Desktop's label, move in steps, and run `mid` while the button is still down. */
async function dragDesktop(dx, dy, mid) {
  const b = await label().boundingBox();
  assert.ok(b, 'Desktop label on screen');
  const x0 = b.x + b.width / 2;
  const y0 = b.y + b.height / 2;
  await c.page.mouse.move(x0, y0);
  await c.page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await c.page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await sleep(16);
  }
  if (mid) await mid();
  await c.page.mouse.up();
}

describe('F1–F2 — Desktop moves, its members and the bound arrow follow', () => {
  test('live: members on screen, the arrow goes around Mobile, the loose note stays', async () => {
    await reset();
    const noteBefore = await c.pageBox('note');
    const was = desktopAt();
    // Zoomed out the world is smaller than the page: drag far enough to clear Mobile.
    await dragDesktop(900, -500, async () => {
      assert.equal(await c.frame.locator('[data-testid="annot-ride"]').count(), 1, 'live overlay');
      const tr = await c.frame.evaluate(
        () => document.querySelector('.dc-annot-scene [data-id="sun"]')?.style.translate ?? ''
      );
      assert.notEqual(tr, '', 'the member is translated on screen');
      const loose = await c.frame.evaluate(
        () => document.querySelector('.dc-annot-scene [data-id="note"]')?.style.translate ?? ''
      );
      assert.equal(loose, '', 'the loose note does not ride');
      const tag = c.frame.locator('[data-testid="annot-cross-tag"]');
      assert.match((await tag.first().textContent()) ?? '', /the straight line would cross Mobile/);
      const pts = await c.frame.evaluate(
        () =>
          document.querySelector('[data-ride-arrow="arw"] path')?.getAttribute('d')?.split('L')
            .length ?? 0
      );
      assert.ok(pts > 2, 'the elbow is routed, not straight');
    });
    const now = await waitForBoard(server.root, (b) => b.get('sun')?.x !== 400);
    const moved = desktopAt();
    const dx = moved.x - was.x;
    const dy = moved.y - was.y;
    assert.ok(Math.abs(dx) > 10, 'the artboard moved');
    assert.deepEqual([now.get('sun').x, now.get('sun').y], [400 + dx, 940 + dy]);
    // A locked member still follows.
    assert.deepEqual([now.get('pin').x, now.get('pin').y], [560 + dx, 940 + dy]);
    assert.equal(now.get('pin').locked, true);
    // The loose note stays.
    assert.deepEqual([now.get('note').x, now.get('note').y], [120, 80]);
    assert.ok(Math.abs((await c.pageBox('note')).x - noteBefore.x) < 1);
    // The bound arrow's cache follows its host.
    assert.deepEqual(now.get('arw').endHost.box, { x: 100 + dx, y: 900 + dy, w: 720, h: 450 });
    // The overlay lets go once the board has landed.
    await sleep(600);
    assert.equal(await c.frame.locator('[data-testid="annot-ride"]').count(), 0);
  });
});

describe('F3 — one ⌘Z restores the artboard and its members', () => {
  test('a single undo puts both back', async () => {
    await reset();
    await c.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    const back = await waitForBoard(server.root, (b) => b.get('sun')?.x === 400);
    assert.deepEqual([back.get('sun').x, back.get('sun').y], [400, 940]);
    assert.deepEqual([back.get('pin').x, back.get('pin').y], [560, 940]);
    assert.deepEqual(
      (({ x, y }) => [x, y])(desktopAt()),
      [100, 900],
      'the artboard is back in the same undo step'
    );
  });
});

describe('F4 — membership you can see', () => {
  test('selecting a member outlines its artboard: "On Desktop · moves with it"', async () => {
    await reset();
    const [x, y] = await c.center('sun');
    await c.click(x, y);
    await sleep(300);
    const out = c.frame.locator('[data-testid="annot-belongs"]');
    assert.equal(await out.count(), 1);
    assert.equal(await out.getAttribute('data-artboard'), 'desktop');
    assert.match((await out.textContent()) ?? '', /On Desktop · moves with it/);
    await reset();
    const [nx, ny] = await c.center('note');
    await c.click(nx, ny);
    await sleep(300);
    assert.equal(await out.count(), 0, 'a loose note belongs to nothing');
  });
});

describe('F5 — marker strokes belong to the artboard under them', () => {
  test('a marker drawn over Desktop is stored with parentArtboard: desktop', async () => {
    await reset();
    const before = new Set(disk().keys());
    await c.page.keyboard.press('m'); // Marker
    const b = await label().boundingBox();
    const x0 = b.x + 80;
    const y0 = b.y + 120;
    await c.page.mouse.move(x0, y0);
    await c.page.mouse.down();
    for (let i = 1; i <= 10; i++) await c.page.mouse.move(x0 + i * 8, y0 + (i % 2) * 6);
    await c.page.mouse.up();
    const after = await waitForBoard(server.root, (m) => [...m.keys()].some((k) => !before.has(k)));
    const pen = [...after.values()].find((e) => !before.has(e.id) && e.type === 'pen');
    assert.ok(pen, 'a marker stroke landed');
    assert.equal(pen.parentArtboard, 'desktop');
  });
});

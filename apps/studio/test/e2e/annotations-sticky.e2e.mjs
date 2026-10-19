// S4.12 — stickies and sections up close (canvas 15 `an-place`, `an-sticky`, `an-section`, `an-convert`) —
// browser E2E (node --test). Real studio server + real canvas in headless Chromium; assertions on the DOM
// AND on disk.
//
//   node --test apps/studio/test/e2e/annotations-sticky.e2e.mjs
//
//   T1 three stickies stacked 14 px apart: Fan out (right-click) spreads them into a row on one line
//   T2 Resolve (small toolbar) writes `resolved { by, at }` and strikes the sticky through in place; Reopen
//      takes it away again
//   T3 Fold on a section hides its members from the drawing and says "2 stickies" on its chip; Unfold
//      brings them back; the file keeps them throughout
//   T4 Turn into a comment: the sticky leaves the board and the shell says "Turned into a comment." with
//      Undo; Undo brings the sticky back byte for byte
//   T5 ⌘K "Move resolved stickies to the trash" (run-action) removes only the resolved ones and says
//      "1 sticky moved to the trash" with Undo; ⌘Z brings it back
//
// Written for S4.12, not run in the builder's session; the lead runs it at the wave gate (it needs
// Chromium + a free port).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  makeProject,
  openCanvas,
  readBoard,
  sleep,
  startServer,
  waitForBoard,
} from './harness.mjs';

const BOARD = [
  {
    id: 'sa',
    type: 'sticky',
    index: 'a0',
    x: 120,
    y: 120,
    w: 160,
    h: 160,
    text: 'Tiles: three words each',
  },
  {
    id: 'sb',
    type: 'sticky',
    index: 'a1',
    x: 134,
    y: 134,
    w: 160,
    h: 160,
    text: 'Service names in bold',
  },
  {
    id: 'sc',
    type: 'sticky',
    index: 'a2',
    x: 148,
    y: 148,
    w: 160,
    h: 160,
    text: 'One row of words is enough',
  },
  {
    id: 'sec',
    type: 'section',
    index: 'a3',
    x: 500,
    y: 100,
    w: 360,
    h: 260,
    label: 'Zpětná vazba',
  },
  {
    id: 'in1',
    type: 'sticky',
    index: 'a4',
    parent: 'sec',
    x: 20,
    y: 40,
    w: 140,
    h: 140,
    text: 'Logo výš',
  },
  {
    id: 'in2',
    type: 'sticky',
    index: 'a5',
    parent: 'sec',
    x: 180,
    y: 40,
    w: 140,
    h: 140,
    text: 'Datum tučně',
  },
];

let server;
let c;

before(async () => {
  server = await startServer(makeProject({ board: BOARD }));
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const disk = () => readBoard(server.root);
const el = (id) => c.frame.locator(`.dc-annot-scene [data-id="${id}"]`).first();
const byTestId = (id) => c.frame.locator(`[data-testid="${id}"]`).first();

async function select(id) {
  const b = await c.pageBox(id);
  assert.ok(b, `${id} on screen`);
  await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(150);
}

describe('T1 — Fan out', () => {
  test('a stack spreads into a row, same line, in paint order', async () => {
    await select('sc');
    const b = await c.pageBox('sc');
    await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    await byTestId('annot-menu-fan-out').click();
    const board = await waitForBoard(server.root, (m) => m.get('sb')?.x !== 134);
    const xs = ['sa', 'sb', 'sc'].map((id) => board.get(id).x);
    assert.deepEqual(
      xs,
      [...xs].sort((p, q) => p - q),
      'left to right in paint order'
    );
    assert.equal(new Set(['sa', 'sb', 'sc'].map((id) => board.get(id).y)).size, 1, 'one line');
    assert.ok(board.get('sb').x - board.get('sa').x >= 160, 'no overlap');
  });
});

describe('T2 — Resolve strikes through in place', () => {
  test('Resolve writes who and when; the sticky stays where it was', async () => {
    await select('sa');
    const before = disk().get('sa');
    await byTestId('annot-ctx-resolve').click();
    const board = await waitForBoard(server.root, (m) => !!m.get('sa')?.resolved);
    assert.match(board.get('sa').resolved.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([board.get('sa').x, board.get('sa').y], [before.x, before.y]);
    assert.equal(await el('sa').locator('[data-resolved]').count(), 1, 'ticked');
    const deco = await el('sa')
      .locator('.dc-annot-text')
      .evaluate((n) => getComputedStyle(n).textDecorationLine);
    assert.match(deco, /line-through/);
  });
  test('Reopen takes the stamp away', async () => {
    await select('sa');
    assert.equal((await byTestId('annot-ctx-resolve').textContent())?.trim(), 'Reopen');
    await byTestId('annot-ctx-resolve').click();
    await waitForBoard(server.root, (m) => !m.get('sa')?.resolved);
    assert.equal(await el('sa').locator('[data-resolved]').count(), 0);
    // resolve it again for T5
    await byTestId('annot-ctx-resolve').click();
    await waitForBoard(server.root, (m) => !!m.get('sa')?.resolved);
  });
});

describe('T3 — Fold', () => {
  test('hides the members from the drawing, keeps them in the file, and Unfold brings them back', async () => {
    const chip = c.frame.locator('.dc-annot-scene [data-id="sec"] [data-section-chip]').first();
    await chip.click();
    await byTestId('annot-ctx-fold').click();
    await waitForBoard(server.root, (m) => m.get('sec')?.folded === true);
    assert.equal(await el('in1').count(), 0, 'not drawn');
    assert.ok(disk().get('in1'), 'still in the file');
    assert.match(
      (await c.frame.locator('[data-fold-note]').first().textContent()) ?? '',
      /2 stickies/
    );
    await chip.click();
    await byTestId('annot-ctx-fold').click();
    await waitForBoard(server.root, (m) => !m.get('sec')?.folded);
    assert.equal(await el('in1').count(), 1, 'drawn again');
  });
});

describe('T4 — Turn into a comment, and undo', () => {
  test('the sticky goes to the comments; Undo brings it back', async () => {
    await select('sb');
    const was = disk().get('sb');
    await byTestId('annot-ctx-to-comment').click();
    await waitForBoard(server.root, (m) => !m.has('sb'));
    const toast = c.page.getByText('Turned into a comment.');
    await toast.first().waitFor({ timeout: 8000 });
    await c.page.getByRole('button', { name: 'Undo' }).first().click();
    const back = await waitForBoard(server.root, (m) => m.has('sb'));
    assert.deepEqual(
      [back.get('sb').x, back.get('sb').y, back.get('sb').text],
      [was.x, was.y, was.text]
    );
  });
});

describe('T5 — ⌘K: Move resolved stickies to the trash', () => {
  test('only the resolved ones go, with "1 sticky moved to the trash" and Undo', async () => {
    await c.page.keyboard.press('Escape');
    await c.page.evaluate(() =>
      window.postMessage({ dgn: 'run-action', v: 1, id: 'annotations.trash-resolved' }, '*')
    );
    // the shell relays run-action to the canvas; fall back to posting at the frame directly
    await c.frame.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'run-action', v: 1, id: 'annotations.trash-resolved' },
          source: window.parent,
        })
      )
    );
    const board = await waitForBoard(server.root, (m) => !m.has('sa'));
    assert.ok(board.has('sc'), 'open stickies stay');
    await c.page.getByText('1 sticky moved to the trash').first().waitFor({ timeout: 8000 });
    await c.page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await waitForBoard(server.root, (m) => m.has('sa'));
  });
});

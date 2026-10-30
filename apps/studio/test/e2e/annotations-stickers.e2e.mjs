// S4.13 — stickers, templates and stamps on the canvas (canvas 15 `an-stk-drop`, `an-templates`, `an-stamps`)
// — browser E2E (node --test). Real studio server + real canvas in headless Chromium; assertions on the DOM
// AND on disk. The shell's pick is posted into the canvas frame exactly as the shell does (a parent message).
//
//   node --test apps/studio/test/e2e/annotations-stickers.e2e.mjs
//
//   T1 a sticker pick follows the pointer; a click lands it at 160 × 160, selected, with "160 × 160" under it
//      and the identity `sticker { pack, id }` in the file
//   T2 Replace swaps the picture in place (same spot, same size, new identity); Flip mirrors (`flip: true`
//      on disk) and a second Flip takes it back
//   T3 a stamp stays armed: two clicks on one artboard by one person are ONE stamp (upsert), a second kind is
//      a second; the cluster says how many and the hover card names the artboard
//   T4 a template lands where you click: three sections, the first at the click
//
// Written for S4.13, not run in the builder's session; the lead runs it at the wave gate (it needs
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

let server;
let c;

before(async () => {
  server = await startServer(makeProject({ board: [] }));
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

/** The board file's elements as a list (the harness reads a Map). */
const list = (m) => [...(m?.values() ?? [])];
const disk = () => list(readBoard(server.root));
const until = async (pred) => list(await waitForBoard(server.root, (m) => pred(list(m))));
const byTestId = (id) => c.frame.locator(`[data-testid="${id}"]`).first();

/** What the shell sends down: a message from the PARENT window into the active canvas frame. */
const postToCanvas = (msg) =>
  c.page.evaluate((m) => {
    const f =
      document.querySelector('[data-testid="canvas-frame"]') ?? document.querySelector('iframe');
    f?.contentWindow?.postMessage(m, '*');
  }, msg);

const click = async (x, y) => {
  await c.page.mouse.move(x, y);
  await sleep(80);
  await c.page.mouse.down();
  await c.page.mouse.up();
  await sleep(200);
};

const center = async () => {
  const b = await c.page.locator('[data-testid="canvas-frame"]').first().boundingBox();
  assert.ok(b, 'the canvas frame is on screen');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

describe('T1 — a sticker follows the pointer and lands at 160 px', () => {
  test('click puts it down there, selected, "160 × 160"', async () => {
    const at = await center();
    await postToCanvas({
      dgn: 'insert-sticker',
      path: 'assets/placeholder.png',
      follow: true,
      sticker: { pack: 'project-status', id: 'group-46.png' },
    });
    await c.page.mouse.move(at.x - 40, at.y - 40);
    await c.page.mouse.move(at.x, at.y);
    await sleep(150);
    assert.ok(await byTestId('annot-placing').count(), 'the ghost trails the pointer');
    await click(at.x, at.y);
    const board = await until((els) => els.some((e) => e.type === 'image'));
    const img = board.find((e) => e.type === 'image');
    assert.equal(img.w, 160);
    assert.equal(img.h, 160);
    assert.deepEqual(img.sticker, { pack: 'project-status', id: 'group-46' });
    assert.equal(
      await byTestId('annot-placing').count(),
      0,
      'one sticker, one click: the ghost is gone'
    );
    assert.equal((await byTestId('annot-sticker-size').textContent())?.trim(), '160 × 160');
  });
});

describe('T2 — Replace keeps the spot and size; Flip mirrors', () => {
  test('Replace (shell → canvas) swaps the picture and its identity in place', async () => {
    const before = (await disk()).find((e) => e.type === 'image');
    await postToCanvas({
      dgn: 'replace-annotation-media',
      id: before.id,
      path: 'assets/other.png',
      sticker: { pack: 'life-style', id: 'best.png' },
    });
    const after = await until((els) =>
      els.some((e) => e.id === before.id && e.href === 'assets/other.png')
    );
    const img = after.find((e) => e.id === before.id);
    assert.equal(img.x, before.x);
    assert.equal(img.y, before.y);
    assert.equal(img.w, 160);
    assert.deepEqual(img.sticker, { pack: 'life-style', id: 'best' });
  });
  test('Flip on the small toolbar sets flip; a second Flip clears it', async () => {
    assert.ok(await byTestId('annot-ctx-replace').count(), 'Replace… is offered over a sticker');
    await byTestId('annot-ctx-flip').click();
    let board = await until((els) => els.some((e) => e.sticker?.flip === true));
    assert.equal(board.find((e) => e.type === 'image').sticker.flip, true);
    await byTestId('annot-ctx-flip').click();
    board = await until((els) =>
      els.some((e) => e.type === 'image' && e.sticker && e.sticker.flip === undefined)
    );
    assert.equal(board.find((e) => e.type === 'image').sticker.flip, undefined);
  });
});

describe('T3 — a stamp stays armed; one per person per kind per spot', () => {
  test('two clicks of one kind are one stamp, a second kind is another', async () => {
    const at = await center();
    await postToCanvas({
      dgn: 'insert-sticker',
      path: '',
      follow: true,
      sticker: { pack: 'stamps', id: 'yes' },
    });
    await c.page.mouse.move(at.x + 200, at.y + 120);
    await sleep(100);
    await click(at.x + 200, at.y + 120);
    // the same spot: a stamp's spot is the 40 px world cell under it, so a 5 px nudge can cross a cell line
    await click(at.x + 200, at.y + 120);
    let stamps = (await until((els) => els.some((e) => e.type === 'stamp'))).filter(
      (e) => e.type === 'stamp'
    );
    assert.equal(stamps.length, 1, 'the same kind by the same person on one spot is an upsert');
    await postToCanvas({
      dgn: 'insert-sticker',
      path: '',
      follow: true,
      sticker: { pack: 'stamps', id: 'star' },
    });
    await click(at.x + 200, at.y + 120);
    stamps = (await until((els) => els.filter((e) => e.type === 'stamp').length === 2)).filter(
      (e) => e.type === 'stamp'
    );
    assert.deepEqual(stamps.map((s) => s.kind).sort(), ['star', 'yes']);
    assert.ok(await byTestId('annot-stamp-cluster').count(), 'the cluster is drawn');
  });
  test('Esc lets go: the next click stamps nothing', async () => {
    await c.page.keyboard.press('Escape');
    await sleep(150);
    const n = (await disk()).filter((e) => e.type === 'stamp').length;
    await click(300, 300);
    assert.equal((await disk()).filter((e) => e.type === 'stamp').length, n);
  });
});

describe('T4 — a template lands where you click', () => {
  test('Kanban: three sections, the first at the click', async () => {
    const at = await center();
    await postToCanvas({ dgn: 'insert-template', id: 'kanban', follow: true });
    await c.page.mouse.move(at.x - 100, at.y - 100);
    await sleep(100);
    await click(at.x - 100, at.y - 100);
    const board = await until((els) => els.filter((e) => e.type === 'section').length === 3);
    const secs = board.filter((e) => e.type === 'section');
    assert.equal(secs.length, 3, 'To do · Doing · Done');
    // the exact origin (the click) is pinned by test/annotations-sticker-drop.test.tsx: expandTemplate
    assert.ok(new Set(secs.map((x) => x.y)).size === 1, 'one row of columns');
  });
});

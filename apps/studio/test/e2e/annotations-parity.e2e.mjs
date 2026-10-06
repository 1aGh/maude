// Annotation layer — behaviour PARITY suite (browser E2E, node --test).
//
// Pins what the whiteboard does today, feature by feature, so the element-
// native editor (annotations v2 Task 26) is held to exactly the same
// behaviour. Every scenario asserts the board ON DISK (and the DOM where the
// behaviour is visual). Runs against any build:
//
//   node --test apps/studio/test/e2e/annotations-parity.e2e.mjs
//   STUDIO_DIR=<other checkout>/apps/studio node --test …

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { makeProjectFor, openCanvas, sleep, startServer, waitForBoard } from './harness.mjs';

/** A reference card at a known world box (for world → page mapping) plus targets. */
const PARITY_BOARD = [
  {
    id: 'ref',
    type: 'shape',
    index: 'a0',
    kind: 'rect',
    x: 100,
    y: 100,
    w: 100,
    h: 100,
    fill: '#eeeeee',
  },
  {
    id: 'A',
    type: 'shape',
    index: 'a1',
    kind: 'rect',
    x: 300,
    y: 100,
    w: 120,
    h: 80,
    fill: '#dfe7f7',
  },
  {
    id: 'B',
    type: 'shape',
    index: 'a2',
    kind: 'ellipse',
    x: 600,
    y: 100,
    w: 120,
    h: 80,
    fill: '#f7dfe7',
  },
  { id: 'C', type: 'sticky', index: 'a3', x: 300, y: 300, w: 160, h: 160, text: 'note' },
  {
    id: 'D',
    type: 'shape',
    index: 'a4',
    kind: 'rect',
    x: 600,
    y: 300,
    w: 120,
    h: 80,
    fill: '#e7f7df',
  },
];

let server;
let c;
before(async () => {
  server = await startServer(await makeProjectFor(PARITY_BOARD));
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

async function reset() {
  for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape');
  await c.page.keyboard.press('v');
  await sleep(200);
}

/** World → page through `ref` (world 100,100, 100 wide). */
async function w2p(wx, wy) {
  const b = await c.pageBox('ref');
  const k = b.width / 100;
  return [b.x + (wx - 100) * k, b.y + (wy - 100) * k];
}

const board = () => waitForBoard(server.root, () => true);
const added = (before, after, pred = () => true) =>
  [...after.values()].filter((e) => !before.has(e.id) && pred(e));

describe('P1 — drawing tools', () => {
  test('pen: a drag draws ink', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('b');
    await c.drag(await w2p(100, 600), await w2p(260, 640), { steps: 16 });
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'pen').length === 1
    );
    const pen = added(b0, b1, (e) => e.type === 'pen')[0];
    assert.ok(pen.points.length >= 6, 'several points');
    assert.notEqual(pen.highlighter, true);
  });

  test('highlighter: a drag draws highlighter ink', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('i');
    await c.drag(await w2p(100, 700), await w2p(260, 720), { steps: 12 });
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'pen').length === 1
    );
    assert.equal(added(b0, b1, (e) => e.type === 'pen')[0].highlighter, true);
  });

  test('shape: a drag draws a shape of that size', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('r');
    await c.drag(await w2p(900, 100), await w2p(1000, 180));
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'shape').length === 1
    );
    const s = added(b0, b1, (e) => e.type === 'shape')[0];
    assert.ok(Math.abs(s.w - 100) < 6 && Math.abs(s.h - 80) < 6, `size ${s.w}×${s.h}`);
    await c.page.keyboard.press('Escape'); // the new shape opens its label editor
  });

  test('sticky: a click drops a note and opens it for typing', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('n');
    const [x, y] = await w2p(900, 300);
    await c.page.mouse.click(x, y);
    await sleep(300);
    assert.ok(await c.editorState(), 'editor open on the new note');
    await c.page.keyboard.type('fresh');
    await c.page.keyboard.press('Enter');
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'sticky' && e.text === 'fresh').length === 1
    );
    assert.ok(b1);
  });

  test('section: drawn around an element, it contains it', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('Shift+S');
    await c.drag(await w2p(560, 260), await w2p(760, 420));
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'section').length === 1
    );
    const sec = added(b0, b1, (e) => e.type === 'section')[0];
    assert.equal(b1.get('D').parent, sec.id, 'D is inside the new section');
  });

  test('arrow: dragged from one shape to another, it binds both ends', async () => {
    await reset();
    const b0 = await board();
    await c.page.keyboard.press('a');
    await c.drag(await w2p(360, 140), await w2p(660, 140), { steps: 12 });
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'arrow').length === 1
    );
    const ar = added(b0, b1, (e) => e.type === 'arrow')[0];
    assert.equal(ar.start?.el, 'A');
    assert.equal(ar.end?.el, 'B');
  });

  test('eraser: a drag across ink erases it', async () => {
    await reset();
    const b0 = await board();
    const pens = [...b0.values()].filter((e) => e.type === 'pen' && !e.highlighter);
    assert.equal(pens.length, 1, 'precondition: the pen stroke from P1');
    await c.page.keyboard.press('e');
    await c.drag(await w2p(180, 560), await w2p(180, 680), { steps: 12 });
    const b1 = await waitForBoard(server.root, (b) => !b.has(pens[0].id));
    assert.equal(b1.has(pens[0].id), false);
  });
});

/** Click an element's centre with the Select tool (optionally adding with Shift). */
async function select(id, shift = false) {
  const [x, y] = await c.center(id);
  await c.click(x, y, shift ? { modifiers: ['Shift'] } : {});
  await sleep(200);
}
/** Page point at fractions (fx, fy) of an element's box. */
async function pointIn(id, fx, fy) {
  const b = await c.pageBox(id);
  return [b.x + b.width * fx, b.y + b.height * fy];
}
async function selectAt(id, fx, fy) {
  const [x, y] = await pointIn(id, fx, fy);
  await c.click(x, y);
  await sleep(200);
}
/** A toolbar control by its accessible name, inside the canvas frame. */
const ctl = (label) => c.frame.locator(`.dc-annot-ctx [aria-label="${label}"]`).first();

describe('P2 — the context toolbar', () => {
  test('a colour swatch recolours the selection', async () => {
    await reset();
    await select('A');
    const sw = c.frame.locator(
      '.dc-annot-ctx [role="radiogroup"][aria-label="Color"] .dc-annot-ctx-sw'
    );
    const n = await sw.count();
    assert.ok(n > 2, 'swatches shown');
    const pick = sw.nth(n - 1);
    const label = await pick.getAttribute('aria-label');
    const color = label.split(' ').pop();
    await pick.click();
    // A default value is omitted on disk (canonical form): read it back as the default.
    const inkOf = (e) => e?.color ?? '#1f1f1f';
    const b = await waitForBoard(server.root, (bd) => inkOf(bd.get('A')) === color);
    assert.equal(inkOf(b.get('A')), color);
  });

  test('thick stroke and a dashed line', async () => {
    await reset();
    const w0 = (await board()).get('A').width ?? 2;
    await select('A');
    await ctl('Thick stroke').click();
    await ctl('Dashed line').click();
    const b = await waitForBoard(server.root, (bd) => bd.get('A')?.dashed === true);
    assert.ok((b.get('A').width ?? 2) > w0, 'thicker');
  });

  test('"No fill" clears the fill', async () => {
    await reset();
    await select('A');
    await c.frame
      .locator('.dc-annot-ctx [role="radiogroup"][aria-label="Swatch target"] button')
      .nth(1)
      .click();
    await ctl('No fill').click();
    const b = await waitForBoard(server.root, (bd) => bd.get('A')?.fill == null);
    assert.equal(b.get('A').fill ?? null, null);
  });

  test('bold and a bulleted list on a sticky', async () => {
    await reset();
    await select('C');
    await ctl('Bold').click();
    await ctl('Bulleted list').click();
    const b = await waitForBoard(server.root, (bd) => bd.get('C')?.list === 'bullet');
    assert.equal(b.get('C').bold, true);
  });

  // (A has no fill after the test above: a click inside it hits nothing, as
  //  for any unfilled shape — the scenarios below pick filled ones.)
  test('group, click-selects-the-group, ungroup', async () => {
    await reset();
    await select('ref');
    await select('B', true);
    await ctl('Group selection').click();
    let b = await waitForBoard(server.root, (bd) => (bd.get('ref')?.groups ?? []).length > 0);
    assert.deepEqual(b.get('ref').groups, b.get('B').groups);
    await reset();
    await select('ref');
    assert.deepEqual(await c.selection(), ['B', 'ref'], 'a click selects the whole group');
    await ctl('Ungroup selection').click();
    b = await waitForBoard(server.root, (bd) => !(bd.get('ref')?.groups ?? []).length);
    assert.equal((b.get('B').groups ?? []).length, 0);
  });
});

describe('P3 — keyboard and menu', () => {
  test('] brings forward, [ sends back (paint order on disk)', async () => {
    await reset();
    const order = (b) =>
      [...b.values()]
        .filter((e) => !e.parent)
        .sort((x, y) => (x.index < y.index ? -1 : x.index > y.index ? 1 : x.id < y.id ? -1 : 1))
        .map((e) => e.id);
    await select('ref');
    await c.page.keyboard.press(']');
    let b = await waitForBoard(server.root, (bd) => order(bd).at(-1) === 'ref');
    assert.equal(order(b).at(-1), 'ref', 'painted last');
    await c.page.keyboard.press('[');
    b = await waitForBoard(server.root, (bd) => order(bd)[0] === 'ref');
    assert.equal(order(b)[0], 'ref', 'painted first');
  });

  test('⌘C ⌘V pastes a copy nearby', async () => {
    await reset();
    const b0 = await board();
    await select('B');
    await c.page.keyboard.press('Meta+c');
    await sleep(300); // the copy reaches the OS clipboard asynchronously
    await c.page.keyboard.press('Meta+v');
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'shape').length === 1
    );
    const copy = added(b0, b1, (e) => e.type === 'shape')[0];
    assert.equal(copy.kind, 'ellipse');
    assert.ok(copy.x > b0.get('B').x, 'offset from the original');
    assert.deepEqual(await c.selection(), [copy.id], 'the copy is selected');
  });

  test('Alt-drag leaves the original and moves a copy', async () => {
    await reset();
    const b0 = await board();
    const [x, y] = await c.center('D');
    await c.drag([x, y], [x, y + 140], { modifiers: ['Alt'] });
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'shape').length === 1
    );
    assert.equal(b1.get('D').y, b0.get('D').y, 'original stays');
    const copy = added(b0, b1, (e) => e.type === 'shape')[0];
    assert.ok(copy.y > b0.get('D').y + 50, 'the copy moved');
  });

  test('right-click opens the menu; "Delete" removes the element', async () => {
    await reset();
    const b0 = await board();
    const copies = [...b0.values()].filter(
      (e) => e.type === 'shape' && e.kind === 'ellipse' && e.id !== 'B'
    );
    assert.ok(copies.length, 'precondition: the pasted copy');
    const [x, y] = await c.center(copies[0].id);
    await c.page.mouse.click(x, y, { button: 'right' });
    await sleep(200);
    const item = c.frame.locator('.dc-context-menu [data-action="delete"]').first();
    await item.waitFor({ timeout: 2000 });
    await item.click();
    const b1 = await waitForBoard(server.root, (b) => !b.has(copies[0].id));
    assert.equal(b1.has(copies[0].id), false);
  });

  test('⌘Z undoes and ⌘⇧Z redoes', async () => {
    await reset();
    const y0 = (await board()).get('ref').y;
    await select('ref');
    await c.page.keyboard.press('ArrowDown');
    let b = await waitForBoard(server.root, (bd) => bd.get('ref')?.y !== y0);
    const y1 = b.get('ref').y;
    await c.page.keyboard.press('Meta+z');
    b = await waitForBoard(server.root, (bd) => bd.get('ref')?.y === y0);
    await c.page.keyboard.press('Meta+Shift+z');
    b = await waitForBoard(server.root, (bd) => bd.get('ref')?.y === y1);
    assert.equal(b.get('ref').y, y1);
  });
});

describe('P4 — handles', () => {
  test('rotate: dragging the rotation zone turns the element', async () => {
    await reset();
    await select('ref');
    const z = await c.frame
      .locator('.dc-annot-rotate-zone[data-corner="rot-se"]')
      .first()
      .boundingBox({ timeout: 2000 });
    const from = [z.x + z.width / 2, z.y + z.height / 2];
    await c.drag(from, [from[0] - 30, from[1] + 60], { steps: 10 });
    const b = await waitForBoard(server.root, (bd) => (bd.get('ref')?.rot ?? 0) !== 0);
    assert.ok(Math.abs(b.get('ref').rot) > 5, `rotated ${b.get('ref').rot}°`);
    await c.page.keyboard.press('Meta+z');
    await waitForBoard(server.root, (bd) => (bd.get('ref')?.rot ?? 0) === 0);
  });

  test('dragging an arrow end onto another shape re-binds it', async () => {
    await reset();
    const b0 = await board();
    const ar = [...b0.values()].find((e) => e.type === 'arrow');
    assert.ok(ar, 'precondition: the arrow from P1');
    const [ax, ay] = await c.center(ar.id);
    await c.click(ax, ay);
    await sleep(200);
    const ep = await c.frame
      .locator('.dc-annot-resize-handle[data-corner="ep2"]')
      .first()
      .boundingBox({ timeout: 2000 });
    const [tx, ty] = await c.center('D');
    await c.drag([ep.x + ep.width / 2, ep.y + ep.height / 2], [tx, ty], { steps: 12 });
    const b1 = await waitForBoard(server.root, (b) => b.get(ar.id)?.end?.el === 'D');
    assert.equal(b1.get(ar.id).start.el, 'A', 'the other end is untouched');
  });

  test('a connection dot drags out a connector bound to the shape', async () => {
    await reset();
    const b0 = await board();
    await select('ref');
    const dot = await c.frame.locator('.dc-annot-conn-dot').first().boundingBox({ timeout: 2000 });
    const from = [dot.x + dot.width / 2, dot.y + dot.height / 2];
    await c.drag(from, [from[0] + 20, from[1] + 220], { steps: 12 });
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'arrow').length === 1
    );
    assert.equal(added(b0, b1, (e) => e.type === 'arrow')[0].start?.el, 'ref');
  });

  test('a corner handle resizes; Shift keeps the aspect ratio', async () => {
    await reset();
    const b0 = await board();
    await select('ref');
    const h = await c.frame
      .locator('.dc-annot-resize-handle[data-corner="se"]')
      .first()
      .boundingBox({ timeout: 2000 });
    const from = [h.x + h.width / 2, h.y + h.height / 2];
    await c.drag(from, [from[0] + 60, from[1] + 10], { steps: 8, modifiers: ['Shift'] });
    const b1 = await waitForBoard(server.root, (b) => b.get('ref')?.w !== b0.get('ref').w);
    const r = b1.get('ref');
    assert.ok(Math.abs(r.w - r.h) < 2, `square kept (${r.w}×${r.h})`);
  });
});

describe('P5 — kinds, sections, selection, media', () => {
  test('the toolbar turns a rectangle into a circle', async () => {
    await reset();
    // D's centre carries the arrow re-bound onto it in P4 (a centre magnet),
    // so D is grabbed off-centre.
    await selectAt('D', 0.2, 0.25);
    assert.deepEqual(await c.selection(), ['D'], 'D selected');
    await ctl('Circle').click({ timeout: 3000 });
    const b = await waitForBoard(server.root, (bd) => bd.get('D')?.kind === 'ellipse');
    assert.equal(b.get('D').kind, 'ellipse');
  });

  test('font size from the toolbar', async () => {
    await reset();
    await select('C');
    await c.frame.locator('.dc-annot-ctx .dc-annot-ctx-fs-trigger').first().click();
    const items = c.frame.locator('.dc-annot-ctx-fs-item');
    const n = await items.count();
    assert.ok(n > 2, 'size presets');
    const px = Number(
      await items
        .nth(n - 1)
        .locator('.dc-annot-ctx-fs-px')
        .textContent()
    );
    await items.nth(n - 1).click();
    const b = await waitForBoard(server.root, (bd) => bd.get('C')?.fontSize === px);
    assert.equal(b.get('C').fontSize, px);
  });

  test('dragging an element out of its section takes it out', async () => {
    await reset();
    const b0 = await board();
    assert.ok(b0.get('D').parent, 'precondition: D is in the section from P1');
    const [x, y] = await pointIn('D', 0.2, 0.25);
    await c.drag([x, y], await w2p(900, 800), { steps: 12 });
    const b1 = await waitForBoard(server.root, (b) => !b.get('D')?.parent);
    assert.equal(b1.get('D').parent, undefined);
  });

  test('Esc and a click on empty canvas clear the selection', async () => {
    await reset();
    await select('B');
    assert.deepEqual(await c.selection(), ['B']);
    await c.page.keyboard.press('Escape');
    await sleep(150);
    assert.deepEqual(await c.selection(), []);
    await select('B');
    const [ex, ey] = await w2p(1160, 600); // empty, and on screen
    await c.page.mouse.click(ex, ey);
    await sleep(200);
    assert.deepEqual(await c.selection(), []);
  });

  test('double-click on a group member selects just that member', async () => {
    await reset();
    await select('ref');
    await select('B', true);
    await c.page.keyboard.press('Meta+g');
    await waitForBoard(server.root, (bd) => (bd.get('B')?.groups ?? []).length > 0);
    await reset();
    const [x, y] = await c.center('B');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('Escape'); // leave the label editor the double-click opened
    await sleep(150);
    const sel = await c.selection();
    assert.ok(sel.length <= 1, `deep select, not the group (${sel})`);
    await select('ref');
    await c.page.keyboard.press('Meta+Shift+g');
    await waitForBoard(server.root, (bd) => !(bd.get('B')?.groups ?? []).length);
  });

  test('pasting a URL drops a link card', async () => {
    await reset();
    const b0 = await board();
    await c.frame.evaluate(() => navigator.clipboard.writeText('https://example.com/some/page'));
    await sleep(150);
    await c.page.keyboard.press('Meta+v');
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'link').length === 1
    );
    const link = added(b0, b1, (e) => e.type === 'link')[0];
    assert.equal(link.url, 'https://example.com/some/page');
  });

  test('pasting an image uploads it and drops an image card', async () => {
    await reset();
    const b0 = await board();
    await c.frame.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 40;
      cv.height = 30;
      const g = cv.getContext('2d');
      g.fillStyle = '#c0392b';
      g.fillRect(0, 0, 40, 30);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await sleep(150);
    await c.page.keyboard.press('Meta+v');
    const b1 = await waitForBoard(
      server.root,
      (b) => added(b0, b, (e) => e.type === 'image' && /^assets\//.test(e.href ?? '')).length === 1,
      15000
    );
    const img = added(b0, b1, (e) => e.type === 'image')[0];
    assert.match(img.href, /^assets\/[0-9a-f]{8}\.png$/);
  });
});

test('no page errors during the run', () => {
  assert.deepEqual(c.errors, []);
});

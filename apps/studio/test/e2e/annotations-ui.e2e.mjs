// Annotation layer — browser E2E (node --test). Real studio server + real
// canvas in headless Chromium; assertions on the DOM AND on the board on disk.
//
//   node --test apps/studio/test/e2e/annotations-ui.e2e.mjs
//   STUDIO_DIR=<other checkout>/apps/studio node --test …   (run against a baseline)
//
// Covers the 2026-09-30 user report + neighbours:
//   R1 Shift+Enter in a sticky / shape label / text puts the caret on the NEW line
//   R2 double-click on a shape (its label or its body) edits it — the view never jumps
//   R3 a marquee over a section's CONTENT selects the content, not the section
//   R4 Shift+click on a selected element removes it from the selection

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { REPORT_BOARD } from './fixtures.mjs';
import {
  makeProjectFor,
  openCanvas,
  peerOps,
  readBoard,
  sleep,
  startServer,
  waitForBoard,
} from './harness.mjs';

let server;
let c;

before(async () => {
  server = await startServer(await makeProjectFor(REPORT_BOARD));
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

async function reset() {
  for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape');
  await sleep(250);
}

/** The open editor (v2 textarea or v1 contentEditable), or null. */
const caretState = () => c.editorState();

describe('R1 — Shift+Enter moves the caret to the new line', () => {
  for (const id of ['note', 'box', 'label']) {
    test(`${id}: after Shift+Enter the caret is not left on line one`, async () => {
      await reset();
      const [x, y] = await c.center(id);
      await c.page.mouse.dblclick(x, y);
      await sleep(300);
      assert.ok(await caretState(), `double-click opens the ${id} editor`);
      await c.page.keyboard.press('End');
      await c.page.keyboard.press('Shift+Enter');
      await sleep(200);
      const s = await caretState();
      assert.ok(s, 'editor still open after Shift+Enter');
      assert.ok(s.caretLine >= 1, `the caret moved off line one (line ${s.caretLine})`);
      // The keystroke lands on the new line, and the edit persists with the newline.
      await c.page.keyboard.type('Z');
      await sleep(100);
      const typed = await caretState();
      assert.match(typed.text, /Ahoj\s*\nZ/);
    });
  }
});

describe('R2 — double-click on a shape edits it; the view never jumps', () => {
  for (const [what, id, where] of [
    ['label text', 'box', 'center'],
    ['shape body', 'box', 'corner'],
    ['circle label', 'circle', 'center'],
  ]) {
    test(`${what}`, async () => {
      await reset();
      const ref = await c.pageBox('lone');
      const b = await c.pageBox(id);
      const pt =
        where === 'center'
          ? [b.x + b.width / 2, b.y + b.height / 2]
          : [b.x + 14, b.y + b.height - 14];
      await c.page.mouse.dblclick(pt[0], pt[1]);
      await sleep(400);
      const after = await c.pageBox('lone');
      assert.deepEqual(
        [Math.round(after.x), Math.round(after.y)],
        [Math.round(ref.x), Math.round(ref.y)],
        'the camera did not move (no fit-to-view)'
      );
      const s = await caretState();
      assert.ok(s, 'the label editor is open');
    });
  }

  test('double-click on standalone text re-edits it', async () => {
    await reset();
    const [x, y] = await c.center('label');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    const s = await caretState();
    assert.ok(s, 'text editor open');
    assert.match(s.text, /Ahoj/);
  });
});

describe('R2b — double-click INSIDE an open editor selects a word; the view never jumps', () => {
  for (const id of ['note', 'box', 'label']) {
    test(`${id}: double-click on a word while editing`, async () => {
      await reset();
      const [x, y] = await c.center(id);
      await c.page.mouse.dblclick(x, y);
      await sleep(300);
      await c.page.keyboard.press('Meta+a');
      await c.page.keyboard.type('alpha bravo charlie');
      await sleep(150);
      // Pan away from the fitted view first — otherwise a stray fit() would
      // land exactly where we are and the jump would go unnoticed.
      await c.page.mouse.move(x, y + 400);
      await c.page.mouse.wheel(40, -80);
      await sleep(300);
      assert.ok(!!(await caretState()), 'panning with the wheel keeps the editor open');
      const ref = await c.pageBox('lone');
      // Double-click the middle word, inside the editor.
      const word = await c.wordPoint('bravo');
      assert.ok(word, 'the word is laid out in the editor');
      const frameBox = await c.page.locator('[data-testid="canvas-frame"]').boundingBox();
      await c.page.mouse.dblclick(word.x + frameBox.x, word.y + frameBox.y);
      await sleep(400);
      const after = await c.pageBox('lone');
      assert.deepEqual(
        [Math.round(after.x), Math.round(after.y)],
        [Math.round(ref.x), Math.round(ref.y)],
        'the camera did not move'
      );
      const state = await caretState();
      assert.ok(state, 'still editing');
      assert.equal(state.selected.trim(), 'bravo', 'the word is selected');
    });
  }
});

describe('R3 — marquee and sections', () => {
  test('a marquee over content inside a section selects the content, not the section', async () => {
    await reset();
    const cb = await c.pageBox('circle');
    const rb = await c.pageBox('box');
    await c.drag(
      [Math.min(cb.x, rb.x) - 20, Math.min(cb.y, rb.y) - 20],
      [
        Math.max(cb.x + cb.width, rb.x + rb.width) + 20,
        Math.max(cb.y + cb.height, rb.y + rb.height) + 20,
      ]
    );
    await sleep(300);
    assert.deepEqual(await c.selection(), ['box', 'circle', 'link']);
  });

  test('a marquee that encloses the whole section selects the section too', async () => {
    await reset();
    const sb = await c.pageBox('sec');
    // Start just above the title chip — still inside the canvas iframe.
    await c.drag([sb.x - 20, sb.y - 12], [sb.x + sb.width + 30, sb.y + sb.height + 30]);
    await sleep(300);
    const sel = await c.selection();
    assert.ok(sel.includes('sec'), `section selected (${sel})`);
  });
});

describe('R4 — Shift+click toggles', () => {
  test('shift-click adds, shift-click on a selected element removes it', async () => {
    await reset();
    const note = await c.center('note');
    const lone = await c.center('lone');
    await c.click(note[0], note[1]);
    await sleep(150);
    assert.deepEqual(await c.selection(), ['note']);
    await c.click(lone[0], lone[1], { modifiers: ['Shift'] });
    await sleep(150);
    assert.deepEqual(await c.selection(), ['lone', 'note']);
    await c.click(note[0], note[1], { modifiers: ['Shift'] });
    await sleep(150);
    assert.deepEqual(await c.selection(), ['lone']);
    await c.click(lone[0], lone[1], { modifiers: ['Shift'] });
    await sleep(150);
    assert.deepEqual(await c.selection(), []);
  });

  test('shift-click on a selected element does not move it', async () => {
    await reset();
    const before = await c.pageBox('note');
    const note = await c.center('note');
    await c.click(note[0], note[1]);
    await sleep(100);
    await c.click(note[0], note[1], { modifiers: ['Shift'] });
    await sleep(400);
    assert.deepEqual(await c.pageBox('note'), before);
    const disk = readBoard(server.root);
    if (disk) assert.deepEqual([disk.get('note').x, disk.get('note').y], [1000, 100]);
  });
});

describe('R5 — what reaches the board on disk (v2)', {
  skip: process.env.E2E_LEGACY === '1',
}, () => {
  test('a multi-line sticky edit persists with its newline; Esc cancels without saving', async () => {
    await reset();
    const [x, y] = await c.center('note');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('Meta+a');
    await c.page.keyboard.type('line one');
    await c.page.keyboard.press('Shift+Enter');
    await c.page.keyboard.type('line two');
    await c.click(20 + 300, 1400); // outside → commit
    const board = await waitForBoard(
      server.root,
      (b) => b.get('note')?.text === 'line one\nline two'
    );
    assert.equal(board.get('note').text, 'line one\nline two');

    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.type(' — not kept');
    await c.page.keyboard.press('Escape');
    await sleep(600);
    assert.equal(
      (await waitForBoard(server.root, () => true)).get('note').text,
      'line one\nline two'
    );
  });

  test('dragging an element into a section re-parents it on disk, at the same place on screen', async () => {
    await reset();
    const lone = await c.pageBox('lone');
    const sec = await c.pageBox('sec');
    const to = [sec.x + sec.width - 120, sec.y + sec.height - 90];
    await c.drag([lone.x + 20, lone.y + 20], to);
    const board = await waitForBoard(server.root, (b) => b.get('lone')?.parent === 'sec');
    assert.equal(board.get('lone').parent, 'sec');
    const after = await c.pageBox('lone');
    // Snapping may nudge the drop point; what matters is that the element is
    // DRAWN where its new parent-relative coordinates say (no jump on
    // re-parent). Reference: the circle, a sibling with known relative (80, 80).
    const circ = await c.pageBox('circle');
    const rel = board.get('lone');
    assert.ok(
      Math.abs(after.x - circ.x - (rel.x - 80)) < 3 &&
        Math.abs(after.y - circ.y - (rel.y - 80)) < 3,
      `drawn at its stored relative place (${after.x - circ.x},${after.y - circ.y} vs ${rel.x - 80},${rel.y - 80})`
    );
    // …and moving the section now carries it (one write: the section).
    const secBefore = board.get('sec');
    const loneBefore = board.get('lone');
    // Grab the section by its title chip (v2: its own node above the section's
    // box; v1: the top of the section's SVG group, which included the chip).
    const chipBox = await c.frame
      .locator('[data-id="sec"] [data-section-chip]')
      .first()
      .boundingBox({ timeout: 500 })
      .catch(() => null);
    const chip = chipBox
      ? [chipBox.x + 20, chipBox.y + chipBox.height / 2]
      : [sec.x + 20, sec.y + 8];
    await c.drag(chip, [chip[0] + 60, chip[1] + 40]);
    const moved = await waitForBoard(server.root, (b) => b.get('sec')?.x !== secBefore.x);
    assert.deepEqual(
      [moved.get('lone').x, moved.get('lone').y],
      [loneBefore.x, loneBefore.y],
      'child keeps its relative place'
    );
    const lone2 = await c.pageBox('lone');
    const sec2 = await c.pageBox('sec');
    // Snapping may round the section's move; the child must move by exactly the same amount.
    assert.ok(
      Math.abs(lone2.x - after.x - (sec2.x - sec.x)) < 2 &&
        Math.abs(lone2.y - after.y - (sec2.y - sec.y)) < 2,
      `child moved with its section (${lone2.x - after.x},${lone2.y - after.y} vs ${sec2.x - sec.x},${sec2.y - sec.y})`
    );
    assert.ok(sec2.x !== sec.x, 'the section moved');
  });

  test('Delete removes the selection from disk; ⌘Z brings it back', async () => {
    await reset();
    const [x, y] = await c.center('circle');
    await c.click(x, y);
    await sleep(150);
    await c.page.keyboard.press('Delete');
    let board = await waitForBoard(server.root, (b) => !b.has('circle'));
    assert.equal(board.has('circle'), false);
    // The arrow bound to it survives, frozen where it was drawn.
    assert.ok(
      board.has('link') && !('el' in board.get('link').start),
      'arrow start is now a free point'
    );
    await c.page.keyboard.press('Meta+z');
    board = await waitForBoard(server.root, (b) => b.has('circle'));
    assert.equal(board.has('circle'), true);
    assert.deepEqual(board.get('link').start, { el: 'circle' }, 'undo re-binds the arrow');
  });
});

describe('R6 — Milestone C: one text system (HTML text, textarea editor)', () => {
  test('text is HTML in the element’s own node, and ink painted above a sticky covers its text', async () => {
    await reset();
    const order = await c.frame.evaluate(() =>
      [...document.querySelectorAll('.dc-annot-scene > [data-id]')].map((n) =>
        n.getAttribute('data-id')
      )
    );
    if (!order.length) return; // E2E_LEGACY: v1 has no scene
    assert.ok(order.indexOf('ink') > order.indexOf('note'), 'the pen paints after the sticky');
    const noteText = await c.frame.evaluate(
      () => document.querySelector('[data-id="note"] .dc-annot-text')?.textContent ?? null
    );
    const onDisk = (await waitForBoard(server.root, () => true)).get('note').text;
    assert.equal(noteText, onDisk, 'the sticky body is an HTML text block');
    assert.equal(
      await c.frame.evaluate(
        () => document.querySelectorAll('.dc-annot-scene text[data-tool]').length
      ),
      0,
      'no SVG <text> for object text'
    );
  });

  test('typing into a shape without a label creates the label', async () => {
    await reset();
    const [x, y] = await c.center('plain');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    assert.ok(await c.editorState(), 'label editor open on an unlabelled shape');
    await c.page.keyboard.type('New label');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(
      server.root,
      (b) => b.get('plain')?.label?.text === 'New label'
    );
    assert.equal(board.get('plain').label.text, 'New label');
    assert.equal(await c.editorState(), null, 'Enter closed the editor');
  });

  test('the Text tool drops a new text; Enter commits it to the board', async () => {
    await reset();
    const b = await c.pageBox('lone');
    await c.page.keyboard.press('t');
    await sleep(100);
    await c.page.mouse.click(b.x + b.width + 120, b.y + b.height + 160);
    await sleep(300);
    assert.ok(await c.editorState(), 'a caret opened for the new text');
    await c.page.keyboard.type('fresh words');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(server.root, (bd) =>
      [...bd.values()].some((e) => e.type === 'text' && e.text === 'fresh words')
    );
    assert.ok([...board.values()].some((e) => e.type === 'text' && e.text === 'fresh words'));
  });

  test('renaming a section from its title chip', async () => {
    await reset();
    const chip = await c.frame
      .locator('[data-id="sec"] [data-section-chip]')
      .first()
      .boundingBox({ timeout: 500 })
      .catch(() => null);
    const sec = await c.pageBox('sec');
    const pt = chip ? [chip.x + 12, chip.y + chip.height / 2] : [sec.x + 12, sec.y + 8];
    await c.page.mouse.dblclick(pt[0], pt[1]);
    await sleep(300);
    assert.ok(await c.editorState(), 'rename field open');
    await c.page.keyboard.press('Meta+a');
    await c.page.keyboard.type('Plan');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(server.root, (bd) => bd.get('sec')?.label === 'Plan');
    assert.equal(board.get('sec').label, 'Plan');
  });

  test('⌘B while editing a sticky makes it bold; Esc on the next session saves nothing', async () => {
    await reset();
    const [x, y] = await c.center('note');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('Meta+b');
    await c.page.keyboard.press('Enter');
    let board = await waitForBoard(server.root, (bd) => bd.get('note')?.bold === true);
    assert.equal(board.get('note').bold, true);
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('Meta+a');
    await c.page.keyboard.type('discard me');
    await c.page.keyboard.press('Escape');
    await sleep(600);
    board = await waitForBoard(server.root, () => true);
    assert.notEqual(board.get('note').text, 'discard me');
  });

  test('⌘Enter in a sticky commits and chains a new sticky with its editor open', async () => {
    await reset();
    const before = await waitForBoard(server.root, () => true);
    const stickies = [...before.values()].filter((e) => e.type === 'sticky').length;
    const [x, y] = await c.center('note');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('Meta+Enter');
    await sleep(300);
    assert.ok(await c.editorState(), 'the new sticky opened for typing');
    await c.page.keyboard.type('next');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(
      server.root,
      (bd) => [...bd.values()].filter((e) => e.type === 'sticky').length > stickies
    );
    assert.ok([...board.values()].some((e) => e.type === 'sticky' && e.text === 'next'));
  });

  test('below the editing zoom floor a double-click first zooms to the element', async () => {
    await reset();
    // Pinch-zoom out over empty canvas (ctrl+wheel is the trackpad pinch).
    const lb = await c.pageBox('lone');
    await c.page.mouse.move(lb.x + lb.width + 200, lb.y + 300);
    await c.page.keyboard.down('Control');
    for (let i = 0; i < 6; i++) await c.page.mouse.wheel(0, 240);
    await c.page.keyboard.up('Control');
    await sleep(600);
    // The world scales by CSS zoom (Blink) or a transform (WebKit): measure
    // the zoom from an element of known world width instead (lone: 160).
    const zoomOf = async () => (await c.pageBox('lone')).width / 160;
    const z0 = await zoomOf();
    assert.ok(z0 < 0.5, `precondition: zoomed out below the floor (zoom ${z0})`);
    const [x, y] = await c.center('lone');
    await c.page.mouse.dblclick(x, y);
    await sleep(900);
    assert.ok((await zoomOf()) > z0, `zoomed in to edit (was ${z0})`);
    assert.ok(await c.editorState(), 'editor open');
    await c.page.keyboard.press('Escape');
  });
});

describe('R7 — Task 19: drafts and a collaborator while editing', () => {
  test('a pause while typing lands a draft on the board, with the editor still open', async () => {
    await reset();
    const [x, y] = await c.center('duo');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('End');
    await c.page.keyboard.type(' A');
    const board = await waitForBoard(server.root, (b) => b.get('duo')?.text === 'shared A');
    assert.equal(board.get('duo').text, 'shared A');
    assert.ok(await c.editorState(), 'still editing');
  });

  test('a collaborator’s edit shows a marker; the commit keeps both texts; undo removes only mine', async () => {
    const cur = (await waitForBoard(server.root, () => true)).get('duo').text;
    await peerOps(server, [
      { op: 'patch', id: 'duo', set: { text: `Peer: ${cur}` }, expect: { text: cur } },
    ]);
    const marker = await c.frame
      .locator('[data-edit-notice="edited"]')
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    assert.ok(marker, '"edited by a collaborator" marker is shown');
    const state = await c.editorState();
    assert.equal(state.text, 'shared A', 'the editor keeps what the user typed');
    await c.page.keyboard.type(' B');
    await c.page.keyboard.press('Enter');
    let board = await waitForBoard(server.root, (b) => b.get('duo')?.text === 'Peer: shared A B');
    assert.equal(board.get('duo').text, 'Peer: shared A B');
    // Undo reverts this edit only — the collaborator's prefix stays.
    await sleep(300);
    await c.page.keyboard.press('Meta+z');
    board = await waitForBoard(server.root, (b) => b.get('duo')?.text === 'Peer: shared');
    assert.equal(board.get('duo').text, 'Peer: shared');
  });

  test('a collaborator deletes the sticky mid-edit — the editor stays, Enter restores it with the text', async () => {
    await reset();
    const [x, y] = await c.center('gone');
    await c.page.mouse.dblclick(x, y);
    await sleep(300);
    await c.page.keyboard.press('End');
    await c.page.keyboard.type(' kept');
    await peerOps(server, [{ op: 'delete', id: 'gone' }]);
    await waitForBoard(server.root, (b) => !b.has('gone'));
    const marker = await c.frame
      .locator('[data-edit-notice="deleted"]')
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    assert.ok(marker, '"deleted by a collaborator" marker is shown');
    assert.equal((await c.editorState())?.text, 'fragile kept', 'the typed text is still there');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(server.root, (b) => b.get('gone')?.text === 'fragile kept');
    assert.equal(board.get('gone').type, 'sticky');
  });
});

describe('R8 — Milestone D: an operation on a section acts on its contents', () => {
  /** Select the section by its title chip. */
  async function selectSection(id) {
    await reset();
    const chip = await c.frame
      .locator(`[data-id="${id}"] [data-section-chip]`)
      .first()
      .boundingBox({ timeout: 1000 });
    await c.click(chip.x + 12, chip.y + chip.height / 2);
    await sleep(200);
    assert.deepEqual(await c.selection(), [id]);
  }
  const childrenOf = (b, id) =>
    [...b.values()]
      .filter((e) => e.parent === id)
      .map((e) => e.id)
      .sort();

  test('arrow-key nudge moves the section and its contents together', async () => {
    const before = await waitForBoard(server.root, () => true);
    await selectSection('sec');
    await c.page.keyboard.press('ArrowRight');
    const after = await waitForBoard(server.root, (b) => b.get('sec')?.x !== before.get('sec').x);
    assert.ok(after.get('sec').x > before.get('sec').x, 'the section moved right');
    for (const id of childrenOf(before, 'sec')) {
      assert.equal(after.get(id).parent, 'sec', `${id} is still inside`);
      assert.equal(after.get(id).x, before.get(id).x, `${id} moved with it (same place inside)`);
    }
  });

  test('⌘D duplicates the section with its contents', async () => {
    const before = await waitForBoard(server.root, () => true);
    const kids = childrenOf(before, 'sec');
    assert.ok(kids.length > 0, 'precondition: the section has contents');
    await selectSection('sec');
    await c.page.keyboard.press('Meta+d');
    const after = await waitForBoard(server.root, (b) => b.size > before.size);
    const copies = [...after.values()].filter((e) => e.type === 'section' && !before.has(e.id));
    assert.equal(copies.length, 1, 'one new section');
    assert.equal(
      childrenOf(after, copies[0].id).length,
      kids.length,
      'its contents were copied into it'
    );
    assert.deepEqual(childrenOf(after, 'sec'), kids, 'the original keeps its own');
  });

  test('Delete on a section removes its contents', async () => {
    const before = await waitForBoard(server.root, () => true);
    const copy = [...before.values()].find((e) => e.type === 'section' && e.id !== 'sec');
    assert.ok(copy, 'precondition: the copy from the previous step');
    const kids = childrenOf(before, copy.id);
    await selectSection(copy.id);
    await c.page.keyboard.press('Delete');
    const after = await waitForBoard(server.root, (b) => !b.has(copy.id));
    for (const k of kids) assert.equal(after.has(k), false, `${k} went with its section`);
    assert.ok(after.has('sec'), 'the other section is untouched');
  });
});

describe('R9 — pointer routing regressions (Task 21 guards them before the pipeline change)', () => {
  // World → page through `onart` (world 720,710, 120 wide; no scenario moves it).
  async function worldToPage(wx, wy) {
    const b = await c.pageBox('onart');
    const k = b.width / 120;
    return [b.x + (wx - 720) * k, b.y + (wy - 710) * k];
  }

  test('3db83a8a: dragging a multi-selection by its hull over an artboard moves the selection', async () => {
    await reset();
    const before = await waitForBoard(server.root, () => true);
    const [ax, ay] = await c.center('onart');
    const [px, py] = await c.center('plain');
    await c.click(ax, ay);
    await c.click(px, py, { modifiers: ['Shift'] });
    await sleep(200);
    assert.deepEqual(await c.selection(), ['onart', 'plain']);
    // Inside the hull, over the artboard, on no element.
    const [hx, hy] = await worldToPage(870, 760);
    await c.drag([hx, hy], [hx + 60, hy + 40]);
    const after = await waitForBoard(
      server.root,
      (b) => b.get('onart')?.x !== before.get('onart').x
    );
    assert.ok(after.get('onart').x > before.get('onart').x, 'onart moved');
    assert.ok(after.get('plain').x > before.get('plain').x, 'plain moved with it');
    assert.deepEqual(await c.selection(), ['onart', 'plain'], 'still selected');
    await c.page.keyboard.press('Meta+z');
    await waitForBoard(server.root, (b) => b.get('onart')?.x === before.get('onart').x);
  });

  test('ce641b18: dragging a resize handle resizes; no marquee, no deselect', async () => {
    await reset();
    const before = await waitForBoard(server.root, () => true);
    const [px, py] = await c.center('plain');
    await c.click(px, py);
    await sleep(200);
    const h = await c.frame
      .locator('.dc-annot-resize-handle[data-corner="se"]')
      .first()
      .boundingBox({ timeout: 2000 });
    const from = [h.x + h.width / 2, h.y + h.height / 2];
    await c.drag(from, [from[0] + 40, from[1] + 30]);
    const after = await waitForBoard(
      server.root,
      (b) => b.get('plain')?.w !== before.get('plain').w
    );
    assert.ok(after.get('plain').w > before.get('plain').w, 'wider');
    assert.deepEqual(await c.selection(), ['plain'], 'still selected');
    assert.equal(
      await c.frame.evaluate(() => !!document.querySelector('.dc-annot-marquee')),
      false,
      'no marquee left behind'
    );
  });
});

describe('R10 — Task 22: a collaborator sees a drag while it happens', () => {
  test('a second viewer sees the gesture ghost mid-drag, and it clears on release', async () => {
    await reset();
    const peerView = await openCanvas(server);
    try {
      const [x, y] = await c.center('lone');
      await c.page.mouse.move(x, y);
      await c.page.mouse.down();
      await c.page.mouse.move(x + 40, y + 20, { steps: 6 });
      await c.page.mouse.move(x + 80, y + 40, { steps: 6 });
      const seen = await peerView.frame
        .locator('[data-peer-gesture="move"]')
        .first()
        .waitFor({ timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      await c.page.mouse.up();
      assert.ok(seen, 'the other viewer shows the drag ghost while the button is held');
      const cleared = await peerView.frame
        .locator('[data-peer-gesture]')
        .first()
        .waitFor({ state: 'detached', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      assert.ok(cleared, 'the ghost goes away once the drag is committed');
      await c.page.keyboard.press('Meta+z');
    } finally {
      await peerView.close();
    }
  });
});

test('no page errors during the run', () => {
  assert.deepEqual(c.errors, []);
});

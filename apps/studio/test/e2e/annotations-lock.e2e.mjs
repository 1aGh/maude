// Annotation lock (#137) — browser E2E (node --test). Real studio server + real
// canvas in headless Chromium; assertions on the DOM AND on the board on disk.
//
//   node --test apps/studio/test/e2e/annotations-lock.e2e.mjs
//
//   L1 a locked element is selectable: lock badge, no handles, toolbar = Unlock only
//   L2 drag / arrow nudge / Delete / double-click do nothing to it
//   L3 marquee skips it; Duplicate makes an UNLOCKED copy
//   L4 ⌘⇧L toggles, persists, and one undo reverts it
//   L5 a locked section stays put, its unlocked child still moves
//   L6 a collaborator's lock / unlock reaches the open canvas
//   L7 the lock is a UX guard: the server op API still applies a peer's move

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  makeProject,
  openCanvas,
  peerOps,
  readBoard,
  sleep,
  startServer,
  waitForBoard,
} from './harness.mjs';

const BOARD = [
  {
    id: 'lk',
    type: 'sticky',
    index: 'a0',
    x: 100,
    y: 100,
    w: 200,
    h: 200,
    text: 'locked',
    locked: true,
  },
  { id: 'fr', type: 'sticky', index: 'a1', x: 400, y: 100, w: 200, h: 200, text: 'free' },
  {
    id: 'lsec',
    type: 'section',
    index: 'a2',
    x: 100,
    y: 400,
    w: 600,
    h: 320,
    label: 'Locked section',
    locked: true,
  },
  {
    id: 'kid',
    type: 'sticky',
    parent: 'lsec',
    index: 'a0',
    x: 40,
    y: 60,
    w: 160,
    h: 160,
    text: 'kid',
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

async function reset() {
  for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape');
  await sleep(250);
}
const disk = () => readBoard(server.root);
const sameBox = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.5);
const badge = () => c.frame.locator('[data-testid="annot-lock-badge"]');
const unlockBtn = () => c.frame.locator('[data-testid="annot-ctx-unlock"]');
const lockBtn = () => c.frame.locator('[data-testid="annot-ctx-lock"]');
const handles = () => c.frame.locator('.dc-annot-resize-handle, .dc-annot-rotate-zone');

/** Click an element to select it (frame-relative centre → page click). */
async function select(id) {
  const [x, y] = await c.center(id);
  await c.click(x, y);
  await sleep(250);
}

describe('L1 — a locked element is selectable but pinned', () => {
  test('click selects it: lock badge, no handles, the toolbar offers only Unlock', async () => {
    await reset();
    await select('lk');
    assert.deepEqual(await c.selection(), ['lk']);
    assert.equal(await badge().count(), 1, 'lock badge shown');
    assert.equal(await handles().count(), 0, 'no resize / rotate handles');
    assert.equal(await unlockBtn().count(), 1, 'toolbar shows Unlock');
    assert.equal(await lockBtn().count(), 0);
    // Nothing else on the toolbar: no colour swatches while locked.
    assert.equal(
      await c.frame
        .locator(
          '.dc-annot-ctx [aria-label="Locked selection"], .dc-annot-ctx[aria-label="Locked selection"]'
        )
        .count(),
      1
    );
  });

  test('an unlocked element has handles and a Lock button instead', async () => {
    await reset();
    await select('fr');
    assert.equal(await badge().count(), 0);
    assert.ok((await handles().count()) > 0, 'handles on an unlocked element');
    assert.equal(await lockBtn().count(), 1);
    assert.equal(await unlockBtn().count(), 0);
  });
});

describe('L2 — nothing moves, deletes or edits a locked element', () => {
  test('drag does not move it, on screen or on disk', async () => {
    await reset();
    const before = await c.pageBox('lk');
    const [x, y] = await c.center('lk');
    await c.drag([x, y], [x + 80, y + 120]);
    await sleep(900);
    assert.ok(sameBox(await c.pageBox('lk'), before), 'did not move on screen');
    const d = disk().get('lk');
    assert.deepEqual([d.x, d.y], [100, 100]);
    assert.equal(d.locked, true);
  });

  test('arrow nudge, Backspace and Delete do nothing', async () => {
    await reset();
    await select('lk');
    for (let i = 0; i < 5; i++) await c.page.keyboard.press('ArrowRight');
    await c.page.keyboard.press('Backspace');
    await c.page.keyboard.press('Delete');
    await sleep(900);
    const d = disk().get('lk');
    assert.ok(d, 'still on the board');
    assert.deepEqual([d.x, d.y], [100, 100]);
  });

  test('double-click does not open the text editor', async () => {
    await reset();
    const [x, y] = await c.center('lk');
    await c.page.mouse.dblclick(x, y);
    await sleep(400);
    assert.equal(await c.editorState(), null, 'no editor');
    await c.page.keyboard.press('Enter');
    await sleep(200);
    assert.equal(await c.editorState(), null, 'Enter does not open it either');
  });

  test('a Delete on a mixed selection removes only the unlocked part', async () => {
    await reset();
    const fr = await c.center('fr');
    await select('lk');
    await c.click(fr[0], fr[1], { modifiers: ['Shift'] });
    await sleep(200);
    assert.deepEqual(await c.selection(), ['fr', 'lk']);
    await c.page.keyboard.press('Backspace');
    await sleep(900);
    const b = disk();
    assert.ok(b.has('lk'), 'the locked one survives');
    assert.ok(!b.has('fr'), 'the free one is deleted');
    // Put it back for the later scenarios.
    await peerOps(server, [{ op: 'put', el: BOARD[1] }]);
    await sleep(600);
  });
});

describe('L3 — marquee and duplicate', () => {
  test('a marquee over both stickies selects only the unlocked one', async () => {
    await reset();
    const a = await c.pageBox('lk');
    const b = await c.pageBox('fr');
    await c.drag(
      [Math.min(a.x, b.x) - 30, Math.min(a.y, b.y) - 30],
      [Math.max(a.x + a.width, b.x + b.width) + 30, Math.max(a.y + a.height, b.y + b.height) + 30]
    );
    await sleep(300);
    assert.deepEqual(await c.selection(), ['fr']);
  });

  test('Duplicate of a locked element yields an unlocked copy', async () => {
    await reset();
    await select('lk');
    await c.page.keyboard.press('Meta+d');
    const board = await waitForBoard(
      server.root,
      (b) => [...b.values()].filter((e) => e.text === 'locked').length === 2
    );
    const copies = [...board.values()].filter((e) => e.text === 'locked' && e.id !== 'lk');
    assert.equal(copies.length, 1, 'one copy');
    assert.equal(copies[0].locked, undefined, 'the copy is not locked');
    assert.equal(board.get('lk').locked, true, 'the original stays locked');
    await peerOps(server, [{ op: 'delete', id: copies[0].id }]);
    await sleep(500);
  });
});

describe('L4 — ⌘⇧L', () => {
  test('toggles the lock, persists it, and one undo reverts it', async () => {
    await reset();
    await select('fr');
    await c.page.keyboard.press('Meta+Shift+L');
    let b = await waitForBoard(server.root, (x) => x.get('fr')?.locked === true);
    assert.equal(b.get('fr').locked, true, 'locked on disk');
    assert.equal(await badge().count(), 1, 'badge appears');
    assert.equal(await unlockBtn().count(), 1);

    // The press toggled it: it is now pinned.
    const before = await c.pageBox('fr');
    const [x, y] = await c.center('fr');
    await c.drag([x, y], [x + 60, y + 60]);
    await sleep(700);
    assert.ok(sameBox(await c.pageBox('fr'), before), 'pinned');

    await c.page.keyboard.press('Meta+z');
    b = await waitForBoard(server.root, (x2) => x2.get('fr')?.locked === undefined);
    assert.equal(b.get('fr').locked, undefined, 'undo unlocked it');
    assert.equal(await badge().count(), 0);
  });

  test('the Unlock button unlocks, and the element then drags', async () => {
    await reset();
    await select('lk');
    await unlockBtn().click();
    const b = await waitForBoard(server.root, (x) => x.get('lk')?.locked === undefined);
    assert.equal(b.get('lk').locked, undefined);
    const [x, y] = await c.center('lk');
    await c.drag([x, y], [x + 70, y + 70]);
    const moved = await waitForBoard(server.root, (x2) => x2.get('lk').x !== 100);
    assert.notEqual(moved.get('lk').x, 100, 'moves once unlocked');
    // ⌘⇧L locks it again (still selected).
    await c.page.keyboard.press('Meta+Shift+L');
    const again = await waitForBoard(server.root, (x2) => x2.get('lk')?.locked === true);
    assert.equal(again.get('lk').locked, true);
  });
});

describe('L5 — a locked section', () => {
  /** A section is grabbed by its title chip, just above its box (an empty click inside is a marquee). */
  const chip = async () => {
    const b = await c.pageBox('lsec');
    return [b.x + 40, b.y - 10];
  };

  test('the section stays put (control: the same grab moves it once unlocked)', async () => {
    await reset();
    const secBefore = await c.pageBox('lsec');
    const grab = await chip();
    await c.drag(grab, [grab[0] + 80, grab[1] + 100]);
    await sleep(900);
    assert.ok(sameBox(await c.pageBox('lsec'), secBefore), 'the locked section did not move');
    assert.deepEqual([disk().get('lsec').x, disk().get('lsec').y], [100, 400]);

    // Positive control: this exact gesture DOES move the section when it is not locked.
    await peerOps(server, [{ op: 'patch', id: 'lsec', unset: ['locked'] }]);
    await sleep(700);
    await reset();
    await c.drag(grab, [grab[0] + 80, grab[1] + 100]);
    const moved = await waitForBoard(server.root, (b) => b.get('lsec').x !== 100);
    assert.notEqual(moved.get('lsec').x, 100, 'the control gesture moves an unlocked section');

    // Put it back where it was, locked, for the scenarios below.
    await peerOps(server, [{ op: 'patch', id: 'lsec', set: { x: 100, y: 400, locked: true } }]);
    await sleep(700);
  });

  test('its unlocked child still moves, and stays inside', async () => {
    await reset();
    const kidBefore = disk().get('kid');
    const [x, y] = await c.center('kid');
    await c.drag([x, y], [x + 60, y + 40]);
    const b = await waitForBoard(server.root, (bd) => bd.get('kid').x !== kidBefore.x);
    assert.notEqual(b.get('kid').x, kidBefore.x, 'the child moved');
    assert.equal(b.get('kid').parent, 'lsec', 'and stayed inside the section');
  });

  test('the section cannot be deleted while it holds a locked element', async () => {
    await reset();
    // The section itself is unlocked here; its child is the locked one.
    await peerOps(server, [
      { op: 'patch', id: 'lsec', unset: ['locked'] },
      { op: 'patch', id: 'kid', set: { locked: true } },
    ]);
    await sleep(700);
    const grab = await chip();
    await c.click(grab[0], grab[1]);
    await sleep(300);
    assert.deepEqual(await c.selection(), ['lsec'], 'the section is selected');
    await c.page.keyboard.press('Backspace');
    await sleep(900);
    assert.ok(disk().has('lsec'), 'the section survives');
    assert.ok(disk().has('kid'), 'and so does its locked child');
    await peerOps(server, [
      { op: 'patch', id: 'kid', unset: ['locked'] },
      { op: 'patch', id: 'lsec', set: { locked: true } },
    ]);
    await sleep(500);
  });
});

describe('L6 — collaborators', () => {
  test("a peer's lock reaches the open canvas, and so does their unlock", async () => {
    await reset();
    await peerOps(server, [{ op: 'patch', id: 'fr', set: { locked: true } }]);
    await sleep(700);
    await select('fr');
    assert.equal(await unlockBtn().count(), 1, 'the peer lock is reflected in the toolbar');
    const before = await c.pageBox('fr');
    const [x, y] = await c.center('fr');
    await c.drag([x, y], [x + 60, y + 60]);
    await sleep(600);
    assert.ok(sameBox(await c.pageBox('fr'), before), 'pinned by the peer');

    await peerOps(server, [{ op: 'patch', id: 'fr', unset: ['locked'] }]);
    await sleep(700);
    await reset();
    await select('fr');
    assert.equal(await lockBtn().count(), 1, 'peer unlock reflected');
    const [x2, y2] = await c.center('fr');
    await c.drag([x2, y2], [x2 + 60, y2 + 60]);
    const b = await waitForBoard(server.root, (bd) => bd.get('fr').x !== 400);
    assert.notEqual(b.get('fr').x, 400, 'moves again');
  });

  test("a peer's edit of another field never strips the lock", async () => {
    await reset();
    await peerOps(server, [{ op: 'patch', id: 'lk', set: { text: 'edited by peer' } }]);
    const b = await waitForBoard(server.root, (bd) => bd.get('lk')?.text === 'edited by peer');
    assert.equal(b.get('lk').locked, true);
  });
});

describe('L7 — the lock is a UX guard, not a permission (DDR-246)', () => {
  test('the server op API still applies a peer move to a locked element', async () => {
    const before = disk().get('lk');
    await peerOps(server, [{ op: 'patch', id: 'lk', set: { x: before.x + 5 } }]);
    const b = await waitForBoard(server.root, (bd) => bd.get('lk').x === before.x + 5);
    assert.equal(b.get('lk').x, before.x + 5);
    assert.equal(b.get('lk').locked, true, 'and it stays locked');
  });

  test('no page errors during the whole run', () => {
    assert.deepEqual(c.errors, []);
  });
});

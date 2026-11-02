// p8-fix-a F21 — the element bar of a top-row selection must be CLICKABLE at Fit's own margin, not hidden under
// the Preview bar island. annotations-parity opens with `clearTop: 120` and clicks Group with `dispatchEvent`
// because the bar used to land under the island; this opens at the default margin (clearTop 0) and asks the
// browser's own hit test: Playwright's trial click fails with "intercepts pointer events" when something else
// covers the control, and elementFromPoint at the button's centre must resolve inside the bar.
//
//   node --test apps/studio/test/e2e/annotations-bar-clearance.e2e.mjs

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { makeProjectFor, openCanvas, sleep, startServer } from './harness.mjs';

const BOARD = [
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
];

let server;
let c;
before(async () => {
  server = await startServer(await makeProjectFor(BOARD));
  c = await openCanvas(server); // clearTop 0: Fit's own margin
});
after(async () => {
  await c?.close();
  server?.stop();
});

describe('the element bar of the top row', () => {
  test('Group is hit by a real pointer, not covered by the Preview bar', async () => {
    for (const [id, shift] of [
      ['ref', false],
      ['B', true],
    ]) {
      const [x, y] = await c.center(id);
      await c.click(x, y, shift ? { modifiers: ['Shift'] } : {});
      await sleep(250);
    }
    await sleep(400);
    const group = c.frame.locator('.dc-annot-ctx [aria-label="Group selection"]').first();
    const box = await group.boundingBox();
    assert.ok(box, 'the Group control is on screen');
    // the shell's islands that cover the top of the canvas
    const covering = await c.page.evaluate(
      ([bx, by, bw, bh]) =>
        [...document.querySelectorAll('[data-occludes="top"]')].some((el) => {
          const r = el.getBoundingClientRect();
          return bx < r.right && bx + bw > r.left && by < r.bottom && by + bh > r.top;
        }),
      [box.x, box.y, box.width, box.height]
    );
    assert.equal(covering, false, `Group (${JSON.stringify(box)}) sits under a top island`);
    // and Playwright's hit-target check agrees (it throws when another element intercepts the pointer)
    await group.click({ trial: true, timeout: 3000 });
  });
});

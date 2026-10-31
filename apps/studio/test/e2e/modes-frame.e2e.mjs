// r2-p3 — the shell frame across a mode switch, in a real Chromium (node --test).
//
//   node --test apps/studio/test/e2e/modes-frame.e2e.mjs
//
// Michal's UX-audit decisions (MICHAL-DECISIONS.md, decision maude/v2-michal-ux-audit-td-decisions):
//   TD1d  a mode switch changes only the toolbar — the pill, the Share cluster, Undo · Redo and the avatar keep
//         their place and form, and the camera does not move;
//   TD1b  the switch's segments name mode + key; the change is announced;
//   TD5   no What's-new toast on the canvas;
//   TD9   keyboard focus draws a 2 px ring on a control whose own rule says `outline: none`;
//   F27   clicking the active left tab keeps its panel.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { REPORT_BOARD } from './fixtures.mjs';
import { makeProjectFor, openCanvas, sleep, startServer } from './harness.mjs';

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

const id = (t) => c.page.locator(`[data-testid="${t}"]`).first();

/** Where the frame's fixed parts are, and what form they are in. */
async function frame() {
  return c.page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(
        ','
      );
    };
    const shown = (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    };
    return {
      pill: box('.sh-pill.island'),
      cluster: box('[data-testid="share-cluster"]'),
      undo: shown('[data-testid="zoom-undo-undo"]'),
      redo: shown('[data-testid="zoom-undo-redo"]'),
      status: shown('[data-testid="share-cluster-status"]'),
      faces: shown('[data-testid="share-cluster-faces"]'),
    };
  });
}
const camera = () =>
  c.frame.evaluate(() => {
    const w = document.querySelector('.dc-world');
    return w ? getComputedStyle(w).transform : null;
  });

describe('TD1d — Edit ⇄ Preview changes only the toolbar', () => {
  test('pill, Share cluster, Undo · Redo and the faces stay put; the camera does not move', async () => {
    await c.setMode('edit');
    await sleep(600);
    const edit = await frame();
    const cam = await camera();
    assert.equal(edit.undo, true, 'Edit draws Undo');
    await id('palette-mode-preview').click();
    await sleep(600);
    assert.equal(
      await id('palette-mode-preview').getAttribute('aria-pressed'),
      'true',
      'Preview is pressed'
    );
    const preview = await frame();
    assert.deepEqual(preview, edit, 'the frame is the same in Preview');
    assert.equal(await camera(), cam, 'the camera did not move');
    assert.equal(await id('mode-switch-live').textContent(), 'Preview', 'the change is announced');
    await id('palette-mode-edit').click();
    await sleep(600);
    assert.deepEqual(await frame(), edit, 'and the same back in Edit');
    assert.equal(await camera(), cam);
  });

  test('the segments name their mode and key', async () => {
    assert.equal(await id('palette-mode-preview').getAttribute('title'), 'Preview  ⌥⌘P');
    assert.equal(await id('palette-mode-present').getAttribute('title'), 'Present  ⌥⌘↵');
  });
});

describe('TD5 — What’s new is never a canvas toast', () => {
  test('no notice on the canvas says What’s new', async () => {
    const texts = await c.page.locator('.maude-notice').allTextContents();
    assert.equal(
      texts.some((t) => /What.s new/.test(t)),
      false,
      texts.join(' | ')
    );
  });
});

describe('TD9 — keyboard focus always draws a 2 px ring', () => {
  test('a mode segment and the panels button show a solid 2 px outline on focus-visible', async () => {
    for (const t of ['palette-mode-preview', 'share-cluster-panels']) {
      await id(t).focus();
      // :focus-visible after a programmatic focus that follows a key press
      await c.page.keyboard.press('Shift');
      const ring = await id(t).evaluate((el) => {
        const s = getComputedStyle(el);
        return { w: s.outlineWidth, st: s.outlineStyle, fv: el.matches(':focus-visible') };
      });
      if (!ring.fv) continue; // a browser that withholds :focus-visible on .focus() — nothing to judge
      assert.equal(ring.st, 'solid', `${t}: ring style`);
      assert.equal(ring.w, '2px', `${t}: ring width`);
    }
  });
});

describe('TD9 — a menu row whose own rule drops the outline still rings; the menu has an edge', () => {
  test('Project menu: a keyboard-focused row draws 2 px; the menu wears 1 px; its island rises over toasts', async () => {
    await c.page.locator('.sh-pill-btn').first().click();
    await sleep(250);
    await c.page.keyboard.press('ArrowDown');
    await sleep(100);
    const got = await c.page.evaluate(() => {
      const row = document.activeElement;
      const menu = document.querySelector('.sh-pill.island [role="menu"]');
      const rs = row ? getComputedStyle(row) : null;
      const ms = menu ? getComputedStyle(menu) : null;
      return {
        role: row?.getAttribute('role') ?? null,
        fv: !!row?.matches(':focus-visible'),
        w: rs?.outlineWidth,
        st: rs?.outlineStyle,
        edge: ms ? `${ms.borderTopWidth} ${ms.borderTopStyle}` : null,
        z: getComputedStyle(document.querySelector('.sh-pill.island')).zIndex,
      };
    });
    await c.page.keyboard.press('Escape');
    assert.equal(got.role, 'menuitem', 'focus is on a menu row');
    assert.equal(got.fv, true);
    assert.equal(`${got.w} ${got.st}`, '2px solid', 'the row rings');
    assert.equal(got.edge, '1px solid', 'the menu has its edge');
    assert.ok(Number(got.z) > 8000, `the open menu's island (z ${got.z}) sits over the toaster`);
  });
});

describe('F27 — the active left tab selects, it never hides the panel', () => {
  test('clicking the active Canvases tab keeps the panel open', async () => {
    const head = '[data-testid="panel-head-left"]';
    const tab = c.page.locator(`${head} [data-testid^="panel-tab-"][aria-selected="true"]`).first();
    assert.equal(await tab.count(), 1, 'the left panel is open with a selected tab');
    const which = await tab.getAttribute('data-testid');
    await tab.click();
    await sleep(400);
    assert.equal(await c.page.locator(head).count(), 1, 'the panel is still there');
    assert.equal(
      await id(which).getAttribute('aria-selected'),
      'true',
      'its tab is still selected'
    );
  });
});

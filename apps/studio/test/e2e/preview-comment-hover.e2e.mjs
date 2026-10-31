// Preview keys + comment hover — browser E2E (node --test). Real studio server + real canvas in headless Chromium;
// assertions on the DOM AND on the comments file on disk.
//
//   node --test apps/studio/test/e2e/preview-comment-hover.e2e.mjs
//
// Michal's rc.1 findings (package E):
//   #18 V in Preview arms Preview's pointer and keeps the mode (it used to cross to Edit).
//   #19 Comment (C) lightly outlines the element under the pointer, and a comment dropped on it stores that
//       element's id; a comment dropped on empty canvas stays at its world point.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeProject, openCanvas, sleep, startServer } from './harness.mjs';

let server;
let c;

before(async () => {
  server = await startServer(makeProject());
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const ELEMENT = '[data-dc-screen="a"] .dc-artboard-body [data-cd-id]';

const tool = () => c.frame.evaluate(() => document.body.getAttribute('data-active-tool'));
const shellMode = () =>
  c.page.evaluate(
    () =>
      document
        .querySelector('[data-testid^="palette-mode-"][aria-pressed="true"]')
        ?.getAttribute('data-testid') ?? null
  );
/** The hover outline as painted (computed display, not only the inline style), or null. */
const hoverHalo = () =>
  c.frame.evaluate(() => {
    const h = document.querySelector('.dc-cv-halo--hover');
    if (!h || getComputedStyle(h).display === 'none') return null;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  });
const comments = () => {
  try {
    return JSON.parse(
      readFileSync(join(server.root, '.design', '_comments', 'ui-board.json'), 'utf8')
    );
  } catch {
    return [];
  }
};
async function waitForComment(text, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = comments().find((x) => x.text === text);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}
async function reset() {
  for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape');
  await sleep(250);
  if ((await shellMode()) !== 'palette-mode-preview') await c.setMode('preview');
}

describe('#18 — V in Preview arms the pointer and keeps Preview', () => {
  test('C then V: the tool is the Hand (browse), the mode is still Preview', async () => {
    await reset();
    await c.page.keyboard.press('c');
    await sleep(300);
    assert.equal(await tool(), 'comment');
    await c.page.keyboard.press('v');
    await sleep(500);
    assert.equal(await shellMode(), 'palette-mode-preview', 'V did not switch to Edit');
    assert.equal(await tool(), 'browse');
  });
});

describe('#19 — Comment outlines the element under the pointer and anchors to it', () => {
  test('hovering an element in comment mode paints the light hover outline on it', async () => {
    await reset();
    await c.page.keyboard.press('c');
    await sleep(300);
    const b = await c.frame.locator(ELEMENT).first().boundingBox();
    await c.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(80);
    await c.page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2);
    await sleep(300);
    const halo = await hoverHalo();
    assert.ok(halo, 'a hover outline is painted under the comment pointer');
    // frame-relative box vs page box: compare sizes, which the iframe offset does not change
    assert.ok(
      Math.abs(halo.w - b.width) <= 2 && Math.abs(halo.h - b.height) <= 2,
      'outline fits the element'
    );
  });

  test('a comment dropped on the element stores its element id', async () => {
    const cdId = await c.frame.locator(ELEMENT).first().getAttribute('data-cd-id');
    const b = await c.frame.locator(ELEMENT).first().boundingBox();
    await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(400);
    await c.page.keyboard.type('on the element');
    await c.frame.locator('[data-testid="comment-composer-send"]').click();
    const saved = await waitForComment('on the element');
    assert.ok(saved, 'the comment reached disk');
    assert.ok(
      saved.selector.includes(`data-cd-id="${cdId}"`),
      `anchored to ${cdId}: ${saved.selector}`
    );
    assert.equal(saved.artboard, 'a');
  });

  test('a comment dropped on empty canvas keeps its world point and no element', async () => {
    await reset();
    await c.page.keyboard.press('c');
    await sleep(300);
    const b = await c.frame.locator('[data-dc-screen="a"]').first().boundingBox();
    await c.page.mouse.move(b.x - 160, b.y - 120);
    await sleep(200);
    assert.equal(await hoverHalo(), null, 'no outline over empty canvas');
    await c.page.mouse.click(b.x - 160, b.y - 120);
    await sleep(400);
    await c.page.keyboard.type('in the open');
    await c.frame.locator('[data-testid="comment-composer-send"]').click();
    const saved = await waitForComment('in the open');
    assert.ok(saved, 'the comment reached disk');
    assert.ok(!saved.selector, 'no element anchor');
    assert.ok(Number.isFinite(saved.world?.x) && Number.isFinite(saved.world?.y), 'a world point');
  });
});

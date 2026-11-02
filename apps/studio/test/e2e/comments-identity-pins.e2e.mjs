// Comments — identity, pins, opening, icon, keyboard — browser E2E (node --test). Real studio server + real canvas in
// headless Chromium on a Mac with NO git identity; assertions on the DOM AND on the comments file on disk.
//
//   node --test apps/studio/test/e2e/comments-identity-pins.e2e.mjs
//
// Michal's rc.1 findings, UX audit package P4:
//   F08  a local comment is signed with the one local identity: the Mine filter counts it, the pin wears the
//        initial the list's avatar wears (never "?"), the row says "You".
//   F19  a comment left on an element pins ON that element (not above the artboard) and its card hangs under it.
//   F14  clicking a pin opens its thread in place, lights its row in the list and keeps Preview.
//   F16  the Comment tool wears the speech bubble the Comments panel wears.
//   F33  a comment needs no pointer: select an element, C, ↵ opens the composer on it.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeProject, openCanvas, sleep, startServer } from './harness.mjs';

// A Mac with no git user.name: the studio signs with the account name (localAuthor), and the viewer's own
// identity (`/_api/git-user`) must be that same name. (Set before the server spawns; the browser is unaffected.)
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const BOARD = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Board() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="E2E">
        <DCArtboard id="a" label="A" width={480} height={320}>
          <div style={{ padding: 32 }}>
            <h1 style={{ margin: 0 }}>Maude desktop E2E</h1>
            <p>Deterministic, static canvas.</p>
            <div style={{ marginTop: 16, width: 120, height: 60, background: '#eee' }}>card</div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

let server;
let c;
const H1 = '[data-dc-screen="a"] h1';

before(async () => {
  const root = makeProject();
  writeFileSync(join(root, '.design', 'ui', 'Board.tsx'), BOARD);
  server = await startServer(root);
  c = await openCanvas(server);
});
after(async () => {
  await c?.close();
  server?.stop();
});

const shellMode = () =>
  c.page.evaluate(
    () =>
      document
        .querySelector('[data-testid^="palette-mode-"][aria-pressed="true"]')
        ?.getAttribute('data-testid') ?? null
  );
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
const pins = () =>
  c.frame.evaluate(() =>
    [...document.querySelectorAll('.cm-pin')].map((p) => {
      const r = p.getBoundingClientRect();
      return {
        id: p.getAttribute('data-comment-pin'),
        text: (p.firstChild?.textContent ?? '').trim(),
        label: p.getAttribute('aria-label'),
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        focused: p.getAttribute('data-focused') === 'true',
      };
    })
  );
const listRows = () =>
  c.page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="comment-item-"]')].map((r) => ({
      id: r.getAttribute('data-testid').replace('comment-item-', ''),
      avatar: r.querySelector('.k-av')?.textContent?.trim() ?? null,
      active: r.classList.contains('is-active'),
      text: r.textContent,
    }))
  );
const counts = () =>
  c.page.evaluate(() => ({
    mine: document
      .querySelector('[data-testid="comment-filter-mine"]')
      ?.textContent?.replace(/\D+/g, ''),
    all: document
      .querySelector('[data-testid="comment-filter-all"]')
      ?.textContent?.replace(/\D+/g, ''),
  }));
async function postWithPointer(text, at) {
  await c.page.keyboard.press('c');
  await sleep(300);
  await c.page.mouse.click(at.x, at.y);
  await sleep(400);
  await c.page.keyboard.type(text);
  await c.frame.locator('[data-testid="comment-composer-send"]').click();
  assert.ok(await waitForComment(text), `"${text}" reached disk`);
  await sleep(500);
}

describe('F08 — one local identity', () => {
  test('two comments: signed by the viewer, counted as Mine, one letter on pin and list, "You" on the row', async () => {
    const h1 = await c.frame.locator(H1).first().boundingBox();
    await postWithPointer('Make this bigger', { x: h1.x + 40, y: h1.y + h1.height / 2 });
    const ab = await c.frame.locator('[data-dc-screen="a"]').first().boundingBox();
    await postWithPointer('Empty area note', { x: ab.x - 160, y: ab.y - 120 });

    const me = (await (await fetch(`http://localhost:${server.port}/_api/git-user`)).json()).name;
    assert.ok(me, 'the studio names the viewer even with no git user.name');
    const saved = comments();
    assert.equal(saved.length, 2);
    for (const s of saved) assert.equal(s.author, me, 'signed with the viewer’s identity');

    assert.deepEqual(await counts(), { mine: '2', all: '2' }, 'Mine counts what I just wrote');

    const ps = await pins();
    const rows = await listRows();
    assert.equal(ps.length, 2);
    for (const p of ps) {
      assert.notEqual(p.text, '?', 'a pin never wears a "?"');
      const row = rows.find((r) => r.id === p.id);
      assert.equal(p.text, row.avatar, 'the pin wears the letter the list avatar wears');
      assert.ok(row.text.includes('You'), 'the row names the author "You"');
      assert.ok(p.label.includes('by You'), `the pin says who: ${p.label}`);
    }
  });
});

describe('F19 — a comment left on an element pins ON it', () => {
  test('the pin sits at the heading’s corner, not above the artboard', async () => {
    const h1 = await c.frame.locator(H1).first().boundingBox();
    const ab = await c.frame.locator('[data-dc-screen="a"]').first().boundingBox();
    const onEl = (await pins()).find((p) => comments().find((x) => x.id === p.id)?.selector);
    assert.ok(onEl, 'the element comment has a pin');
    // centred on the element's top-right corner (the board's convention), within a pin's radius
    assert.ok(
      Math.abs(onEl.cx - (h1.x + h1.width)) <= 16,
      `pin x ${onEl.cx} vs heading right ${h1.x + h1.width}`
    );
    assert.ok(Math.abs(onEl.cy - h1.y) <= 16, `pin y ${onEl.cy} vs heading top ${h1.y}`);
    assert.ok(onEl.cy >= ab.y - 14, 'not floating above the artboard');
  });
});

describe('F14 — a pin opens its thread in place', () => {
  test('click: the thread card opens on the canvas, the row lights, the mode stays', async () => {
    const [first] = await pins();
    await c.page.mouse.click(first.cx, first.cy);
    await sleep(700);
    assert.equal(await shellMode(), 'palette-mode-preview', 'still in Preview');
    assert.ok(await c.frame.locator('.cm-thread').first().isVisible(), 'the thread card is open');
    const active = (await listRows()).filter((r) => r.active).map((r) => r.id);
    assert.deepEqual(active, [first.id], 'the list highlights the pin’s thread');
    await c.page.keyboard.press('Escape');
    await sleep(300);
  });

  test('a thread with a reply says so on its pin', async () => {
    const target = comments()[0];
    const r = await fetch(`http://localhost:${server.port}/_api/comments/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${server.port}` },
      body: JSON.stringify({ op: 'reply', id: target.id, body: 'On it.' }),
    });
    assert.equal(r.status, 200);
    await sleep(1200);
    const count = await c.frame
      .locator(`[data-testid="comment-pin-count-${target.id}"]`)
      .textContent({ timeout: 5000 });
    assert.equal(count.trim(), '2');
  });
});

describe('F16 — one comment icon', () => {
  test('Preview’s Comment slot draws the speech bubble the Comments panel wears', async () => {
    const slotPath = await c.frame.evaluate(
      () =>
        document
          .querySelector('[data-testid="toolbar-slot-comment"] svg path')
          ?.getAttribute('d') ?? null
    );
    assert.ok(slotPath, 'the Comment slot has a glyph');
    assert.ok(slotPath.includes('H8l-3 2.5'), 'a bubble with a tail, not a rounded square');
    const cluster = await c.page.evaluate(
      () =>
        document
          .querySelector('[data-testid="share-cluster-comments"] svg path')
          ?.getAttribute('d') ?? null
    );
    assert.equal(slotPath, cluster, 'the same drawing as the Comments button');
  });
});

describe('F33 — a comment needs no pointer', () => {
  test('select an element, C, ↵: the composer opens on it; type, ⌘↵: it is saved on that element', async () => {
    await c.setMode('edit');
    const card = await c.frame
      .locator('[data-dc-screen="a"] .dc-artboard-body div[style*="background"]')
      .first();
    const b = await card.boundingBox();
    await c.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); // the one pointer use: select it
    await sleep(400);
    await c.page.keyboard.press('c');
    await sleep(500);
    assert.equal(await shellMode(), 'palette-mode-preview', 'C arms the Comment tool (in Preview)');
    await c.page.keyboard.press('Enter');
    await sleep(500);
    assert.ok(
      await c.frame.locator('[data-testid="comment-composer-send"]').isVisible(),
      'the composer opened'
    );
    await c.page.keyboard.type('from the keyboard');
    await c.page.keyboard.press('Meta+Enter');
    const saved = await waitForComment('from the keyboard');
    assert.ok(saved, 'the comment reached disk');
    // Edit's first click selects the artboard's top-level object (the padding div), not the card inside it
    assert.match(
      saved.selector,
      /data-cd-id="[0-9a-f]+"/,
      `anchored to an element: ${saved.selector}`
    );
    assert.equal(saved.artboard, 'a');
  });

  test('↵ with nothing selected opens a floating note at the middle of the view (no dead key)', async () => {
    await c.page.keyboard.press('Escape');
    await sleep(200);
    await c.setMode('preview');
    await c.page.keyboard.press('Escape');
    await c.page.keyboard.press('c');
    await sleep(400);
    await c.page.keyboard.press('Enter');
    await sleep(500);
    assert.ok(
      await c.frame.locator('[data-testid="comment-composer-send"]').isVisible(),
      'the composer opened'
    );
    await c.page.keyboard.type('floating from the keyboard');
    await c.page.keyboard.press('Meta+Enter');
    const saved = await waitForComment('floating from the keyboard');
    assert.ok(saved, 'the comment reached disk');
    assert.ok(!saved.selector, 'no element anchor');
    assert.ok(Number.isFinite(saved.world?.x) && Number.isFinite(saved.world?.y), 'a world point');
  });
});

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
//   F6 (S4.11) an Arrow dropped on a button binds to THAT button — the ring names it, an unnamed
//      element is stamped first (`element.stamp`) and the bind stores the id it got; a new arrow
//      is Curved with a filled head; over an artboard's edge the whole artboard lights up
//   F7 (S4.11) double-click an arrow writes a label that is stored on the arrow
//   F8 (S4.11) the bound element is rewritten (same id, new words): the arrow stays bound and the
//      ring says "rewritten by AI"; the element removed: the dangling card appears, Point to…
//      re-aims, restoring the element re-attaches
//   F9 (S4.11) the elbow arrow keeps its route around Mobile at rest (a routed path, not one corner)
//
// Written for S4.10 and S4.11; the lead runs it at the wave gate (it needs Chromium + a free port).

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
        <button data-cd-id="see-the-work" style={{ position: "absolute", left: 40, top: 120 }}>See the work</button>
        <a className="pricing" style={{ position: "absolute", left: 300, top: 120 }}>Pricing</a>
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
  // moving an artboard is Edit's gesture (the layer is quiet there and rides along)
  before(() => c.setMode('edit'));
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
  // selecting an annotation is Preview's gesture (S4.9)
  before(() => c.setMode('preview'));
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

// ── S4.11 — arrows that bind to the thing you mean ───────────────────────────────────────────────
const canvasPath = () => join(root, '.design', 'ui', 'Board.tsx');
const centerOfPage = async (sel) => {
  const b = await c.frame.locator(sel).first().boundingBox();
  assert.ok(b, `${sel} on screen`);
  return [b.x + b.width / 2, b.y + b.height / 2];
};

/**
 * A page point ON an arrow's stroke (its midpoint by length). A new arrow is Curved (S4.11), so the centre of its
 * path's box is not on the line: a click or double-click there lands on empty canvas.
 */
async function strokeMid(sel) {
  const p = await c.frame.evaluate((q) => {
    const path = document.querySelector(q);
    if (!path) return null;
    const m = path.getScreenCTM();
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  }, sel);
  assert.ok(p, `${sel} on screen`);
  return c.toPage(p.x, p.y);
}

async function drawArrow(from, to, mid) {
  await reset();
  await c.page.keyboard.press('a'); // Arrow
  await c.page.mouse.move(from[0], from[1]);
  await c.page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await c.page.mouse.move(
      from[0] + ((to[0] - from[0]) * i) / 12,
      from[1] + ((to[1] - from[1]) * i) / 12
    );
    await sleep(16);
  }
  if (mid) await mid();
  await c.page.mouse.up();
}

describe('F6 — an arrow binds to the button, not the artboard', () => {
  test('a new arrow dropped on a named button: ring + tag, Curved, filled head, bound by id', async () => {
    const before = new Set(disk().keys());
    const target = await centerOfPage('[data-cd-id="see-the-work"]');
    const start = await c.center('note');
    await drawArrow(start, target, async () => {
      assert.equal(await c.frame.locator('[data-testid="annot-arrow-aim-ring"]').count(), 1);
      assert.match(
        (await c.frame.locator('[data-testid="annot-arrow-aim-tag"]').textContent()) ?? '',
        /Button · See the work/
      );
    });
    const board = await waitForBoard(server.root, (m) =>
      [...m.keys()].some((k) => !before.has(k) && m.get(k).type === 'arrow')
    );
    const a = [...board.values()].find((e) => !before.has(e.id) && e.type === 'arrow');
    assert.equal(a.endHost.ref, 'el:desktop/see-the-work');
    assert.equal(a.endHost.label, 'See the work');
    assert.equal(a.line, 'curved', 'a new arrow is Curved');
    assert.ok(!a.endHead || a.endHead === 'triangle', 'with a filled head');
  });

  test('an unnamed element is stamped first and the bind stores the id it was given', async () => {
    const before = new Set(disk().keys());
    const target = await centerOfPage('.pricing');
    const start = await c.center('note');
    await drawArrow(start, target);
    // the arrow lands first; the stamp (a write to the TSX) and the bind that stores its id follow
    const board = await waitForBoard(server.root, (m) =>
      [...m.keys()].some((k) => !before.has(k) && m.get(k).type === 'arrow' && m.get(k).endHost?.ref)
    );
    const a = [...board.values()].find((e) => !before.has(e.id) && e.type === 'arrow');
    assert.match(a.endHost.ref, /^el:desktop\/[a-z][a-z0-9-]*$/);
    assert.doesNotMatch(a.endHost.ref, /\/[0-9a-f]{8}$/, 'never a computed id');
    const id = a.endHost.ref.split('/')[1];
    assert.ok(
      readFileSync(canvasPath(), 'utf8').includes(`data-cd-id="${id}"`),
      'the id is in the TSX'
    );
  });

  test('over an artboard edge the whole artboard lights up', async () => {
    await reset();
    await c.page.keyboard.press('a');
    const b = await label().boundingBox();
    await c.page.mouse.move(b.x - 2, b.y + 200);
    await sleep(200);
    assert.equal(await c.frame.locator('[data-testid="annot-arrow-edge"]').count(), 1);
    await reset();
  });
});

describe('F7 — double-click an arrow writes on it', () => {
  test('the label is stored on the arrow', async () => {
    await reset();
    const arrow = [...disk().values()].find((e) => e.type === 'arrow' && e.id !== 'arw');
    assert.ok(arrow, 'an arrow from F6');
    const [x, y] = await strokeMid(`.dc-annot-scene [data-id="${arrow.id}"] path`);
    await c.page.mouse.dblclick(x, y);
    const input = c.frame.locator('[data-testid="annot-arrow-label-input"]');
    assert.equal(await input.count(), 1);
    await input.fill('then here');
    await c.page.keyboard.press('Enter');
    const board = await waitForBoard(server.root, (m) => m.get(arrow.id)?.label === 'then here');
    assert.equal(board.get(arrow.id).label, 'then here');
  });
});

describe('F8 — rewritten stays bound; gone is dangling; restore re-attaches', () => {
  const original = () => readFileSync(canvasPath(), 'utf8');
  let saved;
  test('AI rewrites the button: still bound', async () => {
    saved = original();
    writeFileSync(canvasPath(), saved.replace('>See the work<', '>See our work<'));
    await sleep(2500);
    await reset();
    const arrow = [...disk().values()].find((e) => e.endHost?.ref === 'el:desktop/see-the-work');
    const [x, y] = await strokeMid(`.dc-annot-scene [data-id="${arrow.id}"] path`);
    await c.click(x, y);
    await sleep(400);
    assert.match(
      (await c.frame.locator('[data-testid="annot-arrow-rewritten"]').textContent()) ?? '',
      /See our work · rewritten by AI/
    );
    assert.equal(await c.frame.locator('[data-testid="annot-dangling-mark"]').count(), 0);
  });

  test('the button is removed: the open circle + the card with Point to…', async () => {
    writeFileSync(canvasPath(), saved.replace(/<button[^>]*>See the work<\/button>/, ''));
    await sleep(2500);
    const arrow = [...disk().values()].find((e) => e.endHost?.ref === 'el:desktop/see-the-work');
    assert.ok(arrow, 'the bind is still on the board');
    const [x, y] = await strokeMid(`.dc-annot-scene [data-id="${arrow.id}"] path`);
    await c.click(x, y);
    await sleep(400);
    assert.ok((await c.frame.locator('[data-testid="annot-dangling-mark"]').count()) >= 1);
    assert.match(
      (await c.frame.locator('[data-testid="annot-dangling-card"]').textContent()) ?? '',
      /Pointed at “See the work”/
    );
    assert.equal(await c.frame.locator('[data-testid="annot-point-to"]').count(), 1);
  });

  test('restoring the button re-attaches the arrow — nothing was stripped', async () => {
    writeFileSync(canvasPath(), saved);
    await sleep(2500);
    assert.equal(await c.frame.locator('[data-testid="annot-dangling-mark"]').count(), 0);
    const arrow = [...disk().values()].find((e) => e.endHost?.ref === 'el:desktop/see-the-work');
    assert.ok(arrow, 'the bind survived the round trip');
  });
});

describe('F9 — the elbow keeps its route at rest', () => {
  test('arw (an elbow bound to Desktop) is a routed path with more than one corner', async () => {
    await reset();
    const waypoints = await c.frame.evaluate(
      () =>
        document.querySelector('.dc-annot-scene [data-id="arw"] g')?.getAttribute('data-route') ??
        '0'
    );
    assert.ok(Number(waypoints) >= 2, 'ArrowView draws the route held on ends.route');
  });
});

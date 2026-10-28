// P8 test round, G2 — people on one canvas (10 · co-presence, co-follow, co-bring, co-spotlight, co-twelve) —
// browser E2E (node --test). A real studio server, the real shell and canvas in headless Chromium; every person
// is their own browser context, so each one is a separate peer in the canvas's collab room, the way two people's
// windows on one studio are. Who each one is comes from `/_api/git-user` (the canvas's identity source,
// use-collab.tsx), answered per context.
//
//   node --test apps/studio/test/e2e/presence-together.e2e.mjs
//
//   P1 co-presence   Tereza, Jonas and Petra are here: a face each in the Share cluster, in their own tone (never
//                    coral), a cursor each on the canvas; Tereza's face opens "On A4 · plakát · Can edit" · Follow Tereza ·
//                    Go to A4 · plakát · Bring everyone here
//   P2 co-follow     Follow Tereza: a frame in her tone and "Following Tereza esc"; her camera moves and mine moves
//                    with it; esc stops following
//   P3 co-bring      Bring everyone here: the glide draws on my screen; on each of theirs "Following <me>"
//   P4 co-spotlight  "Everyone here is following you · 3 people" + Stop; one leaves with esc (2 people); Stop ends
//                    it for all
//   P5 co-twelve     twelve on one canvas: three faces and +8; the list "12 on Combine-kampan · you + 11", a row per
//                    person with where they are, the idle ones last and greyed ("idle · N min"), the idle cursors
//                    shrunk to an initial
//
// Shots: $E2E_SHOTS_DIR (default .ai/device/scenario-runs/p8-multiplayer/<stamp>/), one per state.
// The role word ("· Can edit", P8 G2 lead decision (b)): the collab room stamps each person's role from their own
// socket's access (collab/room.ts `stampRole`); a client-sent role is overwritten (test/collab-awareness-role.test.ts).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { sleep, startServer } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = 'ui/Combine-kampan.tsx';
const SHOTS =
  process.env.E2E_SHOTS_DIR ??
  resolve(
    HERE,
    '../../../../.ai/device/scenario-runs/p8-multiplayer',
    new Date().toISOString().replaceAll(':', '-')
  );

const CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function CombineKampan() {
  return (
    <DesignCanvas>
      <DCSection id="kampan" title="Combine 2026">
        <DCArtboard id="post" label="Post 1:1" width={540} height={540}><h1 style={{ padding: 24 }}>COMBINE 2026</h1></DCArtboard>
        <DCArtboard id="poster" label="A4 · plakát" width={420} height={594}><h1 style={{ padding: 24 }}>Plakát</h1></DCArtboard>
        <DCArtboard id="story" label="Story 9:16" width={338} height={600}><h1 style={{ padding: 24 }}>Story</h1></DCArtboard>
        <DCArtboard id="web" label="Web · STAŇ SE GATOREM" width={720} height={450}><h1 style={{ padding: 24 }}>STAŇ SE GATOREM</h1></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const META = {
  layout: {
    artboards: [
      { id: 'post', x: 0, y: 0 },
      { id: 'poster', x: 700, y: 0 },
      { id: 'story', x: 1300, y: 0 },
      { id: 'web', x: 0, y: 800 },
    ],
  },
};

function makeKampan() {
  const root = mkdtempSync(join(tmpdir(), 'maude-presence-e2e-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), JSON.stringify({ name: 'presence-e2e' }));
  writeFileSync(join(root, '.design', FILE), CANVAS);
  writeFileSync(join(root, '.design', 'ui', 'Combine-kampan.meta.json'), JSON.stringify(META));
  return root;
}

const VIEW = { width: 1600, height: 1000 };
/** Every person here opens the studio in a browser (`surf=browser`); the Mac app drops this suffix. */
const IN_BROWSER = ' · in a browser';

/**
 * One person: their own browser context, so their own collab peer. `clockAt` (ms) starts the context's clock
 * there — an idle person is seeded in the past and fast-forwarded past the 3-minute idle line.
 */
async function openPerson(browser, server, name, { clockAt = null } = {}) {
  // The canvas asks `/_api/git-user?fc=…` (a glob would miss the query); no service worker answers past it.
  const ctx = await browser.newContext({ viewport: VIEW, serviceWorkers: 'block' });
  await ctx.route(/\/_api\/git-user(\?|$)/, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name, email: null }) })
  );
  if (clockAt !== null) await ctx.clock.install({ time: clockAt });
  const page = await ctx.newPage();
  // Every collab socket this person opens (the canvas's room): how many, how many closed, frames heard.
  const ws = { opened: 0, closed: 0, rx: 0, urls: [] };
  page.on('websocket', (s) => {
    if (!s.url().includes('/_ws/collab/')) return;
    ws.opened++;
    ws.urls.push(s.url().replace(/^ws:\/\/[^/]+/, ''));
    s.on('framereceived', () => ws.rx++);
    s.on('close', () => ws.closed++);
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  await page.goto(`http://localhost:${server.port}/?open=${FILE}`, {
    waitUntil: 'domcontentloaded',
  });
  const frame = await mountedFrame(page);
  return { name, ctx, page, frame, first: name.split(' ')[0], ws };
}

async function mountedFrame(page) {
  for (let i = 0; i < 300; i++) {
    const frame = page.frames().find((f) => f.url().includes('_canvas-shell'));
    if (frame) {
      const ok = await frame
        .evaluate(() => !!document.querySelector('[data-dc-screen="poster"]'))
        .catch(() => false);
      if (ok) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('the canvas never mounted');
}

/** The live canvas frame (it can re-navigate while the module builds). */
const frameOf = (w) => w.page.frames().find((f) => f.url().includes('_canvas-shell')) ?? w.frame;

async function frameBox(w) {
  const b = await w.page.locator('[data-testid="canvas-frame"]').boundingBox();
  assert.ok(b, 'no canvas frame on screen');
  return b;
}

/** An artboard's on-screen box inside the frame (frame coordinates). */
async function boardRect(w, id) {
  return frameOf(w).evaluate((id) => {
    const r = document.querySelector(`[data-dc-screen="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  }, id);
}

/** Pan (wheel) until artboard `id` sits at the frame's centre — the canvas then says I am on it. */
async function centreOn(w, id) {
  const fb = await frameBox(w);
  await w.page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  for (let i = 0; i < 8; i++) {
    const r = await boardRect(w, id);
    assert.ok(r, `${id} is not on ${w.first}'s canvas`);
    const dx = r.x + r.w / 2 - fb.width / 2;
    const dy = r.y + r.h / 2 - fb.height / 2;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    await w.page.mouse.wheel(dx, dy);
    await sleep(250);
  }
}

/** A cursor over the frame: the canvas publishes it to the room. */
async function hover(w, fx, fy) {
  const fb = await frameBox(w);
  await w.page.mouse.move(fb.x + fx, fb.y + fy, { steps: 4 });
}

async function waitFor(fn, what, ms = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}

/** The peers' faces in a person's Share cluster: [{ id, label, tone }] in order. */
async function faces(w) {
  return w.page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="share-cluster-face-"]')].map((el) => ({
      id: el.getAttribute('data-testid'),
      label: el.getAttribute('aria-label'),
      tone: el.style.getPropertyValue('--face-tone'),
      text: el.textContent,
    }))
  );
}

/** Cursor labels another person's canvas draws. */
async function cursors(w) {
  return frameOf(w).evaluate(() =>
    [...document.querySelectorAll('.dc-cursor')].map((el) => ({
      label: el.querySelector('.dc-cursor-label')?.textContent?.trim() ?? '',
      idle: el.getAttribute('data-idle') === 'true',
    }))
  );
}

async function overlay(w) {
  return frameOf(w).evaluate(() => {
    const t = (id) => document.querySelector(`[data-testid="${id}"]`);
    // "<face> Following Tereza [esc]" → "Following Tereza · [esc]": the words, then the key or button
    const words = (el) => {
      if (!el) return null;
      const face = el.querySelector('.dc-presence-face')?.textContent ?? '';
      const tail = [...el.querySelectorAll('kbd, button')].map((k) => `[${k.textContent}]`);
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      return [face, own, ...tail].join(' | ');
    };
    return {
      follow: words(t('presence-follow-pill')),
      spotlight: words(t('presence-spotlight-pill')),
      frameKind: t('presence-frame')?.getAttribute('data-kind') ?? null,
      frameTone: t('presence-frame')?.style.getPropertyValue('--presence-ring') ?? null,
      glide: !!t('presence-bring-glide'),
    };
  });
}

async function esc(w) {
  await frameOf(w).evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  );
}

async function shot(w, name) {
  mkdirSync(SHOTS, { recursive: true });
  await w.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function faceOf(w, first) {
  return waitFor(async () => {
    const f = (await faces(w)).find((x) => x.label?.startsWith(first));
    return f ?? null;
  }, `${w.first} sees ${first}'s face`);
}

describe('presence — people on one canvas (10 · co-presence … co-twelve)', () => {
  let server;
  let browser;
  let you;
  let tereza;
  let jonas;
  let petra;
  before(async () => {
    server = await startServer(makeKampan());
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
    you = await openPerson(browser, server, 'Michal Dovrtěl');
    tereza = await openPerson(browser, server, 'Tereza Nováková');
    jonas = await openPerson(browser, server, 'Jonas Berg');
    petra = await openPerson(browser, server, 'Petra Malá');
  });
  after(async () => {
    console.log(`presence shots: ${SHOTS}`);
    await browser?.close().catch(() => {});
    server?.stop();
  });

  test('P1 co-presence — a face, a cursor, a colour each; the face menu says where and offers Follow · Go to · Bring', async () => {
    await centreOn(tereza, 'poster');
    await centreOn(jonas, 'web');
    await centreOn(petra, 'story');
    await hover(tereza, 820, 520);
    await hover(jonas, 360, 300);
    await hover(petra, 520, 640);

    for (const first of ['Tereza', 'Jonas', 'Petra']) await faceOf(you, first);
    const fs = await faces(you);
    assert.equal(fs.length, 3, `three faces, got ${JSON.stringify(fs)}`);
    for (const f of fs) {
      assert.match(f.tone, /^var\(--object-(sky|green|yellow|lilac|grey)\)$/, `${f.label}: ${f.tone}`);
      assert.doesNotMatch(f.tone, /coral/);
    }
    // the face carries where the person is (the aria label is the list line)
    // (this lane is the browser surface, so each line also says "· in a browser")
    await waitFor(async () => (await faceOf(you, 'Tereza')).label.includes('plakát'), 'Tereza on A4');
    const t = await faceOf(you, 'Tereza');
    assert.equal(t.label, `Tereza Nováková — A4 · plakát${IN_BROWSER}`);
    assert.equal((await faceOf(you, 'Jonas')).label, `Jonas Berg — Web · STAŇ SE GATOREM${IN_BROWSER}`);
    assert.equal((await faceOf(you, 'Petra')).label, `Petra Malá — Story 9:16${IN_BROWSER}`);
    // a tone is the person's, not the window's: Jonas's screen paints Tereza the same
    assert.equal((await faceOf(jonas, 'Tereza')).tone, t.tone);

    // a cursor each on my canvas, labelled with the name
    const cs = await waitFor(async () => {
      const c = await cursors(you);
      return ['Tereza', 'Jonas', 'Petra'].every((n) => c.some((x) => x.label.startsWith(n)))
        ? c
        : null;
    }, 'three cursors on my canvas');
    assert.ok(cs.every((c) => !c.idle));

    // Tereza's face → the face menu
    await you.page.locator(`[data-testid="${t.id}"]`).click();
    const menu = you.page.locator('[data-testid="presence-face-menu"]');
    await menu.waitFor({ timeout: 5_000 });
    assert.equal(
      await menu.locator('[data-testid="presence-face-menu-where"]').textContent(),
      'On A4 · plakát · Can edit'
    );
    const rows = await menu.locator('[role="menuitem"]').allTextContents();
    assert.deepEqual(
      rows.map((r) => r.trim()),
      ['Follow Tereza', 'Go to A4 · plakát', 'Bring everyone here']
    );
    await shot(you, '10-co-presence');
    await you.page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached', timeout: 5_000 });
  });

  test('P1b Go to A4 · plakát frames the artboard Tereza is on', async () => {
    const t = await faceOf(you, 'Tereza');
    // the canvas now says I am on A4 · plakát — Tereza's face for me reads so
    await centreOn(you, 'web');
    await waitFor(async () => (await faceOf(tereza, 'Michal')).label.includes('Web'), 'me on Web');
    await you.page.locator(`[data-testid="${t.id}"]`).click();
    await you.page.locator('[data-testid="presence-face-menu-go-to"]').click();
    await waitFor(
      async () => (await faceOf(tereza, 'Michal')).label.includes('A4 · plakát'),
      'Go to put me on A4 · plakát'
    );
  });

  test('P2 co-follow — my view moves with hers; a frame and one pill in her colour; esc stops it', async () => {
    const t = await faceOf(you, 'Tereza');
    await you.page.locator(`[data-testid="${t.id}"]`).click();
    await you.page.locator('[data-testid="presence-face-menu-follow"]').click();
    const o = await waitFor(async () => {
      const v = await overlay(you);
      return v.follow ? v : null;
    }, 'the follow pill');
    assert.equal(o.follow, 'T | Following Tereza | [esc]');
    assert.equal(o.frameKind, 'follow');
    // the frame and pill wear HER colour (the canvas-side literal of her tone)
    const tone = t.tone.replace(/^var\(--object-(\w+)\)$/, '$1');
    const lit = {
      sky: 'oklch(0.78 0.10 230)',
      green: 'oklch(0.74 0.13 152)',
      yellow: 'oklch(0.82 0.14 95)',
      lilac: 'oklch(0.76 0.10 290)',
      grey: 'oklch(0.70 0.01 250)',
    }[tone];
    assert.equal(o.frameTone.replace(/\s+/g, ' '), lit);
    // the face says I follow her
    assert.match(
      (await you.page.locator(`[data-testid="${t.id}"]`).getAttribute('class')) ?? '',
      /is-following/
    );

    // she pans to Story 9:16 — my camera follows
    await centreOn(tereza, 'story');
    await waitFor(async () => {
      const mine = await boardRect(you, 'story');
      const hers = await boardRect(tereza, 'story');
      return mine && hers && Math.abs(mine.x - hers.x) < 4 && Math.abs(mine.y - hers.y) < 4;
    }, 'my camera matches Tereza’s');
    await shot(you, '10-co-follow');

    await esc(you);
    await waitFor(async () => !(await overlay(you)).follow, 'esc ends following');
    assert.equal((await overlay(you)).frameKind, null);
  });

  test('P3 co-bring — Bring everyone here: the glide on my screen, "Following Michal" on theirs', async () => {
    await hover(you, 800, 500);
    const t = await faceOf(you, 'Tereza');
    await you.page.locator(`[data-testid="${t.id}"]`).click();
    await you.page.locator('[data-testid="presence-face-menu-bring"]').click();
    // the moment: the glide is drawn on my screen (it leaves the DOM once they land)
    await waitFor(async () => (await overlay(you)).glide, 'the glide');
    await shot(you, '10-co-bring');
    for (const w of [tereza, jonas, petra]) {
      const o = await waitFor(async () => {
        const v = await overlay(w);
        return v.follow ? v : null;
      }, `${w.first} follows me`);
      assert.equal(o.follow, 'M | Following Michal | [esc]');
    }
    await shot(tereza, '10-co-bring-theirs');
    // landed: the wake and glide are gone
    await waitFor(async () => !(await overlay(you)).glide, 'the glide lands');
  });

  test('P4 co-spotlight — "Everyone here is following you · 3 people" + Stop; esc leaves; Stop ends it for all', async () => {
    let o = await waitFor(async () => {
      const v = await overlay(you);
      return v.spotlight?.includes('3 people') ? v : null;
    }, 'the spotlight pill counts 3');
    assert.equal(o.spotlight, 'Y | Everyone here is following you · 3 people | [Stop]');
    assert.equal(o.frameKind, 'spotlight');
    assert.equal(o.frameTone.replace(/\s+/g, ' '), 'oklch(0.82 0.14 95)'); // You is yellow (C32)
    // their cameras moved to mine
    const mine = await boardRect(you, 'poster');
    for (const w of [tereza, jonas, petra]) {
      await waitFor(async () => {
        const r = await boardRect(w, 'poster');
        return r && Math.abs(r.x - mine.x) < 4 && Math.abs(r.y - mine.y) < 4;
      }, `${w.first}'s camera is mine`);
    }
    await shot(you, '10-co-spotlight');

    // Jonas leaves with esc: two people
    await esc(jonas);
    o = await waitFor(async () => {
      const v = await overlay(you);
      return v.spotlight?.includes('2 people') ? v : null;
    }, 'the count drops to 2');
    assert.equal((await overlay(jonas)).follow, null);

    // Stop ends it for all
    await frameOf(you).locator('[data-testid="presence-spotlight-stop"]').click();
    await waitFor(async () => !(await overlay(you)).spotlight, 'Stop ends my spotlight');
    for (const w of [tereza, petra])
      await waitFor(async () => !(await overlay(w)).follow, `${w.first} stops following`);
  });

  test('P6 a person who sits still stays here (past the 30 s awareness timeout)', async () => {
    await sleep(45_000);
    const fs = await faces(you);
    assert.deepEqual(
      fs.map((f) => f.label?.split(' ')[0]).sort(),
      ['Jonas', 'Petra', 'Tereza'],
      `after 45 s of nobody moving: ${JSON.stringify(fs.map((f) => f.label))}`
    );
    assert.equal((await cursors(you)).length, 3);
  });
});

// P8 G2 finding, fixed: with twelve people each canvas heard only 3–4 of the other eleven. An idle person's clock
// jumped (fastForward — a laptop waking from sleep does the same), their awareness timed the others out, told the
// room so, and the room removed them for everybody (collab/room.ts `ownAwareness`, use-collab.tsx;
// test/collab-awareness-ownership.test.ts). The failure message names each person's cursors and collab socket.
describe('presence — twelve people on one canvas (10 · co-twelve)', () => {
  let server;
  const people = [];
  const ACTIVE = [
    ['Tereza Nováková', 'poster'],
    ['Jonas Berg', 'web'],
    ['Petra Malá', 'story'],
    ['Lukáš Dvořák', 'post'],
    ['Klára Veselá', 'post'],
    ['Ondřej Král', 'story'],
    ['Vojta Černý', 'web'],
    ['Filip Novák', 'poster'],
  ];
  // idle: their clock started this far in the past; they stop moving and the 3-minute line passes
  const IDLE = [
    ['Eliška Horáková', 4],
    ['Radek Svoboda', 12],
    ['Hana Pokorná', 25],
  ];
  // One browser per person: contexts of one browser share its connection pool, and past five or six people
  // their long-lived connections to the one studio queue behind each other (a person who never arrives).
  const browsers = [];
  const own = async () => {
    const b = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
    browsers.push(b);
    return b;
  };
  before(async () => {
    server = await startServer(makeKampan());
    people.push(await openPerson(await own(), server, 'Michal Dovrtěl'));
    for (const [name, board] of ACTIVE) {
      const w = await openPerson(await own(), server, name);
      await centreOn(w, board);
      await hover(w, 500 + people.length * 40, 300 + people.length * 30);
      people.push(w);
    }
    for (const [name, mins] of IDLE) {
      const w = await openPerson(await own(), server, name, {
        clockAt: Date.now() - (mins - 3.5) * 60_000,
      });
      await hover(w, 300 + people.length * 30, 600);
      people.push(w);
    }
  });
  after(async () => {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    server?.stop();
  });

  test('P5 three faces and +8; the list says where each person is; idle last, grey, an initial', async () => {
    const you = people[0];
    // the idle ones cross the 3-minute line (their clocks run ahead past it)
    for (const w of people.slice(1 + ACTIVE.length)) await w.ctx.clock.fastForward('04:00');
    const more = you.page.locator('[data-testid="share-cluster-faces-more"]');
    await waitFor(async () => (await more.textContent()) === '+8', '+8').catch(async (e) => {
      const seen = await you.page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="share-cluster-face"]')].map((el) =>
          `${el.textContent}:${el.getAttribute('aria-label') ?? ''}`
        )
      );
      // who each person's canvas hears (cursors) — a person who never arrived is missing here
      const hear = await Promise.all(
        people.map(
          async (w) =>
            `${w.first}:${(await cursors(w)).length}[ws ${w.ws.opened}/${w.ws.closed} rx${w.ws.rx}]`
        )
      );
      throw new Error(`${e.message}: faces ${JSON.stringify(seen)} · cursors ${hear.join(' ')}`);
    });
    assert.equal((await faces(you)).length, 3);
    // the three shown are people who are here, not idle ones
    for (const f of await faces(you)) assert.doesNotMatch(f.label ?? '', /idle/);

    await more.click();
    const list = you.page.locator('[data-testid="presence-people-list"]');
    await list.waitFor({ timeout: 5_000 });
    assert.deepEqual(
      (await list.locator('.sh-plist-h span').allTextContents()).map((s) => s.trim()),
      ['12 on Combine-kampan', 'you + 11']
    );
    const rows = await waitFor(async () => {
      const r = await you.page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="presence-people-row-"]')].map((el) => ({
          name: el.querySelector('.sh-plist-name')?.textContent,
          where: el.querySelector('em')?.textContent,
          idle: el.classList.contains('is-idle'),
        }))
      );
      return r.length === 11 && r.filter((x) => x.idle).length === 3 ? r : null;
    }, 'eleven rows, three idle');
    const where = Object.fromEntries(rows.map((r) => [r.name, r.where]));
    assert.equal(where['Tereza Nováková'], `A4 · plakát${IN_BROWSER}`);
    assert.equal(where['Jonas Berg'], `Web · STAŇ SE GATOREM${IN_BROWSER}`);
    assert.equal(where['Petra Malá'], `Story 9:16${IN_BROWSER}`);
    assert.equal(where['Lukáš Dvořák'], `Post 1:1${IN_BROWSER}`);
    // the idle ones are last, most recent first, with how long
    const tail = rows.slice(-3);
    assert.ok(tail.every((r) => r.idle));
    assert.deepEqual(
      tail.map((r) => r.name),
      ['Eliška Horáková', 'Radek Svoboda', 'Hana Pokorná']
    );
    for (const r of tail) assert.match(r.where, /^idle · \d+ min$/);
    assert.ok(Number(tail[2].where.match(/\d+/)[0]) >= 20, tail[2].where);
    assert.equal(
      await list.locator('[data-testid="presence-people-bring"]').textContent(),
      'Bring everyone here'
    );
    await shot(you, '10-co-twelve');

    // idle cursors are grey and shrink to an initial
    const cs = await waitFor(async () => {
      const c = await cursors(you);
      return c.filter((x) => x.idle).length === 3 ? c : null;
    }, 'three idle cursors');
    assert.deepEqual(cs.filter((c) => c.idle).map((c) => c.label).sort(), ['E', 'H', 'R']);
  });
});

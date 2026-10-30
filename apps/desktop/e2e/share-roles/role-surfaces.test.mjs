// Phase 8 test round, G1a (share · invites · roles): what each person SEES, driven end to end on the share-roles
// rig (stand-up.mjs — the real hub, the real control plane, real studios, a cell door) in headless Chromium.
// Every step asserts the words / controls the board draws (CONTRACT §6–§7 win where they disagree) and leaves a
// screenshot under the run's evidence dir (`<out>/g1a-<row>-*.png`).
//
//   02 ob-invite-page    the invitation page the control plane serves, in a signed-out browser
//   04 md-comment-only   Can comment: Viewing, Hand + Comment only, no AI chat panel, Ask to edit, a comment posts
//   05 es-viewer         …and the Comments panel's empty state names who sees it
//   09 ex-edges          Can comment: the Export sheet's one line; Can view: no Export entry, ⇧⌘E opens nothing
//   11 pn-cant-open      now Can view (the words, the toolbar gone) · access removed (the card, Back to Home)
//   04 md-edge-viewer    a view-only link in a browser: the menu lists only what a viewer can do; Version history
//                        opens without Restore
//   06 ad-share          the owner's Share › Advanced: this link's rules, the other ways in, where it syncs
//   09 ex-share-vs       the owner's Export sheet points at Share once, with Copy link
//
//   node --test --test-force-exit apps/desktop/e2e/share-roles/role-surfaces.test.mjs   (Node 24, bun on PATH)
//   — always through scripts/v2-test-lane.sh. Heavy (a hub, a control plane, a cell, three studios).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { standUp } from './stand-up.mjs';

const STEP = 30_000;
const tid = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

let rig;
let ownerUrl;
let chromium;
let shots;
const pages = [];
/** Lukáš's window (Can edit), opened once: on Smoke beside the owner, then removed. */
let lukas = null;

before(
  async () => {
    rig = await standUp(process.env.MAUDE_E2E_OUT ? { out: process.env.MAUDE_E2E_OUT } : {});
    shots = join(rig.run.out, 'g1a');
    mkdirSync(shots, { recursive: true });
    ownerUrl = (await rig.startOwnerStudio()).url;
    const { chromium: pw } = await import('@playwright/test');
    chromium = await pw.launch({
      headless: true,
      ...(process.env.MAUDE_E2E_CHROMIUM ? { executablePath: process.env.MAUDE_E2E_CHROMIUM } : {}),
    });
  },
  { timeout: 240_000 }
);
after(async () => {
  for (const p of pages) await p.close().catch(() => {});
  await chromium?.close().catch(() => {});
  await rig?.stop();
});

const json = async (res) => res.json().catch(() => null);
const hub = (path, { token = rig.owner.token, method = 'GET', body } = {}) =>
  fetch(`${rig.hub.http}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-maude-access': '2',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const control = async (path, body = {}) => {
  const r = await fetch(new URL(path, rig.run.lifecycle), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const b = await json(r);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(b)}`);
  return b.url;
};
async function until(what, fn, ms = STEP) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  assert.fail(`${what}: not within ${ms} ms${last ? ` (${last})` : ''}`);
}

async function open(url, { context } = {}) {
  const page = context
    ? await context.newPage()
    : await chromium.newPage({ viewport: { width: 1440, height: 900 } });
  pages.push(page);
  await page.goto(url);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
/** Every data-testid on the page that is rendered (has a box), for evidence and presence checks. */
const shownIds = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]'))
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => n.getAttribute('data-testid'))
  );
async function evidence(page, name, e) {
  await shot(page, `${name}-red`).catch(() => {});
  const ids = await shownIds(page).catch(() => []);
  writeFileSync(join(shots, `${name}-red.log`), `${String(e?.stack ?? e)}\n\n${ids.join('\n')}\n`);
}
/** Run a step; on a red, keep the screenshot and every rendered testid beside it. */
async function step(page, name, fn) {
  try {
    return await fn();
  } catch (e) {
    await evidence(page, name, e);
    throw e;
  }
}

const rowId = (rel) =>
  `canvas-row-${rel
    .replace(/\.tsx$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()}`;
const frameOf = (page) => page.frameLocator(tid('canvas-frame'));
async function openCanvas(page, rel = rig.run.canvas) {
  await page.locator(tid(rowId(rel))).click({ timeout: 60_000 });
  await frameOf(page).locator(tid('smoke-h1')).waitFor({ timeout: 60_000 });
}
const text = async (loc) => flat(await loc.textContent({ timeout: STEP }));
async function accessWord(page, want) {
  const word = page.locator(tid('share-cluster-status'));
  await until(`the access word "${want}"`, async () => (await text(word)) === want);
}
/** The mode switch's segment for `mode`, pressed (a read-only person opens in Preview, md-edge-viewer). */
async function selectMode(page, mode) {
  const b = page.locator(tid(`palette-mode-${mode}`));
  await b.waitFor({ timeout: STEP });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await until(`mode ${mode}`, async () => (await b.getAttribute('aria-pressed')) === 'true');
}
/** Close whatever sheet is up (Export, Share) so the next click lands. */
async function dismiss(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.ex-scrim, [data-testid="share-dialog"]').count())) return;
    await page.keyboard.press('Escape');
    await sleep(250);
  }
}
/** The tool slots the canvas toolbar shows, in order (`toolbar-slot-<id>`), or null with no toolbar. */
async function toolbarSlots(page) {
  const frame = frameOf(page);
  if ((await frame.locator('[role="toolbar"]').count()) === 0) return null;
  return frame
    .locator('[role="toolbar"] [data-testid^="toolbar-slot-"]')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-testid').replace('toolbar-slot-', '')));
}
async function openMenu(page) {
  if (!(await page.locator(tid('project-menu')).isVisible())) {
    await page.locator(tid('project-pill')).click();
  }
  await page.locator(tid('project-menu')).waitFor({ timeout: STEP });
}
async function closeMenu(page) {
  if (await page.locator(tid('project-menu')).isVisible()) await page.keyboard.press('Escape');
}
/** The action ids the open project menu lists at its top level and in every open sub-menu. */
const menuRows = (page) =>
  page
    .locator('[data-testid^="project-menu-row-"]')
    .evaluateAll((ns) =>
      ns
        .map((n) => n.getAttribute('data-testid').replace('project-menu-row-', ''))
        .filter((id) => !id.startsWith('sub-'))
    );
/** Open every sub-menu once and collect every action row the menu offers. */
async function allMenuRows(page) {
  await openMenu(page);
  const seen = new Set(await menuRows(page));
  const subs = await page
    .locator('[data-testid^="project-menu-row-sub-"]')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-testid')));
  for (const sub of subs) {
    await openMenu(page);
    const row = page.locator(tid(sub));
    if (!(await row.isVisible().catch(() => false))) continue;
    await row.hover();
    await row.click().catch(() => {});
    await sleep(250);
    for (const id of await menuRows(page)) seen.add(id);
  }
  await closeMenu(page);
  return seen;
}

// ── 02 ob-invite-page ─────────────────────────────────────────────────────────────────────────
describe('02 ob-invite-page — the invitation, in a browser', () => {
  it('who invited you, to what, the comment — one download, Open in Maude, the steps, the browser path', async () => {
    // The owner invites a person who is not on the project yet, pointing at Smoke and a comment there
    // (the Share sheet's own call; `thread` is the comment the invite lands on, S6↔S9 §5.3).
    const sent = await hub('/api/access/invites', {
      method: 'POST',
      body: {
        email: 'vendula@share-roles.test',
        role: 'viewer',
        canvas: rig.run.canvas,
        thread: 'c-poster-1',
      },
    });
    assert.equal(sent.status, 201, JSON.stringify(await json(sent.clone())));
    const { id } = rig.controlPlane.sql
      .prepare(
        "SELECT id FROM project_invites WHERE lower(email) = 'vendula@share-roles.test' ORDER BY created_at DESC LIMIT 1"
      )
      .get();
    // A signed-out browser (its own context: no session cookie) opens the e-mailed link.
    const context = await chromium.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await open(`${rig.controlPlane.url}/invite/${id}`, { context });
    await step(page, 'ob-invite-page', async () => {
      assert.equal(await text(page.locator('h1')), 'Olga Owner invited you to Share Roles');
      // the canvas and that a comment waits there — the comment's text stays in the project (invites.mjs)
      const card = page.locator('.card', { hasText: 'Smoke' }).first();
      assert.equal(await text(card.locator('strong')), 'Smoke');
      assert.match(await text(card), /Olga Owner left a comment for you on this canvas\./);
      // one download, then Open in Maude for an installed app (maude:// carries the invite id only)
      const download = page.getByRole('link', { name: 'Download Maude for Mac' });
      assert.equal(await download.count(), 1);
      const openIn = page.getByRole('link', { name: 'Already installed? Open in Maude' });
      assert.equal(await openIn.getAttribute('href'), `maude://invite/${id}`);
      // the three steps, in order: download, sign in, you're on the canvas by the comment
      assert.deepEqual((await page.locator('ol.steps li').allTextContents()).map(flat), [
        'Download and open',
        'Sign in',
        'You’re on Smoke, by Olga Owner’s comment',
      ]);
      // the browser path, folded: "Just looking? See it in the browser — any computer."
      const just = page.locator('summary', { hasText: 'Just looking?' });
      assert.equal(await text(just), 'Just looking? See it in the browser — any computer.');
      // what the role means, in words (Can comment)
      assert.match(
        await text(page.locator('body')),
        /You’ll be able to look at the work and leave comments\./
      );
      assert.ok(!(await text(page.locator('body'))).includes('owner@share-roles.test'));
      await shot(page, 'ob-invite-page');
      await just.click();
      await page.getByRole('heading', { name: 'Join Share Roles' }).waitFor({ timeout: STEP });
      await shot(page, 'ob-invite-page-browser-path');
    });
    await context.close();
  });
});

// ── the owner: 06 ad-share · 09 ex-share-vs ───────────────────────────────────────────────────
describe('the owner — 06 ad-share · 09 ex-share-vs', () => {
  let owner;
  before(
    async () => {
      // Lukáš (Can edit) is on Smoke too: the Export sheet's line names who else is here
      lukas = await open(rig.run.lukas.url);
      await step(lukas, 'lukas-open', () => openCanvas(lukas));
      owner = await open(ownerUrl);
      await step(owner, 'owner-open', () => openCanvas(owner));
    },
    { timeout: 120_000 }
  );

  it('ex-share-vs: Export points at Share once — "<people> … A link shows them the latest" + Copy link', async () => {
    await step(owner, 'ex-share-vs', async () => {
      await openMenu(owner);
      await owner.locator(tid('project-menu-row-export.open')).first().click();
      await owner.locator(tid('export-sheet')).waitFor({ timeout: STEP });
      const hint = owner.locator(tid('export-share-hint'));
      await hint.waitFor({ timeout: STEP });
      assert.match(
        await text(hint),
        /^.+ (is|are) in this project\. A link shows them the latest, with comments\.Copy link$/
      );
      assert.equal(
        await text(hint),
        `${rig.run.lukas.name} is in this project. A link shows them the latest, with comments.Copy link`
      );
      await shot(owner, 'ex-share-vs-export-hint');
      await owner.locator(tid('export-cancel')).click();
      await dismiss(owner);
    });
  });

  it('ad-share: Share › Advanced — this link’s rules, the other ways in, where it syncs; Invite stays primary', async () => {
    await step(owner, 'ad-share', async () => {
      await dismiss(owner);
      await owner.locator(tid('share-cluster-share')).click();
      await owner.locator(tid('share-dialog')).waitFor({ timeout: STEP });
      // closed: scope, Invite primary, people, the link row with Copy link
      assert.equal(await text(owner.locator(tid('share-scope-canvas'))), 'This canvas');
      assert.equal(await text(owner.locator(tid('share-scope-project'))), 'Whole project');
      assert.equal(await text(owner.locator(tid('share-invite-submit'))), 'Invite');
      assert.match(
        (await owner.locator(tid('share-invite-submit')).getAttribute('class')) ?? '',
        /btn--primary/
      );
      await owner.locator(tid('share-link-row')).waitFor({ timeout: STEP });
      assert.equal(await text(owner.locator(tid('share-link-copy'))), 'Copy link');
      await shot(owner, 'ad-share-closed');
      // Advanced, open
      await owner.locator(tid('share-other-ways-toggle')).click();
      for (const id of [
        'share-link-who',
        'share-link-role',
        'share-link-expires',
        'share-join-as',
        'share-open-app',
        'share-syncs-hub',
        'share-syncs-last',
      ])
        await owner.locator(tid(id)).waitFor({ timeout: STEP });
      const adv = await text(owner.locator(tid('share-other-ways')));
      for (const words of [
        'This link',
        'Who can open',
        'Role',
        'Expires',
        'New people join as',
        'Other ways in',
        'App link',
        'This Mac only',
        'Where it syncs',
        'Hub',
        'Last synced',
        'Sync details live in Menu › Diagnostics › Sync.',
      ])
        assert.ok(adv.includes(words), `"${words}" not in Advanced: ${adv}`);
      const hubShown = owner.locator(tid('share-syncs-hub'));
      // the Hub row is a read-only, copyable field: its address is the field's value, not its text
      const hubWords = `${await text(hubShown)} ${await hubShown.inputValue().catch(() => '')} ${
        (await hubShown.getAttribute('value')) ?? ''
      }`;
      assert.ok(hubWords.includes(new URL(rig.hub.http).host), hubWords);
      // the defaults the board draws for a team project: Team only · Can view · New people join as Can edit
      assert.equal(await owner.locator(tid('share-link-who')).inputValue(), 'team');
      assert.equal(await owner.locator(tid('share-link-role')).inputValue(), 'observer');
      // Invite by GitHub username is the desktop app's row (share-model: native shell only) — not in a browser
      assert.equal(await owner.locator(tid('share-github')).count(), 0);
      await shot(owner, 'ad-share-advanced');
    });
  });
});

// ── Petra: Can comment on the whole project ───────────────────────────────────────────────────
describe('Can comment — 04 md-comment-only · 05 es-viewer · 09 ex-edges', () => {
  let petra;
  before(
    async () => {
      const sent = await hub('/api/access/invites', {
        method: 'POST',
        body: { email: rig.run.petra.email, role: 'viewer' },
      });
      assert.equal(sent.status, 201, JSON.stringify(await json(sent.clone())));
      petra = await open(await control('/petra/accept'));
      await step(petra, 'can-comment-open', () => openCanvas(petra));
    },
    { timeout: 180_000 }
  );

  it('md-comment-only: Can comment in words, Ask to edit, Viewing — Hand and Comment only, no AI chat panel', async () => {
    await step(petra, 'md-comment-only', async () => {
      await accessWord(petra, 'Can comment');
      assert.equal(
        await petra.locator(tid('share-cluster-status')).getAttribute('data-status'),
        'access'
      );
      await petra.locator(tid('share-cluster-ask')).waitFor({ timeout: STEP });
      assert.equal(await text(petra.locator(tid('share-cluster-ask'))), 'Ask to edit');
      assert.equal(await petra.locator(tid('share-cluster-share')).count(), 0);
      // the mode switch offers Viewing, never Edit; it opens in Preview, whose toolbar is cut the same way
      assert.equal(await petra.locator(tid('palette-mode-edit')).count(), 0);
      await petra.locator(tid('palette-mode-viewing')).waitFor({ timeout: STEP });
      const inPreview = await until('the Preview toolbar', () => toolbarSlots(petra));
      assert.deepEqual(inPreview, ['browse', 'comment']);
      await selectMode(petra, 'viewing');
      // the canvas toolbar: Hand and Comment, nothing else — hidden, not greyed
      await frameOf(petra).locator(tid('toolbar-viewing')).waitFor({ timeout: STEP });
      const viewing = await toolbarSlots(petra);
      // two slots: the Hand slot (`inspect` in Viewing, `browse` in Preview — tool-palette draws both as Hand)
      // and Comment
      assert.equal(viewing.length, 2, viewing.join(' '));
      assert.ok(['inspect', 'browse'].includes(viewing[0]), viewing.join(' '));
      assert.equal(viewing[1], 'comment');
      // no AI chat panel (CONTRACT §6 C30): not shown, and nothing that opens it
      const ids = await shownIds(petra);
      assert.ok(!ids.some((i) => i.startsWith('ai-') || i.startsWith('chat-')), ids.join(' '));
      await shot(petra, 'md-comment-only');
    });
  });

  it('es-viewer: the Comments panel — "No comments on Smoke yet." and who sees one right away', async () => {
    await step(petra, 'es-viewer', async () => {
      // the cluster's Comments icon is drawn only where the canvas has comments (P8 C3): View › Comments
      assert.equal(await petra.locator(tid('share-cluster-comments')).count(), 0);
      await openMenu(petra);
      const row = petra.locator(tid('project-menu-row-view.comments')).first();
      if (!(await row.isVisible())) {
        await petra.locator(tid('project-menu-row-sub-view')).click();
      }
      await row.click();
      const empty = petra.locator(tid('comments-empty'));
      await empty.waitFor({ timeout: STEP });
      // the names arrive with the people answer: the line settles on them
      const words = await until('the empty line naming who sees it', async () => {
        const w = await text(empty);
        return / see(s)? it right away\./.test(w) ? w : null;
      }).catch(async () => text(empty));
      assert.match(words, /No comments on Smoke yet\./);
      const people = await petra.evaluate(() =>
        fetch('/_api/share/people').then(async (r) => ({
          status: r.status,
          body: await r.json().catch(() => null),
        }))
      );
      writeFileSync(join(shots, 'es-viewer-people.json'), JSON.stringify(people, null, 2));
      assert.match(
        words,
        /Press C, then click anywhere on the canvas to leave one\. .+ sees? it right away\./,
        `people answer ${people.status}`
      );
      // a viewer's empty state offers no Share action
      assert.equal(await petra.locator(tid('comments-share')).count(), 0);
      await shot(petra, 'es-viewer');
    });
  });

  it('md-comment-only: C, a click on the artboard, Post — the comment is on the canvas for everyone', async () => {
    await step(petra, 'md-comment-post', async () => {
      await dismiss(petra);
      // posted from Viewing, the mode the board draws. P8 G1a item 2: a click right after Comment was pressed
      // used to open no composer (the comment layer heard the tool a task late) — fixed, so no wait here
      await selectMode(petra, 'viewing');
      const frame = frameOf(petra);
      await frame.locator(tid('toolbar-slot-comment')).click();
      const box = await frame.locator(tid('smoke-h1')).boundingBox();
      assert.ok(box, 'the headline has a box');
      await petra.mouse.click(box.x + box.width / 2, box.y + box.height + 60);
      const say = `Číslo by mělo být větší ${Date.now()}`;
      await frame.locator(tid('comment-composer-send')).waitFor({ timeout: STEP });
      await frame.locator('textarea').first().fill(say);
      await shot(petra, 'md-comment-only-composer');
      await frame.locator(tid('comment-composer-send')).click();
      await frame
        .locator('text=' + say)
        .first()
        .waitFor({ timeout: STEP })
        .catch(() => {});
      await shot(petra, 'md-comment-only-posted');
      // it reaches the owner: the owner's window shows it (its Comments icon appears, the panel lists it)
      const owner = await open(ownerUrl);
      await openCanvas(owner);
      await owner.locator(tid('share-cluster-comments')).click({ timeout: 60_000 });
      await owner.getByText(say).first().waitFor({ timeout: 60_000 });
      await shot(owner, 'md-comment-only-owner-sees-it');
      await owner.close();
    });
  });

  it('ex-edges: Can comment exports — the sheet says so in one line, and the Export entry is there', async () => {
    await step(petra, 'ex-edges-comment', async () => {
      await dismiss(petra);
      const rows = await allMenuRows(petra);
      assert.ok(rows.has('export.open'), [...rows].join(' '));
      await openMenu(petra);
      await petra.locator(tid('project-menu-row-export.open')).first().click();
      const sheet = petra.locator(tid('export-sheet'));
      await sheet.waitFor({ timeout: STEP });
      assert.equal(
        await text(petra.locator(tid('export-access-line'))),
        'You can comment on this project. Exporting is fine — it makes a copy and changes nothing.'
      );
      assert.equal(await petra.locator(tid('export-submit')).isEnabled(), true);
      await shot(petra, 'ex-edges-can-comment');
      await petra.locator(tid('export-cancel')).click();
    });
  });

  // ── 11 pn-cant-open (col 3) + 09 ex-edges (Can view) ─────────────────────────────────────
  it('pn-cant-open: the owner changes Petra to Can view — the word, the toolbar goes, no Export anywhere', async () => {
    const { people } = await json(await hub('/api/access/people'));
    const her = people.find((p) => p.name?.startsWith('Petra'));
    assert.ok(her, JSON.stringify(people));
    const ok = await hub(`/api/access/people/${her.id}`, {
      method: 'PATCH',
      body: { role: 'observer' },
    });
    assert.equal(ok.status, 200, JSON.stringify(await json(ok.clone())));
    await step(petra, 'pn-cant-open-can-view', async () => {
      await accessWord(petra, 'Can view');
      // S1.20 — the toast says who narrowed and what she is now (the hub's notice names both)
      const owner = 'Olga'; // stand-up.mjs PEOPLE.owner (Olga Owner), first name
      await petra
        .locator('[data-testid^="notice-"]')
        .filter({ hasText: `${owner} changed you to Can view. Your changes were saved first.` })
        .first()
        .waitFor({ timeout: STEP });
      await shot(petra, 'pn-cant-open-narrowed-toast');
      await petra.locator(tid('share-cluster-ask')).waitFor({ timeout: STEP });
      // the toolbar goes (Can view: none), the canvas stays on screen
      await until('the toolbar to go', async () => (await toolbarSlots(petra)) === null);
      await frameOf(petra).locator(tid('smoke-h1')).waitFor({ timeout: STEP });
      await shot(petra, 'pn-cant-open-now-can-view');
    });
    await step(petra, 'ex-edges-can-view', async () => {
      // the lock is the server's (CONTRACT §7): her studio refuses every export class write
      const refused = await petra.evaluate(async () => {
        const out = {};
        for (const p of ['/_api/export', '/_api/export-jobs']) {
          const r = await fetch(p, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: '.design/ui/Smoke.tsx', format: 'png' }),
          });
          out[p] = r.status;
        }
        return out;
      });
      assert.deepEqual(refused, { '/_api/export': 403, '/_api/export-jobs': 403 });
      // Can view is refused every export on the server, so the role sees no Export at all (ex-edges)
      const rows = await allMenuRows(petra);
      assert.ok(!rows.has('export.open'), [...rows].join(' '));
      assert.ok(!rows.has('handoff.open'), [...rows].join(' '));
      await petra.locator('body').click({ position: { x: 700, y: 20 } });
      await petra.keyboard.press('Meta+Shift+KeyE');
      await sleep(800);
      assert.equal(await petra.locator(tid('export-sheet')).count(), 0, '⇧⌘E opened nothing');
      await shot(petra, 'ex-edges-can-view-no-export');
    });
  });

  it('pn-cant-open: the owner removes Lukáš while he looks — the access card, saved first, Back to Home', async () => {
    if (!lukas) {
      lukas = await open(rig.run.lukas.url);
      await step(lukas, 'pn-cant-open-lukas-open', () => openCanvas(lukas));
    }
    const { people } = await json(await hub('/api/access/people'));
    const him = people.find((p) => p.name?.startsWith('Luk'));
    assert.ok(him, JSON.stringify(people));
    const gone = await hub(`/api/access/people/${him.id}`, { method: 'DELETE' });
    assert.equal(gone.status, 204);
    await step(lukas, 'pn-cant-open-removed', async () => {
      const card = lukas.locator(tid('access-ended'));
      await card.waitFor({ timeout: 60_000 });
      const words = await text(card);
      assert.ok(words.includes(`You no longer have access to ${rig.run.project}.`), words);
      assert.ok(
        words.includes(
          'Your last changes were saved first. If this is a surprise, ask someone on the team.'
        ),
        words
      );
      assert.equal(await text(lukas.locator(tid('access-ended-home'))), 'Back to Home');
      await shot(lukas, 'pn-cant-open-removed');
    });
  });

  it('pn-cant-open: the owner removes Petra while she looks (Can view, no hub socket) — the same access card', async () => {
    // Petra is Can view since the narrowing above. A Can view window holds no hub socket, so the hub's notice
    // never reaches it: it asks GET /api/access/me itself, on focus and about every 60 s (decision
    // maude/v2-p8-g1a-commenter-door-and-viewer-removal-poll). Focus is what a person does when they look back.
    const { people } = await json(await hub('/api/access/people'));
    const her = people.find((p) => p.name?.startsWith('Petra'));
    assert.ok(her, JSON.stringify(people));
    const gone = await hub(`/api/access/people/${her.id}`, { method: 'DELETE' });
    assert.equal(gone.status, 204);
    await step(petra, 'pn-cant-open-removed-can-view', async () => {
      const card = petra.locator(tid('access-ended'));
      await until(
        'the access card on a Can view window',
        async () => {
          await petra.evaluate(() => window.dispatchEvent(new Event('focus')));
          await sleep(1000);
          return card.isVisible();
        },
        90_000
      );
      const words = await text(card);
      assert.ok(words.includes(`You no longer have access to ${rig.run.project}.`), words);
      assert.ok(
        words.includes(
          'Your last changes were saved first. If this is a surprise, ask someone on the team.'
        ),
        words
      );
      assert.equal(await text(petra.locator(tid('access-ended-home'))), 'Back to Home');
      await shot(petra, 'pn-cant-open-removed-can-view');
    });
  });
});

// ── 04 md-edge-viewer: a view-only link, in a browser on the cell door ────────────────────────
describe('04 md-edge-viewer — a view-only link, in a browser', () => {
  it('Preview, pins show, the menu lists only what a viewer can do; Version history opens without Restore', async () => {
    const made = await hub('/api/access/links', {
      method: 'POST',
      body: { canvas: rig.run.canvas, role: 'observer', who: 'anyone' },
    });
    const link = await json(made);
    assert.equal(made.status, 201, JSON.stringify(link));
    const viewer = await open(await control('/viewer/redeem', { url: link.url }));
    await step(viewer, 'md-edge-viewer', async () => {
      await openCanvas(viewer);
      await accessWord(viewer, 'Can view');
      assert.equal(await viewer.locator(tid('palette-mode-edit')).count(), 0);
      assert.equal(await viewer.locator(tid('share-cluster-share')).count(), 0);
      // Can view: no toolbar at all, no AI chat panel
      assert.equal(await toolbarSlots(viewer), null);
      const ids = await shownIds(viewer);
      assert.ok(!ids.some((i) => i.startsWith('ai-') || i.startsWith('chat-')), ids.join(' '));
      // the menu: only what a viewer can do — no Export, no Handoff, no new canvas, no trash
      const rows = await allMenuRows(viewer);
      for (const id of ['export.open', 'handoff.open', 'canvas.new', 'file.new'])
        assert.ok(!rows.has(id), `${id} in a viewer's menu: ${[...rows].join(' ')}`);
      assert.ok(rows.has('history.open'), [...rows].join(' '));
      await openMenu(viewer);
      await shot(viewer, 'md-edge-viewer-menu');
      // Version history opens to look — without Restore
      await viewer.locator(tid('project-menu-row-history.open')).first().click();
      await viewer.locator(tid('vh-panel')).waitFor({ timeout: STEP });
      await sleep(1000);
      assert.equal(await viewer.locator(tid('vh-restore')).count(), 0);
      assert.equal(await viewer.locator(tid('history-preview-restore')).count(), 0);
      await shot(viewer, 'md-edge-viewer-history');
    });
  });
});

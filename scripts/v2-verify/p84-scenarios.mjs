#!/usr/bin/env node
// V2-8.4 cross-shell scenarios — one script, three shells (plain browser · cloud tab · cloud viewer).
//
//   node scripts/v2-verify/p84-scenarios.mjs <rig.json> <out-dir> [shell ...]
//
// `scenario-runner` approach (plugins/flow/agents/scenario-runner.md), web-desktop lane: the same
// steps run in each shell, a screenshot per step, a result per step; a failure on one shell does not
// abort the others. What it asserts per shell comes from the shell-parity TABLE
// (apps/studio/client/v2/shell/shell-parity.json) — the same table the shell is pinned against — so
// "parity OK" means the live page matches the table, not a list typed into this file.
//
// Steps:  open-project · open-canvas · select-inspect · comment · export-png · share
//
// Needs the rig from p84-up.mjs (browser: plain studio · owner: local cell, password sign-in ·
// viewer: a `viewer`-role session minted into the cell's token store).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const rig = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const WANT = process.argv.slice(4);
const SHELLS = ['browser', 'owner', 'viewer'].filter((s) => !WANT.length || WANT.includes(s));
mkdirSync(join(OUT, 'shots'), { recursive: true });

const require = createRequire(join(process.cwd(), 'apps/studio/package.json'));
const { chromium } = require('playwright');
const table = JSON.parse(
  readFileSync(join(process.cwd(), 'apps/studio/client/v2/shell/shell-parity.json'), 'utf8')
);
const TABLE_SHELL = { browser: 'browser', owner: 'cloud-owner', viewer: 'cloud-viewer' };
const CANVAS = '.design/ui/board.tsx';
const COMMENT_TEXT = 'V2-8.4 scenario comment';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function newShell(browser, shell) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addInitScript(() => {
    try {
      // a returning user: no first-run tour over the canvas
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') page._errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  let url = rig.browser;
  if (shell === 'owner') {
    url = rig.cell;
    // the real cloud entry: the hub's own password door
    await page.goto(`${rig.cell}/studio/signin`);
    await page.fill('input[name=email]', rig.owner.email);
    await page.fill('input[name=password]', rig.owner.password);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  } else if (shell === 'viewer') {
    url = rig.cell;
    await ctx.addCookies([
      { name: rig.cookie, value: rig.sessions.viewer, url: rig.cell, httpOnly: true },
    ]);
  }
  return { ctx, page, url };
}

/** The canvas iframe (cross-origin on every shell: DDR-054) as a Playwright Frame. */
async function canvasFrame(page, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = page.frames().find((x) => x.url().includes('_canvas-shell'));
    if (f) {
      const ok = await f
        .evaluate(() => document.body?.innerText.includes('Cross-shell card'))
        .catch(() => false);
      if (ok) return f;
    }
    await sleep(250);
  }
  return null;
}

const STEPS = [
  {
    id: 'open-project',
    title: 'Open the project',
    async run({ page, url, shell, note, shot }) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(tid('project-pill'), { timeout: 60000 });
      await page.waitForSelector(tid('canvas-list'), { timeout: 30000 });
      await sleep(1200);
      // assert the TABLE: every chrome testid a present part lists is on screen …
      const ts = table.shells[TABLE_SHELL[shell]];
      const isMenuRow = (id) => id.startsWith('project-menu-row-');
      const missing = [];
      const present = [];
      const menuIds = [];
      for (const [name, part] of Object.entries(ts.parts)) {
        if (!part.present) continue;
        for (const id of part.testids ?? []) {
          if (isMenuRow(id)) {
            // a row the table marks conditional (a dashboard address, a linked project, a signed-in account) is not
            // asserted present: a LOCAL cell has no dashboard, so its menu has no Back to Home — and says nothing
            if (id.replace('project-menu-row-', '') in table.conditional) continue;
            menuIds.push([name, id]);
            continue;
          }
          if ((await page.locator(tid(id)).count()) === 0) missing.push(`${name}:${id}`);
          else present.push(id);
        }
      }
      // … the menu rows it lists are in the project menu …
      await page.click(tid('project-pill'));
      await sleep(700);
      await shot('menu');
      for (const [name, id] of menuIds) {
        if ((await page.locator(tid(id)).count()) === 0) missing.push(`${name}:${id}`);
        else present.push(id);
      }
      // … and every chrome a part marks ABSENT in this shell is absent (the table's other columns list the ids)
      const stray = [];
      for (const [name, part] of Object.entries(ts.parts)) {
        if (part.present) continue;
        for (const other of Object.values(table.shells)) {
          for (const id of other.parts[name]?.testids ?? []) {
            if (await page.locator(tid(id)).count()) stray.push(`${name}:${id}`);
          }
        }
      }
      await page.keyboard.press('Escape');
      note(`table shell ${ts.id}: ${present.length} chrome testids present, ${stray.length} stray`);
      if (missing.length)
        throw new Error(`chrome the parity table lists is missing: ${missing.join(', ')}`);
      if (stray.length)
        throw new Error(`chrome the parity table marks absent is on screen: ${stray.join(', ')}`);
      const row = await page.locator(tid('canvas-row-ui-board')).count();
      if (!row) throw new Error('the seeded canvas row canvas-row-ui-board is not in the tree');
      const access = await page
        .locator(tid('share-cluster-status'))
        .first()
        .innerText()
        .catch(() => '');
      note(`status word: "${access.replace(/\s+/g, ' ').trim()}"`);
      return { chrome: present.length, status: access.trim() };
    },
  },
  {
    id: 'open-canvas',
    title: 'Open a canvas',
    async run({ page, note }) {
      // the cell opens the project's first canvas on its own (?open=); the plain browser waits for a click
      if (!(await page.locator(tid('canvas-frame')).count())) {
        await page.click(tid('canvas-row-ui-board'));
      }
      await page.waitForSelector(tid('canvas-frame'), { timeout: 30000 });
      const path = await page.locator(tid('canvas-frame')).getAttribute('data-path');
      if (path !== CANVAS) throw new Error(`canvas-frame data-path is ${path}, expected ${CANVAS}`);
      const f = await canvasFrame(page);
      if (!f) throw new Error('the canvas never rendered its content ("Cross-shell card")');
      note(`rendered in ${new URL(f.url()).host}`);
      await sleep(600);
      return { frameHost: new URL(f.url()).host };
    },
  },
  {
    id: 'select-inspect',
    title: 'Select an element and inspect it',
    async run({ page, shell, note }) {
      const f = await canvasFrame(page);
      if (!f) throw new Error('no canvas frame');
      // a viewer opens in Preview (the live mock); selecting is the Viewing mode's job
      if (shell === 'viewer') {
        await page.click(tid('palette-mode-viewing'));
        await sleep(600);
      }
      const h1 = await f.locator('h1').first().boundingBox();
      if (!h1) throw new Error('no <h1> in the canvas');
      await page.mouse.click(h1.x + 20, h1.y + h1.height / 2);
      await sleep(900);
      if (!(await page.locator(tid('inspector-panel')).count())) {
        await page.keyboard.press('Meta+Shift+I');
        await sleep(700);
      }
      await page.waitForSelector(tid('inspector-panel'), { timeout: 8000 });
      const text = (await page.locator(tid('inspector-panel')).innerText())
        .replace(/\s+/g, ' ')
        .trim();
      note(`inspector: "${text.slice(0, 110)}"`);
      if (!/Position/.test(text) && !/Frame|Card/.test(text))
        throw new Error('the Inspector shows no selection');
      const ro = ts(shell).parts.inspector.readOnly === true;
      const editable = await page
        .locator(
          `${tid('inspector-panel')} input:not(:disabled):not([readonly]):not([type=hidden]), ${tid('inspector-panel')} textarea:not(:disabled):not([readonly]), ${tid('inspector-panel')} select:not(:disabled)`
        )
        .count();
      note(`${editable} editable input(s) in the Inspector (table readOnly=${ro})`);
      if (ro && editable > 0)
        throw new Error(`a read-only Inspector has ${editable} editable inputs`);
      if (!ro && editable === 0)
        throw new Error('an editor sees no editable input in the Inspector');
      return { editableInputs: editable, readOnly: ro, header: text.slice(0, 60) };
    },
  },
  {
    id: 'comment',
    title: 'Leave a comment',
    async run({ page, note, shot }) {
      const f = await canvasFrame(page);
      const card = await f.locator('h1').first().boundingBox();
      // C arms the comment tool (it lives in Preview's toolbar and opens the Comments panel)
      await page.keyboard.press('Escape');
      await page.keyboard.press('c');
      await sleep(600);
      await page.mouse.click(card.x + 180, card.y + 120);
      await f.waitForSelector('.cm-composer', { timeout: 8000 }).catch(() => {});
      if (!(await f.locator('.cm-composer').count()))
        throw new Error('the comment composer never opened');
      const field = f
        .locator('.cm-composer textarea, .cm-composer [contenteditable="true"], .cm-composer input')
        .first();
      await field.click();
      await page.keyboard.type(COMMENT_TEXT);
      await sleep(300);
      await shot('composer');
      await f.locator(tid('comment-composer-send')).first().click();
      await sleep(1800);
      if (!(await page.locator(tid('comments-panel')).count())) {
        await page.keyboard.press('Meta+Shift+M');
        await page.waitForSelector(tid('comments-panel'), { timeout: 8000 });
      }
      const text = await page.locator(tid('comments-panel')).innerText();
      const items = await page.locator('[data-testid^="comment-item-"]').count();
      note(
        `the Comments panel holds the comment: ${text.includes(COMMENT_TEXT)} (${items} comment(s) listed — a cell shows every shell's)`
      );
      if (!text.includes(COMMENT_TEXT)) throw new Error('the comment is not in the Comments panel');
      // the cluster's comments button is drawn now that the canvas has a comment
      const btn = await page.locator(tid('share-cluster-comments')).count();
      note(`share-cluster-comments button drawn: ${btn > 0}`);
      if (!btn)
        throw new Error(
          'the Share cluster draws no comments button although the canvas has a comment'
        );
      return { saved: true };
    },
  },
  {
    id: 'export-png',
    title: 'Export a PNG',
    async run({ page, shell, note, shot, outDir }) {
      // close the Comments island so nothing sits over the sheet, then ⇧⌘E
      if (await page.locator(tid('comments-panel')).count()) {
        await page.click(tid('comments-panel-close')).catch(() => {});
        await sleep(300);
      }
      await page.keyboard.press('Meta+Shift+E');
      await page.waitForSelector(tid('export-sheet'), { timeout: 10000 });
      await sleep(800);
      const title = (
        await page
          .locator(tid('export-title'))
          .innerText()
          .catch(() => '')
      ).trim();
      note(
        `sheet: "${title}" · scope ${await page.locator(tid('export-sheet')).getAttribute('data-scope')}`
      );
      await shot('sheet');
      // the file the shell hands the browser (the cloud tab captures in the page and saves a download)
      const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
      await page.locator(tid('export-submit')).click();
      // Two lanes, one promise. A local project runs a server job (the sheet closes, the Exports island lists it);
      // a cloud tab with no render service captures in the browser (the sheet stays and says "Saved … to your downloads").
      const t0 = Date.now();
      let lane = '';
      let said = '';
      while (Date.now() - t0 < 150000 && !lane) {
        const st = page.locator(tid('export-status'));
        if (await st.count()) {
          const ok = await st.getAttribute('data-ok');
          said = (await st.innerText()).replace(/\s+/g, ' ').trim();
          if (ok === '0') throw new Error(`the export was refused: ${said}`);
          if (ok === '1') lane = 'browser';
        } else if (!(await page.locator(tid('export-sheet')).count())) {
          lane = 'server-job';
        }
        if (!lane) await sleep(400);
      }
      if (!lane) throw new Error('the export neither finished in the sheet nor started a job');
      if (lane === 'browser') {
        note(`browser lane: "${said}"`);
        await shot('saved');
      } else {
        await page.waitForSelector(tid('share-cluster-exports'), { timeout: 15000 });
        if (!(await page.locator(tid('exports-panel')).count()))
          await page.click(tid('share-cluster-exports'));
        await page.waitForSelector(tid('exports-panel'), { timeout: 8000 });
        const done = page.locator('[data-testid^="export-job-"][data-state="done"]');
        const failed = page.locator(
          '[data-testid^="export-job-"][data-state="failed"], [data-testid^="export-job-"][data-state="error"]'
        );
        const t1 = Date.now();
        while (Date.now() - t1 < 150000 && !(await done.count()) && !(await failed.count()))
          await sleep(1000);
        const row = page.locator('[data-testid^="export-job-"][data-state]').first();
        const state = await row.getAttribute('data-state').catch(() => null);
        const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        note(`server job ${state}: "${text.slice(0, 140)}"`);
        await shot('job');
        if (state !== 'done')
          throw new Error(`the PNG export ended ${state}: ${text.slice(0, 200)}`);
      }
      // a download, when the lane hands one over, is a real PNG
      let png = null;
      const d = await Promise.race([dl, sleep(2500).then(() => null)]);
      if (d) {
        const dest = join(outDir, 'shots', `${shell}-export.png`);
        await d.saveAs(dest);
        const head = readFileSync(dest).subarray(0, 8).toString('hex');
        png = {
          file: `shots/${shell}-export.png`,
          signature: head,
          ok: head === '89504e470d0a1a0a',
        };
        note(`downloaded ${d.suggestedFilename()} — PNG signature ${png.ok ? 'ok' : 'WRONG'}`);
        if (!png.ok) throw new Error('the downloaded export is not a PNG');
      }
      return { lane, title, png };
    },
  },
  {
    id: 'share',
    title: 'Share sheet',
    async run({ page, shell, note, gap, shot }) {
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      if (shell === 'viewer') {
        // "Ask to edit" — the read-only session's one action. It answers in words (a toast): the hub's, or ours.
        await page.click(tid('share-cluster-ask'));
        await sleep(2500);
        const said = [];
        // the answer pill carries no role: read the page for the words the client can say
        const text = await page.evaluate(() => document.body.innerText);
        for (const w of [
          'Asked. The owner will see your request.',
          'Queued — sends when this Mac is online.',
          'You can already edit this.',
          'You already asked. The owner has your request.',
          'Ask a project owner for edit access.',
          'Could not ask right now. Try again in a minute.',
          'not found',
        ])
          if (text.includes(w) && !said.includes(w)) said.push(w);
        note(`Ask to edit answered: ${JSON.stringify(said)}`);
        await shot('asked');
        if (!said.length) throw new Error('Ask to edit said nothing');
        if (
          said.some(
            (t) => /^(not found|forbidden|unauthorized|error)$/i.test(t) || /not found/i.test(t)
          )
        )
          throw new Error(`Ask to edit answered with a bare route error: ${said.join(' / ')}`);
        const sent = said.some((t) =>
          /^(Asked\.|Queued|You already asked|You can already edit)/.test(t)
        );
        if (!sent)
          gap(
            'Ask to edit cannot reach a hub door from a cloud tab on a LOCAL cell: the tab asks /_api/share/requests (refused by the cell proxy, S9.21) and /api/access/requests takes a bearer, not the session cookie. Says "' +
              said[0] +
              '" instead of sending.'
          );
        return { surface: 'ask-to-edit', said, sent };
      }
      await page.click(tid('share-cluster-share'));
      await page.waitForSelector(tid('share-dialog'), { timeout: 8000 });
      await sleep(1200);
      const body = (await page.locator(tid('share-dialog')).innerText()).replace(/\s+/g, ' ');
      const local = (await page.locator(tid('share-local-note')).count()) > 0;
      const invite = (await page.locator(tid('share-invite')).count()) > 0;
      note(
        `share sheet (${local ? 'local project: no invite' : invite ? 'invite + people' : 'degraded'}): "${body.slice(0, 170)}"`
      );
      if (shell === 'owner' && invite) {
        // P8 cloud-share — send one invitation from the cloud tab (the hub answers /_api/share/*
        // for the cell by the desktop's fixed map) and read it back in the people list.
        await page.fill(tid('share-invite-email'), 'invitee@local.test');
        await page.click(tid('share-invite-submit'));
        await sleep(2000);
        const people = (
          await page
            .locator(tid('share-people'))
            .innerText()
            .catch(() => '')
        )
          .replace(/\s+/g, ' ')
          .trim();
        note(`invited from the tab — people list: "${people.slice(0, 160)}"`);
        await shot('invited');
        if (!/invitee/.test(people))
          throw new Error('the invitation sent from the tab is not listed');
        return { local, hasInvite: invite, invited: true };
      }
      if (shell === 'owner' && !invite)
        gap(
          'the cloud-tab Share sheet cannot load people/invites on a LOCAL cell: it asks /_api/share/* (refused by the cell proxy) — the sheet says "' +
            body.slice(body.indexOf('Sharing'), body.indexOf('Sharing') + 60) +
            '…" and speaks of "this Mac".'
        );
      return { local, hasInvite: invite };
    },
  },
];

function ts(shell) {
  return table.shells[TABLE_SHELL[shell]];
}

const browser = await chromium.launch({ headless: true });
const results = {};
for (const shell of SHELLS) {
  const { ctx, page, url } = await newShell(browser, shell);
  results[shell] = { steps: [], errors: [] };
  let n = 0;
  for (const step of STEPS) {
    n += 1;
    const notes = [];
    const extra = [];
    const gaps = [];
    const rec = {
      gaps,
      id: step.id,
      title: step.title,
      status: 'pass',
      notes,
      data: null,
      shot: null,
      extra,
      error: null,
    };
    const shot = async (name) => {
      const f = `shots/${shell}-${String(n).padStart(2, '0')}-${step.id}-${name}.png`;
      await page.screenshot({ path: join(OUT, f) }).catch(() => {});
      extra.push(f);
    };
    try {
      rec.data = await step.run({
        page,
        url,
        shell,
        note: (s) => notes.push(s),
        gap: (s) => gaps.push(s),
        outDir: OUT,
        shot,
      });
    } catch (e) {
      rec.status = 'fail';
      rec.error = String(e.message ?? e).slice(0, 400);
    }
    rec.shot = `shots/${shell}-${String(n).padStart(2, '0')}-${step.id}.png`;
    await page.screenshot({ path: join(OUT, rec.shot) }).catch(() => {});
    results[shell].steps.push(rec);
    console.log(`${shell} ${step.id}: ${rec.status}${rec.error ? ` — ${rec.error}` : ''}`);
    // a dialog left open must not eat the next step's keys
    await page.keyboard.press('Escape').catch(() => {});
    // … and the press must LAND before the next step clicks: with the shell focused, esc is forwarded to the
    // canvas frame by postMessage (`run-action ui.step-back`), and Chromium runs an input event ahead of a
    // queued message — the next step's click selected, then the late esc cleared it (select-inspect red).
    await sleep(400);
  }
  results[shell].errors = page._errors.slice(0, 20);
  await ctx.close();
}
await browser.close();
// a run of one shell merges into the results of the others (the full run is long; a shell can be re-run alone)
const prev = existsSync(join(OUT, 'results.json'))
  ? JSON.parse(readFileSync(join(OUT, 'results.json'), 'utf8'))
  : {};
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify({ ...prev, ...results }, null, 2)}\n`);

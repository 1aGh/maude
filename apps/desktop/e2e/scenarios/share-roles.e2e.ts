// S9.21c — Share roles across people (contract V2-1.7 §7, real processes, V2-8; 10 co-share-roles · co-ask-edit ·
// co-access-ends). Config + the run file it reads: wdio.share-roles.conf.ts.
//
//   1. The owner (this app) invites Petra Can view on one canvas. Petra's window shows that one canvas, Viewing,
//      no toolbar; her drag goes nowhere and one tip says why. Ask to edit → the owner's toast → Review → Let
//      Petra edit → Petra hears "You can edit … now." and the toolbar is back.
//   2. The owner removes Lukáš while he edits: his last change lands in the owner's project, then his window
//      dims behind "You no longer have access to …" and Back to Home.
//   3. The owner turns off the link a third person came in on: "This link was turned off."
//
// Petra and Lukáš are a studio of their own on the same hub, driven through a headless Chromium page (the
// multiplayer/ harness's way). The link viewer is a plain browser on the project's cell door (a workspace-mode
// hub, share-roles/stand-up.mjs): `/viewer/redeem` hands back the cell's own sign-in URL, and the link card comes
// from the cell's 401 `link-off` on that browser's next request (decision maude/v2-p8-e2e-link-viewer-on-cell-door). The canvas is a separate origin: Chromium reaches it with frameLocator; the
// owner never needs to look inside it. Every step has its own deadline and leaves a screenshot.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium, type FrameLocator, type Page } from '@playwright/test';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { setSelect } from '../helpers/select';
import { waitForSidecar } from '../helpers/sidecar';
import { pinCurrentWindow } from '../helpers/windows';

type Person = { email?: string; name: string; url?: string };
type Run = {
  out: string;
  nativeProject: string;
  project: string;
  canvas: string;
  lifecycle: string;
  petra: Person;
  lukas: Person;
  viewer: Person;
};
const runPath = process.env.MAUDE_SHARE_ROLES_CONFIG;
if (!runPath) throw new Error('Use wdio.share-roles.conf.ts with a run file.');
const run = JSON.parse(readFileSync(runPath, 'utf8')) as Run;

const tid = (id: string) => `[data-testid="${id}"]`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const canvasName = (run.canvas.split('/').pop() as string).replace(/\.tsx$/, '');
const rowId = (rel: string) =>
  `canvas-row-${rel
    .replace(/\.tsx$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()}`;
const first = (name: string) => name.trim().split(/\s+/)[0];
const STEP_MS = 30_000;

async function until<T>(
  what: string,
  fn: () => Promise<T | null | false | undefined>,
  ms = STEP_MS
) {
  const end = Date.now() + ms;
  let last: unknown = null;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  throw new Error(`${what}: not within ${ms} ms${last ? ` (${String(last)})` : ''}`);
}

/** The runner's loopback control (accept an invitation, open a link) — never a grant made here. */
async function lifecycle(path: string, body: unknown = {}): Promise<{ url: string }> {
  const r = await fetch(new URL(path, run.lifecycle), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (r.status !== 200 || typeof json?.url !== 'string')
    throw new Error(`lifecycle ${path}: ${r.status} ${json?.error ?? ''}`);
  return { url: json.url };
}

// ── the owner: this app ─────────────────────────────────────────────────────────────────────────────
const nativeText = (q: string) =>
  browser.execute(
    (s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    q
  );

/** The testid of the one notice whose words include `words`, or null. */
const nativeNotice = (words: string) =>
  browser.execute((w) => {
    for (const n of Array.from(document.querySelectorAll('[data-testid^="notice-"]')))
      if ((n.textContent ?? '').replace(/\s+/g, ' ').includes(w))
        return n.getAttribute('data-testid');
    return null;
  }, words);

async function ownerOpensShare(scope: 'canvas' | 'project') {
  if (!(await $(tid('share-dialog')).isExisting())) {
    await $(tid('share-cluster-share')).click();
    await $(tid('share-dialog')).waitForDisplayed({ timeout: STEP_MS });
  }
  const seg = $(tid(`share-scope-${scope}`));
  if (!(await seg.isExisting())) return;
  // the segment is pressed once the sheet shows that scope: a click that landed while the sheet was still
  // re-rendering (the request block answered just before) left it on This canvas, where Lukáš's row is his grant
  await browser.waitUntil(
    async () => {
      if ((await seg.getAttribute('aria-pressed')) === 'true') return true;
      await seg.click();
      await browser.pause(150);
      return (await seg.getAttribute('aria-pressed')) === 'true';
    },
    { timeout: STEP_MS, timeoutMsg: `Share never showed the ${scope} scope` }
  );
}
async function ownerClosesShare() {
  if (await $(tid('share-close')).isExisting()) await $(tid('share-close')).click();
}

// ── everyone else: a studio each, in Chromium ───────────────────────────────────────────────────────
let chromiumBrowser: Browser | null = null;
const pages: Page[] = [];
/** Evidence trace (p8-e2e-fix-r5): one line per access event, with the time, beside the runner's own trace. */
const trace = (line: string) =>
  appendFileSync(join(run.out, 'access-trace.log'), `${Date.now()} ${line}\n`);
async function person(url: string, who = 'person'): Promise<Page> {
  if (!chromiumBrowser)
    chromiumBrowser = await chromium.launch({
      headless: true,
      ...(process.env.MAUDE_E2E_CHROMIUM ? { executablePath: process.env.MAUDE_E2E_CHROMIUM } : {}),
    });
  const page = await chromiumBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  pages.push(page);
  // the studio's inspector socket: every access frame it hands this window (`access`, `access-changed`, …)
  page.on('websocket', (ws) => {
    trace(`${who} ws open ${ws.url()}`);
    ws.on('framereceived', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : '';
      if (/"type":"access/.test(text)) trace(`${who} ws frame ${text.slice(0, 200)}`);
    });
    ws.on('close', () => trace(`${who} ws close ${ws.url()}`));
  });
  await page.goto(url);
  return page;
}
const frameOf = (page: Page): FrameLocator => page.frameLocator(tid('canvas-frame'));
async function openCanvas(page: Page, rel: string) {
  await page.locator(tid(rowId(rel))).click({ timeout: STEP_MS });
  await frameOf(page).locator('h1').first().waitFor({ timeout: STEP_MS });
}
async function noticeOn(page: Page, words: string) {
  await page
    .locator('[data-testid^="notice-"]', { hasText: words })
    .first()
    .waitFor({ timeout: STEP_MS });
}
async function shot(page: Page, label: string) {
  await page.screenshot({ path: join(run.out, `${label}.png`) });
}
/** The Share cluster's access word, once it settles on `want` — the word follows `/_config.access`, read after the
 *  shell boots. On a timeout: the word it shows, what `/_config.access` says, and a screenshot. */
async function accessWord(page: Page, label: string, want: string) {
  const word = page.locator(tid('share-cluster-status'));
  const now = async () => (await word.textContent())?.trim() ?? '';
  try {
    await until(`${label}'s access word`, async () => (await now()) === want);
  } catch {
    await shot(page, `${label}-access-word`);
    const access = await page
      .evaluate(() =>
        fetch('/_config', { cache: 'no-store' })
          .then((r) => r.json())
          .then((c) => JSON.stringify(c.access ?? null))
      )
      .catch((e) => String(e));
    throw new Error(
      `${label}'s access word is "${await now()}", not "${want}" · /_config.access ${access}`
    );
  }
}
/** The mode switch's segment for `mode`, pressed. */
async function selectMode(page: Page, mode: 'viewing' | 'edit') {
  const b = page.locator(tid(`palette-mode-${mode}`));
  await b.waitFor({ timeout: STEP_MS });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await until(`mode ${mode}`, async () => (await b.getAttribute('aria-pressed')) === 'true');
}

describe('Share roles: Can view asks, Can edit is removed, a link is turned off (V2-1.7 §7)', () => {
  const report = startReport(
    'S9.21c share-roles — owner, Petra, Lukáš and a link viewer on one hub'
  );

  before(async () => {
    await pinCurrentWindow();
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    await $(tid(rowId(run.canvas))).click();
    await $(tid('canvas-frame')).waitForDisplayed({ timeout: 60_000 });
  });

  after(async () => {
    for (const p of pages) await p.close().catch(() => {});
    await chromiumBrowser?.close().catch(() => {});
  });

  it('Petra, Can view on one canvas: Viewing, no toolbar, Ask to edit → Let Petra edit → the toolbar', async () => {
    // The owner invites her on this canvas, Can view.
    await ownerOpensShare('canvas');
    await $(tid('share-invite-email')).setValue(run.petra.email as string);
    // the embedded WebDriver's option click does not select in WKWebView (helpers/select.ts)
    expect(await setSelect('share-invite-role', 'observer')).toBe(true);
    await $(tid('share-invite-submit')).click();
    // a hub that mails says "sent"; one that does not (this stand-in) hands the owner the link to send
    // (share-sheet.jsx notice `sent` | `link`) — either way Petra is invited, as Can view
    await browser.waitUntil(
      async () =>
        (await $(tid('share-invite-sent')).isDisplayed()) ||
        (await $(tid('share-invite-link')).isDisplayed()),
      { timeout: STEP_MS, timeoutMsg: 'the invite said neither sent nor here is the link' }
    );
    await capture(report, 'owner-invited-petra');
    await ownerClosesShare();

    // Petra accepts (her own account, through the runner) and her window opens: the one canvas.
    const { url } = await lifecycle('/petra/accept');
    const petra = await person(url, 'petra');
    await petra.locator(tid(rowId(run.canvas))).waitFor({ timeout: 60_000 });
    expect(await petra.locator('.sh-sidebar [data-testid^="canvas-row-"]').count()).toBe(1);
    await openCanvas(petra, run.canvas);

    // Her access in words, Ask to edit in place of Share; Viewing and no toolbar.
    await accessWord(petra, 'petra', 'Can view');
    await petra.locator(tid('share-cluster-ask')).waitFor({ timeout: STEP_MS });
    expect(await petra.locator(tid('share-cluster-share')).count()).toBe(0);
    await selectMode(petra, 'viewing');
    expect(await frameOf(petra).locator('[role="toolbar"]').count()).toBe(0);

    // She tries to drag the headline: nothing moves, one tip says why.
    const box = await frameOf(petra).locator('h1').first().boundingBox();
    if (!box) throw new Error('the headline has no box in Petra’s window');
    await petra.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await petra.mouse.down();
    await petra.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 12 });
    await petra.mouse.up();
    const tip = petra.locator(tid('access-view-tip'));
    await tip.waitFor({ timeout: STEP_MS });
    expect(await tip.textContent()).toContain(`You can look at ${canvasName}, not change it.`);
    await shot(petra, 'petra-viewing-tip');

    // Ask to edit → the owner's toast → Review → the request block → Let Petra edit.
    await petra.locator(tid('share-cluster-ask')).click();
    await noticeOn(petra, 'Asked. The owner will see your request.');
    const toast = await until('the owner’s request toast', () =>
      nativeNotice(`${first(run.petra.name)}`).then(async (id) =>
        id && (await nativeText(tid(id)))?.includes(`asks to edit ${canvasName}`) ? id : null
      )
    );
    await capture(report, 'owner-request-toast');
    await $(`${tid(toast)} .maude-notice-action`).click();
    await $(tid('share-requests')).waitForDisplayed({ timeout: STEP_MS });
    const approve = await $('[data-testid^="share-request-approve-"]');
    expect(await approve.getText()).toBe(`Let ${first(run.petra.name)} edit`);
    trace('owner clicks Let Petra edit');
    await approve.click();
    await capture(report, 'owner-let-petra-edit');
    await ownerClosesShare();

    // Petra hears it, and after the re-exchange the toolbar is back.
    await noticeOn(petra, `You can edit ${canvasName} now.`);
    await petra.locator(tid('share-cluster-share')).waitFor({ timeout: STEP_MS });
    await selectMode(petra, 'edit');
    await frameOf(petra).locator(tid('toolbar-edit')).waitFor({ timeout: STEP_MS });
    await shot(petra, 'petra-can-edit');
  });

  it('Lukáš removed mid-edit: his last change lands, then the access card', async () => {
    const lukas = await person(run.lukas.url as string);
    await openCanvas(lukas, run.canvas);
    await selectMode(lukas, 'edit');

    // He edits the headline through the canvas' own leaf editor.
    const editor = frameOf(lukas).locator('h1[contenteditable="plaintext-only"]');
    for (let level = 0; level < 12 && !(await editor.count()); level++) {
      await frameOf(lukas).locator('h1').first().dblclick();
      await sleep(50);
    }
    if (!(await editor.count()))
      throw new Error('the headline editor did not open in Lukáš’s window');
    const title = `Edited by ${first(run.lukas.name)} ${Date.now()}`;
    await editor.fill(title);
    await editor.press('Enter');
    const editedAt = Date.now();

    // The owner removes him from the project, right away.
    await ownerOpensShare('project');
    // the sheet can draw itself afresh once its lists load (back on This canvas, its first scope): look again —
    // on This canvas Lukáš's row is a canvas grant he does not have, and Remove there reached no control-plane change (r5 trace)
    await browser.pause(1_000);
    await ownerOpensShare('project');
    const roleButton = await until('Lukáš’s row in Share', () =>
      browser.execute((name) => {
        for (const li of Array.from(document.querySelectorAll('[data-testid^="share-person-"]'))) {
          const id = li.getAttribute('data-testid') ?? '';
          if (!/^share-person-(?!role-|resend-)/.test(id)) continue;
          if (!(li.textContent ?? '').includes(name)) continue;
          return li
            .querySelector('[data-testid^="share-person-role-"]')
            ?.getAttribute('data-testid');
        }
        return null;
      }, first(run.lukas.name))
    );
    await $(tid(roleButton)).click();
    await $(tid('share-role-remove')).click();
    await $(tid('share-remove-dialog')).waitForDisplayed({ timeout: STEP_MS });
    await $(tid('share-remove-confirm')).click();
    await capture(report, 'owner-removed-lukas');
    await ownerClosesShare();

    // His window: the card, in words, and the one way out.
    const card = lukas.locator(tid('access-ended'));
    await card.waitFor({ timeout: 60_000 });
    const cardAt = Date.now();
    const words = (await card.textContent())?.replace(/\s+/g, ' ') ?? '';
    expect(words).toContain(`You no longer have access to ${run.project}.`);
    expect(words).toContain('Your last changes were saved first.');
    await lukas.locator(tid('access-ended-home')).waitFor({ timeout: STEP_MS });
    await shot(lukas, 'lukas-access-ended');

    // …and nothing he made is lost: his last change is in the owner's project.
    const file = join(run.nativeProject, '.design', run.canvas);
    const landedAt = await until(
      'Lukáš’s last change in the owner’s project',
      async () => (readFileSync(file, 'utf8').includes(title) ? Date.now() : null),
      60_000
    );
    // Saved first (co-access-ends): the times, kept with the evidence.
    writeFileSync(
      join(run.out, 'lukas-removed-timings.json'),
      JSON.stringify({ editedAt, cardAt, landedAt }, null, 2)
    );
  });

  it('Share › Advanced: Invite by GitHub username waits there, with its own Invite (desktop only)', async () => {
    // 02 ob-local-moved / ob-adv-sheets: the main Invite stays primary; inviting by GitHub username is one
    // disclosure away, on the desktop only (it needs this Mac's GitHub sign-in), and its Invite stays off
    // until there is a name.
    await ownerOpensShare('project');
    expect((await $(tid('share-invite-submit')).getText()).trim()).toBe('Invite');
    const github = $(tid('share-github'));
    if (!(await github.isDisplayed())) await $(tid('share-other-ways-toggle')).click();
    await github.waitForDisplayed({ timeout: STEP_MS });
    expect((await github.$('label').getText()).trim()).toBe('Invite by GitHub username');
    expect(await $(tid('share-github-username')).getAttribute('placeholder')).toBe('@username');
    const ghInvite = $(tid('share-github-invite'));
    expect((await ghInvite.getText()).trim()).toBe('Invite');
    expect(await ghInvite.isEnabled()).toBe(false);
    await $(tid('share-github-username')).setValue('@tereza');
    await browser.waitUntil(() => ghInvite.isEnabled(), {
      timeout: STEP_MS,
      timeoutMsg: 'the GitHub Invite never turned on with a name in the field',
    });
    await capture(report, 'owner-advanced-github-invite');
    await $(tid('share-github-username')).clearValue();
    await ownerClosesShare();
  });

  it('a link turned off: the person on it reads "This link was turned off."', async () => {
    // The owner copies a link for this canvas; the copy is read where it is written.
    await browser.execute(() => {
      const w = window as unknown as { __e2eCopied?: string };
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        w.__e2eCopied = text;
        await write(text).catch(() => {});
      };
    });
    await ownerOpensShare('canvas');
    if (!(await $(tid('share-link-row')).isExisting()))
      throw new Error(
        'this hub hands out no links (/health.access.links) — the link step needs one that does'
      );
    // A third person is not on the team: the link must be "Anyone with the link" (Advanced › This link › Who can
    // open; the sheet's default is Team only, which the control plane refuses to a stranger — 403 at /l/redeem).
    if (!(await $(tid('share-link-who')).isDisplayed()))
      await $(tid('share-other-ways-toggle')).click();
    await $(tid('share-link-who')).waitForDisplayed({ timeout: STEP_MS });
    expect(await setSelect('share-link-who', 'anyone')).toBe(true);
    await $(tid('share-link-copy')).click();
    const link = await until('the copied link', () =>
      browser.execute(() => (window as unknown as { __e2eCopied?: string }).__e2eCopied ?? null)
    );

    // A third person opens it (signed in, through the runner) and looks at the canvas.
    const { url } = await lifecycle('/viewer/redeem', { url: link });
    const viewer = await person(url, 'viewer');
    await openCanvas(viewer, run.canvas);
    await accessWord(viewer, 'viewer', 'Can view');

    // The owner turns it off, under Advanced.
    if (!(await $(tid('share-link-off')).isDisplayed()))
      await $(tid('share-other-ways-toggle')).click();
    await $(tid('share-link-off')).waitForDisplayed({ timeout: STEP_MS });
    trace('owner turns the link off');
    await $(tid('share-link-off')).click();
    await capture(report, 'owner-link-off');
    await ownerClosesShare();

    const card = viewer.locator(tid('access-link-off'));
    await card.waitFor({ timeout: 60_000 });
    const words = (await card.textContent())?.replace(/\s+/g, ' ') ?? '';
    expect(words).toContain('This link was turned off.');
    expect(words).toContain(`Ask the person who shared ${canvasName} for a new one.`);
    await shot(viewer, 'viewer-link-off');
  });
});

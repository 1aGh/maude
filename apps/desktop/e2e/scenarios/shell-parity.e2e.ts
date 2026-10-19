import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import {
  exists,
  identifyShell,
  Key,
  paletteRows,
  parityTable,
  readSettings,
  type ShellParity,
  tid,
  walkProjectMenu,
} from '../helpers/parity';
import { canEnterCanvasFrame, isNativeShell, openApp, target } from '../helpers/target';
import { canvasRow } from '../helpers/tree';

/**
 * One studio, seven shells — the v2 shell parity contract (V2-4.9).
 *
 * THE SAME FILE runs against the native `.app` and against a cloud URL, and what it checks is a TABLE, not a
 * list of hand-written expectations. `apps/studio/client/v2/shell/shell-parity.json` says, for desktop · local
 * browser · cloud owner / member / viewer · local read-only link · embed, which chrome exists and, for every
 * absence, why. It is derived from the action registry and the shell's own models by
 * `shell-parity.js` and pinned by `test/v2-shell-parity.test.tsx`. This spec identifies the shell it is in
 * (GET /_config + the Tauri global), then walks the live page and asserts the table's present chrome by
 * testid, the menu's rows, Settings' sections, ⌘K's AI-chat row — and every absence.
 *
 *   pnpm test:e2e:desktop:parity          # the bundled .app           → expects `desktop`
 *   pnpm test:e2e:desktop:parity:cloud    # a cell — local stand-in    → expects `cloud-viewer`
 *                                         #   (MAUDE_E2E_PARITY_ROLE=owner|member|viewer picks the role the
 *                                         #   stand-in vouches; MAUDE_E2E_CLOUD_URL points at a real one)
 *
 * `MAUDE_E2E_PARITY_SHELL` (set by wdio.parity.conf.ts) names the shell the run is MEANT to be in; a run that
 * quietly fell back to another one says so instead of passing against the wrong column.
 *
 * What legitimately differs lives in `helpers/target.ts` behind a name; what differs by SHELL lives in the
 * table. Anything else is a parity assertion, and a difference is a bug.
 */
/** expect() here takes no message: a labelled pair makes the failing assertion say what it was about. */
const eq = (label: string, actual: unknown, expected: unknown) =>
  expect({ label, actual }).toEqual({ label, actual: expected });

describe(`shell parity (${target()})`, () => {
  let shell: ShellParity;
  const table = parityTable();
  const part = (name: string) => shell.parts[name];

  before(() => startReport(`shell-parity-${target()}`));

  it('identifies the shell it is in, and it is the one this run is meant for', async () => {
    const url = await openApp();
    expect(url).toBeTruthy();
    await capture('app-open');

    // The one thing that legitimately differs at this level: the desktop is a native shell, the cloud is a
    // tab. Asserted rather than assumed, so a run that silently fell back to the wrong target says so.
    expect(await isNativeShell()).toBe(target() === 'native');

    const found = await identifyShell(table);
    eq('the page matches one of the table’s shells', found !== null, true);
    shell = found as ShellParity;
    const meant = process.env.MAUDE_E2E_PARITY_SHELL;
    if (meant) expect(shell.id).toBe(meant);
    console.log(`shell parity: ${shell.id} — ${shell.label}`);
  });

  it('draws the project pill, the Share cluster, the mode switch and the left panel the table lists', async () => {
    await openApp();
    // the shared chrome — every shell with a pill
    for (const name of ['project-pill', 'share-cluster', 'left-panel', 'mode-switch']) {
      eq(`table: ${name} is present`, part(name).present, true);
      for (const testId of part(name).testids ?? []) {
        const el = await $(tid(testId));
        await el.waitForExist({ timeout: 60_000 });
        eq(`${shell.id}: ${testId} on screen`, await el.isExisting(), true);
      }
    }
    // Share OR Ask to edit, never both: a read-only session says what it can do instead of offering to share
    const asks = part('share-cluster').action === 'Ask to edit';
    expect(await $(tid('share-cluster-ask')).isExisting()).toBe(asks);
    expect(await $(tid('share-cluster-share')).isExisting()).toBe(!asks);
    await capture('chrome-present');
  });

  it('has no tab strip or Home inside a project page unless the table says so — the strip is its own webview', async () => {
    await openApp();
    // The strip is a separate webview (V2-3.7): a project page never contains a `tab-*` element, in any shell.
    const tabs = await browser.execute(
      () => document.querySelectorAll('[data-testid^="tab-"]').length
    );
    eq('the project page holds no tab strip', tabs, 0);
    eq('only the desktop has window tabs', part('window-tabs').present, shell.id === 'desktop');
  });

  it('opens a canvas and renders THAT canvas', async () => {
    await openApp();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();

    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 30_000 });
    expect(await frame.getAttribute('data-path')).toBe('.design/ui/Smoke.tsx');
    await capture('canvas-open');

    // The canvas iframe's own DOM is reachable only on the desktop: a cell serves canvases from a
    // per-project canvas origin, which is DDR-054 doing its job. Stated here rather than skipped
    // mysteriously. (So the toolbars — they live in that iframe — are pinned by the studio-side table test.)
    expect(canEnterCanvasFrame()).toBe(target() === 'native');
  });

  it('lets a reader OPEN the Inspector — C1', async () => {
    // "Read-only means cannot change, not cannot see." The table says every shell with chrome has an
    // Inspector; a reader's is read-only. ⌘⇧I is the key, and it must work for a reader too.
    await openApp();
    expect(part('inspector').present).toBe(true);
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });

    await browser.keys([Key.Command, Key.Shift, 'i']); // ⌘⇧I
    const inspector = await $('[data-testid="inspector-panel"]');
    await inspector.waitForExist({ timeout: 10_000 });
    expect(await inspector.isExisting()).toBe(true);
    await capture('inspector-open');
  });

  it('offers exactly the menu rows the table lists — and "Back to Home" goes where the table says', async () => {
    await openApp();
    const { top, rows } = await walkProjectMenu();
    const menu = part('menu') as unknown as { top: string[]; rows: string[] };
    const conditional = Object.keys(table.conditional);

    // nothing the table does not list
    const extra = rows.filter((r) => !menu.rows.includes(r));
    eq(`${shell.id}: rows the table does not list`, extra, []);
    // everything it lists, bar the rows that depend on state the fixture does not have (a linked project,
    // a signed-in account, a dashboard address)
    const missing = menu.rows.filter((r) => !conditional.includes(r) && !rows.includes(r));
    eq(`${shell.id}: rows the table lists but the menu lacks`, missing, []);
    // the pill menu's own level, in order (a conditional row may be missing; the rest keep their places)
    expect(top.filter((t) => !conditional.includes(t))).toEqual(
      menu.top.filter((t) => !conditional.includes(t))
    );

    // "Back to Home": present exactly where the table says (a cloud tab without a dashboard may omit it)
    const home = part('back-to-home');
    if (!home.present) expect(rows).not.toContain('nav.home');
    await capture('menu-walked');
  });

  it('says where the server runs — "Runs in the cloud" in a cloud tab, a process word on a Mac (S11.15, 06 ad-edge-where)', async () => {
    await openApp();
    await (await $(tid('project-pill'))).click();
    await (await $(tid('project-menu'))).waitForExist({ timeout: 10_000 });
    const read = (await browser.executeAsync((done: (v: unknown) => void) => {
      const sub = document.querySelector(
        '[data-testid="project-menu"] [data-sub="Diagnostics"]'
      ) as HTMLElement | null;
      sub?.click();
      setTimeout(() => {
        const text = (id: string) =>
          document.querySelector(`[data-action="${id}"]`)?.textContent?.trim() ?? null;
        done({
          server: text('diag.server'),
          // the three Advanced values of a process a cloud tab does not run
          address: text('diag.address'),
        });
      }, 150);
    })) as { server: string | null; address: string | null };
    const cloud = Boolean(shell.by.cloudRole);
    eq(`${shell.id}: the Server row`, (read.server ?? '').includes('Runs in the cloud'), cloud);
    // the rows the matrix swaps for that word are not offered in a cloud tab (they sit under Advanced, so a
    // closed submenu may not draw them on a Mac either: only the cloud half is a hard claim)
    if (cloud) eq(`${shell.id}: no Address row`, read.address, null);
    for (let i = 0; i < 4; i++) {
      if (!(await (await $(tid('project-menu'))).isExisting())) break;
      await browser.keys([Key.Escape]);
      await browser.pause(80);
    }
  });

  it('opens Settings with the sections the table lists — a reader gets General, never the Mac’s', async () => {
    await openApp();
    const settings = part('settings') as unknown as {
      sections: string[];
      rows: Array<{ testid: string; section: string; conditional?: boolean }>;
    };
    const { tabs, generalTestids } = await readSettings();
    expect(tabs).toEqual(settings.sections);
    for (const r of settings.rows.filter((x) => x.section === 'general' && !x.conditional)) {
      const prefix = r.testid.split('<')[0];
      eq(
        `${shell.id}: General row ${r.testid}`,
        generalTestids.some((g) => g.startsWith(prefix)),
        true
      );
    }
    await capture('settings-sections');
  });

  it('opens Settings with ⌘, in a read-only session too (it used to be swallowed)', async () => {
    await openApp();
    if (!shell.by.readOnly) return; // an owner's ⌘, is covered by the menu route above and by the key tests
    await (await $(tid('project-pill'))).click(); // focus the chrome, not the canvas
    await browser.keys([Key.Escape]);
    await browser.keys([Key.Command, ',']);
    await (await $(tid('settings-sheet'))).waitForExist({ timeout: 10_000 });
    await (await $(tid('settings-close'))).click();
  });

  it('says where the AI chat lives: a plain row on the desktop, a greyed note in a cloud tab, nothing elsewhere', async () => {
    await openApp();
    const chat = part('ai-chat');
    const rows = (await paletteRows('AI chat')).filter((r) => r.id === 'action:ai.chat');
    if (chat.present) {
      eq(`${shell.id}: ⌘K lists AI chat`, rows.length, 1);
      expect(rows[0].dim).toBe(false);
    } else if (chat.search) {
      const s = chat.search as { row: string; disabled: boolean };
      eq(`${shell.id}: ⌘K lists the greyed row`, rows.length, 1);
      expect(rows[0].text).toContain(s.row);
      expect(rows[0].dim).toBe(s.disabled);
    } else {
      eq(`${shell.id}: no AI chat row at all`, rows, []);
    }
    // and the island itself is never mounted where the table says it is absent
    if (!chat.present) expect(await $(tid('ai-chat-header')).isExisting()).toBe(false);
  });

  it('shows the embed nothing but the canvas', async () => {
    // Last: it navigates the page away from the studio shell and back again.
    const embed = table.shells.embed;
    for (const name of Object.keys(embed.parts).filter((n) => n !== 'canvas'))
      eq(`table: embed ${name}`, embed.parts[name].present, false);

    const home = await browser.getUrl();
    const base = home.split('?')[0].split('#')[0];
    await browser.url(`${base}?embed=1&open=ui/Smoke.tsx`);
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector('#root iframe'))),
      { timeout: 60_000, interval: 500, timeoutMsg: 'the embed never framed a canvas' }
    );
    // the chrome the other shells draw is not here
    for (const testId of [
      'project-pill',
      'share-cluster',
      'canvas-list',
      'canvas-search',
      'panel-tab-tree',
      'inspector-panel',
    ])
      eq(`embed: ${testId} is not drawn`, await exists(testId, 500), false);
    // …and the canvas it frames is the read-only one: ro=1 (no editing) and embed=1 (no camera writes)
    const src = (await browser.execute(
      () => document.querySelector('#root iframe')?.getAttribute('src') ?? ''
    )) as string;
    expect(src).toContain('embed=1');
    expect(src).toContain('ro=1');
    await capture('embed');

    await browser.url(home); // leave the app where the next scenario expects it
  });
});

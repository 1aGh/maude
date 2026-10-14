import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import {
  activeTab,
  focusTab,
  handles,
  labels,
  menuState,
  newHomeTab,
  pinCurrentWindow,
  strip,
  waitWindow,
} from '../helpers/windows';

/**
 * V2-3.3 — the Home window (contract V2-1.1 §7 `home.e2e.ts`, decisions 2/3, §5.4).
 *
 *  1. A first launch with an empty app-state opens `home` (no welcome-project sidecar).
 *  2. Opening the two fixture projects from Home opens each as the active tab; Home stays,
 *     pinned (V2-3.7 own tab bar); ⌘T (`new_home_tab`) shows Home again.
 *  3. Home lists both projects' recent canvases, with their pictures.
 *  4. Picking a recent canvas of a CLOSED project opens it as a new tab; Home stays.
 *  5. Opening an OPEN project from Home focuses its existing tab (`opened: 'existing'`,
 *     `shell://opened-existing`) — no second window.
 *  6. A canvas created in an OPEN project shows up on Home without a reload (V2-3.10): the
 *     project server re-indexes, the shell emits `index://changed {pids}`, Home refetches.
 *  7. The File menu follows the active tab (V2-3.9): on Home New Canvas, Show Home and Close
 *     Tab are disabled and New Project / Open Project enabled; on a project all are enabled;
 *     Show Home activates the pinned Home.
 *  8. File ▸ New Project… on Home opens Home's create sheet, and the new project opens as the
 *     active tab (it did nothing before V2-3.9).
 *
 * Fixtures: wdio.home.conf.ts → fixtures/seed-home-index.ts.
 */
interface Fixture {
  name: string;
  root: string;
  pid: string;
  rel: string;
}
const FIXTURES = JSON.parse(process.env.MAUDE_E2E_HOME_FIXTURES ?? '[]') as Fixture[];
const [ALPHA, BETA] = FIXTURES;
const KEY: Record<string, string> = { alpha: 'a'.repeat(64), beta: 'b'.repeat(64) };
const HOME = 'home';
const tid = (s: string) => `[data-testid="${s}"]`;
const slug = (rel: string) =>
  rel
    .replace(/\.(tsx|jsx|html)$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
const rowId = (f: Fixture) => `home-recent-row-${f.pid}-${slug(f.rel)}`;
const label = (f: Fixture) => `p-${f.pid}`;

/** Select a tab once it has left the splash for its server — a script running across
 *  that navigate dies with a bare "JavaScript exception". */
async function onServer(tab: string): Promise<void> {
  await waitWindow(tab);
  await browser.switchToWindow(tab);
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(
          () => location.protocol === 'http:' && document.readyState === 'complete'
        );
      } catch {
        return false; // mid-navigation
      }
    },
    { timeout: 120_000, interval: 250, timeoutMsg: `${tab} never reached its server` }
  );
  await focusTab(tab);
}

async function onHome(): Promise<void> {
  await onServer(HOME);
  await (await $(tid('home-root'))).waitForDisplayed({ timeout: 90_000 });
}

/** `invoke` that resolves the shell's error text instead of a bare WebDriver exception. */
async function tryInvoke(cmd: string, args: Record<string, unknown> = {}) {
  return browser.execute(
    (c: string, a: Record<string, unknown>) =>
      // biome-ignore lint/suspicious/noExplicitAny: __TAURI__ is an injected global
      (window as any).__TAURI__.core.invoke(c, a).then(
        (ok: unknown) => ({ ok }),
        (err: unknown) => ({ err: String(err) })
      ),
    cmd,
    args
  ) as Promise<{ ok?: unknown; err?: string }>;
}

/** V2-3.7: Home is pinned — it never closes — and `tab` is the one shown. */
async function homeStaysAnd(tab: string): Promise<void> {
  expect(await handles()).toContain(HOME);
  await browser.waitUntil(async () => (await activeTab()) === tab, {
    timeout: 10_000,
    timeoutMsg: `${tab} is not the active tab (active: ${await activeTab()})`,
  });
}

/** `open_project({root})` from Home: the project opens as the active tab, Home stays. */
async function openFromHome(f: Fixture): Promise<unknown> {
  await onHome();
  const r = await tryInvoke('open_project', { root: f.root });
  console.log(`[home] open_project(${f.name}) → ${JSON.stringify(r)}`);
  await waitWindow(label(f));
  await homeStaysAnd(label(f));
  await onServer(label(f));
  return r.ok ?? r;
}

async function hasPicture(id: string): Promise<boolean> {
  return browser.execute((sel: string) => {
    const img = document.querySelector(sel)?.querySelector('img');
    return !!img && img.complete && img.naturalWidth > 0;
  }, tid(id));
}

/** What the page sees for a row's picture — for the failure message. */
async function pictureState(f: Fixture) {
  return browser.execute(
    async (sel: string, src: string, pid: string) => {
      const img = document.querySelector(sel)?.querySelector('img');
      try {
        // V2-3.6 H1: Home's routes want the page secret, which only home_session() hands out
        type Invoke = (cmd: string) => Promise<{ secret: string }>;
        const w = window as unknown as { __TAURI__: { core: { invoke: Invoke } } };
        const { secret } = await w.__TAURI__.core.invoke('home_session');
        const h = { headers: { 'x-maude-home': secret } };
        const r = await fetch(src, h);
        const i = await fetch(`/_home/index?pids=${pid}`, h);
        const p = (await i.json()).projects?.[0];
        return {
          img: img ? `${img.complete}/${img.naturalWidth}` : null,
          thumb: r.status,
          index: { state: p?.state, cover: p?.canvases?.[0]?.cover ?? null },
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
    tid(rowId(f)),
    `/_home/thumb/${f.pid}/${KEY[f.name]}.jpg`,
    f.pid
  );
}

describe('home (native-desktop)', () => {
  before(async () => {
    startReport('home (native-desktop)');
    expect(FIXTURES.length).toBe(2);
    await browser.setTimeout({ script: 60_000 });
    const first = await pinCurrentWindow();
    console.log(`[home] boot window ${first}; handles ${JSON.stringify(await labels())}`);
  });

  it('1 · a first launch with an empty app-state opens the Home window', async () => {
    expect(await labels()).toEqual([]);
    expect(await handles()).toEqual([HOME, 'strip']);
    // The strip: no project tab, Home pinned icon-only.
    const s = await strip();
    expect(s.tabs).toEqual([]);
    expect(s.home).toEqual({ label: 'Home', text: '' });
    expect(s.active).toBe(HOME);
    await onHome();
    expect(await browser.getUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    // Home commands answer here (the runtime `home` capability + the Rust re-check).
    const st = await tryInvoke('shell_state');
    expect(st.ok).toMatchObject({ projects: [], recent: [] });
    await capture('01-home-first-launch');
  });

  it('2 · opening a project from Home opens it as the active tab; Home stays pinned', async () => {
    expect(await openFromHome(ALPHA)).toEqual({ label: label(ALPHA), opened: 'new' });
    expect(await labels()).toEqual([label(ALPHA)]);
    await newHomeTab();
    await homeStaysAnd(HOME);
    expect(await openFromHome(BETA)).toEqual({ label: label(BETA), opened: 'new' });
    expect((await labels()).sort()).toEqual([label(ALPHA), label(BETA)].sort());
    // Strip order is open order (Home opened both → each at the end); Home is not a tab.
    const s = await strip();
    expect(s.tabs).toEqual([label(ALPHA), label(BETA)]);
    expect(s.active).toBe(label(BETA));
    // A project window may not read Home's state (capability + label/origin re-check).
    expect((await tryInvoke('shell_state')).err).toBeTruthy();
    await newHomeTab();
    await onHome();
    await capture('02-home-back');
  });

  it('3 · Home lists both projects’ recent canvases, with pictures', async () => {
    for (const f of [ALPHA, BETA]) {
      await (await $(tid(rowId(f)))).waitForDisplayed({ timeout: 60_000 });
      try {
        await browser.waitUntil(() => hasPicture(rowId(f)), { timeout: 30_000 });
      } catch {
        throw new Error(`${rowId(f)} shows no picture: ${JSON.stringify(await pictureState(f))}`);
      }
    }
    await capture('03-home-recent-rows');
  });

  it('4 · picking a closed project’s canvas opens it as a new tab; Home stays', async () => {
    await invokeTauri('e2e_close_window', { label: label(ALPHA), destroy: false });
    await waitWindow(label(ALPHA), false);
    await onHome();
    await (await $(tid(rowId(ALPHA)))).click();
    await waitWindow(label(ALPHA), true, 30_000);
    await homeStaysAnd(label(ALPHA));
    await onServer(label(ALPHA));
    expect((await labels()).sort()).toEqual([label(ALPHA), label(BETA)].sort());
    await capture('04-picked-closed-project');
  });

  it('5 · opening an open project from Home focuses its tab instead of opening another', async () => {
    await newHomeTab();
    await onHome();
    const r = await tryInvoke('open_project', { pid: ALPHA.pid });
    expect(r).toEqual({ ok: { label: label(ALPHA), opened: 'existing' } });
    await homeStaysAnd(label(ALPHA));
    await onServer(label(ALPHA));
    expect((await labels()).sort()).toEqual([label(ALPHA), label(BETA)].sort());
    await capture('05-open-project-focused');
  });

  it('6 · a new canvas in an open project shows up on Home live, without a reload', async () => {
    // BETA is open (step 2) and running; Home comes back as its own tab.
    expect(await labels()).toContain(label(BETA));
    await newHomeTab();
    await onHome();
    await (await $(tid(rowId(BETA)))).waitForDisplayed({ timeout: 60_000 });
    // A page-lifetime marker: a reload (or a re-navigation) would drop it.
    await browser.execute(() => {
      (window as unknown as { __v2310: number }).__v2310 = 1;
    });

    // Create the canvas on disk, as an agent or an editor would, and say it was opened just
    // now so it lands in Home's Recent list. Home learns of it ONLY through index://changed.
    const rel = 'ui/live-board.tsx';
    const designRoot = join(BETA.root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(
      join(designRoot, rel),
      `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="live" label="Live" width={400} height={300} />
    </DesignCanvas>
  );
}
`
    );
    const recentFile = join(designRoot, '_canvas-state', '_recent.json');
    const recent = JSON.parse(readFileSync(recentFile, 'utf8')) as {
      opened: Record<string, number>;
    };
    recent.opened[rel] = Date.now() + 60_000;
    writeFileSync(recentFile, JSON.stringify(recent));

    const live: Fixture = { ...BETA, rel };
    await (await $(tid(rowId(live)))).waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: `${rowId(live)} never appeared on Home (index://changed not delivered?)`,
    });
    expect(await browser.execute(() => (window as unknown as { __v2310?: number }).__v2310)).toBe(
      1
    );
    await capture('06-home-live-new-canvas');
  });

  it('7 · the menu follows the active tab; Show Home activates the pinned Home', async () => {
    await newHomeTab();
    await onHome();
    const onHomeMenu = await menuState();
    expect(onHomeMenu.active).toBe(HOME);
    expect(onHomeMenu.enabled).toEqual({
      new_canvas: false,
      new_project: true,
      open_project_folder: true,
      show_home: false,
      close_tab: false,
      next_tab: true,
      prev_tab: true,
    });
    // A project tab: everything on.
    const onProject = await menuState('select_tab_1');
    expect(onProject.active).toMatch(/^p-/);
    expect(Object.values(onProject.enabled).every((v) => v === true)).toBe(true);
    // Show Home (⌘T) from the project: Home is active again, and Show Home is off.
    const back = await menuState('show_home');
    expect(back.active).toBe(HOME);
    expect(back.enabled.show_home).toBe(false);
    expect(await activeTab()).toBe(HOME);
    // Close Tab on Home does nothing: Home never closes, no tab is lost.
    const tabs = await labels();
    await menuState('close_tab');
    expect(await labels()).toEqual(tabs);
    expect(await activeTab()).toBe(HOME);
    await capture('07-menu-on-home');
  });

  it('8 · New Project… on Home opens the create sheet; the new project opens as the active tab', async () => {
    await onHome();
    const before = await labels();
    await menuState('new_project');
    await browser.switchToWindow(HOME);
    await (await $(tid('home-create-dialog'))).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: 'File ▸ New Project… did nothing on Home',
    });
    await (await $(tid('home-create-name'))).setValue('Relaunch plakaty');
    await (await $(tid('home-create-submit'))).click();
    await browser.waitUntil(async () => (await labels()).length === before.length + 1, {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: 'no new project tab after Create project',
    });
    const created = (await labels()).find((l) => !before.includes(l)) as string;
    await browser.waitUntil(async () => (await activeTab()) === created, { timeout: 10_000 });
    // A tab opened from Home goes at the end of the strip (Home has no place in it).
    await browser.waitUntil(async () => (await strip()).tabs.at(-1) === created, {
      timeout: 5_000,
      timeoutMsg: `the new project is not the last strip tab: ${JSON.stringify((await strip()).tabs)}`,
    });
    await capture('08-new-project-from-home');
  });
});

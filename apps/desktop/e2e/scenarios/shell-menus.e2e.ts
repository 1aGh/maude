import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { menuState, pinCurrentWindow } from '../helpers/windows';

/**
 * 06 Advanced · ad-menus — "The menu holds what the menu bar showed — File, View › Advanced, Help … Six menus
 * became one; nothing fell off." Two halves, because there are two menus:
 *
 *   in-app   the Menu under the project pill (CONTRACT §1): every row the board draws for Menu, File, View (+ its
 *            Advanced group) and Help is on the live menu, in the board's order, with the board's keys
 *   native   the Mac's menu bar (menu.rs, built from `menu.actions.json`, generated from the action registry): the
 *            bar AppKit actually shows has exactly the generated menus and rows — id, words, enabled for the role
 *
 * Board text is the spec (CONTRACT wins where they differ — the live menu may hold MORE rows than the board draws for
 * a project state the board does not show, never fewer).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, '../../src-tauri/menu.actions.json');
const tid = (s: string) => `[data-testid="${s}"]`;

type Row = { label: string; keys: string };
/** [label, keys] — the 06 Advanced board's MenusBoard lists. */
const BOARD: Record<string, [string, string][]> = {
  Menu: [
    ['Back to Home', ''],
    ['File', ''],
    ['Edit', ''],
    ['View', ''],
    ['Help', ''],
    ['Version history', '⌥⌘H'],
    ['Share…', ''],
    ['Export…', '⇧⌘E'],
    ['Diagnostics', ''],
    ['Settings…', '⌘,'],
  ],
  File: [
    ['New canvas', '⌘N'],
    ['New project…', '⇧⌘N'],
    ['Open project…', '⌘O'],
    ['Duplicate canvas', ''],
    ['Rename canvas', ''],
    ['Move to…', ''],
    ['Import from Figma…', ''],
    ['Import a brand…', ''],
    ['Assemble clips into a video', ''],
    ['Export…', '⇧⌘E'],
    ['Handoff to production', '⇧⌘H'],
    ['Close canvas', ''],
  ],
  View: [
    ['Hide panels', '⌘\\'],
    ['Comments', '⇧⌘M'],
    ['Assets', ''],
    ['Annotations', '⇧P'],
    ['Present the canvas', ''],
    ['Zoom in', '⌘+'],
    ['Zoom out', '⌘−'],
    ['Zoom to fit', '⌘0'],
    ['Actual size', '⇧0'], // the board draws ⌘1; V2-3.11 gave ⌘1..⌘8 to the tabs (actions/defs/native.ts), so Actual size is ⇧0
    ['Advanced', ''],
  ],
  'View › Advanced': [
    ['Layers as a panel', ''],
    ['Inspector', '⇧⌘I'],
    ['Open inspector on select', ''],
    ['Keep timeline open', '⇧⌘T'],
    ['Minimap', ''],
    ['Zoom controls', ''],
    ['Print guides', ''],
    ['Hidden files', ''],
    ['Pin panels to the side', ''],
  ],
  Help: [
    ['Keyboard shortcuts', '?'],
    ['Help and guides', 'F1'],
    ["What's new", ''],
    ['Take the tour', ''],
    ['Watch the intro', ''],
    ['How sharing works', ''],
    ['Report a bug…', ''],
  ],
};

const norm = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/…/g, '...').trim().toLowerCase();

/** The rows the open menu draws right now: the words, then the key chip (the two are glued in `getText`). */
async function rows(): Promise<Row[]> {
  const texts = (await browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="project-menu-row-"]')).map((el) =>
      (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
  )) as string[];
  return (
    texts
      .filter(Boolean)
      // keys start with a modifier glyph, or are F1 / ? (a label never ends in either)
      .map((t) => {
        const m = /^(.*?)((?:[⌘⇧⌥⌃]+\S*)|F\d{1,2}|\?)?$/.exec(t) as RegExpExecArray;
        return { label: (m[1] ?? t).trim(), keys: m[2] ?? '' };
      })
  );
}

/** Every board row is on the live list, in the board's order, with its keys. */
function expectRows(where: string, live: Row[], want: [string, string][]) {
  let at = -1;
  const missing: string[] = [];
  for (const [label, keys] of want) {
    const i = live.findIndex((r, ix) => ix > at && norm(r.label).startsWith(norm(label)));
    if (i < 0) {
      missing.push(label);
      continue;
    }
    at = i;
    if (keys) expect([where, label, live[i]?.keys]).toEqual([where, label, keys]);
  }
  if (missing.length)
    throw new Error(
      `${where}: board rows missing/out of order: ${missing.join(' · ')}\nlive: ${live.map((r) => `${r.label}${r.keys ? ` [${r.keys}]` : ''}`).join(' | ')}`
    );
}

async function openMenu() {
  const pill = await $(tid('project-pill'));
  await pill.waitForDisplayed({ timeout: 30_000 });
  await pill.click();
  await $(tid('project-menu')).waitForDisplayed({ timeout: 8_000 });
}
async function closeMenu() {
  await browser.keys('Escape');
  await browser
    .waitUntil(async () => !(await $(tid('project-menu')).isDisplayed()), {
      timeout: 4_000,
      interval: 100,
    })
    .catch(() => undefined);
}

describe('shell-menus (06 ad-menus)', () => {
  before(async () => {
    startReport('shell-menus');
    await waitForSidecar();
    await pinCurrentWindow();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
  });

  it('the in-app Menu, File, View › Advanced and Help hold every row the board draws', async () => {
    await openMenu();
    expectRows('Menu', await rows(), BOARD.Menu as [string, string][]);
    await capture('menu top level');
    for (const sub of ['File', 'View', 'Help']) {
      await (await $(tid(`project-menu-row-sub-${sub.toLowerCase()}`))).click();
      await browser.pause(250);
      expectRows(sub, await rows(), BOARD[sub] as [string, string][]);
      if (sub === 'View') {
        await (await $(tid('project-menu-row-sub-advanced'))).click();
        await browser.pause(250);
        expectRows('View › Advanced', await rows(), BOARD['View › Advanced'] as [string, string][]);
        await capture('menu view advanced');
      } else {
        await capture(`menu ${sub.toLowerCase()}`);
      }
      await browser.keys('Escape'); // one level back
      await browser.pause(150);
    }
    await closeMenu();
  });

  it('the Mac menu bar is what menu.actions.json (the registry) says — titles, rows, words, enablement', async () => {
    const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as {
      menus: { title: string; items: { kind: string; id?: string; label?: string }[] }[];
    };
    const state = (await menuState()) as unknown as {
      bar: {
        title: string;
        items: { id?: string; text?: string; enabled?: boolean; predefined?: string }[];
      }[];
    };
    expect(Array.isArray(state.bar)).toBe(true);
    const live = state.bar.map((m) => m.title);
    // every generated menu is on the bar, in the generated order (AppKit may add its own, e.g. View)
    let at = -1;
    for (const m of spec.menus) {
      const i = live.findIndex((t, ix) => ix > at && t === m.title);
      expect([m.title, i >= 0]).toEqual([m.title, true]);
      at = i;
      const bar = state.bar[i] as (typeof state.bar)[number];
      const wantItems = m.items.filter((it) => it.kind === 'item');
      // `quit` is the app's own Quit (S5.14: asks first while AI works), added beside the generated rows
      const liveItems = bar.items.filter((it) => it.id !== undefined && it.id !== 'quit');
      if (m.title === 'Maude')
        expect(bar.items.find((it) => it.id === 'quit')?.text).toBe('Quit Maude');
      // the rows with an id are exactly the generated ones: same ids, same order, same words
      expect(liveItems.map((it) => [it.id, it.text])).toEqual(
        wantItems.map((it) => [it.id, it.label])
      );
    }
    // File is the registry's File: New Canvas, New Project…, Open Project…, Show Home, Close Tab
    const file = state.bar.find((m) => m.title === 'File')?.items.filter((it) => it.id) ?? [];
    expect(file.map((it) => it.text)).toEqual([
      'New Canvas',
      'New Project…',
      'Open Project…',
      'Show Home',
      'Close Tab',
    ]);
    await capture('native bar read');
  });
});

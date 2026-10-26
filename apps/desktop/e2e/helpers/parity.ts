// The v2 shell parity contract, as the e2e reads it — V2-4.9.
//
// `apps/studio/client/v2/shell/shell-parity.js` derives, for each of the seven shells (desktop · browser ·
// cloud owner / member / viewer · local read-only link · embed), which chrome exists and, for every absence,
// why. `scripts/gen-shell-parity.mjs` commits it as `shell-parity.json`, because a wdio spec cannot import
// the client's TypeScript/JSX graph; `test/v2-shell-parity.test.tsx` keeps the file honest against the
// models and the rendered components. This helper is the other half: it works out WHICH shell the spec is
// running in and walks the live page for what the table says.
//
// Nothing here knows a shell by name outside the table. A new part of the chrome is a new row in the JSON.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser } from '@wdio/globals';
import { isNativeShell } from './target';

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE = join(HERE, '../../../studio/client/v2/shell/shell-parity.json');

export interface Part {
  present: boolean;
  why?: string;
  testids?: string[];
  [k: string]: unknown;
}
export interface ShellParity {
  id: string;
  label: string;
  surface: string;
  by: { native?: boolean; cloudRole?: string | null; readOnly?: boolean; embed?: boolean };
  parts: Record<string, Part>;
}
export interface ParityTable {
  schema: string;
  conditional: Record<string, string>;
  menuRows: { all: string[]; trails: Record<string, string[]> };
  shells: Record<string, ShellParity>;
}

export function parityTable(): ParityTable {
  return JSON.parse(readFileSync(TABLE, 'utf8')) as ParityTable;
}

export const tid = (id: string) => `[data-testid="${id}"]`;

/** WebDriver's key codes (the values of webdriverio's `Key`), so the spec needs no import that only resolves
 *  through a transitive dependency. */
export const Key = { Command: '\uE03D', Shift: '\uE008', Escape: '\uE00C' } as const;

/** What this page can say about itself: GET /_config (cloud.role, readOnly) and the Tauri global. */
export async function describeShell(): Promise<{
  native: boolean;
  cloudRole: string | null;
  readOnly: boolean;
}> {
  const native = await isNativeShell();
  const cfg = (await browser.executeAsync((done: (v: unknown) => void) => {
    fetch('/_config', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => done(j))
      .catch(() => done(null));
  })) as { cloud?: { role?: string | null } | null; readOnly?: boolean } | null;
  if (!cfg) throw new Error('GET /_config did not answer — the shell cannot be identified');
  const role = cfg.cloud ? (cfg.cloud.role ?? 'owner') : null;
  return {
    native,
    cloudRole: role === 'observer' ? 'viewer' : role,
    readOnly: !!cfg.readOnly,
  };
}

/** The table's shell for what the page says — or null when no shell matches (a bug in itself). */
export async function identifyShell(table = parityTable()): Promise<ShellParity | null> {
  const me = await describeShell();
  const hit = Object.values(table.shells).find((s) => {
    if (s.by.embed) return false;
    if (!!s.by.native !== me.native) return false;
    if ((s.by.cloudRole ?? null) !== me.cloudRole) return false;
    // a cloud shell is told apart by its role; a local one by the read-only flag
    return me.cloudRole ? true : !!s.by.readOnly === me.readOnly;
  });
  return hit ?? null;
}

/** Wait for a data-testid and say whether it is there. */
export async function exists(testId: string, timeout = 2_000): Promise<boolean> {
  const el = await $(tid(testId));
  try {
    await el.waitForExist({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Every row the project menu offers, found by opening every submenu. `top` is the pill menu's own level
 *  in order: an action id, or `sub-<slug>` for a submenu. Leaves the menu closed. */
export async function walkProjectMenu(): Promise<{ top: string[]; rows: string[] }> {
  await (await $(tid('project-pill'))).click();
  await (await $(tid('project-menu'))).waitForExist({ timeout: 10_000 });
  const out = (await browser.executeAsync((done: (v: unknown) => void) => {
    const slug = (s: string) =>
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const rows = new Set<string>();
    const top: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const ROOT = '[data-testid="project-menu"]';
    const items = (menu: Element) =>
      Array.from(menu.querySelectorAll(':scope > [role=none] > [role^=menuitem]')) as HTMLElement[];
    // The menu closes when the WINDOW loses focus (project-pill.jsx: a click into the canvas iframe) — and on a
    // shared desktop another app can take the focus mid-walk (r7/a2: the walk lost every submenu after Edit). So
    // each level is reached again from the pill by its path of submenu names, re-opening the menu if it closed.
    async function openPath(path: string[]): Promise<Element | null> {
      for (let t = 0; t < 12; t++) {
        let menu: Element | null = document.querySelector(ROOT);
        if (!menu) {
          (document.querySelector('[data-testid="project-pill"]') as HTMLElement | null)?.click();
          await wait(120);
          continue;
        }
        for (const label of path) {
          const here: Element = menu;
          const b: HTMLElement | undefined = items(here).find(
            (x) => x.getAttribute('data-sub') === label
          );
          if (!b) {
            menu = null;
            break;
          }
          if (b.getAttribute('aria-expanded') !== 'true') b.click();
          let child: Element | null | undefined = null;
          for (let u = 0; u < 6 && !child; u++) {
            child = b.parentElement?.querySelector(':scope > [role=menu]');
            if (!child) await wait(80);
          }
          menu = child ?? null;
          if (!menu) break;
        }
        if (menu) return menu;
        await wait(80);
      }
      return null;
    }
    async function walk(path: string[]): Promise<void> {
      const menu = await openPath(path);
      if (!menu) return;
      const subs: string[] = [];
      for (const b of items(menu)) {
        const act = b.getAttribute('data-action');
        const sub = b.getAttribute('data-sub');
        if (act) rows.add(act);
        if (path.length === 0) top.push(act ?? `sub-${slug(sub ?? '')}`);
        if (sub) subs.push(sub);
      }
      for (const sub of subs) await walk([...path, sub]);
    }
    if (!document.querySelector(ROOT)) return done({ top, rows: [] });
    walk([]).then(() => done({ top, rows: [...rows] }));
  })) as { top: string[]; rows: string[] };
  await closeProjectMenu();
  return out;
}

/** Esc steps back one level (a submenu first, then the menu — WAI-ARIA, V2-4 gate polish-b): press
 *  it until the menu is gone, so the next pill click opens the menu instead of closing it. */
async function closeProjectMenu(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await (await $(tid('project-menu'))).isExisting())) return;
    await browser.keys([Key.Escape]);
    await browser.pause(80);
  }
}

/** Settings via the menu (the one way every shell has), the section tabs read, and the sheet closed again. */
export async function readSettings(): Promise<{ tabs: string[]; generalTestids: string[] }> {
  await closeProjectMenu();
  await (await $(tid('project-pill'))).click();
  const row = await $(tid('project-menu-row-settings.open'));
  await row.waitForDisplayed({ timeout: 10_000 });
  await row.click();
  await (await $(tid('settings-sheet'))).waitForExist({ timeout: 10_000 });
  const tabs = (await browser.execute(() =>
    Array.from(document.querySelectorAll('[role="tab"][data-testid^="settings-tab-"]')).map((t) =>
      (t.getAttribute('data-testid') ?? '').replace('settings-tab-', '')
    )
  )) as string[];
  const generalTestids = (await browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-testid="settings-panel-general"] [data-testid]')
    ).map((t) => t.getAttribute('data-testid') ?? '')
  )) as string[];
  await closeSettings();
  return { tabs, generalTestids };
}

/** Esc closes the sheet (06 draws no Done: `settings-close` is clipped to 1 px until it takes keyboard focus, so a
 *  browser that hit-tests a click — Chrome in the cloud run — refuses it as covered by the rail). */
export async function closeSettings(): Promise<void> {
  await browser.keys([Key.Escape]);
  await (await $(tid('settings-sheet'))).waitForExist({ reverse: true, timeout: 10_000 });
}

/** ⌘K, one query typed, the matching palette rows' text and whether they are greyed. */
export async function paletteRows(
  query: string
): Promise<Array<{ id: string; text: string; dim: boolean }>> {
  await browser.keys([Key.Command, 'k']);
  const input = await $(tid('palette-input'));
  await input.waitForExist({ timeout: 10_000 });
  await input.setValue(query);
  await browser.pause(400);
  const rows = (await browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="palette-row-"]')).map((el) => ({
      id: (el.getAttribute('data-testid') ?? '').replace('palette-row-', ''),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      dim: el.classList.contains('is-dim'),
    }))
  )) as Array<{ id: string; text: string; dim: boolean }>;
  await browser.keys([Key.Escape]);
  return rows;
}

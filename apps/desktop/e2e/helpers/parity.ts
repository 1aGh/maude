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
    async function level(menu: Element, depth: number): Promise<void> {
      const btns = Array.from(
        menu.querySelectorAll(':scope > [role=none] > [role^=menuitem]')
      ) as HTMLElement[];
      for (const b of btns) {
        const act = b.getAttribute('data-action');
        const sub = b.getAttribute('data-sub');
        if (act) rows.add(act);
        if (depth === 0) top.push(act ?? `sub-${slug(sub ?? '')}`);
      }
      for (const b of btns) {
        if (!b.getAttribute('data-sub')) continue;
        b.click();
        // a submenu renders on the next frames — on screen (WKWebView in front) that can be well past 80 ms, and a
        // nested one (Help ▸ Diagnostics) was then read as empty: wait for it, up to a second
        let child: Element | null | undefined = null;
        for (let i = 0; i < 25 && !child; i++) {
          await wait(40);
          child = b.parentElement?.querySelector(':scope > [role=menu]');
        }
        if (child) await level(child, depth + 1);
      }
    }
    const root = document.querySelector('[data-testid="project-menu"]');
    if (!root) return done({ top, rows: [] });
    level(root, 0).then(() => done({ top, rows: [...rows] }));
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
  await (await $(tid('settings-close'))).click();
  await (await $(tid('settings-sheet'))).waitForExist({ reverse: true, timeout: 10_000 });
  return { tabs, generalTestids };
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

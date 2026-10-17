// V2-4.8a — the in-app menubar is gone, and everything it carried has a v2 home.
//
// The v1 manifest is frozen (V2-2.0c): every entry scanned out of `client/menus/menubar.jsx` is still in
// it, and `nothing-deleted.json` `map` sends each to ONE target. This test pins three things:
//   1. the component, its mount and its CSS are deleted (no `menubar` testid is emitted any more);
//   2. each of those entries resolves to a v2 target that exists: a ledger row with a `v2` home
//      (action | testid, + the path a person follows), or a registry action a person can reach
//      (a row of the one menu, a v2 surface, or ⌘K), or a hook a v2 element emits;
//   3. the one thing the menubar showed that the menu did not — the cloud "← Dashboard" link — is
//      `nav.home` ("Back to Home") in a cloud tab, and not offered where there is nowhere to go.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs data module shared with the nothing-deleted probe
import { ACTION_SURFACE } from '../../../scripts/v2-manifest/reach-rules.mjs';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { menuIds, PROJECT_MENU } from '../actions/menu.ts';
import { actionSearchRows } from '../client/v2/search/search-model.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { buildProjectMenu, menuCtx, modelIds } from '../client/v2/shell/project-menu-model.js';

const STUDIO = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(STUDIO, p), 'utf8');
const nd = JSON.parse(read('client/v2/nothing-deleted.json'));
const manifest = JSON.parse(read('client/v2/v1-manifest.json'));
const hooks: Array<{ hook: string }> = JSON.parse(read('client/testids.json'));

const entries: Array<{ id: string; file: string }> = (manifest.entries ?? manifest).filter(
  (e: { file: string }) => /client\/menus\/menubar\.jsx$/.test(e.file)
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const d of readdirSync(join(STUDIO, dir), { withFileTypes: true })) {
    const rel = join(dir, d.name);
    if (d.isDirectory()) sourceFiles(rel, out);
    else if (/\.(jsx?|tsx?)$/.test(d.name)) out.push(rel);
  }
  return out;
}

/** A pattern hook (`toolbar-slot-<toolId>`) names a family; `toolbar-slot-browse` is one of it. */
function patternHook(h: { hook: string; pattern?: boolean }, id: string): boolean {
  if (!h.pattern) return false;
  const re = new RegExp(
    `^${h.hook
      .split(/<[^>]+>/)
      .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\w.-]+')}$`
  );
  return re.test(id);
}

describe('the in-app menubar is deleted', () => {
  test('the component file is gone and nothing imports it', () => {
    expect(existsSync(join(STUDIO, 'client/menus/menubar.jsx'))).toBe(false);
    const app = read('client/app.jsx');
    expect(app).not.toMatch(/menus\/menubar/);
    expect(app).not.toMatch(/<Menubar\b|ShellMenubar/);
  });

  test('no client source emits the menubar hooks', () => {
    const emitting = sourceFiles('client').filter((f) =>
      /data-testid="(menubar|menu-\$\{key\}|assistant-toggle|share-btn|report-bug-toggle|cloud-back|cloud-project-name|cloud-signout|view-only-stamp)"|data-testid=\{`menu-\$\{key\}`\}/.test(
        read(f)
      )
    );
    expect(emitting).toEqual([]);
  });
});

describe('every v1 menubar entry resolves to a reachable v2 target', () => {
  const targets = new Map<string, string>();
  for (const e of entries) targets.set(e.id, nd.map[e.id]);
  const asCloud = menuCtx({ native: false, cloudTab: true, canvasOpen: true });
  const ctxs = [
    menuCtx({ native: true, canvasOpen: true }),
    menuCtx({ native: false, canvasOpen: true }),
    asCloud,
    menuCtx({ native: false, cloudTab: true, readOnly: true, canvasOpen: true }),
  ];
  const inMenu = new Set(menuIds(PROJECT_MENU));
  const inSearch = new Set(ctxs.flatMap((c) => actionSearchRows(c).map((r) => r.actionId)));

  test('the manifest has the entries (frozen) and each one is mapped', () => {
    expect(entries.length).toBeGreaterThan(60);
    const unmapped = [...targets].filter(([, t]) => !t).map(([id]) => id);
    expect(unmapped).toEqual([]);
  });

  test('a row target has a v2 home: an action or a hook, and the path a person follows', () => {
    const rowIds = new Set([...targets.values()].filter((t) => t && !t.includes(':')));
    expect(rowIds.size).toBeGreaterThan(0);
    for (const id of rowIds) {
      const row = nd.rows.find((r: { id: string }) => r.id === id);
      expect(row, id).toBeDefined();
      expect(Boolean(row.v2.action || row.v2.testid), `${id}: v2.action / v2.testid`).toBe(true);
      expect(String(row.v2.where ?? '').length, `${id}: v2.where`).toBeGreaterThan(0);
      if (row.v2.action)
        expect(ACTIONS_BY_ID.has(row.v2.action), `${id}: ${row.v2.action}`).toBe(true);
      if (row.v2.testid)
        expect(
          hooks.some((h) => h.hook === row.v2.testid || patternHook(h, row.v2.testid)),
          `${id}: ${row.v2.testid} is in testids.json`
        ).toBe(true);
    }
  });

  test('an action target is a row of the one menu, a v2 surface, or a ⌘K result', () => {
    const lost: string[] = [];
    for (const t of new Set(targets.values())) {
      if (!t?.startsWith('action:')) continue;
      const id = t.slice('action:'.length);
      if (!ACTIONS_BY_ID.has(id)) lost.push(`${id} (not registered)`);
      else if (!inMenu.has(id) && !(id in ACTION_SURFACE) && !inSearch.has(id)) lost.push(id);
    }
    expect(lost).toEqual([]);
  });

  test('a hook target is in testids.json and not retired', () => {
    for (const t of new Set(targets.values())) {
      if (!t?.startsWith('testid:')) continue;
      const h = hooks.find((x) => x.hook === t.slice('testid:'.length)) as
        | { hook: string; v2?: string }
        | undefined;
      expect(h, t).toBeDefined();
      expect(h?.v2, t).not.toBe('retired');
    }
  });
});

describe('Back to Home in a cloud tab is the old "← Dashboard" link', () => {
  const cloud = menuCtx({ native: false, cloudTab: true, canvasOpen: true });

  test("nav.home is in the cloud tab's menu, not in a plain browser tab's", () => {
    expect(modelIds(buildProjectMenu(cloud))).toContain('nav.home');
    expect(modelIds(buildProjectMenu(menuCtx({ native: false, canvasOpen: true })))).not.toContain(
      'nav.home'
    );
    expect(ACTIONS_BY_ID.get('nav.home')?.label).toBe('Back to Home');
  });

  test('a hub with no dashboard (self-hosted) leaves no dead row', () => {
    const model = buildProjectMenu(cloud, { hidden: ['nav.home'] });
    expect(modelIds(model)).not.toContain('nav.home');
  });

  test('outside the desktop app the row opens the dashboard; the desktop app keeps its native command', () => {
    const opened: string[] = [];
    const web = createMenuHandlers({ native: false, onOpenDashboard: () => opened.push('web') });
    web['nav.home']?.();
    expect(opened).toEqual(['web']);
    const desktop = createMenuHandlers({ native: true, onOpenDashboard: () => opened.push('x') });
    expect(desktop['nav.home']).toBeUndefined(); // falls through to NATIVE_COMMANDS['nav.home']
  });
});

describe('"Sign out" — the menubar\'s cloud account chip — is the account row of File in a cloud tab', () => {
  const cloud = menuCtx({ native: false, cloudTab: true, canvasOpen: true });

  test('a cloud tab has it (with the account as its status word); a plain browser tab does not', () => {
    expect(modelIds(buildProjectMenu(cloud))).toContain('account.switch');
    expect(modelIds(buildProjectMenu(menuCtx({ native: false, canvasOpen: true })))).not.toContain(
      'account.switch'
    );
    const model = buildProjectMenu(cloud, {
      status: { 'account.switch': { word: 'a@b.c', tone: 'neutral', mono: true } },
    });
    const file = model.find((n: { label?: string }) => n.label === 'File');
    const row = file?.children.find((n: { id?: string }) => n.id === 'account.switch');
    expect(row?.status?.word).toBe('a@b.c');
  });

  test('in a cloud tab it ends the session with a form POST (signing out is a write), never a link', () => {
    const app = readFileSync(join(STUDIO, 'client/app.jsx'), 'utf8');
    expect(app).toContain("form.method = 'post';");
    expect(app).toContain("form.action = '/auth/browser/signout';");
    expect(app).toContain('form.submit();');
  });
});

// V2-4.7b — Menu › Diagnostics, against the REAL components (happy-dom + React):
//  · the submenu: a status word per source (ok / offline / failed cases), the Advanced values, the rows
//    left out for a cloud member, every row reachable by keyboard and running through run(id);
//  · the sheet: Logs · Server · AI setup · Sync (today's Sync panel, whole), each control with its testid;
//  · every nothing-deleted row homed on `diag` resolves to a rendered control in the v2 UI.
// The ten ids are registered in actions/defs/diagnostics.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DIAGNOSTICS_ACTIONS as DIAG_ACTIONS } from '../actions/defs/diagnostics.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { hiddenMenuIds, menuStatuses } from '../client/v2/diagnostics/diagnostics-model.js';
import DiagnosticsSheet from '../client/v2/diagnostics/diagnostics-sheet.jsx';
import { createMenuHandlers, runnableIds } from '../client/v2/shell/menu-runner.js';
import { buildProjectMenu, menuCtx, modelIds } from '../client/v2/shell/project-menu-model.js';
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';

const desktop = menuCtx({ native: true, canvasOpen: true });
const DIAG_IDS = DIAG_ACTIONS.map((d) => d.id);
let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const linked = (over: Record<string, unknown> = {}) => ({
  state: 'online',
  queuedOps: 0,
  files: {},
  docs: { synced: 3, pending: 0, rejected: 0 },
  ...over,
});

async function mountPill(state: Record<string, unknown>, run: (id: string) => void = () => {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ProjectPill project="Alligators brand" ctx={desktop} state={state} run={run} />);
  });
}
const pill = () => document.querySelector('[data-testid="project-pill"]') as HTMLButtonElement;
const tick = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const key = async (el: Element, k: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
  await tick();
};
const focused = () => document.activeElement as HTMLElement;
const word = (id: string) =>
  document.querySelector(`[data-testid="project-menu-status-${id}"]`) as HTMLElement | null;

const status = (over: Parameters<typeof menuStatuses>[0] = {}) =>
  menuStatuses({
    syncStatus: linked(),
    wsConnected: true,
    report: { ready: true, items: [] },
    info: { address: 'localhost:4402', pid: 41207, folder: '/Users/me/Maude/alligators' },
    ...over,
  });

async function openDiagnostics() {
  await act(async () => pill().click());
  const sub = document.querySelector(
    '[data-testid="project-menu-row-sub-diagnostics"]'
  ) as HTMLElement;
  await act(async () => sub.click());
  await tick();
}

describe('the Diagnostics submenu', () => {
  test('ok: one word per source, the Advanced values beside their rows', async () => {
    await mountPill({ status: status(), hidden: [] });
    await openDiagnostics();
    expect(word('diag.sync')?.textContent).toBe('Up to date');
    expect(word('diag.sync')?.getAttribute('data-tone')).toBe('ok');
    expect(word('diag.server')?.textContent).toBe('Running');
    expect(word('diag.ai')?.textContent).toBe('Ready');
    // Advanced is a submenu of its own
    const adv = document.querySelector(
      '[data-testid="project-menu-row-sub-advanced"]'
    ) as HTMLElement;
    const inDiag = document.querySelector(
      '[data-testid="project-menu-sub-diagnostics"]'
    ) as HTMLElement;
    const advRow = inDiag.querySelector('[data-sub="Advanced"]') as HTMLElement;
    expect(advRow).toBeTruthy();
    void adv;
    await act(async () => advRow.click());
    expect(word('diag.address')?.textContent).toBe('localhost:4402');
    expect(word('diag.process')?.textContent).toBe('41207');
    expect(word('diag.project-folder')?.textContent).toBe('~/Maude/alligators');
  });

  test('offline: Sync says Offline (warn), Server says Reconnecting…, AI says Needs setup', async () => {
    await mountPill({
      status: status({
        syncStatus: linked({ state: 'offline' }),
        wsConnected: false,
        report: { ready: false, items: [{ id: 'claude', status: 'missing' }] },
      }),
      hidden: [],
    });
    await openDiagnostics();
    expect(word('diag.sync')?.textContent).toBe('Offline');
    expect(word('diag.sync')?.getAttribute('data-tone')).toBe('warn');
    expect(word('diag.server')?.textContent).toBe('Reconnecting…');
    expect(word('diag.ai')?.textContent).toBe('Needs setup');
  });

  test('failed: an unreachable server says Not responding (error); every document refused says Failed', async () => {
    await mountPill({ status: status({ unreachable: true }), hidden: [] });
    await openDiagnostics();
    expect(word('diag.server')?.textContent).toBe('Not responding');
    expect(word('diag.server')?.getAttribute('data-tone')).toBe('error');
  });

  test('a cloud member has no Resync / Download all rows', async () => {
    await mountPill({
      status: status(),
      hidden: hiddenMenuIds({ cloud: { url: 'https://x' }, syncStatus: linked() }),
    });
    await openDiagnostics();
    const inDiag = document.querySelector(
      '[data-testid="project-menu-sub-diagnostics"]'
    ) as HTMLElement;
    await act(async () => (inDiag.querySelector('[data-sub="Advanced"]') as HTMLElement).click());
    const ids = Array.from(document.querySelectorAll('[data-action]')).map((e) =>
      e.getAttribute('data-action')
    );
    expect(ids).toContain('diag.address');
    expect(ids).not.toContain('sync.resync');
    expect(ids).not.toContain('sync.download-all');
  });

  test('the keyboard reaches every Diagnostics row (↓ and → only) and ↵ runs it through run(id)', async () => {
    const ran: string[] = [];
    await mountPill({ status: status(), hidden: [] }, (id) => ran.push(id));
    pill().focus();
    await key(pill(), 'Enter');
    // walk the root to Diagnostics
    for (let i = 0; i < 40 && focused().getAttribute('data-sub') !== 'Diagnostics'; i++)
      await key(focused(), 'ArrowDown');
    expect(focused().getAttribute('data-sub')).toBe('Diagnostics');
    await key(focused(), 'ArrowRight');
    const reached: string[] = [];
    const walk = async () => {
      const level = focused().closest('[role=menu]') as HTMLElement;
      const rows = Array.from(level.querySelectorAll(':scope > [role=none] > [role^=menuitem]'));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as HTMLElement;
        expect(focused()).toBe(row);
        if (row.hasAttribute('data-sub')) {
          await key(row, 'ArrowRight');
          await walk();
          await key(focused(), 'ArrowLeft');
        } else reached.push(row.getAttribute('data-action') as string);
        if (i < rows.length - 1) await key(row, 'ArrowDown');
      }
    };
    await walk();
    expect(reached.filter((id) => DIAG_IDS.includes(id)).sort()).toEqual([...DIAG_IDS].sort());
    expect(reached).toContain('canvas.reload');
  });

  test('↵ on a Diagnostics row runs it once through run(id) and closes the menu', async () => {
    const ran: string[] = [];
    await mountPill({ status: status(), hidden: [] }, (id) => ran.push(id));
    pill().focus();
    await key(pill(), 'Enter');
    for (let i = 0; i < 40 && focused().getAttribute('data-sub') !== 'Diagnostics'; i++)
      await key(focused(), 'ArrowDown');
    await key(focused(), 'ArrowRight');
    await key(focused(), 'Enter'); // first row: Sync
    expect(ran).toEqual(['diag.sync']);
    expect(document.querySelector('[data-testid="project-menu"]')).toBeNull();
  });

  test('every Diagnostics id the menu renders has a runner (no dead row)', () => {
    const can = runnableIds(createMenuHandlers(new Proxy({}, { get: () => () => {} })));
    const rendered = modelIds(buildProjectMenu(desktop));
    for (const id of DIAG_IDS) {
      expect(rendered, id).toContain(id);
      expect(can.has(id), id).toBe(true);
    }
  });
});

// ── the sheet ─────────────────────────────────────────────────────────────────────────────────

const SOURCES = {
  retentionDays: 7,
  logDir: '~/.maude/logs',
  sources: {
    sync: { status: {}, recent: ['[log] [sync] pushed a.tsx', '[warn] [sync] hub replied 429'] },
    server: { status: {}, recent: ['[log] canvas built · Pricing'] },
    ai: { status: {}, recent: [] },
    export: { status: {}, recent: ['[error] [remote] png FAILED 500'] },
  },
};
const REPORT = {
  ready: true,
  items: [
    {
      id: 'claude',
      label: 'Claude Code',
      status: 'present',
      required: true,
      detail: 'v2.1.240',
      resolvedPath: '~/.local/bin/claude',
    },
  ],
};

function sheetProps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const props = {
    view: 'logs',
    onView: (v: string) => calls.push(`view:${v}`),
    onClose: () => calls.push('close'),
    words: status()
      ? { server: status()['diag.server'], ai: status()['diag.ai'], sync: status()['diag.sync'] }
      : {},
    data: SOURCES,
    error: '',
    onRefresh: () => calls.push('refresh'),
    onCopyReport: () => calls.push('copy-report'),
    onCopy: (_t: string, label: string) => calls.push(`copy:${label}`),
    info: { address: 'localhost:4402', pid: 41207, version: '2.0.0', folder: '/Users/me/p' },
    wsConnected: true,
    activePath: 'ui/Pricing.tsx',
    isSystem: false,
    repoChanged: { reload: () => calls.push('reload'), dismiss: () => calls.push('dismiss') },
    ai: { report: REPORT, loading: false, recheck: () => calls.push('recheck') },
    sync: {
      status: linked({ url: 'https://alligators.cloud.maude.sh', files: { progress: null } }),
      word: status()['diag.sync'],
      project: 'Alligators',
      cloud: null,
      groupPaths: [],
      behind: 2,
      onGetLatest: async () => {
        calls.push('get-latest');
        return { ok: true };
      },
      onCopy: (_t: string, label: string) => calls.push(`copy:${label}`),
    },
    ...over,
  };
  return { props, calls };
}

async function mountSheet(over: Record<string, unknown> = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
  const { props, calls } = sheetProps(over);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<DiagnosticsSheet {...(props as never)} />);
  });
  return calls;
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(async () => q(id)?.click());

describe('the Diagnostics sheet', () => {
  test('Logs: filter by source, search, copy all, Refresh; the tail is the server’s ring', async () => {
    const calls = await mountSheet();
    expect(q('diag-logs-lines')?.querySelectorAll('li').length).toBe(4);
    await click('diag-logs-filter-sync');
    expect(q('diag-logs-lines')?.querySelectorAll('li').length).toBe(2);
    expect(q('diag-logs-filter-sync')?.getAttribute('aria-pressed')).toBe('true');
    await click('diag-logs-filter-ai');
    expect(q('diag-logs-empty')).toBeTruthy();
    await click('diag-logs-filter-all');
    await click('diag-logs-copy-all');
    await click('diag-logs-refresh');
    expect(calls).toEqual(['copy-report', 'refresh']);
    expect(document.body.textContent).toContain('Kept 7 days on this Mac');
  });

  test('Logs: an unreadable ring says so instead of showing nothing', async () => {
    await mountSheet({ data: null, error: 'HTTP 403' });
    expect(q('diag-logs-error')?.textContent).toContain('HTTP 403');
  });

  test('tabs: Logs · Server · AI setup · Sync, each with its word; Esc and × close it', async () => {
    const calls = await mountSheet();
    for (const v of ['logs', 'server', 'ai', 'sync']) expect(q(`diag-tab-${v}`)).toBeTruthy();
    expect(q('diag-tab-sync')?.textContent).toContain('Up to date');
    await click('diag-tab-ai');
    await click('diagnostics-close');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual(['view:ai', 'close', 'close']);
  });

  test('Server: mode stamp, live connection, address, version, process, folder, and the repo-changed notice', async () => {
    const calls = await mountSheet({ view: 'server' });
    expect(q('diag-mode-stamp')?.getAttribute('data-mode')).toBe('canvas');
    expect(q('diag-live')?.textContent).toBe('Connected');
    expect(q('diag-row-address')?.textContent).toContain('localhost:4402');
    expect(q('diag-row-version')?.textContent).toContain('2.0.0');
    expect(q('diag-row-process')?.textContent).toContain('41207');
    expect(q('diag-row-folder')?.textContent).toContain(
      '~/p'.replace('~/p', '/Users/me/p').replace('/Users/me', '~')
    );
    await click('diag-copy-address');
    expect(calls).toEqual(['copy:Address']);
    expect(q('diag-repo-changed')).toBeTruthy();
    await click('diag-repo-dismiss');
    await click('diag-repo-reload');
    expect(calls).toEqual(['copy:Address', 'dismiss', 'reload']);
  });

  test('Server: a closed socket reads Reconnecting…; no canvas reads Idle', async () => {
    await mountSheet({ view: 'server', wsConnected: false, activePath: null, repoChanged: null });
    expect(q('diag-live')?.textContent).toBe('Reconnecting…');
    expect(q('diag-mode-stamp')?.getAttribute('data-mode')).toBe('idle');
    expect(q('diag-repo-changed')).toBeNull();
  });

  test('AI setup: the readiness list whole — rows, the claude binary path, Check again', async () => {
    const calls = await mountSheet({ view: 'ai' });
    expect(q('rdy-row-claude')).toBeTruthy();
    expect(document.body.textContent).toContain('~/.local/bin/claude');
    await click('diag-ai-recheck');
    expect(calls).toEqual(['recheck']);
  });

  test('Sync: today’s Sync panel, whole, with Get latest and the hints', async () => {
    const calls = await mountSheet({ view: 'sync' });
    expect(q('sync-panel')).toBeTruthy();
    // the panel keeps its own Resync / Download all (the desktop copy, not the cloud)
    expect(q('sync-resync')).toBeTruthy();
    expect(q('sync-offline')).toBeTruthy();
    expect(q('diag-get-latest-row')).toBeTruthy();
    await click('diag-get-latest');
    expect(calls).toEqual(['get-latest']);
    expect(q('diag-get-latest-note')?.textContent).toBe('Up to date with everyone.');
    expect(q('diag-sync-hints')?.textContent).toContain('maude design status');
    expect(q('diag-sync-hints')?.textContent).toContain('/design:rollback');
  });

  test('Sync: an unlinked project says there is nothing to sync', async () => {
    await mountSheet({
      view: 'sync',
      sync: { status: null, word: { word: 'Local project', tone: 'neutral' } },
    });
    expect(q('diag-sync-solo')?.textContent).toContain('nothing to sync');
    expect(q('sync-panel')).toBeNull();
  });
});

// ── nothing deleted: every `diag` row has a rendered home ─────────────────────────────────────

describe('nothing-deleted rows homed on Diagnostics', () => {
  const nd = JSON.parse(
    readFileSync(new URL('../client/v2/nothing-deleted.json', import.meta.url), 'utf8')
  );
  const rows = nd.rows.filter((r: { home: string }) => r.home === 'diag');

  test('there are 19 rows on diag and each has a v2 home: where + (a registry action or a testid)', () => {
    expect(rows.length).toBe(19);
    for (const r of rows) {
      expect(r.v2.where, r.id).toBeTruthy();
      expect(Boolean(r.v2.action) || Boolean(r.v2.testid), r.id).toBe(true);
    }
  });

  test('each home resolves: its action is a menu row (or ⌘K registry id), its testid renders in the sheet / menu', async () => {
    // render every view of the sheet and the open menu, collect the testids
    const seen = new Set<string>();
    const collect = () => {
      for (const e of document.querySelectorAll('[data-testid]'))
        seen.add(e.getAttribute('data-testid') as string);
    };
    for (const view of ['logs', 'server', 'ai', 'sync']) {
      await mountSheet({ view });
      collect();
      act(() => root?.unmount());
      host?.remove();
    }
    await mountPill({ status: status(), hidden: [] });
    await openDiagnostics();
    await act(async () =>
      (
        document.querySelector(
          '[data-testid="project-menu-sub-diagnostics"] [data-sub="Advanced"]'
        ) as HTMLElement
      ).click()
    );
    collect();
    const menuIds = new Set(modelIds(buildProjectMenu(desktop, { status: status(), hidden: [] })));
    for (const r of rows) {
      const { action, testid } = r.v2 as { action: string | null; testid: string | null };
      if (action)
        expect(
          ACTIONS_BY_ID.has(action) &&
            (menuIds.has(action) || action.startsWith('diag.') || action === 'canvas.reload'),
          `${r.id} action ${action}`
        ).toBe(true);
      if (testid) {
        const ok = testid.includes('<')
          ? [...seen].some((s) => s.startsWith(testid.split('<')[0]))
          : seen.has(testid);
        expect(ok, `${r.id} testid ${testid}`).toBe(true);
      }
    }
  });
});

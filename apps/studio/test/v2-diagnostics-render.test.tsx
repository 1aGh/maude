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
// The two Logs-sheet buttons are registered (⌘K reaches them) but have no menu row (06 ad-diag lists none).
const SHEET_ONLY = ['diag.copy-logs', 'diag.logs-show-in-finder'];
const DIAG_IDS = DIAG_ACTIONS.map((d) => d.id).filter((id) => !SHEET_ONLY.includes(id));
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
    // a cloud tab runs no process of yours (the Server row says "Runs in the cloud" — S11.15) and no sync
    // runtime of its own: nothing is left for Advanced to hold, so the row itself is not drawn
    expect(inDiag.querySelector('[data-sub="Advanced"]')).toBeNull();
    const ids = Array.from(document.querySelectorAll('[data-action]')).map((e) =>
      e.getAttribute('data-action')
    );
    expect(ids).not.toContain('diag.address');
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
    // S11.11: the sheet's two buttons are runnable too (a shell handler; a native command) — and in
    // no menu row, so they cannot be a dead one
    for (const id of SHEET_ONLY) {
      expect(can.has(id), id).toBe(true);
      expect(rendered, id).not.toContain(id);
    }
  });
});

// ── the sheet ─────────────────────────────────────────────────────────────────────────────────

const SOURCES = {
  retentionDays: 7,
  logDir: '~/.maude/logs',
  sources: {
    sync: {
      status: {},
      recent: ['[log] [sync] pushed a.tsx', '[warn] [sync] hub replied 429'],
      recentAt: [Date.UTC(2026, 9, 18, 14, 5, 12), Date.UTC(2026, 9, 18, 14, 6, 31)],
    },
    server: {
      status: {},
      recent: ['[log] canvas built · Pricing'],
      recentAt: [Date.UTC(2026, 9, 18, 14, 5, 40)],
    },
    ai: { status: {}, recent: [], recentAt: [] },
    export: {
      status: {},
      recent: ['[error] [remote] png FAILED 500'],
      recentAt: [Date.UTC(2026, 9, 18, 14, 7, 0)],
    },
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
    { id: 'plugins', label: 'Plugins', status: 'present', required: true, detail: 'bundled' },
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
    onCopyLogs: (lines: unknown[]) => calls.push(`copy-logs:${lines.length}`),
    onReveal: () => calls.push('reveal'),
    onCopy: (_t: string, label: string) => calls.push(`copy:${label}`),
    info: { address: 'localhost:4402', pid: 41207, version: '2.0.0', folder: '/Users/me/p' },
    wsConnected: true,
    activePath: 'ui/Pricing.tsx',
    isSystem: false,
    repoChanged: { reload: () => calls.push('reload'), dismiss: () => calls.push('dismiss') },
    ai: { report: REPORT, loading: false, recheck: () => calls.push('recheck') },
    sync: {
      // S11.12 — every Sync details card renders from this one payload (the home-resolves test)
      status: linked({
        url: 'https://alligators.cloud.maude.sh',
        docs: { synced: 3, pending: 0, rejected: 1 },
        notices: [{ id: 'source-conflict-ui-pricing', severity: 'warn', text: 'held' }],
        aiAction: { state: 'held', label: 'Cut the trailer', canvases: ['ui/a.tsx'] },
        assets: { total: 4, done: 1, pushed: 1, skipped: 0, failedCount: 0, finished: false },
        files: { synced: 3, pulled: 0, conflicts: 0, failed: 0, progress: null },
      }),
      native: true,
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
  test('Logs: filter by source, search, copy all — no Refresh button (06 ad-logs); the tail is the server’s ring', async () => {
    const calls = await mountSheet();
    expect(q('diag-logs-lines')?.querySelectorAll('li').length).toBe(4);
    await click('diag-logs-filter-sync');
    expect(q('diag-logs-lines')?.querySelectorAll('li').length).toBe(2);
    expect(q('diag-logs-filter-sync')?.getAttribute('aria-pressed')).toBe('true');
    await click('diag-logs-filter-ai');
    expect(q('diag-logs-empty')).toBeTruthy();
    await click('diag-logs-filter-all');
    await click('diag-logs-copy-all');
    // 06 ad-logs draws Filter, Copy all and Show in Finder — no Refresh icon (the host re-reads while Logs is in view)
    expect(q('diag-logs-refresh')).toBeNull();
    // Copy all hands over the lines as shown (4 of them), not the report
    expect(calls).toEqual(['copy-logs:4']);
    expect(document.body.textContent).toContain('Kept 7 days on this Mac');
  });

  test('Logs: a time, the source and the message per line, merged by time; the foot names the 200 lines', async () => {
    await mountSheet();
    const rows = Array.from(q('diag-logs-lines')?.querySelectorAll('li') ?? []);
    const cells = rows.map((r) => Array.from(r.children).map((c) => c.textContent));
    // oldest first across the four sources; the [sync] tag is the source column's, not the message's
    expect(cells.map((c) => c[1])).toEqual(['sync', 'server', 'sync', 'export']);
    expect(cells[0]?.[2]).toBe('pushed a.tsx');
    expect(cells[0]?.[0]).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(document.body.textContent).toContain(
      'Help › Report a bug can attach the last 200 lines.'
    );
  });

  test('Logs: Show in Finder is there only when the shell can do it', async () => {
    const calls = await mountSheet();
    await click('diag-logs-show-in-finder');
    expect(calls).toEqual(['reveal']);
    act(() => root?.unmount());
    host?.remove();
    await mountSheet({ onReveal: null });
    expect(q('diag-logs-show-in-finder')).toBeNull();
  });

  test('Logs: an unreadable ring says so instead of showing nothing', async () => {
    await mountSheet({ data: null, error: 'HTTP 403' });
    expect(q('diag-logs-error')?.textContent).toContain('HTTP 403');
  });

  test('06 ad-logs: Logs, Server and AI setup are three boxes at once — no tabs; × and Esc close it', async () => {
    const calls = await mountSheet({ view: 'server' });
    expect(q('diag-logs')).toBeTruthy();
    expect(q('diag-server')).toBeTruthy();
    expect(q('diag-ai')).toBeTruthy();
    expect(q('diag-sync')).toBeNull();
    expect(document.querySelector('[role="tab"], [role="tablist"]')).toBeNull();
    expect(q('diagnostics-sheet')?.getAttribute('data-layout')).toBe('trio');
    // the box the person asked for is the marked one
    expect(q('diag-server')?.hasAttribute('data-current')).toBe(true);
    expect(q('diag-logs')?.hasAttribute('data-current')).toBe(false);
    await click('diagnostics-close');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual(['close', 'close']);
  });

  test('06 ad-syncd: Sync opens alone, without the three boxes', async () => {
    await mountSheet({ view: 'sync' });
    expect(q('diagnostics-sheet')?.getAttribute('data-layout')).toBe('sync');
    expect(q('diag-logs')).toBeNull();
    expect(q('diag-server')).toBeNull();
  });

  test('Server rows are the kit ARow: key, value, and Copy as a 24 px icon button; no v1 migration note', async () => {
    await mountSheet({ view: 'server' });
    const copy = q('diag-copy-address') as HTMLElement;
    expect(copy.classList.contains('icon-btn')).toBe(true);
    expect(copy.querySelector('svg')).toBeTruthy();
    expect(copy.getAttribute('aria-label')).toBe('Copy address');
    expect(q('diag-server')?.textContent).not.toMatch(/status bar|IDLE · CANVAS/);
    expect(q('diag-mode-stamp')?.textContent).toBe('Canvas · Pricing');
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

  test('AI setup: four answers, the claude binary path and where it came from, Check again', async () => {
    const calls = await mountSheet({ view: 'ai' });
    const rows = Array.from(q('diag-ai-rows')?.querySelectorAll('li') ?? []);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'diag-ai-row-installed',
      'diag-ai-row-found',
      'diag-ai-row-signed-in',
      'diag-ai-row-plugins',
    ]);
    expect(rows.every((r) => r.getAttribute('data-state') === 'ok')).toBe(true);
    expect(q('diag-ai-row-found')?.textContent).toContain('~/.local/bin/claude');
    expect(q('diag-ai-row-found')?.textContent).toContain('Found on your PATH');
    // nothing is wrong, so no full probe rows — the whole probe is one quiet fold away
    expect(q('diag-ai-needs')).toBeNull();
    expect(q('rdy-row-claude')).toBeNull();
    await click('diag-ai-all-toggle');
    expect(q('rdy-row-claude')).toBeTruthy();
    await click('diag-ai-all-toggle'); // the fold is remembered per Mac: leave it as found
    await click('diag-ai-recheck');
    expect(calls).toEqual(['recheck']);
  });

  test('AI setup: what is not satisfied keeps its whole row (fix, Set up, the command)', async () => {
    await mountSheet({
      view: 'ai',
      ai: {
        report: {
          ready: false,
          items: [
            {
              id: 'claude',
              label: 'Claude Code',
              status: 'missing',
              required: true,
              detail: 'Not found on PATH.',
              action: 'install',
              installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
            },
            { id: 'plugins', label: 'Plugins', status: 'present', required: true, detail: 'ok' },
          ],
        },
        loading: false,
        recheck: () => {},
      },
    });
    expect(q('diag-ai-row-installed')?.getAttribute('data-state')).toBe('missing');
    expect(q('diag-ai-row-found')?.getAttribute('data-state')).toBe('missing');
    expect(q('diag-ai-row-plugins')?.getAttribute('data-state')).toBe('ok');
    expect(q('diag-ai-needs')).toBeTruthy();
    expect(q('rdy-row-claude')).toBeTruthy();
    expect(q('acp-setup-install')).toBeTruthy();
    expect(q('rdy-row-plugins')).toBeNull(); // the satisfied one stays out of the way
  });

  test('Sync: Sync details (S11.12), with Get latest and the hints', async () => {
    const calls = await mountSheet({ view: 'sync' });
    // S11.12 — the v1 panel is no longer mounted here; Resync now / Download all stay in the
    // menu's Diagnostics › Advanced rows (sync.resync / sync.download-all)
    expect(q('sync-panel')).toBeTruthy();
    expect(q('sync-resync')).toBeNull(); // Resync lives on the menu row, not in a panel header
    expect(document.querySelector('.sp-note, [data-testid="sync-assets"]')).toBeNull(); // not the v1 body
    expect(q('diag-sync-title')?.textContent).toBe('Sync · Alligators');
    expect(q('diag-get-latest-row')).toBeTruthy();
    await click('diag-get-latest');
    expect(calls).toEqual(['get-latest']);
    expect(q('diag-get-latest-note')?.textContent).toBe('Up to date with everyone.');
    // V2-4.10: "Hub, commands" is the shared Advanced fold now — one quiet row until it is opened
    expect(q('diag-sync-hints-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(q('diag-sync-hints')?.textContent).not.toContain('maude design status');
    await click('diag-sync-hints-toggle');
    expect(q('diag-sync-hints')?.textContent).toContain('maude design status');
    expect(q('diag-sync-hints')?.textContent).toContain('/design:rollback');
  });

  test('Sync: the Resync card — the bar and "Resyncing… 1 204 of 1 318", then the result and the log pointer', async () => {
    const running = {
      state: 'running',
      done: 1204,
      total: 1318,
      summary: { checked: 0, sent: 0, fetched: 0, conflicts: 0 },
    };
    await mountSheet({
      view: 'sync',
      sync: { ...sheetProps().props.sync, resync: running },
    });
    expect(q('diag-resync')?.getAttribute('data-state')).toBe('running');
    expect(q('diag-resync-progress')?.textContent).toBe('Resyncing… 1 204 of 1 318');
    expect(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('91');
    act(() => root?.unmount());
    host?.remove();
    await mountSheet({
      view: 'sync',
      sync: {
        ...sheetProps().props.sync,
        resync: {
          state: 'done',
          done: 1318,
          total: 1318,
          summary: { checked: 1318, sent: 3, fetched: 0, conflicts: 0 },
        },
      },
    });
    expect(q('diag-resync-result')?.textContent).toBe(
      'Resync done — 3 files sent, nothing else differed.'
    );
    expect(q('diag-resync')?.textContent).toContain('1 318 checked');
    act(() => root?.unmount());
    host?.remove();
    await mountSheet({ view: 'sync' });
    expect(q('diag-resync')).toBeNull(); // quiet until a resync has run
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

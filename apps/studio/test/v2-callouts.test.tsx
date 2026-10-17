// V2-4.8b — the old top banners reach the person as callouts / status words, never silently dropped.
//
//  · model: each banner message has an item (diverged / rejected / long offline / reconnect flash / role /
//    update / repo changed); a short offline spell is the Share cluster's status word, not a callout;
//  · render (happy-dom + React, the REAL host over a shell store): every trigger state draws its callout
//    with ONE action, the action does what the banner's button did, a close hides one event only;
//  · the old components are gone: status-bar.jsx, SyncBanner / CloudRoleBanner / UpdateBanner, the inline
//    repo notice, and the stack is mounted OUTSIDE `.st-body` (Presentation mode must not hide a warning).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { OPEN_DIAGNOSTICS_EVENT } from '../client/v2/diagnostics/diagnostics-bus.js';
import { ShellCallouts } from '../client/v2/shell/callouts-host.jsx';
import {
  calloutStack,
  ROLE_LINE,
  repoCallout,
  roleCallout,
  syncCallout,
  updateCallout,
} from '../client/v2/shell/callouts-model.js';
import { saveStatus } from '../client/v2/shell/save-status.js';

const CLIENT = join(import.meta.dir, '..', 'client');
const linked = (over: Record<string, unknown> = {}) => ({
  linked: true,
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  ...over,
});
const diverged = (over: Record<string, unknown> = {}) => ({
  kind: 'cold-start-diverged',
  slug: 'pricing',
  winner: 'local',
  at: 1700000000,
  ...over,
});

describe('the model: every banner message has an item', () => {
  test('diverged: what happened, what is safe, one action', () => {
    const c = syncCallout(linked({ conflicts: [diverged()] }));
    expect(c?.kind).toBe('sync-diverged');
    expect(c?.tone).toBe('warn');
    expect(c?.title).toContain('pricing');
    expect(c?.detail).toContain('Version history');
    expect(c?.action?.id).toBe('details');
  });

  test('diverged with a failed snapshot is an error that says the overwrite was refused', () => {
    const c = syncCallout(linked({ conflicts: [diverged({ snapshotFailed: true })] }));
    expect(c?.tone).toBe('error');
    expect(c?.detail).toMatch(/could not be saved/);
  });

  test('the newest divergence wins, and a new one has a new key', () => {
    const a = syncCallout(linked({ conflicts: [diverged()] }));
    const b = syncCallout(
      linked({ conflicts: [diverged(), diverged({ slug: 'home', at: 1700000999 })] })
    );
    expect(b?.title).toContain('home');
    expect(b?.key).not.toBe(a?.key);
  });

  test('rejected documents use the noun for 1 and for many, never "canvas(es)"', () => {
    expect(syncCallout(linked({ docs: { rejected: 1 } }))?.title).toBe('1 canvas not syncing');
    expect(syncCallout(linked({ docs: { rejected: 3 } }))?.title).toBe('3 canvases not syncing');
    expect(JSON.stringify(syncCallout(linked({ docs: { rejected: 3 } })))).not.toContain('(es)');
  });

  test('long offline: an error with the queued count; a short offline spell is the status word', () => {
    const long = syncCallout(linked({ state: 'offline-long', queuedOps: 14 }));
    expect(long?.tone).toBe('error');
    expect(long?.detail).toContain('14 edits');
    expect(syncCallout(linked({ state: 'offline-long', queuedOps: 1 }))?.detail).toContain(
      '1 edit '
    );
    expect(syncCallout(linked({ state: 'offline', queuedOps: 4 }))).toBeNull();
    // ... and the word that carries it is the Share cluster's
    expect(saveStatus({ linked: true, phase: 'offline', pending: 4 }).word).toBe(
      'Offline — kept on this Mac'
    );
  });

  test('the reconnect flash is a quiet success; solo, unlinked and not-syncable say nothing', () => {
    expect(syncCallout(linked({ flash: 'synced' }))?.tone).toBe('ok');
    expect(syncCallout(null)).toBeNull();
    expect(syncCallout({ linked: false })).toBeNull();
    expect(syncCallout(linked({ notSyncable: true, conflicts: [diverged()] }))).toBeNull();
    expect(syncCallout(linked())).toBeNull();
  });

  test('update, repo changed and role carry the v1 strip’s words and its one action', () => {
    expect(updateCallout({ version: '2.0.1' })).toMatchObject({
      title: 'Maude updated (v2.0.1)',
      action: { id: 'restart', label: 'Restart now' },
    });
    expect(updateCallout(null)).toBeNull();
    expect(repoCallout({ kind: 'pull' })).toMatchObject({
      title: 'Repo state changed',
      action: { id: 'reload', label: 'Reload' },
    });
    expect(repoCallout(null)).toBeNull();
    expect(roleCallout({ role: 'viewer' })?.title).toBe(ROLE_LINE.viewer);
    expect(roleCallout({ role: 'viewer' }, () => true)).toBeNull();
    expect(roleCallout({ role: 'stranger' })).toBeNull();
    expect(roleCallout(undefined)).toBeNull();
  });

  test('order: errors, warnings, then news; a dismissal hides only that event', () => {
    const input = {
      syncStatus: linked({ conflicts: [diverged({ snapshotFailed: true })] }),
      updateReady: { version: '2.0.1' },
      gitLifecycle: { x: 1 },
      cloud: { role: 'member' },
    };
    const all = calloutStack(input);
    expect(all.map((c) => c.kind)).toEqual(['sync-diverged', 'repo-changed', 'update', 'role']);
    expect(all.map((c) => c.tone)).toEqual(['error', 'info', 'info', 'info']);
    const keys = new Set([all[0].key]);
    expect(calloutStack({ ...input, dismissed: keys }).map((c) => c.kind)).not.toContain(
      'sync-diverged'
    );
  });
});

// ── the real host over a shell store ───────────────────────────────────────────────────────────
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  try {
    localStorage.clear();
  } catch {}
});

async function mount(shellCore: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const core = {
    cfg: {},
    gitLifecycle: null,
    setGitLifecycle: () => {},
    setUpdateReady: () => {},
    syncStatus: null,
    updateReady: null,
    ...shellCore,
  };
  await act(async () => {
    root?.render(
      <ShellStoreContext.Provider value={{ shellCore: core } as never}>
        <ShellCallouts />
      </ShellStoreContext.Provider>
    );
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the host: each trigger state reaches the person', () => {
  test('nothing to say → an empty stack', async () => {
    await mount({ syncStatus: linked() });
    expect(q('callouts')?.children.length).toBe(0);
  });

  test('diverged sync: the callout, and Details opens Diagnostics › Sync', async () => {
    let asked = '';
    const on = (e: Event) => {
      asked = (e as CustomEvent).detail?.view ?? '';
    };
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, on);
    await mount({ syncStatus: linked({ conflicts: [diverged()] }) });
    expect(q('callout-sync-diverged')?.textContent).toContain('“pricing” changed in two places');
    await click(q('callout-sync-diverged-action'));
    window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, on);
    expect(asked).toBe('sync');
  });

  test('rejected sync, and the close hides only that count', async () => {
    await mount({ syncStatus: linked({ docs: { rejected: 2 } }) });
    expect(q('callout-sync-rejected')?.textContent).toContain('2 canvases not syncing');
    await click(q('callout-sync-rejected-dismiss'));
    expect(q('callout-sync-rejected')).toBeNull();
  });

  test('cloud role: shown once, "Got it" is the only control and is remembered', async () => {
    await mount({ cfg: { cloud: { role: 'viewer' } } });
    expect(q('callout-role')?.textContent).toContain(ROLE_LINE.viewer);
    expect(q('callout-role-dismiss')).toBeNull();
    await click(q('callout-role-action'));
    expect(q('callout-role')).toBeNull();
    expect(localStorage.getItem('maude-cloud-role-seen:viewer')).toBe('1');
    act(() => root?.unmount());
    host?.remove();
    await mount({ cfg: { cloud: { role: 'viewer' } } });
    expect(q('callout-role')).toBeNull();
  });

  test('update ready: the version, Restart now, and "Later" clears the staged flag', async () => {
    let cleared = false;
    await mount({ updateReady: { version: '2.0.1' }, setUpdateReady: () => (cleared = true) });
    expect(q('callout-update')?.textContent).toContain('Maude updated (v2.0.1)');
    expect(q('callout-update-action')?.textContent).toBe('Restart now');
    await click(q('callout-update-dismiss'));
    expect(cleared).toBe(true);
  });

  test('repo changed: Reload, and the close clears the flag', async () => {
    let cleared = false;
    await mount({ gitLifecycle: { x: 1 }, setGitLifecycle: () => (cleared = true) });
    expect(q('callout-repo-changed')?.textContent).toContain('Repo state changed');
    expect(q('callout-repo-changed-action')?.textContent).toBe('Reload');
    await click(q('callout-repo-changed-dismiss'));
    expect(cleared).toBe(true);
  });

  test('format gate keeps its testids, drawn as a callout in the same stack', async () => {
    await mount({ cfg: { formatGate: { projectFormat: 2, supported: 1 } }, updateReady: null });
    const gate = q('format-gate-banner');
    expect(gate?.className).toContain('st-callout');
    expect(q('callouts')?.contains(gate)).toBe(true);
    expect(q('format-gate-update')).not.toBeNull();
  });

  test('the Share cluster word still carries offline / not saved (the banner’s short states)', () => {
    expect(saveStatus({ linked: true, online: false, phase: 'synced' }).word).toBe(
      'Offline — kept on this Mac'
    );
    expect(saveStatus({ linked: true, phase: 'refused' }).word).toBe('Not saved');
  });
});

describe('the old chrome is gone', () => {
  const read = (rel: string) => readFileSync(join(CLIENT, rel), 'utf8');
  test('status-bar.jsx is deleted and nothing mounts a StatusBar', () => {
    expect(existsSync(join(CLIENT, 'shell/status-bar.jsx'))).toBe(false);
    const app = read('app.jsx');
    expect(app).not.toMatch(/<StatusBar|ShellStatusBar|status-bar\.jsx/);
  });
  test('banners.jsx keeps only the format gate', () => {
    const src = read('shell/banners.jsx');
    expect(src).toContain('export function FormatGateBanner');
    expect(src).not.toMatch(/SyncBanner|CloudRoleBanner|UpdateBanner|st-banner/);
    expect(read('app.jsx')).not.toMatch(
      /<(SyncBanner|CloudRoleBanner|UpdateBanner)|Repo state changed/
    );
  });
  test('the stack is a child of .maude, before .st-shell — Presentation mode must not hide it', () => {
    const app = read('app.jsx');
    const at = app.indexOf('<ShellCallouts />');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(app.indexOf('<div className="st-shell">'));
  });
});

describe('the first-run tour offers are callouts (V2-4.9 — the v1 corner box covered the left panel)', () => {
  test('usage first, then collab; none while a tour runs; Start is the one action', async () => {
    const { tourCallout, calloutStack } = await import('../client/v2/shell/callouts-model.js');
    expect(tourCallout({ usage: true, collab: true })).toMatchObject({
      kind: 'tour-usage',
      tone: 'info',
      action: { id: 'tour-usage', label: 'Start' },
    });
    expect(tourCallout({ collab: true })?.kind).toBe('tour-collab');
    expect(tourCallout({ usage: true, running: true })).toBeNull();
    expect(tourCallout({})).toBeNull();
    const stack = calloutStack({ tour: { usage: true } });
    expect(stack.map((c) => c.kind)).toEqual(['tour-usage']);
    expect(calloutStack({ tour: { usage: true }, dismissed: new Set(['tour:usage']) })).toEqual([]);
  });

  test('the shell no longer draws the fixed .mdcc-tour-nudge box', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../client/app.jsx', import.meta.url), 'utf8');
    expect(app.includes('className="mdcc-tour-nudge"')).toBe(false);
  });
});

// S11.17 (C37) — the recovery callouts reach the person through the REAL host (happy-dom + React):
//   · after an unclean exit the desktop shell hands the tab `app://crashed` once → the crash line with the
//     time from `GET /_api/diagnostics/last-work`; Report a bug… opens the dialog marked "from the crash";
//   · while the studio holds writes (`GET /_api/diagnostics/disk` full) → Not saved + the sentence, and
//     Show in Finder reveals the design folder through the S11.16 door;
//   · the report dialog ticks the crash logs from the crash line, and never under "Never".
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
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
import { reportLogsConsent } from '../client/v2/settings/settings-model.js';
import { ShellCallouts } from '../client/v2/shell/callouts-host.jsx';
import { menuRunner } from '../client/v2/shell/menu-runner.js';
import { resetCrashNoticeForTest } from '../client/v2/shell/native-doors.js';
import {
  crashLogsTicked,
  refreshDisk,
  resetRecoveryForTest,
  retryHeld,
  setReportEntry,
  takeReportEntry,
} from '../client/v2/shell/recovery-store.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
const w = globalThis as unknown as { __TAURI__?: unknown };
// the page asks the shell once (S11.16): another file's mount must not have asked for this one
beforeEach(() => {
  resetCrashNoticeForTest();
  resetRecoveryForTest();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  w.__TAURI__ = undefined;
  resetCrashNoticeForTest();
  resetRecoveryForTest();
});

/** The studio, as far as these two routes go. */
function studio(o: { lastWorkAt?: number | null; disk?: Record<string, unknown> }) {
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('/_api/diagnostics/last-work'))
      return Response.json({ lastWorkAt: o.lastWorkAt ?? null });
    if (String(url).endsWith('/_api/diagnostics/disk'))
      return Response.json(o.disk ?? { full: false, held: 0, since: null });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}
/** The desktop shell: `take_crash_notice` answers once; the reveal door records what it was asked. */
function shell(notice: unknown) {
  const asked: Array<[string, unknown]> = [];
  w.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: unknown) => {
        asked.push([cmd, args]);
        return cmd === 'take_crash_notice' ? notice : null;
      },
    },
  };
  return asked;
}

async function mount(cfg: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const core = {
    cfg,
    gitLifecycle: null,
    setGitLifecycle: () => {},
    setUpdateReady: () => {},
    syncStatus: null,
    updateReady: null,
  };
  await act(async () => {
    root?.render(
      <ShellStoreContext.Provider value={{ shellCore: core } as never}>
        <ShellCallouts />
      </ShellStoreContext.Provider>
    );
  });
  // let the notice, the last-work read and the first disk read settle
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('the crash line', () => {
  test('after an unclean exit: the line with the time of the last work; Report a bug… opens the dialog from the crash', async () => {
    const t = new Date();
    t.setHours(14, 5, 0, 0);
    studio({ lastWorkAt: t.getTime() });
    shell({ kind: 'app://crashed', startedAt: 1 });
    const ran: string[] = [];
    const map = { 'help.report-bug': () => ran.push(`report:${takeReportEntry()}`) };
    menuRunner.bind(map);
    try {
      await mount();
      expect(q('callout-crashed')?.textContent).toContain(
        'Maude quit unexpectedly. Your work up to 14:05 is here.'
      );
      expect(q('callout-crashed-action')?.textContent).toBe('Report a bug…');
      await click(q('callout-crashed-action'));
      expect(ran).toEqual(['report:crash']);
    } finally {
      menuRunner.unbind(map);
    }
  });

  test('a clean quit (no notice) and a browser tab (no shell): no line', async () => {
    studio({ lastWorkAt: Date.now() });
    shell(null);
    await mount();
    expect(q('callout-crashed')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    resetCrashNoticeForTest();
    w.__TAURI__ = undefined;
    await mount();
    expect(q('callout-crashed')).toBeNull();
  });
});

describe('the full disk', () => {
  test('held writes: Not saved + the sentence; Show in Finder reveals the design folder', async () => {
    studio({ disk: { full: true, held: 1, since: 9 } });
    const asked = shell(null);
    await mount({ designRel: '.design' });
    const c = q('callout-disk-full');
    expect(c?.textContent).toContain('Not saved');
    expect(c?.textContent).toContain(
      "This Mac is out of space — changes wait here until there's room."
    );
    expect(c?.getAttribute('data-tone')).toBe('error');
    await click(q('callout-disk-full-action'));
    expect(asked).toContainEqual(['project_reveal_path', { rel: '.design' }]);
  });

  test('a browser tab: the sentence, no Finder button', async () => {
    studio({ disk: { full: true, held: 1, since: 9 } });
    await mount();
    expect(q('callout-disk-full')?.textContent).toContain('This Mac is out of space');
    expect(q('callout-disk-full-action')).toBeNull();
  });

  test('room again: the callout goes away', async () => {
    studio({ disk: { full: true, held: 1, since: 9 } });
    await mount();
    expect(q('callout-disk-full')).not.toBeNull();
    studio({ disk: { full: false, held: 0, since: null } });
    await act(async () => {
      await refreshDisk();
    });
    expect(q('callout-disk-full')).toBeNull();
  });
});

describe('Retry and the report dialog', () => {
  test('retryHeld posts disk-retry and keeps the store in step', async () => {
    const posts: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      posts.push(`${init?.method ?? 'GET'} ${url}`);
      return Response.json({ landed: 1, held: 0, full: false });
    }) as typeof fetch;
    expect(await retryHeld()).toEqual({ landed: 1, held: 0, full: false });
    expect(posts).toEqual(['POST /_api/diagnostics/disk-retry']);
  });

  test('crash logs: ticked from the crash line or under Always; never under Never; the entry is read once', () => {
    expect(crashLogsTicked(reportLogsConsent('ask'), 'crash')).toBe(true);
    expect(crashLogsTicked(reportLogsConsent('ask'), null)).toBe(false);
    expect(crashLogsTicked(reportLogsConsent('always'), null)).toBe(true);
    expect(crashLogsTicked(reportLogsConsent('never'), 'crash')).toBe(false);
    setReportEntry('crash');
    expect(takeReportEntry()).toBe('crash');
    expect(takeReportEntry()).toBeNull();
  });
});

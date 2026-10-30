// p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert) — the shell, rendered (happy-dom). A format-1
// project, or a linked one that still saves the old way, converts BY ITSELF on open: no dialog, a notice
// that says what happened, that it now saves with accepted revisions, and that the backup is in Version
// history on this Mac only. A reason this Mac cannot convert now is ONE line with its action, and the
// conversion runs by itself once the reason clears. A failed attempt never retries on the same answer.
// A Maude Cloud project never converts by itself during the rc.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { __TAURI__?: unknown };
  w.__TAURI__ = { core: { invoke: async () => [] } };
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const HUB = 'https://hub.example';
const realFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
const toasts: string[] = [];
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  toasts.length = 0;
  try {
    sessionStorage.clear();
  } catch {}
});

const older = {
  name: 'alligators',
  designRel: '.design',
  formatVersion: 1,
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnlyReason: 'format',
};
const fmt2Legacy = {
  name: 'alligators',
  designRel: '.design',
  formatVersion: 2,
  formatGate: null,
  saveMode: 'legacy',
  readOnlyReason: null,
};
const REPORT = { format: 'maude.migrate-report', steps: [], refusals: [] };
const dryLocal = {
  ...REPORT,
  dryRun: true,
  exitCode: 0,
  autoConvert: { allowed: true },
  project: { formatBefore: 1, linked: null },
};
const dryLinked = (
  linked: Record<string, unknown> = {},
  codes: string[] = [],
  formatBefore = 1
) => ({
  ...REPORT,
  dryRun: true,
  exitCode: codes.length ? 11 : 0,
  autoConvert: { allowed: true },
  refusals: codes.map((code) => ({ path: '', reason: code, code })),
  project: {
    formatBefore,
    linked: { hub: HUB, role: 'owner', hubFormat: 2, capabilities: ['format-v2'], ...linked },
  },
});
const appliedOk = (formatBefore = 1, linked: Record<string, unknown> | null = null) => ({
  ...REPORT,
  dryRun: false,
  exitCode: 0,
  autoConvert: { allowed: true },
  snapshot: '_history/_migrate/v2-20261029T120000000Z',
  project: { formatBefore, linked },
});

type Answer = { status: number; body: unknown };

/** The migrate route: each dry run answers the next of `drys` (the last one repeats); each apply the next of `applies`. */
function mockMigrate(drys: unknown[], applies: Answer[] = []) {
  const calls = { dry: 0, apply: 0, bodies: [] as Record<string, unknown>[] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/_api/project/migrate') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.bodies.push(body);
      if (!body.apply) {
        const d = drys.length > 1 ? drys.shift() : drys[0];
        calls.dry++;
        return new Response(JSON.stringify(d), { status: 200 });
      }
      calls.apply++;
      const a = applies.shift() ?? { status: 500, body: { error: 'x' } };
      return new Response(JSON.stringify(a.body), { status: a.status });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return calls;
}

const wait = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mount(cfg: Record<string, unknown> = older) {
  const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
  const { OlderFormatCallout } = await import('../client/v2/shell/format-update.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const store = { shellCore: { cfg, project: 'alligators' } };
  await act(async () =>
    root?.render(
      <ShellStoreContext.Provider value={store as never}>
        <OlderFormatCallout />
      </ShellStoreContext.Provider>
    )
  );
  await wait(20);
}

const kind = () => $('format-older-callout')?.getAttribute('data-kind') ?? null;
const line = () => $('format-older-callout')?.textContent ?? '';
const focus = async () => {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await wait(20);
};

describe('converts on open, unasked', () => {
  test('a local format-1 project: one apply, no dialog, no click', async () => {
    const calls = mockMigrate([dryLocal], [{ status: 200, body: appliedOk() }]);
    await mount();
    expect(calls.apply).toBe(1);
    expect(calls.bodies.find((b) => b.apply)?.confirmCloud).toBeUndefined();
    expect($('format-update-dialog')).toBe(null); // the opt-in dialog is gone
    expect($('format-cloud-dialog')).toBe(null);
  });

  test('a linked format-1 project, owner on a v2 hub: converts too', async () => {
    const calls = mockMigrate(
      [dryLinked({ modeDue: true, mode: 'legacy', hubFormat: 1 })],
      [{ status: 200, body: appliedOk(1, { role: 'owner', modeDue: true, modeSwitched: true }) }]
    );
    await mount();
    expect(calls.apply).toBe(1);
  });

  test('a linked format-2 project that still saves the old way: switches by itself', async () => {
    const calls = mockMigrate(
      [dryLinked({ modeDue: true, mode: 'legacy' }, [], 2)],
      [{ status: 200, body: appliedOk(2, { role: 'owner', modeDue: true, modeSwitched: true }) }]
    );
    await mount(fmt2Legacy);
    expect(calls.apply).toBe(1);
  });
});

describe('the notice', () => {
  test('says what happened, accepted revisions, and Version history on this Mac only', async () => {
    const { OLDER_COPY, SAVE_COPY, applyResult } = await import(
      '../client/v2/shell/format-update.js'
    );
    for (const t of [
      OLDER_COPY.toastUpdated,
      SAVE_COPY.toastBoth,
      SAVE_COPY.toastSwitched,
      SAVE_COPY.toastImporting,
    ]) {
      expect(t).toMatch(/Updated/);
      expect(t).toMatch(/accepted revisions/);
      expect(t).toMatch(/Version history, on this Mac only/);
      expect(t).not.toMatch(/\b(we|I|our)\b|!/);
    }
    expect(applyResult({ status: 200, report: appliedOk() })).toEqual({
      done: true,
      toast: OLDER_COPY.toastUpdated,
    });
  });
});

describe('a reason this Mac cannot convert now: one line, then it converts by itself', () => {
  const cases: Array<{
    name: string;
    dry: unknown;
    kind: string;
    line: RegExp;
    button: string | null;
  }> = [
    {
      name: 'signed out',
      dry: dryLinked({ role: 'unknown' }, ['no-sign-in']),
      kind: 'no-sign-in',
      line: /isn't signed in/,
      button: 'format-older-sign-in',
    },
    {
      name: 'not the owner',
      dry: dryLinked({ role: 'member' }, ['not-owner']),
      kind: 'non-owner',
      line: /Ask the owner/,
      button: null,
    },
    {
      name: 'offline',
      dry: dryLinked({ hubFormat: null }, ['offline']),
      kind: 'offline',
      line: /Waiting for the connection/i,
      button: null,
    },
    {
      name: 'an old team server',
      dry: dryLinked({ hubFormat: 1, capabilities: [] }, ['hub-too-old']),
      kind: 'hub-too-old',
      line: /team server needs an update/,
      button: 'format-older-team-server',
    },
    {
      name: 'browser-not-paired',
      dry: dryLinked({ modeBlocker: 'browser-not-paired', mode: 'legacy' }),
      kind: 'server-setup',
      line: /isn't set up to save accepted revisions/,
      button: null,
    },
    {
      name: 'store-not-durable',
      dry: dryLinked({ modeBlocker: 'store-not-durable', mode: 'legacy' }),
      kind: 'server-setup',
      line: /isn't set up to save accepted revisions/,
      button: null,
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const calls = mockMigrate([c.dry, c.dry, dryLinked()], [{ status: 200, body: appliedOk() }]);
      await mount();
      expect(calls.apply).toBe(0);
      expect(kind()).toBe(c.kind);
      expect(line()).toMatch(c.line);
      if (c.button) expect($(c.button)).not.toBe(null);
      // one action at most (CONTRACT §4)
      expect($('format-older-callout')?.querySelectorAll('button').length ?? 0).toBeLessThanOrEqual(
        1
      );
      await focus(); // still the same reason
      expect(calls.apply).toBe(0);
      await focus(); // the reason cleared
      expect(calls.apply).toBe(1);
    });
  }
});

describe('no retry loop', () => {
  test('a failed apply is not tried again on the same answer, however often the window checks', async () => {
    const calls = mockMigrate([dryLocal], [{ status: 500, body: { error: 'migration failed' } }]);
    await mount();
    expect(calls.apply).toBe(1);
    for (let i = 0; i < 5; i++) await focus();
    expect(calls.apply).toBe(1);
    expect(line()).toMatch(/Something stopped the update/);
    expect($('format-older-retry')?.textContent).toBe('Retry update');
  });

  test('a change of conditions in between re-arms it once', async () => {
    const offline = dryLinked({ hubFormat: null }, ['offline']);
    const calls = mockMigrate(
      [dryLinked(), dryLinked(), offline, dryLinked()],
      [
        { status: 500, body: { error: 'x' } },
        { status: 200, body: appliedOk(1, { role: 'owner' }) },
      ]
    );
    await mount();
    expect(calls.apply).toBe(1);
    await focus(); // offline now
    expect(calls.apply).toBe(1);
    await focus(); // back: a new answer — one more try
    expect(calls.apply).toBe(2);
  });

  test('a reload in the same session does not try again on the same answer', async () => {
    const calls = mockMigrate([dryLocal], [{ status: 500, body: { error: 'x' } }]);
    await mount();
    expect(calls.apply).toBe(1);
    act(() => root?.unmount());
    host?.remove();
    await mount();
    expect(calls.apply).toBe(1);
    expect(kind()).toBe('held');
    expect($('format-older-retry')).not.toBe(null);
  });

  test('the guard (pure): blocked after an attempt, re-armed by another answer, capped per session', async () => {
    const { autoStep, AUTO_FRESH, AUTO_MAX } = await import('../client/v2/shell/format-update.js');
    const ready = { kind: 'ready' };
    let g = AUTO_FRESH;
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const s = autoStep(g, i % 2 ? { kind: 'offline' } : ready);
      if (s.apply) n++;
      g = s.guard;
    }
    expect(n).toBe(AUTO_MAX);
    // a probe in flight is no change of conditions
    const s1 = autoStep(AUTO_FRESH, ready);
    expect(autoStep(autoStep(s1.guard, { kind: 'checking' }).guard, ready).apply).toBe(false);
    // a run that went through stays blocked on the same trigger (a stale /_config) …
    expect(autoStep(s1.guard, ready, 'format').apply).toBe(false);
    // … and the next trigger (format moved, the switch still due) is a new one
    expect(autoStep(s1.guard, ready, 'save').apply).toBe(true);
  });
});

describe('a Maude Cloud project during the rc', () => {
  const held = (linked: Record<string, unknown> = {}) => ({
    ...dryLinked({ hub: 'https://alligators.cloud.maude.sh', hubFormat: 1, ...linked }),
    autoConvert: { allowed: false, why: 'cloud-rc' },
  });

  test('never converts by itself; the owner can, past the warning', async () => {
    const calls = mockMigrate([held()], [{ status: 200, body: appliedOk(1, { role: 'owner' }) }]);
    await mount();
    for (let i = 0; i < 3; i++) await focus();
    expect(calls.apply).toBe(0);
    expect(kind()).toBe('cloud');
    expect(line()).toMatch(/Maude Cloud/);
    await act(async () => $('format-older-update')?.click());
    await wait(10);
    expect($('format-cloud-dialog')?.textContent ?? '').toMatch(/view only for everyone/);
    await act(async () => $('format-cloud-confirm')?.click());
    await wait(20);
    expect(calls.apply).toBe(1);
    expect(calls.bodies.find((b) => b.apply)?.confirmCloud).toBe(true);
  });

  test('the save-mode switch alone on a cloud hub: nothing automatic', async () => {
    const calls = mockMigrate([
      {
        ...held({ modeDue: true, mode: 'legacy', hubFormat: 2 }),
        project: {
          formatBefore: 2,
          linked: {
            hub: 'https://alligators.cloud.maude.sh',
            role: 'owner',
            hubFormat: 2,
            capabilities: ['format-v2'],
            modeDue: true,
          },
        },
      },
    ]);
    await mount(fmt2Legacy);
    await focus();
    expect(calls.apply).toBe(0);
  });

  test('the cloud tab itself (a cell): nothing automatic either', async () => {
    const calls = mockMigrate([dryLocal]);
    await mount({ ...older, cloud: { role: 'owner', projectName: 'Alligators brand' } });
    expect(calls.apply).toBe(0);
    expect(kind()).toBe('cloud');
  });
});

// p8-sec2-lows B2-3 — the timer that re-asks the team server backs off, so a project blocked for good (browser
// not paired, server not set up) is not a dry run against the owner's hub every minute.
describe('the re-check backs off', () => {
  test('each timed re-check waits longer than the last, up to ten minutes', async () => {
    const calls = mockMigrate([dryLinked({ modeBlocker: 'browser-not-paired', mode: 'legacy' })]);
    const realSet = globalThis.setTimeout;
    const timers: Array<{ ms: number; fn: () => void }> = [];
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if ((ms ?? 0) >= 60_000) {
        timers.push({ ms: ms as number, fn });
        return 0 as never;
      }
      return realSet(fn, ms, ...rest);
    }) as typeof setTimeout;
    try {
      await mount();
      expect(kind()).toBe('server-setup');
      const dryAtStart = calls.dry;
      const seen: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t = timers.at(-1);
        if (!t) break;
        seen.push(t.ms);
        timers.length = 0;
        await act(async () => t.fn());
        await wait(20);
      }
      expect(seen).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
      expect(calls.dry).toBe(dryAtStart + 6); // each fire is one dry run, no more
    } finally {
      globalThis.setTimeout = realSet;
    }
  });
});

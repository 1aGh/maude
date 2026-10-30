// S11.11 — Diagnostics: Logs (time column, Copy all, Show in Finder), AI setup in four rows, and
// Resync from the click to the sentence (06 ad-diag · ad-logs · ad-trace). Pure functions and the
// handler the rows run; the real components are in v2-diagnostics-render.test.tsx.

import { describe, expect, test } from 'bun:test';

import { createDiagnosticsHandlers } from '../client/v2/diagnostics/diagnostics-handlers.js';
import {
  aiNeedsWork,
  aiRows,
  clock,
  logLines,
  logsText,
} from '../client/v2/diagnostics/diagnostics-model.js';
import {
  groupDigits,
  resyncNeedsYou,
  resyncPercent,
  resyncProgressText,
  resyncResultText,
} from '../client/v2/diagnostics/resync-model.js';
import { runResync } from '../client/v2/diagnostics/resync-run.js';

const at = (h: number, m: number, s: number) => new Date(2026, 9, 18, h, m, s).getTime();

describe('logs: a time, merged by time, the tag left to the source column', () => {
  const sources = {
    sync: {
      recent: ['[log] [sync] pushed a.tsx', '[warn] [sync] hub replied 429 · retry in 40 s'],
      recentAt: [at(14, 5, 12), at(14, 6, 31)],
    },
    server: { recent: ['[log] canvas built · Pricing'], recentAt: [at(14, 5, 40)] },
    ai: { recent: ['[log] [acp] turn done'], recentAt: [at(14, 6, 1)] },
    export: { recent: [], recentAt: [] },
  };

  test('oldest first across sources; `shown` has no [sync] tag, `text` keeps it for the search', () => {
    const l = logLines(sources);
    expect(l.map((x) => `${clock(x.at)} ${x.source}`)).toEqual([
      '14:05:12 sync',
      '14:05:40 server',
      '14:06:01 ai',
      '14:06:31 sync',
    ]);
    expect(l[0]).toMatchObject({ shown: 'pushed a.tsx', text: '[sync] pushed a.tsx' });
    expect(l[2]?.shown).toBe('[acp] turn done'); // an unrelated tag is part of the message
    expect(logLines(sources, { query: '[sync]' })).toHaveLength(2);
  });

  test('"Copy all" is the lines as shown — time, source, message — nothing else', () => {
    expect(logsText(logLines(sources, { filter: 'sync' }))).toBe(
      '14:05:12  sync  pushed a.tsx\n14:06:31  sync  hub replied 429 · retry in 40 s'
    );
  });

  test('lines the server did not stamp (an older studio) keep source order and print without a time', () => {
    const old = { sync: { recent: ['[log] a'] }, server: { recent: ['[log] b'] } };
    const l = logLines(old);
    expect(l.map((x) => x.source)).toEqual(['sync', 'server']);
    expect(clock(l[0]?.at)).toBe('');
    expect(logsText(l)).toBe('sync  a\nserver  b');
  });

  test('nothing in the ring: nothing to copy', () => {
    expect(logsText(logLines({}))).toBe('');
  });
});

describe('AI setup: four answers over the probe’s own data', () => {
  const claude = (over: Record<string, unknown> = {}) => ({
    id: 'claude',
    label: 'Claude Code (the `claude` CLI)',
    required: true,
    status: 'present',
    detail: 'Signed in',
    resolvedPath: '/Users/me/.local/bin/claude',
    ...over,
  });
  const plugins = (status = 'present') => ({
    id: 'plugins',
    label: 'Plugins',
    required: true,
    status,
    detail: '',
  });

  test('all well: four ✓ rows in the canvas’s order, the path with its origin', () => {
    const rows = aiRows({ ready: true, items: [claude(), plugins()] });
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['installed', 'ok'],
      ['found', 'ok'],
      ['signed-in', 'ok'],
      ['plugins', 'ok'],
    ]);
    expect(rows[1]).toMatchObject({ value: '~/.local/bin/claude', hint: 'Found on your PATH' });
    expect(
      aiRows({ ready: true, items: [claude({ resolvedViaMaude: true }), plugins()] })[1]?.hint
    ).toBe('Installed by Maude');
    expect(aiNeedsWork({ items: [claude(), plugins()] })).toEqual([]);
  });

  test('not signed in: installed and found stay ✓, only Signed in is not; that row keeps its full fix', () => {
    const report = {
      ready: false,
      items: [claude({ status: 'missing', action: 'signin' }), plugins()],
    };
    const rows = aiRows(report);
    expect(rows.map((r) => r.state)).toEqual(['ok', 'ok', 'missing', 'ok']);
    expect(aiNeedsWork(report).map((i) => i.id)).toEqual(['claude']);
  });

  test('not installed: no path, no fake ✓; an unreadable sign-in is "unknown", not "missing"', () => {
    const gone = aiRows({
      items: [claude({ status: 'missing', resolvedPath: undefined }), plugins('missing')],
    });
    expect(gone.map((r) => r.state)).toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(gone[1]?.value).toBe('');
    const unreadable = aiRows({ items: [claude({ status: 'unknown' }), plugins()] });
    expect(unreadable[2]?.state).toBe('unknown');
  });

  test('before the probe answers there are no rows', () => {
    expect(aiRows(null)).toEqual([]);
    expect(aiRows({ items: [] })).toEqual([]);
  });
});

describe('Resync’s words (06 ad-trace)', () => {
  test('digits group with a plain space, like the canvases', () => {
    expect([groupDigits(1318), groupDigits(7), groupDigits(1204567)]).toEqual([
      '1 318',
      '7',
      '1 204 567',
    ]);
  });

  test('progress: the pair when the total is known, plain "Resyncing…" before', () => {
    expect(resyncProgressText({ done: 1204, total: 1318 })).toBe('Resyncing… 1 204 of 1 318');
    expect(resyncProgressText({ done: 0, total: 0 })).toBe('Resyncing…');
    expect(resyncProgressText(null)).toBe('Resyncing…');
    expect(resyncPercent({ done: 1204, total: 1318 })).toBe(91);
    expect(resyncPercent({ done: 0, total: 0 })).toBeNull();
  });

  test('the result: the canvas’s sentence, and the honest variants', () => {
    const done = (summary: Record<string, number>) => ({
      state: 'done',
      summary: { checked: 1318, sent: 0, fetched: 0, conflicts: 0, ...summary },
    });
    expect(resyncResultText(done({ sent: 3 }))).toBe(
      'Resync done — 3 files sent, nothing else differed.'
    );
    expect(resyncResultText(done({ sent: 1 }))).toBe(
      'Resync done — 1 file sent, nothing else differed.'
    );
    expect(resyncResultText(done({}))).toBe('Resync done — nothing differed.');
    expect(resyncResultText(done({ sent: 2, fetched: 5 }))).toBe(
      'Resync done — 2 files sent, 5 files fetched, nothing else differed.'
    );
    expect(resyncResultText(done({ sent: 3, conflicts: 2 }))).toBe(
      'Resync done — 3 files sent, 2 conflicts to look at in Sync details.'
    );
    expect(resyncNeedsYou(done({ conflicts: 1 }))).toBe(true);
    expect(resyncNeedsYou(done({ sent: 3 }))).toBe(false);
    expect(
      resyncResultText({
        state: 'attention',
        summary: { checked: 1318, sent: 1, fetched: 0, conflicts: 0 },
      })
    ).toBe('Resync stopped early — 1 file sent so far. Sync details says why.');
  });
});

// A fake studio for the runner: POST starts, GET /_sync-status answers the scripted views in turn.
function fakeFetch(views: unknown[], post: { status?: number; body?: unknown } = {}) {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/_api/sync/resync')
      return new Response(JSON.stringify(post.body ?? { ok: true, sync: { syncing: true } }), {
        status: post.status ?? 200,
      });
    const v = views[Math.min(i++, views.length - 1)];
    return new Response(JSON.stringify(v ? { linked: true, resync: v } : { linked: true }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const run = (views: unknown[], post?: { status?: number; body?: unknown }) => {
  const f = fakeFetch(views, post);
  const said: { id: string; title: string; kind: string; timerKey: string; duration?: number }[] =
    [];
  return {
    f,
    said,
    result: runResync({
      notify: (n: never) => said.push(n),
      fetchFn: f.fn,
      sleep: async () => {},
      pollMs: 0,
    }),
  };
};
const running = (done: number) => ({
  state: 'running',
  done,
  total: 1318,
  summary: { checked: 0, sent: 0, fetched: 0, conflicts: 0 },
});
const done = (summary: Record<string, number>) => ({
  state: 'done',
  done: 1318,
  total: 1318,
  summary: { checked: 1318, sent: 0, fetched: 0, conflicts: 0, ...summary },
});

describe('runResync — one notice from "Resyncing…" to the sentence', () => {
  test('1 204 of 1 318, then the result — all on the one notice id', async () => {
    const r = run([running(400), running(1204), done({ sent: 3 })]);
    const out = await r.result;
    expect(out.ok).toBe(true);
    expect(r.said.map((n) => n.title)).toEqual([
      'Resyncing…',
      'Resyncing… 400 of 1 318',
      'Resyncing… 1 204 of 1 318',
      'Resync done — 3 files sent, nothing else differed.',
    ]);
    expect(new Set(r.said.map((n) => n.id))).toEqual(new Set(['sync.resync']));
    // progress is one phase (same timerKey, stays up); the result is a new phase
    expect(r.said.slice(0, 3).map((n) => n.timerKey)).toEqual(['run', 'run', 'run']);
    expect(r.said[0]?.duration).toBe(Number.POSITIVE_INFINITY);
    expect(r.said.at(-1)?.kind).toBe('success');
    expect(r.said.at(-1)?.timerKey).toBe('done');
    expect(r.f.calls[0]).toBe('POST /_api/sync/resync');
  });

  test('a conflict is a warning that points at Sync details', async () => {
    const r = run([done({ sent: 3, conflicts: 1 })]);
    await r.result;
    expect(r.said.at(-1)).toMatchObject({
      kind: 'warning',
      title: 'Resync done — 3 files sent, 1 conflict to look at in Sync details.',
    });
  });

  test('busy, refused and declined each say why and never poll', async () => {
    const busy = run([], { status: 409, body: { ok: false } });
    expect((await busy.result).ok).toBe(false);
    expect(busy.said.at(-1)).toMatchObject({
      kind: 'error',
      title: 'Already restarting — give it a moment.',
    });
    expect(busy.f.calls).toEqual(['POST /_api/sync/resync']);
    const declined = run([], {
      body: { ok: true, sync: { syncing: false, detail: 'This project isn’t linked.' } },
    });
    expect((await declined.result).ok).toBe(false);
    expect(declined.said.at(-1)?.title).toBe('This project isn’t linked.');
    const refused = run([], {
      status: 403,
      body: { ok: false, detail: 'Resync must be started from Maude itself.' },
    });
    await refused.result;
    expect(refused.said.at(-1)?.title).toBe('Resync must be started from Maude itself.');
  });

  test('no trace after the restart (an old studio): says it started, does not hang', async () => {
    const r = run([null]);
    expect((await r.result).ok).toBe(true);
    expect(r.said.at(-1)?.title).toBe('Resync started — Diagnostics › Sync shows how it is going.');
  });

  test('stopped early is told as such', async () => {
    const r = run([
      {
        state: 'attention',
        done: 900,
        total: 1318,
        summary: { checked: 1318, sent: 0, fetched: 0, conflicts: 0 },
      },
    ]);
    await r.result;
    expect(r.said.at(-1)).toMatchObject({
      kind: 'warning',
      title: 'Resync stopped early — Sync details says why.',
    });
  });
});

describe('the rows that run it', () => {
  test('Resync now goes through the runner; Copy logs copies the lines and says so', async () => {
    const copied: string[] = [];
    const toasts: string[] = [];
    const notices: string[] = [];
    const fetchFn = (async (url: string) => {
      if (url === '/_api/diagnostics')
        return new Response(
          JSON.stringify({
            sources: {
              sync: { recent: ['[log] [sync] pushed a.tsx'], recentAt: [at(14, 5, 12)] },
              server: { recent: [], recentAt: [] },
              ai: { recent: [], recentAt: [] },
              export: { recent: [], recentAt: [] },
            },
          })
        );
      if (url === '/_api/sync/resync')
        return new Response(JSON.stringify({ ok: true, sync: { syncing: true } }));
      return new Response(JSON.stringify({ resync: done({ sent: 3 }) }));
    }) as unknown as typeof fetch;
    const h = createDiagnosticsHandlers(
      { toast: (m: string) => toasts.push(m) },
      {
        fetchFn,
        write: async (t: string) => {
          copied.push(t);
          return true;
        },
        notify: (n: { title: string }) => notices.push(n.title),
        sleep: async () => {},
        pollMs: 0,
      }
    );
    await h['diag.copy-logs']();
    expect(copied).toEqual(['14:05:12  sync  pushed a.tsx']);
    expect(toasts).toEqual(['Logs copied.']);
    await h['sync.resync']();
    expect(notices.at(-1)).toBe('Resync done — 3 files sent, nothing else differed.');
    // the show-in-Finder button is native: no shell handler to double-run it
    expect('diag.logs-show-in-finder' in h).toBe(false);
  });

  // p8-sweep-advanced — the dead-control crawl reaches Menu › Diagnostics › Advanced › Download all only through an
  // injected hub-link status (the rig has no hub); this pins the row's action itself.
  test('Download all asks the server for everything offline and says the answer', async () => {
    const toasts: string[] = [];
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify({ ok: true, complete: true, pulled: 4 }));
    }) as unknown as typeof fetch;
    const h = createDiagnosticsHandlers({ toast: (m: string) => toasts.push(m) }, { fetchFn });
    await h['sync.download-all']();
    expect(calls).toEqual(['POST /_api/sync/offline']);
    expect(toasts[0]).toBe('Downloading everything for offline…');
    expect(toasts).toHaveLength(2);
    expect(toasts[1]).toMatch(/\S/);
  });

  test('Copy logs with nothing to copy, or an unreadable studio, says so and copies nothing', async () => {
    const copied: string[] = [];
    const toasts: string[] = [];
    const mk = (fetchFn: unknown) =>
      createDiagnosticsHandlers(
        { toast: (m: string) => toasts.push(m) },
        {
          fetchFn,
          write: async (t: string) => {
            copied.push(t);
            return true;
          },
        }
      );
    await mk(async () => new Response(JSON.stringify({ sources: {} })))['diag.copy-logs']();
    await mk(async () => new Response('no', { status: 403 }))['diag.copy-logs']();
    await mk(async () => {
      throw new Error('down');
    })['diag.copy-logs']();
    expect(copied).toEqual([]);
    expect(toasts).toEqual([
      'There are no log lines yet.',
      'Couldn’t read the logs.',
      'Couldn’t read the logs.',
    ]);
  });
});

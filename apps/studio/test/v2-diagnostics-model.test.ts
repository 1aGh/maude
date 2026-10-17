// V2-4.7b — Menu › Diagnostics as pure functions: one status word per source (Sync · Server · AI setup),
// the Advanced values, the rows left out for a cloud member, and the log filter.
import { describe, expect, test } from 'bun:test';
import { createDiagnosticsHandlers } from '../client/v2/diagnostics/diagnostics-handlers.js';
import {
  aiWord,
  diagnosticsInfo,
  hiddenMenuIds,
  logLines,
  menuStatuses,
  modeStamp,
  parseLine,
  serverWord,
  syncWord,
  tilde,
} from '../client/v2/diagnostics/diagnostics-model.js';
import { requestOffline, requestResync } from '../client/v2/diagnostics/sync-actions.js';

const linked = (over: Record<string, unknown> = {}) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  ...over,
});

describe('the Sync word', () => {
  test('a solo project is a neutral "Local project", not a problem', () => {
    expect(syncWord(null)).toEqual({ word: 'Local project', tone: 'neutral' });
    expect(syncWord({ linked: false })).toEqual({ word: 'Local project', tone: 'neutral' });
  });
  test('ok: synced → Up to date, syncing → Syncing…', () => {
    expect(syncWord(linked()).word).toBe('Up to date');
    expect(syncWord(linked()).tone).toBe('ok');
    expect(syncWord(linked({ docs: { synced: 1, pending: 2, rejected: 0 } })).word).toBe(
      'Syncing…'
    );
  });
  test('offline: the link is down → Offline (warn)', () => {
    expect(syncWord(linked({ state: 'offline' }))).toEqual({ word: 'Offline', tone: 'warn' });
  });
  test('failed: every document refused → Failed (error)', () => {
    const w = syncWord(linked({ docs: { synced: 0, pending: 0, rejected: 2 } }));
    expect(w.tone).toBe('error');
    expect(w.word).toBe('Failed');
  });
  test('an unfinished AI edit held for the person → Needs you', () => {
    expect(syncWord(linked(), { aiHeld: true })).toEqual({ word: 'Needs you', tone: 'warn' });
  });
});

describe('the Server and AI words', () => {
  test('Server: Running when live, Reconnecting… when the socket is down, Not responding when unreachable', () => {
    expect(serverWord({ wsConnected: true })).toEqual({ word: 'Running', tone: 'ok' });
    expect(serverWord({ wsConnected: false })).toEqual({ word: 'Reconnecting…', tone: 'warn' });
    expect(serverWord({ unreachable: true }).tone).toBe('error');
  });
  test('AI setup: Ready / Needs setup from the preflight report, Checking… before it', () => {
    expect(aiWord(null).word).toBe('Checking…');
    expect(aiWord({ ready: true, items: [] })).toEqual({ word: 'Ready', tone: 'ok' });
    expect(aiWord({ ready: false, items: [{ id: 'claude', status: 'missing' }] })).toEqual({
      word: 'Needs setup',
      tone: 'warn',
    });
  });
});

describe('menuStatuses', () => {
  test('words for the three sources, values for the three Advanced rows', () => {
    const s = menuStatuses({
      syncStatus: linked(),
      wsConnected: true,
      report: { ready: true, items: [] },
      info: { address: 'localhost:4402', pid: 41207, folder: '/Users/me/Maude/alligators' },
    });
    expect(s['diag.sync'].word).toBe('Up to date');
    expect(s['diag.server'].word).toBe('Running');
    expect(s['diag.ai'].word).toBe('Ready');
    expect(s['diag.address']).toEqual({ word: 'localhost:4402', tone: 'neutral', mono: true });
    expect(s['diag.process'].word).toBe('41207');
    expect(s['diag.project-folder'].word).toBe('~/Maude/alligators');
  });
  test('a value that is not known leaves its row without one', () => {
    const s = menuStatuses({ info: { address: '', pid: null, folder: '' } });
    expect(s['diag.address']).toBeUndefined();
    expect(s['diag.process']).toBeUndefined();
    expect(s['diag.project-folder']).toBeUndefined();
  });
  test('tilde only shortens a home prefix', () => {
    expect(tilde('/Users/me/x')).toBe('~/x');
    expect(tilde('/srv/x')).toBe('/srv/x');
  });
});

describe('rows left out', () => {
  test('a cloud member has neither Resync nor Download all (the hub refuses the route)', () => {
    expect(hiddenMenuIds({ cloud: { url: 'x' }, syncStatus: linked({ files: {} }) })).toEqual([
      'sync.resync',
      'sync.download-all',
    ]);
  });
  test('a desktop copy with a file plane has both; without one, no Download all; unlinked, neither', () => {
    expect(hiddenMenuIds({ syncStatus: linked({ files: {} }) })).toEqual([]);
    expect(hiddenMenuIds({ syncStatus: linked() })).toEqual(['sync.download-all']);
    expect(hiddenMenuIds({ syncStatus: null })).toEqual(['sync.download-all', 'sync.resync']);
  });
});

describe('logs', () => {
  const sources = {
    sync: { recent: ['[log] [sync] pushed a.tsx', '[warn] [sync] hub replied 429'] },
    server: { recent: ['[log] canvas built · Pricing'] },
    ai: { recent: [] },
    export: { recent: ['[error] [remote] png FAILED 500'] },
  };
  test('parseLine keeps the level and the message', () => {
    expect(parseLine('[warn] [sync] x')).toEqual({ level: 'warn', text: '[sync] x' });
    expect(parseLine('plain')).toEqual({ level: 'log', text: 'plain' });
  });
  test('all merges the four sources; one source narrows; a query narrows further', () => {
    expect(logLines(sources).map((l) => l.source)).toEqual(['sync', 'sync', 'server', 'export']);
    expect(logLines(sources, { filter: 'sync' })).toHaveLength(2);
    expect(logLines(sources, { filter: 'ai' })).toEqual([]);
    expect(logLines(sources, { query: '429' }).map((l) => l.level)).toEqual(['warn']);
  });
  test('the mode stamp is what the menu bar said: Idle · Canvas · System', () => {
    expect(modeStamp({}).stamp).toBe('Idle');
    expect(modeStamp({ activePath: 'ui/a.tsx' }).stamp).toBe('Canvas');
    expect(modeStamp({ isSystem: true }).stamp).toBe('System');
  });
});

describe('diagnosticsInfo', () => {
  test('reads pid and version off the server status; a bad payload gives empty facts', () => {
    const i = diagnosticsInfo(
      { sources: { server: { status: { pid: 41207, version: '2.0.0', uptimeSeconds: 12 } } } },
      { host: 'localhost:4402', folder: '/x' }
    );
    expect(i).toMatchObject({
      address: 'localhost:4402',
      pid: 41207,
      version: '2.0.0',
      folder: '/x',
    });
    expect(diagnosticsInfo(null).pid).toBeNull();
  });
});

describe('what the rows run', () => {
  test('the Diagnostics rows ask for their view; Advanced values copy; unknown ones say so', async () => {
    const opened: unknown[][] = [];
    const toasts: string[] = [];
    const copied: string[] = [];
    const h = createDiagnosticsHandlers(
      { toast: (m: string) => toasts.push(m) },
      {
        open: (...a: unknown[]) => opened.push(a),
        facts: () => ({ address: 'localhost:4402', pid: 41207, folder: '' }),
        write: async (t: string) => {
          copied.push(t);
          return true;
        },
      }
    );
    h['diag.sync']();
    h['diag.server']();
    h['diag.ai']();
    h['diag.logs']();
    h['diag.ai-recheck']();
    expect(opened).toEqual([['sync'], ['server'], ['ai'], ['logs'], ['ai', { recheck: true }]]);
    await h['diag.address']();
    await h['diag.process']();
    await h['diag.project-folder']();
    expect(copied).toEqual(['localhost:4402', '41207']);
    expect(toasts).toEqual([
      'Address copied.',
      'Process number copied.',
      'Project folder isn’t known here.',
    ]);
  });
});

describe('Resync and Download all (moved out of the Sync panel, wording unchanged)', () => {
  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });
  test('resync: ok is silent, 409 / failure / unreachable have the panel’s sentences', async () => {
    expect(await requestResync(reply(200, { ok: true, sync: { syncing: true } }))).toEqual({
      ok: true,
      note: '',
    });
    expect((await requestResync(reply(409, {}))).note).toBe(
      'Already restarting — give it a moment.'
    );
    expect((await requestResync(reply(500, {}))).note).toBe('Resync could not start.');
    expect(
      (await requestResync(reply(200, { ok: true, sync: { syncing: false, detail: 'Asleep.' } })))
        .note
    ).toBe('Asleep.');
    expect(
      (
        await requestResync(async () => {
          throw new Error('down');
        })
      ).note
    ).toBe('Maude could not reach the sync service.');
  });
  test('download all: complete / partial / refused', async () => {
    expect(await requestOffline(reply(200, { ok: true, complete: true, pulled: 1 }))).toBe(
      'Everything is on this device — 1 file came down.'
    );
    expect(await requestOffline(reply(200, { ok: true, pulled: 2, failed: 3 }))).toBe(
      '2 files came down; 3 still to come — Maude keeps trying.'
    );
    expect(await requestOffline(reply(200, { ok: false }))).toBe(
      'Could not download the project right now.'
    );
  });
});

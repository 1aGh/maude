// S11.11 — `maude design logs` and `maude design sync status|resync` (Menu › Diagnostics from a
// terminal; 06 ad-logs, ad-trace). `logs` and `sync status` read (effect none → auto tier);
// `sync resync` re-compares every file with the cloud copy (shared → prompt).

import { afterEach, describe, expect, test } from 'bun:test';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

// the verb prints local time; the child runs in UTC so the clock reads the same everywhere
const T = (h: number, m: number, s: number) => Date.UTC(2026, 9, 18, h, m, s);
const UTC = { TZ: 'UTC' };

// A studio older than the verb: its lines still carry a secret. The verb scrubs once more.
const GH = `ghp_${'a1B2c3D4e5F6g7H8i9J0'}`;
const DIAG = {
  retentionDays: 7,
  logDir: '~/.maude/logs',
  sources: {
    sync: {
      status: {},
      recent: [
        '[log] [sync] pushed Combine-kampan.tsx',
        '[warn] [sync] hub replied 429 · retry in 40 s',
        `[log] [sync] auth header Authorization: Bearer ${GH}`,
      ],
      recentAt: [T(14, 5, 12), T(14, 6, 31), T(14, 7, 0)],
    },
    server: {
      status: {},
      recent: [
        '[log] canvas built · Combine-kampan · 412 ms',
        '[log] evil\u001b]0;pwned\u0007 title',
      ],
      recentAt: [T(14, 5, 40), T(14, 8, 0)],
    },
    ai: { status: {}, recent: ['[log] [acp] chat c-1 · turn done'], recentAt: [T(14, 6, 1)] },
    export: { status: {}, recent: [], recentAt: [] },
  },
};

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});
const diagHandler = (s: Seen) => (s.path === '/_api/diagnostics' ? json(DIAG) : undefined);
const lines = (stdout: string) => stdout.split('\n').filter((l) => /^\d\d:\d\d:\d\d/.test(l));

describe('maude design logs', () => {
  test('all four sources, merged by time, oldest first, the [prefix] left to the source column', async () => {
    studio = fakeStudio(diagHandler);
    const r = await studio.run('logs', ['--tail', '100'], UTC);
    expect(r.code).toBe(0);
    const l = lines(r.stdout);
    expect(l[0]).toMatch(/^14:05:12 {2}sync {3}pushed Combine-kampan\.tsx$/);
    expect(l[1]).toMatch(/^14:05:40 {2}server {1}canvas built/);
    expect(l[2]).toMatch(/^14:06:01 {2}ai {5}\[acp\] chat c-1/); // an unrelated prefix stays
    expect(l[3]).toMatch(/^14:06:31 {2}sync {3}warn: hub replied 429/);
    expect(studio.seen.map((s) => s.path)).toEqual(['/_api/diagnostics']);
  });

  test('--source, --grep and --tail narrow it', async () => {
    studio = fakeStudio(diagHandler);
    const sync = lines((await studio.run('logs', ['--source', 'sync'], UTC)).stdout);
    expect(sync).toHaveLength(3);
    expect(sync.every((x) => / sync {3}/.test(x))).toBe(true);
    const grep = lines((await studio.run('logs', ['--grep', 'CANVAS BUILT'])).stdout);
    expect(grep).toHaveLength(1);
    const tail = lines((await studio.run('logs', ['--tail', '2'], UTC)).stdout);
    expect(tail).toHaveLength(2);
    expect(tail.at(-1)).toContain('14:08:00');
  });

  test('a secret in a line never reaches the terminal (text or --json)', async () => {
    studio = fakeStudio(diagHandler);
    const text = await studio.run('logs', []);
    const js = await studio.run('logs', ['--json']);
    for (const out of [text.stdout, js.stdout]) {
      expect(out).not.toContain(GH);
      expect(out).not.toContain('a1B2c3D4e5F6g7H8i9J0');
    }
    expect(text.stdout).toContain('[redacted]');
  });

  test('peer-written text is data: control characters out, one untrusted block, json marked', async () => {
    studio = fakeStudio(diagHandler);
    const r = await studio.run('logs', []);
    expect(r.stdout).toContain('BEGIN UNTRUSTED DATA');
    const control = [...r.stdout].filter((ch) => {
      const n = ch.charCodeAt(0);
      return (n < 32 && n !== 10) || (n >= 127 && n < 160);
    });
    expect(control).toEqual([]);
    const j = JSON.parse((await studio.run('logs', ['--json'])).stdout);
    expect(j.untrusted).toBe(true);
    expect(j.lines[0]).toMatchObject({
      source: 'sync',
      level: 'log',
      text: 'pushed Combine-kampan.tsx',
    });
  });

  test('lines with no timestamp (an older studio) still print, source by source', async () => {
    const old = structuredClone(DIAG) as typeof DIAG;
    for (const s of Object.values(old.sources)) (s as { recentAt?: number[] }).recentAt = undefined;
    studio = fakeStudio((s) => (s.path === '/_api/diagnostics' ? json(old) : undefined));
    const r = await studio.run('logs', ['--source', 'server']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('canvas built');
  });

  test('usage errors make no request', async () => {
    studio = fakeStudio(diagHandler);
    for (const args of [
      ['--source', 'nope'],
      ['--tail', '0'],
      ['--tail', '201'],
      ['--tail', 'x'],
      ['stray'],
      ['--follow'],
    ]) {
      const r = await studio.run('logs', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
    expect((await studio.run('logs', ['--help'])).code).toBe(0);
  });

  test('a refusing studio is exit 1, not a stack trace', async () => {
    studio = fakeStudio(() => new Response('no', { status: 403 }));
    const r = await studio.run('logs', []);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('refused');
  });
});

const SEED = (phase: string, delivered: number, extra: Record<string, unknown> = {}) => ({
  linked: true,
  url: 'https://alligators.cloud.maude.sh',
  canvases: 12,
  phase: 'synced',
  files: {
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    progress: { phase, tracked: 1318, delivered },
    ...extra,
  },
});
const DONE = {
  state: 'done',
  done: 1318,
  total: 1318,
  summary: { checked: 1318, sent: 3, fetched: 0, conflicts: 0 },
};

describe('maude design sync status', () => {
  test('one word, the hub host, the counts, the last resync', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_sync-status' ? json({ ...SEED('converged', 1318), resync: DONE }) : undefined
    );
    const r = await studio.run('sync', ['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Sync · ');
    expect(r.stdout).toContain('hub · alligators.cloud.maude.sh');
    expect(r.stdout).toContain('files · 1 318 of 1 318');
    expect(r.stdout).toContain('Resync done — 3 files sent, nothing else differed.');
    const j = JSON.parse((await studio.run('sync', ['status', '--json'])).stdout);
    expect(j).toMatchObject({ untrusted: true, linked: true, hub: 'alligators.cloud.maude.sh' });
    expect(j.resync.summary).toEqual({ checked: 1318, sent: 3, fetched: 0, conflicts: 0 });
  });

  test('a solo project says so', async () => {
    studio = fakeStudio((s) => (s.path === '/_sync-status' ? json({ linked: false }) : undefined));
    const r = await studio.run('sync', ['status']);
    expect(r.stdout).toContain('Sync · Local project');
  });
});

describe('maude design sync resync', () => {
  const env = { MAUDE_SYNC_POLL_MS: '5' };

  test('starts it, follows the trace, prints the sentence the toast shows', async () => {
    let polls = 0;
    studio = fakeStudio((s) => {
      if (s.path === '/_api/sync/resync') return json({ ok: true, sync: { syncing: true } });
      if (s.path === '/_sync-status') {
        polls++;
        return json({
          ...SEED('seeding', 1204),
          resync:
            polls >= 3
              ? DONE
              : {
                  state: 'running',
                  done: 1204,
                  total: 1318,
                  summary: { checked: 0, sent: 0, fetched: 0, conflicts: 0 },
                },
        });
      }
    });
    const r = await studio.run('sync', ['resync'], env);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('Resync done — 3 files sent, nothing else differed.');
    expect(studio.seen[0]).toMatchObject({ method: 'POST', path: '/_api/sync/resync' });
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  test('--no-wait only starts it', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/sync/resync' ? json({ ok: true, sync: { syncing: true } }) : undefined
    );
    const r = await studio.run('sync', ['resync', '--no-wait'], env);
    expect(r.code).toBe(0);
    expect(studio.seen.map((s) => s.path)).toEqual(['/_api/sync/resync']);
  });

  test('conflicts are a result with a pointer, not a failure', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/sync/resync') return json({ ok: true, sync: { syncing: true } });
      if (s.path === '/_sync-status')
        return json({
          ...SEED('converged', 1318),
          resync: { ...DONE, summary: { checked: 1318, sent: 2, fetched: 1, conflicts: 2 } },
        });
    });
    const r = await studio.run('sync', ['resync'], env);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      '2 files sent, 1 file fetched, 2 conflicts to look at in Sync details'
    );
  });

  test('stopped early is exit 1', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/sync/resync') return json({ ok: true, sync: { syncing: true } });
      if (s.path === '/_sync-status')
        return json({
          ...SEED('paused', 900),
          resync: {
            state: 'attention',
            done: 900,
            total: 1318,
            summary: { checked: 1318, sent: 1, fetched: 0, conflicts: 0 },
          },
        });
    });
    const r = await studio.run('sync', ['resync'], env);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Resync stopped early');
  });

  test('busy, declined and refused each say why and exit 1', async () => {
    studio = fakeStudio(() =>
      json({ ok: false, reason: 'busy', detail: 'Syncing is already restarting.' }, 409)
    );
    expect((await studio.run('sync', ['resync'], env)).stderr).toContain('already restarting');
    studio.stop();
    studio = fakeStudio(() =>
      json({
        ok: true,
        sync: { syncing: false, reason: 'unlinked', detail: 'This project is not linked.' },
      })
    );
    const declined = await studio.run('sync', ['resync'], env);
    expect(declined.code).toBe(1);
    expect(declined.stderr).toContain('not linked');
    studio.stop();
    studio = fakeStudio(() => json({ ok: false, reason: 'cross-origin', detail: 'nope' }, 403));
    expect((await studio.run('sync', ['resync'], env)).code).toBe(1);
  });

  test('usage errors make no request; only status and resync exist', async () => {
    studio = fakeStudio(() => json({}));
    for (const args of [[], ['pause'], ['status', 'x'], ['resync', '--force'], ['resync', 'now']]) {
      const r = await studio.run('sync', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
  });
});

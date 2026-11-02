// V2-2.9 (T23) — local diagnostics: four sources, 7-day retention, status providers, and a
// report that never carries what the scrubber redacts.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classify,
  diagnostics,
  initDiagnostics,
  record,
  registerStatus,
  report,
  resetDiagnosticsForTest,
  SOURCES,
  stopDiagnostics,
  sweep,
} from '../diagnostics/store.ts';

let dir: string;
beforeEach(() => {
  resetDiagnosticsForTest();
  dir = mkdtempSync(join(tmpdir(), 'maude-diag-'));
});
afterEach(async () => {
  await stopDiagnostics();
  rmSync(dir, { recursive: true, force: true });
});

describe('sources', () => {
  test('lines are routed to server, sync, ai and export by their prefix', () => {
    expect(classify('[log] [sync] linking to https://hub.example.com')).toBe('sync');
    expect(classify('[warn] [sync:presence] gone')).toBe('sync');
    expect(classify('[error] [acp-adapter] boom')).toBe('ai');
    expect(classify('[log] [acp] refusing')).toBe('ai');
    expect(classify('[error] [remote] png FAILED 500')).toBe('export');
    expect(classify('[error] [video] building bundles')).toBe('export');
    expect(classify('[log] listening on 4399')).toBe('server');
    expect(classify('[log] [mem] rss 900 MB')).toBe('server');
  });

  test('the Diagnostics API returns all four sources, each with status and recent lines', () => {
    registerStatus('server', () => ({ uptimeSeconds: 12 }));
    registerStatus('sync', () => ({ linked: false }));
    registerStatus('ai', () => ({ running: 0 }));
    registerStatus('export', () => ({ queued: 1 }));
    record('[log] [sync] up');
    record('[log] [acp] up');
    record('[log] [remote] up');
    record('[log] server up');
    const d = diagnostics();
    expect(Object.keys(d.sources).sort()).toEqual([...SOURCES].sort());
    for (const s of SOURCES) expect(d.sources[s].recent.length).toBe(1);
    expect(d.sources.export.status).toEqual({ queued: 1 });
    expect(d.retentionDays).toBe(7);
  });

  test('a source without a provider says so instead of failing', () => {
    registerStatus('ai', () => {
      throw new Error('probe broke');
    });
    const d = diagnostics();
    expect(d.sources.sync.status).toEqual({ known: false });
    expect(d.sources.ai.status).toEqual({ known: false, error: 'probe broke' });
  });
});

describe('redaction', () => {
  const planted = [
    '[log] [sync] reading /Users/someone/git/acme/.design/ui/a.tsx',
    `[log] home is ${homedir()}/secret-place`,
    '[error] [remote] Authorization: Bearer abc.def.ghi-123',
    '[log] [acp] token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '[log] key sk-ant-REDACTMEREDACTMEREDACTME',
    '[log] [sync] invited jane.doe@example.com',
    '[log] HUB_SECRET=s3cr3t-value',
  ];
  test('the report carries no project path, home path, token, key, secret or e-mail', () => {
    resetDiagnosticsForTest();
    void initDiagnostics({ repoRoot: '/Users/someone/git/acme', logDir: dir });
    for (const l of planted) record(l);
    registerStatus('sync', () => ({
      hub: 'https://hub.example.com',
      owner: 'jane.doe@example.com',
    }));
    const text = report({ project: '/Users/someone/git/acme' });
    for (const leak of [
      '/Users/someone/git/acme',
      homedir(),
      'abc.def.ghi-123',
      'ghp_AAAA',
      'sk-ant-REDACT',
      'jane.doe@example.com',
      's3cr3t-value',
    ])
      expect(text).not.toContain(leak);
    expect(text).toContain('<project>/.design/ui/a.tsx');
    expect(text).toContain('[email]');
  });

  test('persisted day files are scrubbed too', async () => {
    await initDiagnostics({
      repoRoot: '/Users/someone/git/acme',
      logDir: dir,
      now: Date.parse('2026-10-09T10:00:00Z'),
    });
    record(
      '[log] [sync] reading /Users/someone/git/acme/x.tsx for jane.doe@example.com',
      Date.parse('2026-10-09T10:00:00Z')
    );
    await stopDiagnostics();
    const file = join(dir, 'sync', '2026-10-09.log');
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, 'utf8');
    expect(body).toContain('<project>/x.tsx');
    expect(body).not.toContain('jane.doe@example.com');
    expect(body).not.toContain('/Users/someone');
  });
});

describe('scrub coverage (Phase 1 gate review)', () => {
  test('auth schemes, lowercase token keys, cookies, query secrets and vendor keys are redacted', () => {
    resetDiagnosticsForTest();
    for (const l of [
      '[log] [remote] Authorization: Basic dXNlcjpwYXNzd29yZA==',
      '[log] [sync] access_token=abcdef123456 refresh_token=zzzz9999',
      '[log] client_secret: "s3cr3tvalue"',
      '[log] Cookie: sid=deadbeefcafe; theme=dark',
      '[log] [remote] GET https://api.example.com/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstu',
      '[log] aws AKIAABCDEFGHIJKLMNOP stripe sk_live_abcdefghij1234 slack xoxb-1234567890-abcdef',
    ])
      record(l);
    const text = report();
    for (const leak of [
      'dXNlcjpwYXNzd29yZA',
      'abcdef123456',
      'zzzz9999',
      's3cr3tvalue',
      'deadbeefcafe',
      'AIzaSyA1234567890',
      'AKIAABCDEFGHIJKLMNOP',
      'sk_live_abcdefghij1234',
      'xoxb-1234567890',
    ])
      expect(text).not.toContain(leak);
  });

  test('a message with newlines cannot forge extra log entries on disk', async () => {
    await initDiagnostics({ logDir: dir, now: Date.parse('2026-10-09T10:00:00Z') });
    record(
      '[log] [sync] ok\n2026-10-09T09:00:00.000Z [log] forged entry',
      Date.parse('2026-10-09T10:00:00Z')
    );
    await stopDiagnostics();
    const body = readFileSync(join(dir, 'sync', '2026-10-09.log'), 'utf8');
    expect(body.trim().split('\n')).toHaveLength(1);
  });
});

describe('retention', () => {
  test('day files older than 7 days are swept; recent days and foreign files stay', async () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    mkdirSync(join(dir, 'server'), { recursive: true });
    mkdirSync(join(dir, 'export'), { recursive: true });
    writeFileSync(join(dir, 'server', '2026-09-30.log'), 'old');
    writeFileSync(join(dir, 'server', '2026-10-01.log'), 'old');
    writeFileSync(join(dir, 'server', '2026-10-02.log'), 'kept — exactly 7 days');
    writeFileSync(join(dir, 'export', '2026-10-09.log'), 'today');
    writeFileSync(join(dir, 'export', 'notes.txt'), 'not ours');
    await initDiagnostics({ logDir: dir, now });
    expect(existsSync(join(dir, 'server', '2026-09-30.log'))).toBe(false);
    expect(existsSync(join(dir, 'server', '2026-10-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'server', '2026-10-02.log'))).toBe(true);
    expect(existsSync(join(dir, 'export', '2026-10-09.log'))).toBe(true);
    expect(existsSync(join(dir, 'export', 'notes.txt'))).toBe(true);
    await sweep(now + 24 * 60 * 60 * 1000);
    expect(existsSync(join(dir, 'server', '2026-10-02.log'))).toBe(false);
  });

  test('nothing is written to disk before the server opts in', async () => {
    const prev = process.env.MAUDE_LOG_DIR;
    process.env.MAUDE_LOG_DIR = dir;
    try {
      resetDiagnosticsForTest(); // picks up MAUDE_LOG_DIR, persistence off
      record('[log] [sync] before init');
      await stopDiagnostics();
      expect(existsSync(join(dir, 'sync'))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MAUDE_LOG_DIR;
      else process.env.MAUDE_LOG_DIR = prev;
    }
  });
});

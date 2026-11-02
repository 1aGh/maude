// S11.11 — the Logs card's time column needs the store to say WHEN each line was recorded, and the
// redaction (V2-2.9) must hold for what the sheet, the report and `maude design logs` all read.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { diagnostics, record, report, resetDiagnosticsForTest } from '../diagnostics/store.ts';

beforeEach(() => resetDiagnosticsForTest());
afterEach(() => resetDiagnosticsForTest());

describe('recentAt — a time per line', () => {
  test('index-aligned with `recent`, per source', () => {
    record('[log] [sync] pushed a.tsx', 1_000);
    record('[log] canvas built', 2_000);
    record('[warn] [sync] hub replied 429', 3_000);
    const d = diagnostics();
    expect(d.sources.sync.recent).toHaveLength(2);
    expect(d.sources.sync.recentAt).toEqual([1_000, 3_000]);
    expect(d.sources.server.recentAt).toEqual([2_000]);
    expect(d.sources.ai.recentAt).toEqual([]);
  });

  test('stays aligned when the ring drops its oldest lines', () => {
    for (let i = 0; i < 520; i++) record(`[log] [sync] line ${i}`, i);
    const { recent, recentAt } = diagnostics(500).sources.sync;
    expect(recent).toHaveLength(500);
    expect(recentAt).toHaveLength(500);
    expect(recent[0]).toContain('line 20');
    expect(recentAt[0]).toBe(20);
    expect(recentAt.at(-1)).toBe(519);
  });

  test('a tail reads the same slice of both', () => {
    for (let i = 0; i < 10; i++) record(`[log] [sync] line ${i}`, 100 + i);
    const { recent, recentAt } = diagnostics(3).sources.sync;
    expect(recent.map((l) => l.slice(-6))).toEqual(['line 7', 'line 8', 'line 9']);
    expect(recentAt).toEqual([107, 108, 109]);
  });
});

describe('redaction holds for everything the Logs card and the verb read', () => {
  const GH = `ghp_${'a1B2c3D4e5F6g7H8i9J0'}`;
  test('a token in a line is gone from the lines, the report and the status', () => {
    record(`[log] [sync] auth Authorization: Bearer ${GH}`, 1);
    record(`[error] [acp] key sk-ant-api03-${'x'.repeat(40)} rejected`, 2);
    const d = JSON.stringify(diagnostics());
    expect(d).not.toContain(GH);
    expect(d).not.toContain('sk-ant-api03-');
    const r = report({ project: 'p' });
    expect(r).not.toContain(GH);
    expect(r).not.toContain('sk-ant-api03-');
    expect(d).toContain('[redacted]');
  });
});

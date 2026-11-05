// F6 — the aggregate per-pass byte budget on the downward lanes (Sync v2
// Increment 0, DDR-226 §9).
//
// The gap the Plane-B flip gate named: every lane capped ONE file and the COUNT
// of files, nothing capped the product. 200 × 512 MB = 100 GB, and the hub
// chooses both factors. These tests pin that a pass stops on bytes, that it
// stops LOUDLY, and — the part that matters for an untrusted hub — that a
// manifest UNDERSTATING a file's size buys no extra transfer.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pullFiles } from '../sync/file-pull.ts';
import { createPullBudget, MAX_PULL_BYTES_PER_PASS } from '../sync/pull-budget.ts';

const silent = { log: () => {}, warn: () => {} };

describe('createPullBudget', () => {
  test('commits what fits and refuses what does not', () => {
    const b = createPullBudget({ maxBytes: 100, label: 't', log: silent });
    expect(b.take(60)).toBe(true);
    expect(b.spent()).toBe(60);
    expect(b.remaining()).toBe(40);
    expect(b.take(50)).toBe(false);
    expect(b.spent()).toBe(60); // a refused charge is not committed
    expect(b.exhausted()).toBe(true);
  });

  test('an exact fit is allowed', () => {
    const b = createPullBudget({ maxBytes: 100, label: 't', log: silent });
    expect(b.take(100)).toBe(true);
    expect(b.exhausted()).toBe(false);
    expect(b.remaining()).toBe(0);
    expect(b.take(1)).toBe(false);
  });

  test('a negative or NaN size can never refund budget', () => {
    const b = createPullBudget({ maxBytes: 100, label: 't', log: silent });
    expect(b.take(-1_000_000)).toBe(true);
    expect(b.take(Number.NaN)).toBe(true);
    expect(b.spent()).toBe(0);
    expect(b.take(101)).toBe(false);
  });

  test('the wall is named exactly once, and loudly', () => {
    const warns: string[] = [];
    const b = createPullBudget({
      maxBytes: 10,
      label: 'sync/files',
      log: { warn: (m: string) => warns.push(m) },
    });
    b.take(20);
    b.take(20);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('[sync/files]');
    expect(warns[0]).toContain('byte budget');
    expect(warns[0]).toContain('next pass');
  });

  test('the default ceiling is the documented 2 GiB', () => {
    expect(MAX_PULL_BYTES_PER_PASS).toBe(2 * 1024 * 1024 * 1024);
    const b = createPullBudget({ label: 't', log: silent });
    expect(b.remaining()).toBe(MAX_PULL_BYTES_PER_PASS);
  });
});

describe('file-pull honours the pass budget', () => {
  const manifest = (files: { path: string; size: number; sha256: string }[]) =>
    ({
      files: files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        size: f.size,
        mtimeMs: Date.now(),
        class: 'inert-media',
      })),
    }) as const;

  const sha = async (bytes: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  test('charges from the manifest BEFORE the request — an over-budget batch costs no transfer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pull-budget-files-'));
    try {
      mkdirSync(join(dir, 'assets'), { recursive: true });
      const bytes = new Uint8Array(400);
      const hash = await sha(bytes);
      const fetched: string[] = [];
      const fetchImpl = (async (url: string) => {
        const u = String(url);
        if (u.endsWith('/api/files')) {
          return new Response(
            JSON.stringify(
              manifest([
                { path: 'assets/a.png', size: 400, sha256: hash },
                { path: 'assets/b.png', size: 400, sha256: hash },
                { path: 'assets/c.png', size: 400, sha256: hash },
              ])
            ),
            { status: 200 }
          );
        }
        fetched.push(u);
        return new Response(bytes, { status: 200 });
      }) as unknown as typeof fetch;

      const out = await pullFiles({
        designRoot: dir,
        hubUrl: 'https://hub.example',
        token: () => 't',
        allowCodeModules: false,
        fetchImpl,
        log: silent,
        maxPassBytes: 900,
      });

      expect(out.pulled).toHaveLength(2);
      expect(out.budgetExhausted).toBe(true);
      // The third file was never even requested — the manifest priced it.
      expect(fetched).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a manifest that UNDERSTATES a size buys no extra transfer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pull-budget-files-lie-'));
    try {
      mkdirSync(join(dir, 'assets'), { recursive: true });
      const big = new Uint8Array(5_000);
      const hash = await sha(big);
      const fetchImpl = (async (url: string) => {
        const u = String(url);
        if (u.endsWith('/api/files')) {
          return new Response(
            JSON.stringify(
              // Declares 1 byte; sends 5,000.
              manifest([{ path: 'assets/lie.png', size: 1, sha256: hash }])
            ),
            { status: 200 }
          );
        }
        return new Response(big, { status: 200 });
      }) as unknown as typeof fetch;

      const out = await pullFiles({
        designRoot: dir,
        hubUrl: 'https://hub.example',
        token: () => 't',
        allowCodeModules: false,
        fetchImpl,
        log: silent,
        maxPassBytes: 1_000,
      });

      expect(out.pulled).toEqual([]);
      expect(out.budgetExhausted).toBe(true);
      // Streamed: the transfer stops at the ceiling instead of reading all 5000 B.
      expect(out.failed[0]?.reason).toContain('declared 1 B, sent more than');
      // And crucially: nothing landed on disk.
      expect(readdirSync(join(dir, 'assets'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

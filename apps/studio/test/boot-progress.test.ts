// #204 (task L) — the studio's boot tells the cell's supervisor it is still moving. The supervisor
// (apps/hub/src/studio-child.mjs) kills a booting child only once it has gone quiet; these pins hold
// the two ends to one line format and keep the steps in server.ts.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// @ts-expect-error — plain .mjs, no types
import { BOOT_PROGRESS_RE } from '../../hub/src/studio-child.mjs';
import { bootFinished, bootStep } from '../boot-progress.ts';

const saved = { ws: process.env.MAUDE_WORKSPACE_MODE, bp: process.env.MAUDE_BOOT_PROGRESS };
afterEach(() => {
  process.env.MAUDE_WORKSPACE_MODE = saved.ws;
  process.env.MAUDE_BOOT_PROGRESS = saved.bp;
  if (saved.ws === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
  if (saved.bp === undefined) delete process.env.MAUDE_BOOT_PROGRESS;
});

describe('boot progress (#204)', () => {
  test('a step in a cell is a line the supervisor counts as progress', () => {
    process.env.MAUDE_WORKSPACE_MODE = '1';
    const lines: string[] = [];
    bootStep('http', (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(BOOT_PROGRESS_RE.test(lines[0])).toBe(true);
    expect(lines[0]).toMatch(/^\[boot\] http \+\d+ms$/);
  });

  test('a desktop prints nothing (nobody supervises it this way)', () => {
    delete process.env.MAUDE_WORKSPACE_MODE;
    delete process.env.MAUDE_BOOT_PROGRESS;
    const lines: string[] = [];
    bootStep('http', (l) => lines.push(l));
    expect(lines).toEqual([]);
  });

  test('server.ts reports its steps, and stops once it listens', () => {
    const src = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    for (const step of ['context', 'api', 'http', 'watcher', 'routes'])
      expect(src).toContain(`bootStep('${step}')`);
    const finished = src.indexOf('bootFinished();');
    expect(finished).toBeGreaterThan(src.indexOf('let server: BunServer;'));
    expect(finished).toBeLessThan(src.indexOf('ctx.paths.serverInfoFile,'));
  });

  test('nothing after the server listens', () => {
    process.env.MAUDE_WORKSPACE_MODE = '1';
    const lines: string[] = [];
    bootFinished((l) => lines.push(l));
    bootStep('late', (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[boot\] listening/);
  });
});

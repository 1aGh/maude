// p8-sweep-close (1) — the loading cap's canvas-origin liveness probe must not
// call a slow-but-alive canvas a dead server.
//
// The canvas origin answers without a CORS header (DDR-054), so a plain
// cross-origin fetch always rejects in a browser. This fake fetch behaves the
// way a browser does: a cross-origin request without `mode: 'no-cors'` rejects
// (the CORS block), a no-cors one to a live listener resolves opaque, and any
// request to a dead listener rejects.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeCanvasOrigin } from '../client/hooks/canvas-origin-probe.js';

const SHELL = 'http://localhost:4000';
function browserFetch(alive: boolean, status = 200) {
  return async (url: string, init: RequestInit = {}) => {
    if (!alive) throw new TypeError('Failed to fetch');
    const crossOrigin = /^https?:/.test(url) && !url.startsWith(SHELL);
    if (crossOrigin) {
      if (init.mode !== 'no-cors') throw new TypeError('Failed to fetch (CORS)');
      return { type: 'opaque', ok: false, status: 0 } as Response;
    }
    return { type: 'basic', ok: status < 400, status } as Response;
  };
}

describe('canvas-origin probe (loading cap, issue #115)', () => {
  test('a live cross-origin canvas listener is "compile", not "server"', async () => {
    expect(await probeCanvasOrigin('http://localhost:51681', browserFetch(true))).toBe('compile');
  });
  test('a dead canvas listener is "server"', async () => {
    expect(await probeCanvasOrigin('http://localhost:51681', browserFetch(false))).toBe('server');
  });
  test('same-origin (cell, split off): a 5xx is "server", a 200 is "compile"', async () => {
    expect(await probeCanvasOrigin('', browserFetch(true, 503))).toBe('server');
    expect(await probeCanvasOrigin('', browserFetch(true, 200))).toBe('compile');
  });
  test('the loading cap uses the probe (no bare cross-origin /_health fetch)', () => {
    const src = readFileSync(join(import.meta.dir, '../client/hooks/use-shell-core.jsx'), 'utf8');
    expect(src).toContain('probeCanvasOrigin(cfg?.canvasOrigin)');
    expect(src).not.toMatch(/fetch\(`\$\{cfg\?\.canvasOrigin \|\| ''\}\/_health`/);
  });
});

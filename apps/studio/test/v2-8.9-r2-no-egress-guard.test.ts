// V2-8.9 round 2 R2-M1 — `maude design smoke` ignored "AI may › Search the web: off": bin/smoke.sh ran
// plain `agent-browser open` on canvases the agent wrote. The guard: every bin helper that drives a
// headless browser goes through the no-egress path — a shell helper sources _no-egress.sh before its
// first agent-browser call, a Node helper launches Chromium through _pw-launch.mjs. The one exception
// is agent-browser-safe.sh, which forces --allowed-domains localhost,127.0.0.1 itself.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const SH_EXEMPT = new Set(['_no-egress.sh', 'agent-browser-safe.sh']);
const AB_CALL = /(?:^|[\s;&|(`])(?:agent-browser|"\$AB")\s+(?!>|2>)[a-z-]/m;
const SOURCED = /^\s*\. "\$\(dirname "\$0"\)\/_no-egress\.sh"\s*$/m;

const code = (src: string) =>
  src
    .split('\n')
    .map((l) => (/^\s*#/.test(l) ? '' : l))
    .join('\n');

describe('every shell helper that runs agent-browser sources _no-egress.sh first', () => {
  const shells = readdirSync(BIN).filter((f) => f.endsWith('.sh') && !SH_EXEMPT.has(f));
  const callers = shells.filter((f) => AB_CALL.test(code(readFileSync(join(BIN, f), 'utf8'))));
  test('the sweep finds the known callers', () => {
    for (const f of ['screenshot.sh', 'canvas-rects.sh', 'perf.sh', 'smoke.sh'])
      expect(callers).toContain(f);
  });
  for (const f of callers) {
    test(f, () => {
      const src = code(readFileSync(join(BIN, f), 'utf8'));
      const sourced = src.search(SOURCED);
      expect(sourced).toBeGreaterThan(-1);
      expect(sourced).toBeLessThan(src.search(AB_CALL));
    });
  }
});

describe('every Node helper that launches Chromium goes through _pw-launch.mjs', () => {
  const OWN_LAUNCH =
    /chromium\.launch|from ['"]playwright(?:-core)?['"]|require\(['"]playwright|await import\(['"]playwright/;
  const mjs = readdirSync(BIN).filter(
    (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== '_pw-launch.mjs'
  );
  test('no helper but _pw-launch.mjs loads Playwright itself', () => {
    expect(mjs.filter((f) => OWN_LAUNCH.test(readFileSync(join(BIN, f), 'utf8')))).toEqual([]);
  });
  test('the launchers use it', () => {
    const users = mjs.filter((f) => readFileSync(join(BIN, f), 'utf8').includes('launchChromium'));
    for (const f of ['_screenshot-playwright.mjs', '_canvas-rects-playwright.mjs'])
      expect(users).toContain(f);
  });
});

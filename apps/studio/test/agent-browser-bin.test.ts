// 2.0.5 packaged-app finding: the desktop sidecar pins the bundled engine with
// MAUDE_AGENT_BROWSER, but the logo/SVG import resolver only read
// MAUDE_AGENT_BROWSER_BIN, so on a Mac without a global agent-browser every
// import failed ("Couldn't read the logo."). One shared lookup now.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAgentBrowserBin } from '../bin/_agent-browser-bin.mjs';

describe('resolveAgentBrowserBin', () => {
  test('MAUDE_AGENT_BROWSER alone (no agent-browser on PATH) resolves to it', () => {
    const env = { PATH: '/nonexistent', MAUDE_AGENT_BROWSER: '/App/Contents/MacOS/agent-browser' };
    expect(resolveAgentBrowserBin(env)).toBe('/App/Contents/MacOS/agent-browser');
  });

  test('the legacy MAUDE_AGENT_BROWSER_BIN still works', () => {
    expect(resolveAgentBrowserBin({ MAUDE_AGENT_BROWSER_BIN: '/x/ab' })).toBe('/x/ab');
  });

  test('MAUDE_AGENT_BROWSER wins over the legacy name, and both beat PATH', () => {
    expect(
      resolveAgentBrowserBin({ MAUDE_AGENT_BROWSER: '/a', MAUDE_AGENT_BROWSER_BIN: '/b' })
    ).toBe('/a');
    expect(resolveAgentBrowserBin({})).toBe('agent-browser');
    expect(resolveAgentBrowserBin({ MAUDE_AGENT_BROWSER: '' })).toBe('agent-browser');
  });
});

describe('the desktop sidecar and the resolver agree on the env name', () => {
  test('every MAUDE_AGENT_BROWSER* variable sidecar.rs exports is one the resolver honours', () => {
    const rs = readFileSync(
      join(import.meta.dir, '..', '..', 'desktop', 'src-tauri', 'src', 'sidecar.rs'),
      'utf8'
    );
    const names = [...rs.matchAll(/\.env\(\s*"(MAUDE_AGENT_BROWSER\w*)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(resolveAgentBrowserBin({ [name]: '/bundled/agent-browser' })).toBe(
        '/bundled/agent-browser'
      );
    }
  });
});

describe('every JS resolver goes through the shared lookup', () => {
  const bin = join(import.meta.dir, '..', 'bin');
  for (const f of ['_import-asset.mjs', '_perf-probe.mjs', '_agent-browser-safe.mjs']) {
    test(f, () => {
      const src = readFileSync(join(bin, f), 'utf8');
      expect(src).toContain('resolveAgentBrowserBin');
      expect(src).not.toMatch(/process\.env\.MAUDE_AGENT_BROWSER(_BIN)?\s*\|\|/);
    });
  }
});

// Issue #125 — region capture plumbing: the shell URL opt-in and the shims'
// `--region` argument. The capture itself is exercised end-to-end against a
// live dev-server (playwright), not here.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseRegionArg } from '../../bin/_region.mjs';
import { canvasShellUrl } from '../../exporters/index.ts';
import { DEV_SERVER_ROOT } from '../../paths.ts';

const ctx = { designRoot: '/abs/.design', repoRoot: '/abs', serverOrigin: 'http://x' };

describe('canvasShellUrl — annotations opt-in', () => {
  test('default export URL is unchanged: hide-chrome, no annotations', () => {
    const u = new URL(canvasShellUrl(ctx, '.design/ui/Home.tsx'));
    expect(u.searchParams.get('hide-chrome')).toBe('1');
    expect(u.searchParams.has('annotations')).toBe(false);
  });

  test('annotations: true adds annotations=1 and KEEPS hide-chrome (capture CSP)', () => {
    const u = new URL(canvasShellUrl(ctx, '.design/ui/Home.tsx', { annotations: true }));
    expect(u.searchParams.get('hide-chrome')).toBe('1');
    expect(u.searchParams.get('annotations')).toBe('1');
  });
});

describe('_region.mjs parseRegionArg', () => {
  test('absent → no region', () => {
    expect(parseRegionArg(undefined)).toBeNull();
  });
  test('canvas', () => {
    expect(parseRegionArg('canvas')).toEqual({ kind: 'canvas' });
  });
  test('selector list', () => {
    expect(parseRegionArg('{"selectors":["#a","#b"]}')).toEqual({
      kind: 'selectors',
      selectors: ['#a', '#b'],
    });
  });
  test('garbage throws', () => {
    expect(() => parseRegionArg('{"selectors":[1]}')).toThrow();
    expect(() => parseRegionArg('nope')).toThrow();
  });
});

describe('_shell.html — annotations=1 re-shows the scene only', () => {
  const shell = readFileSync(
    join(DEV_SERVER_ROOT, '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
    'utf8'
  );
  test('gated on hide-chrome AND annotations=1', () => {
    const i = shell.indexOf("params.get('annotations') === '1'");
    expect(i).toBeGreaterThan(shell.indexOf("params.get('hide-chrome') === '1'"));
  });
  test('keeps comment pins hidden and the annotation <defs> laid out', () => {
    const block = shell.slice(shell.indexOf('canvas-export-annotations'));
    expect(block.slice(0, 800)).toContain('[data-mdcc-annotations]');
    expect(block.slice(0, 800)).toContain(':not(defs)');
    expect(block.slice(0, 800)).not.toContain('cm-pin');
  });
});

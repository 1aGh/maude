// S11.13 (C34, contract S11 Q10) — GET /_api/kg/summary: Settings › Advanced › Decision memory.
// Counts only, read from the committed log with no shell-out; "Not set up" is `active: false`.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aboutThisMac, createSettingsRoutes, kgSummary } from '../routes/settings.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(opts: { mode?: string; asserts?: number; logDir?: string; kgairc?: object } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kgsum-'));
  dirs.push(root);
  mkdirSync(join(root, '.ai'), { recursive: true });
  writeFileSync(
    join(root, '.ai', 'workflows.config.json'),
    JSON.stringify({ knowledgeGraph: { mode: opts.mode ?? 'auto' } })
  );
  if (opts.kgairc) writeFileSync(join(root, '.kgairc'), JSON.stringify(opts.kgairc));
  if (opts.asserts !== undefined) {
    const log = join(root, opts.logDir ?? '.kgai/store/log');
    mkdirSync(log, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < opts.asserts; i++)
      lines.push(
        JSON.stringify({
          op: 'assert',
          decision: { id: `d_${i}`, title: `SECRET-TITLE-${i}`, rationale: 'SECRET-BODY' },
        })
      );
    // noise that is not a decision
    lines.push(JSON.stringify({ op: 'upsert_element', element: { name: 'x' } }));
    writeFileSync(join(log, 'i1.ndjson'), `${lines.join('\n')}\n`);
  }
  return root;
}

describe('kgSummary — the count behind "N decisions · kgai"', () => {
  test('counts decision assertions in the committed log', () => {
    expect(kgSummary(repo({ asserts: 7 }))).toEqual({ active: true, decisions: 7, engine: 'kgai' });
  });

  test('no store at all answers null — the row says "Not set up"', () => {
    expect(kgSummary(repo())).toEqual({ active: false, decisions: null, engine: 'kgai' });
  });

  test('mode off is never active, even with a log on disk', () => {
    expect(kgSummary(repo({ mode: 'off', asserts: 3 })).active).toBe(false);
  });

  test('a .kgairc store pointing at a relative folder is read', () => {
    const root = repo({ asserts: 4, logDir: 'shared/log', kgairc: { store: './shared' } });
    expect(kgSummary(root).decisions).toBe(4);
  });

  test('a log with no decisions is set up, with zero', () => {
    const root = repo({ asserts: 0 });
    expect(kgSummary(root)).toEqual({ active: true, decisions: 0, engine: 'kgai' });
  });

  test('a missing repo root never throws', () => {
    expect(kgSummary('/nonexistent/kgsum-nope').active).toBe(false);
  });
});

describe('the route', () => {
  test('is one main-origin GET and carries no decision text', async () => {
    const root = repo({ asserts: 2 });
    const specs = createSettingsRoutes({ repoRoot: root });
    expect(specs.map((s) => `${s.method} ${s.path} ${s.origin}`)).toEqual([
      'GET /_api/kg/summary main',
      'GET /_api/settings/about main',
    ]);
    const res = await specs[0].handle(new Request('http://x/_api/kg/summary'), {});
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({ active: true, decisions: 2, engine: 'kgai' });
    expect(text).not.toContain('SECRET');
  });
});

describe('aboutThisMac — "Bun x · built in" and the bundled plugins', () => {
  test('reads the bundled plugin versions next to the studio and names the runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'about-'));
    dirs.push(root);
    for (const [name, version] of [
      ['design', '2.0.0'],
      ['flow', '2.0.1'],
    ]) {
      mkdirSync(join(root, 'plugins', name, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(root, 'plugins', name, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name, version })
      );
    }
    mkdirSync(join(root, 'apps', 'studio'), { recursive: true });
    const about = aboutThisMac(join(root, 'apps', 'studio'));
    expect(about.plugins).toEqual([
      { name: 'design', version: '2.0.0' },
      { name: 'flow', version: '2.0.1' },
    ]);
    expect(about.runtime).toMatch(/^Bun \d+\.\d+\.\d+/);
  });

  test('an npm layout without the plugin manifests lists none', () => {
    const root = mkdtempSync(join(tmpdir(), 'about-'));
    dirs.push(root);
    expect(aboutThisMac(join(root, 'apps', 'studio')).plugins).toEqual([]);
  });
});

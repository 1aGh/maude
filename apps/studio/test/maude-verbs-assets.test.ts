// S8.11 — `maude design assets [--usage <asset>] [--not-used]` (read-only, auto tier).
// From the running studio's `/_api/index?part=assets`, else the static index built in-process,
// where "Not used" lists nothing because older versions cannot be read.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const row = (rel: string, over: Record<string, unknown> = {}) => ({
  rel,
  kind: 'image',
  size: 2048,
  mtimeMs: 1,
  usedIn: [],
  usedBy: 0,
  usedElsewhere: false,
  olderVersions: false,
  recentTake: false,
  notUsed: false,
  ...over,
});
const ROWS = [
  row('assets/aaaaaaaa.png', { usedIn: ['ui/a.tsx', 'ui/b.tsx'], usedBy: 2 }),
  row('assets/eeeeeeee.png', { notUsed: true }),
  row('assets/ffffffff.png', { olderVersions: true }),
  row('assets/evil\u001b]0;x\u0007.png', { notUsed: true }),
];
let history = 'ready';
const handler = (s: Seen) => {
  if (s.path === '/_api/index' && s.query.part === 'assets')
    return json({ seq: 3, history, assets: ROWS });
};

let studio: ReturnType<typeof fakeStudio> | null = null;
let plain: string | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
  if (plain) rmSync(plain, { recursive: true, force: true });
  plain = null;
  history = 'ready';
});

describe('maude design assets (studio)', () => {
  test('lists every asset with its use', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('assets', []);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('4 assets');
    expect(r.stdout).toContain('assets/aaaaaaaa.png  image  2 KB  2 canvases');
    expect(studio.seen.map((s) => s.path)).toEqual(['/_api/index']);
  });

  test('--usage names the canvases, by full path or bare name; an unknown asset exits 1', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('assets', ['--usage', 'aaaaaaaa.png']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('used in ui/a.tsx');
    expect(r.stdout).toContain('used in ui/b.tsx');
    const j = JSON.parse(
      (await studio.run('assets', ['--usage', '.design/assets/ffffffff.png', '--json'])).stdout
    );
    expect(j.olderVersions).toBe(true);
    const bad = await studio.run('assets', ['--usage', 'nope.png']);
    expect(bad.code).toBe(1);
  });

  test('--usage --details asks the studio for the details of that asset; --details alone is a usage error', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/asset-details')
        return json({
          ok: true,
          details: {
            rel: 'assets/aaaaaaaa.png',
            uses: [{ canvas: 'ui/a.tsx', boards: [{ id: 'ab-post', label: 'Post 4:5' }] }],
            madeByAi: {
              prompt: 'night touchdown',
              provider: 'fal',
              model: 'flux',
              at: '2026-10-18T09:12:00Z',
            },
            footage: null,
            advanced: {
              storedAs: 'assets/aaaaaaaa.png',
              edits: [],
              cutOuts: [],
              original: '~/Pictures/IMG.jpg',
            },
          },
        });
      return handler(s);
    });
    const r = await studio.run('assets', ['--usage', 'aaaaaaaa.png', '--details']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('prompt: night touchdown');
    expect(r.stdout).toContain('on artboard ab-post (Post 4:5) in ui/a.tsx');
    expect(r.stdout).toContain('original: ~/Pictures/IMG.jpg');
    expect(studio.seen.find((s) => s.path === '/_api/asset-details')?.query.path).toBe(
      'assets/aaaaaaaa.png'
    );
    expect(studio.seen.every((s) => s.method === 'GET')).toBe(true);
    expect((await studio.run('assets', ['--details'])).code).toBe(2);
  });

  test('--not-used lists the unused, never an asset an older version shows', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('assets', ['--not-used', '--json']);
    const out = JSON.parse(r.stdout);
    expect(out.checking).toBe(false);
    expect(out.assets.map((a: { rel: string }) => a.rel)).toEqual([
      'assets/eeeeeeee.png',
      'assets/evil\u001b]0;x\u0007.png',
    ]);
    const text = (await studio.run('assets', ['--not-used'])).stdout;
    expect(text).toContain('2 not used');
    // names are printed as data: no control characters reach the terminal
    const control = [...text].filter((ch) => {
      const n = ch.charCodeAt(0);
      return (n < 32 && n !== 10) || (n >= 127 && n < 160);
    });
    expect(control).toEqual([]);
  });

  test('--not-used lists nothing while the history scan is running', async () => {
    history = 'checking';
    studio = fakeStudio(handler);
    const r = await studio.run('assets', ['--not-used']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Checking older versions');
    expect(r.stdout).not.toContain('eeeeeeee');
    const j = JSON.parse((await studio.run('assets', ['--not-used', '--json'])).stdout);
    expect(j).toMatchObject({ checking: true, assets: [] });
  });

  test('read-only: only a GET, and flags that would escalate are refused', async () => {
    studio = fakeStudio(handler);
    expect((await studio.run('assets', ['--delete'])).code).toBe(2);
    expect((await studio.run('assets', ['--usage', 'a.png', '--not-used'])).code).toBe(2);
    expect(studio.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('maude design assets (no studio)', () => {
  function project() {
    plain = mkdtempSync(join(tmpdir(), 'maude-assets-cli-'));
    mkdirSync(join(plain, '.design', 'ui'), { recursive: true });
    mkdirSync(join(plain, '.design', 'assets'), { recursive: true });
    writeFileSync(join(plain, '.design', 'config.json'), '{}');
    writeFileSync(join(plain, '.design', 'assets', 'aaaaaaaa.png'), 'x');
    writeFileSync(join(plain, '.design', 'assets', 'bbbbbbbb.png'), 'y');
    writeFileSync(
      join(plain, '.design', 'ui', 'a.tsx'),
      'export default () => <img src="../assets/aaaaaaaa.png" />;\n'
    );
    return plain;
  }
  const run = async (args: string[]) => {
    const root = plain ?? project();
    const p = Bun.spawn(
      ['bash', join(import.meta.dir, '..', 'bin', 'assets.sh'), ...args, '--root', root],
      {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, MAUDE_INDEX_DIR: join(root, '.idx') },
      }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { stdout, stderr, code };
  };

  test('usage comes from the static index; "Not used" says it cannot check yet', async () => {
    const all = await run(['--json']);
    const j = JSON.parse(all.stdout);
    expect(j.source).toBe('static');
    expect(j.assets.find((a: { rel: string }) => a.rel === 'assets/aaaaaaaa.png').usedIn).toEqual([
      'ui/a.tsx',
    ]);
    const nu = await run(['--not-used']);
    expect(nu.code).toBe(0);
    expect(nu.stdout).toContain('Checking older versions');
    expect(nu.stdout).not.toContain('bbbbbbbb');
  });

  test('--usage --details with no studio: the sidecars and the artboard are read in-process, the Original from this Mac', async () => {
    const root = project();
    writeFileSync(
      join(root, '.design', 'assets', 'aaaaaaaa.gen.json'),
      JSON.stringify({
        format: 'maude.gen',
        v: 1,
        prompt: 'night touchdown',
        provider: 'fal',
        model: 'flux',
        at: '2026-10-18T09:12:00Z',
        takes: ['aaaaaaaa'],
      })
    );
    writeFileSync(
      join(root, '.design', 'ui', 'a.tsx'),
      'export default () => (<DesignCanvas><DCSection id="s"><DCArtboard id="ab-post" label="Post 4:5" width={10} height={10}><img src="../assets/aaaaaaaa.png" /></DCArtboard></DCSection></DesignCanvas>);\n'
    );
    mkdirSync(join(root, '.design', '_canvas-state'), { recursive: true });
    writeFileSync(
      join(root, '.design', '_canvas-state', 'asset-origins.json'),
      JSON.stringify({
        v: 1,
        origins: { aaaaaaaa: { path: '/Volumes/Photos/IMG.png', importedAt: 1 } },
      })
    );
    const r = await run(['--usage', 'aaaaaaaa.png', '--details']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('prompt: night touchdown');
    expect(r.stdout).toContain('on artboard ab-post (Post 4:5) in ui/a.tsx');
    expect(r.stdout).toContain('original: /Volumes/Photos/IMG.png');
  });
});

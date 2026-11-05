// 2.0.5 (#205) — `ds-check --canvas` reads the canvases a RUNNING studio refused after their build
// (`/_index-data` `canvasRefusedInputs`), loopback only, and says so when no studio answers.
// The import walk (static) cannot know a built module was refused for a file another canvas owns.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';

import { rootIdentity } from '../../../cli/lib/studio-locate.mjs';
import { liveRefusals, rootOf, wantsLive } from '../bin/_ds-check-live.mjs';
import { runDsCheck } from '../ds/cli.ts';
import { NO_STUDIO_NOTE, refusedFromIndex } from '../ds/post-build.ts';

const USES = '✗ This canvas uses ui/shared.tsx, which belongs to another canvas.';
const CANVAS_SRC =
  "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n";

let root: string;
let studio: Server;
let asked: string[] = [];
let health: Record<string, unknown>;

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ds-check-live-')));
  const d = join(dir, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  writeFileSync(
    join(d, 'config.json'),
    JSON.stringify({ name: 't', canvasGroups: [{ label: 'UI', path: 'ui' }] })
  );
  for (const c of ['a', 'c']) {
    writeFileSync(join(d, `ui/${c}.tsx`), CANVAS_SRC);
    writeFileSync(join(d, `ui/${c}.meta.json`), '{}\n');
  }
  return dir;
}

/** `_server.json` as the studio writes it, except `url` — which a verb must never follow. */
function advertise(dir: string, port: number, extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(dir, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port, url: 'http://evil.example:1', ...extra })
  );
}

beforeAll(() => {
  root = project();
  health = { app: 'design', rootId: rootIdentity(root) };
  studio = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const u = new URL(req.url);
      asked.push(`${req.headers.get('host')} ${u.pathname}`);
      if (u.pathname === '/_health') return Response.json(health);
      if (u.pathname === '/_index-data')
        return Response.json({
          designRoot: '.design',
          canvasRefusedInputs: { '.design/ui/c.tsx': ['ui/shared.tsx'], '.design/ui/x.tsx': [] },
        });
      return new Response('no', { status: 404 });
    },
  });
  advertise(root, studio.port as number);
});
afterAll(() => {
  studio?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe('what the studio reports', () => {
  test('keys come back design-root-relative; junk is ignored', () => {
    expect(
      refusedFromIndex({
        designRoot: '.design',
        canvasRefusedInputs: { '.design/ui/c.tsx': ['ui/s.tsx', 7, ''], '.design/ui/e.tsx': [] },
      })
    ).toEqual(new Map([['ui/c.tsx', ['ui/s.tsx']]]));
    expect(refusedFromIndex(null).size).toBe(0);
    expect(refusedFromIndex({ canvasRefusedInputs: ['x'] }).size).toBe(0);
  });
  test('only the per-canvas modes ask; a hook never waits on a studio', () => {
    expect(wantsLive(['--canvas', 'ui/c.tsx'])).toBe(true);
    expect(wantsLive(['brand', '--canvases'])).toBe(true);
    expect(wantsLive(['--hook', '--canvas', 'ui/c.tsx'])).toBe(false);
    expect(wantsLive(['brand'])).toBe(false);
    expect(rootOf(['--root', '/p/x'], {}, '/c')).toBe('/p/x');
    expect(rootOf([], { CLAUDE_PROJECT_DIR: '/p/y' }, '/c')).toBe('/p/y');
  });
});

describe('a running studio', () => {
  test('liveRefusals reads the refusals from 127.0.0.1, never the advertised url', async () => {
    asked = [];
    const post = await liveRefusals(root);
    expect(post.live).toBe(true);
    expect([...post.refused]).toEqual([['ui/c.tsx', ['ui/shared.tsx']]]);
    expect(asked.map((a) => a.split(' ')[0].split(':')[0])).toEqual(['127.0.0.1', '127.0.0.1']);
  });

  test('ds-check --canvas prints the post-build reason, in the card words', async () => {
    const post = await liveRefusals(root);
    const r = runDsCheck(['--canvas', 'ui/c.tsx'], { CLAUDE_PROJECT_DIR: root }, null, post);
    expect(r.stdout).toContain(USES);
    expect(r.stdout).toContain('✗ Move the shared part into a component file');
    expect(r.stdout).not.toContain(NO_STUDIO_NOTE);
    const clean = runDsCheck(['--canvas', 'ui/a.tsx'], { CLAUDE_PROJECT_DIR: root }, null, post);
    expect(clean.stdout).not.toContain('belongs to another canvas');
    const json = JSON.parse(
      runDsCheck(['--canvas', 'ui/c.tsx', '--json'], { CLAUDE_PROJECT_DIR: root }, null, post)
        .stdout
    );
    expect(json.studio).toBe(true);
    expect(json.refusedInputs).toEqual({ 'ui/c.tsx': ['ui/shared.tsx'] });
  });

  test('the shim asks the studio itself (maude design ds-check)', async () => {
    const p = Bun.spawn(
      [
        'bun',
        'run',
        join(import.meta.dir, '../bin/_ds-check.mjs'),
        '--canvas',
        'ui/c.tsx',
        '--root',
        root,
      ],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } }
    );
    const out = await new Response(p.stdout).text();
    await p.exited;
    expect(out).toContain(USES);
  }, 30000);
});

describe('no studio for this project', () => {
  test('no _server.json → static reasons only, and it says so', async () => {
    const lone = project();
    try {
      const post = await liveRefusals(lone);
      expect(post.live).toBe(false);
      const r = runDsCheck(['--canvas', 'ui/c.tsx'], { CLAUDE_PROJECT_DIR: lone }, null, post);
      expect(r.stdout).toContain(NO_STUDIO_NOTE);
      expect(r.stdout).not.toContain('belongs to another canvas');
      const json = JSON.parse(
        runDsCheck(['--canvas', 'ui/c.tsx', '--json'], { CLAUDE_PROJECT_DIR: lone }, null, post)
          .stdout
      );
      expect(json.studio).toBe(false);
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });

  test('another project on that port (wrong rootId) or a dead pid is no studio', async () => {
    const other = project();
    try {
      advertise(other, studio.port as number); // /_health names `root`, not `other`
      expect((await liveRefusals(other)).live).toBe(false);
      advertise(root, studio.port as number, { pid: 2 ** 22 + 12345 }); // not running
      expect((await liveRefusals(root)).live).toBe(false);
      advertise(root, studio.port as number);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

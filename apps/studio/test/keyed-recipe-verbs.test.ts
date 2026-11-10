// fix-bulk 2026-11-10 follow-up — the last `curl-local` recipe families the plugin taught the AI:
// Assets › Move to trash / Rename… (`/_api/assets/trash|rename`), Retry on Not saved
// (`/_api/diagnostics/disk-retry`), Sync details' Compare / Keep mine / Use theirs / Keep both
// (`/_api/project/conflict`), Publish / Discard an unfinished AI edit (`/_api/project/ai-action`),
// Cancel the transfer (`/_api/sync/cancel-assets`), and /design-video:reel's footage sidecars
// (`/_api/footage`, taught as a bare GET / PUT). Since 2.1.0 the studio's main origin needs its key
// from every caller (contract sec-loopback-bearer §7) and `curl-local` sends none, so every one of them
// answered 401 `api-key-required` against the app. Each now has a verb that sends the key.
//
// A REAL studio in required mode, booted like canvas-file-verbs-key.test.ts: a terminal-started server
// (role `cli`, §7.5) writes its key under a scratch XDG_STATE_HOME, and the app registry points at a
// file that does not exist, so the person's app is never read. The sandbox is not linked, so the Sync
// details answers reach the route and get its own "nothing to answer" — not a 401.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CLI = path.join(import.meta.dir, '..', '..', '..', 'cli', 'bin', 'maude.mjs');

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Greeting() {
  return (
    <DesignCanvas>
      <DCArtboard id="hello" label="Hello" width={400} height={300}>
        <h1>Hello</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// a 1×1 PNG nothing uses
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ANALYSIS = {
  asset: 'assets/a1b2c3d4.mp4',
  durationSec: 10,
  shots: [{ start: 0, end: 3, usable: true, quality: 0.8 }],
};

describe('the curl-local replacement verbs against a studio that requires its key', () => {
  let proc: Subprocess | null = null;
  let port: number;
  let root: string;
  let designRoot: string;
  let state: string;
  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    writeFileSync(path.join(designRoot, 'ui', 'Greeting.tsx'), CANVAS);
    mkdirSync(path.join(designRoot, 'assets'), { recursive: true });
    writeFileSync(path.join(designRoot, 'assets', 'e5f60718.png'), PNG);
    writeFileSync(path.join(designRoot, 'assets', 'b0b0b0b0.png'), PNG);
    state = `${root}-keys`;
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, 'analysis.json'), JSON.stringify(ANALYSIS));
    writeFileSync(path.join(state, 'bad.json'), JSON.stringify({ shots: [{ start: 5, end: 5 }] }));
    port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SERVER_ROLE: 'cli',
      XDG_STATE_HOME: state,
      MAUDE_APP_REGISTRY_FILE: path.join(state, 'no-app', 'servers.json'),
    });
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  const env = (keys: string) => {
    const e: Record<string, string | undefined> = {
      ...process.env,
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_NO_UPDATE_CHECK: '1',
      CLAUDE_PROJECT_DIR: root,
      XDG_STATE_HOME: keys,
      MAUDE_APP_REGISTRY_FILE: path.join(state, 'no-app', 'servers.json'),
    };
    for (const k of [
      'MAUDE_SESSION_ROOT',
      'MAUDE_HOOK_SESSION',
      'MAUDE_CHAT_ID',
      'MAUDE_AGENT_ACTOR',
      'MAUDE_READ_ROOTS',
    ])
      delete e[k];
    return e;
  };
  const maude = (args: string[], keys = state) => {
    const p = Bun.spawnSync(['node', CLI, 'design', ...args], { cwd: root, env: env(keys) });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };
  const url = (route: string) => `http://127.0.0.1:${port}${route}`;
  const json = ['--header', 'Content-Type: application/json', '--data'];

  test('every old curl-local recipe answers 401 api-key-required and changes nothing', () => {
    const recipes: string[][] = [
      [
        url('/_api/assets/trash'),
        '--method',
        'POST',
        ...json,
        '{"assets":["assets/e5f60718.png"]}',
      ],
      [
        url('/_api/assets/rename'),
        '--method',
        'POST',
        ...json,
        '{"asset":"assets/e5f60718.png","name":"logo"}',
      ],
      [url('/_api/diagnostics/disk-retry'), '--method', 'POST'],
      [url('/_api/project/conflict?file=ui/Greeting.tsx')],
      [url('/_api/project/conflict'), '--method', 'POST', ...json, '{"file":"x","choice":"mine"}'],
      [url('/_api/project/ai-action'), '--method', 'POST', ...json, '{"choice":"publish"}'],
      [url('/_api/sync/cancel-assets'), '--method', 'POST'],
      [url('/_api/footage?asset=a1b2c3d4')],
    ];
    for (const r of recipes) {
      const got = maude(['curl-local', ...r]);
      const refused = got.out.includes('api-key-required');
      expect({ r: r.join(' '), refused, got: refused ? '' : got.out + got.err }).toEqual({
        r: r.join(' '),
        refused: true,
        got: '',
      });
    }
    expect(existsSync(path.join(designRoot, 'assets', 'e5f60718.png'))).toBe(true);
    // the registry spelled five of them `-X POST … -d`, which curl-local never took (its own flag set)
    const asTaught = maude(['curl-local', '-X', 'POST', url('/_api/diagnostics/disk-retry')]);
    expect({ code: asTaught.code, flag: asTaught.err.includes('unrecognized flag "-X"') }).toEqual({
      code: 2,
      flag: true,
    });
  }, 60_000);

  test('retry-save and sync cancel-transfer reach their routes with the key', () => {
    const retry = maude(['retry-save', '--json']);
    expect({ code: retry.code, err: retry.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(retry.out)).toEqual({ landed: 0, held: 0, full: false });

    const cancel = maude(['sync', 'cancel-transfer']);
    expect({ code: cancel.code, err: cancel.err }).toEqual({ code: 0, err: '' });
    expect(cancel.out).toContain('no transfer was running');
  }, 30_000);

  test('the Sync details answers reach the route: no conflict / no AI edit, not a 401', () => {
    const cmp = maude(['sync', 'compare', 'ui/Greeting.tsx']);
    expect(cmp.code).toBe(1);
    expect(cmp.err).toContain('No conflict on that canvas.');
    for (const sub of ['keep-mine', 'use-theirs', 'keep-both']) {
      const r = maude(['sync', sub, 'ui/Greeting.tsx']);
      expect({ sub, code: r.code, none: r.err.includes('No conflict on that canvas.') }).toEqual({
        sub,
        code: 1,
        none: true,
      });
    }
    for (const sub of ['publish-ai-edit', 'discard-ai-edit']) {
      const r = maude(['sync', sub]);
      expect({
        sub,
        code: r.code,
        none: r.err.includes('There is no unfinished AI edit.'),
      }).toEqual({ sub, code: 1, none: true });
    }
  }, 60_000);

  test('asset-rename and asset-trash answer as the Assets panel does, with the key', () => {
    const ren = maude(['asset-rename', '.design/assets/e5f60718.png', 'logo', '--json']);
    const rb = JSON.parse(ren.out || '{}') as { ok?: boolean; to?: string };
    // the studio's verdict, never a 401: renamed, or kept while it checks who uses it
    expect(ren.err).not.toContain('api-key');
    if (ren.code === 0) {
      expect(rb).toMatchObject({ ok: true, to: 'assets/logo.png' });
      expect(existsSync(path.join(designRoot, 'assets', 'logo.png'))).toBe(true);
    } else expect(ren.err).toMatch(/refused — (checking|used|kept-by-versions)/);

    const tr = maude(['asset-trash', 'assets/b0b0b0b0.png', '--json']);
    expect(tr.err).not.toContain('api-key');
    const tb = JSON.parse(tr.out) as { ok: boolean; results: { rel: string; ok: boolean }[] };
    expect(tb.ok).toBe(true);
    expect(tb.results.map((r) => r.rel)).toEqual(['assets/b0b0b0b0.png']);
    expect(existsSync(path.join(designRoot, 'assets', 'b0b0b0b0.png'))).toBe(!tb.results[0]?.ok);
  }, 30_000);

  test('footage save stores a valid analysis, show reads it back, a bad one names the refusal', () => {
    const empty = maude(['footage', 'show', '--asset', 'a1b2c3d4']);
    expect({ code: empty.code, err: empty.err }).toEqual({ code: 0, err: '' });
    expect(empty.out).toContain('BEGIN UNTRUSTED DATA');
    expect(empty.out).toContain('{}');

    const save = maude([
      'footage',
      'save',
      '--asset',
      'assets/a1b2c3d4.mp4',
      '--from',
      path.join(state, 'analysis.json'),
    ]);
    expect({ code: save.code, err: save.err }).toEqual({ code: 0, err: '' });
    const stored = JSON.parse(
      readFileSync(path.join(designRoot, 'assets', 'a1b2c3d4.footage.json'), 'utf8')
    ) as { shots: { quality: number }[] };
    expect(stored.shots[0]?.quality).toBe(0.8);

    const back = maude(['footage', 'show', '--asset', 'assets/a1b2c3d4.mp4', '--json']);
    expect(back.code).toBe(0);
    const b = JSON.parse(back.out) as { untrusted: boolean; data: { shots: unknown[] } };
    expect(b.untrusted).toBe(true);
    expect(b.data.shots.length).toBe(1);

    const bad = maude([
      'footage',
      'save',
      '--asset',
      'a1b2c3d4',
      '--from',
      path.join(state, 'bad.json'),
    ]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('refused');
    expect(bad.err).not.toContain('api-key');
  }, 30_000);

  test('without the key every verb is refused: the key is what lets them through', () => {
    const other = `${root}-nokeys`;
    mkdirSync(other, { recursive: true });
    for (const args of [
      ['retry-save'],
      ['sync', 'cancel-transfer'],
      ['sync', 'compare', 'ui/Greeting.tsx'],
      ['asset-trash', 'assets/e5f60718.png'],
      ['footage', 'show', '--asset', 'a1b2c3d4'],
    ]) {
      const r = maude(args, other);
      expect({ args, code: r.code, key: r.err.includes('api-key-required') }).toEqual({
        args,
        code: 1,
        key: true,
      });
    }
    expect(existsSync(path.join(designRoot, 'assets', 'e5f60718.png'))).toBe(
      !existsSync(path.join(designRoot, 'assets', 'logo.png'))
    );
  }, 60_000);

  test('usage: operands and stray flags', () => {
    expect(maude(['asset-trash']).code).toBe(2);
    expect(maude(['asset-trash', 'ui/Greeting.tsx']).code).toBe(2);
    expect(maude(['asset-trash', 'assets/../config.json']).code).toBe(2);
    expect(maude(['asset-rename', 'assets/x.png']).code).toBe(2);
    expect(maude(['retry-save', 'now']).code).toBe(2);
    expect(maude(['retry-save', '--force']).code).toBe(2);
    expect(maude(['sync', 'compare']).code).toBe(2);
    expect(maude(['sync', 'keep-mine', '../x.tsx']).code).toBe(2);
    expect(maude(['sync', 'publish-ai-edit', '--run', 'a b']).code).toBe(2);
    expect(maude(['footage', 'show']).code).toBe(2);
    expect(maude(['footage', 'show', '--asset', 'a', '--cut', 'b']).code).toBe(2);
    expect(maude(['footage', 'save', '--asset', 'a1b2c3d4']).code).toBe(2);
    for (const verb of ['asset-trash', 'asset-rename', 'retry-save', 'footage']) {
      const h = maude([verb, '--help']);
      expect({ code: h.code, usage: h.out.includes(`usage: maude design ${verb}`) }).toEqual({
        code: 0,
        usage: true,
      });
    }
  }, 60_000);
});

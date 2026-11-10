// fix-bulk W1 follow-up — the design plugin taught the AI to make, rename and move a canvas with
// `maude design curl-local http://127.0.0.1:<port>/_api/canvas|fs-move`. Since 2.1.0 the studio's main
// origin needs its key from every caller (contract sec-loopback-bearer §7), and `curl-local` sends
// none — so every one of those recipes answered 401 `api-key-required` against the app. The recipes now
// teach `maude design canvas-new` / `canvas-move`, which find the studio and its key the way every verb
// does (studio-locate.mjs) and call the same two routes.
//
// A REAL studio in required mode: a terminal-started server (role `cli`, §7.5) mints its key and writes
// it to the per-user key file under XDG_STATE_HOME — a scratch dir here, never ~/.local/state — and the
// app registry points at a file that does not exist, so the person's app is never read.

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

describe('canvas-new / canvas-move against a studio that requires its key', () => {
  let proc: Subprocess | null = null;
  let port: number;
  let root: string;
  let designRoot: string;
  let state: string;
  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    writeFileSync(path.join(designRoot, 'ui', 'Greeting.tsx'), CANVAS);
    mkdirSync(path.join(designRoot, 'ui', 'archive'), { recursive: true });
    state = `${root}-keys`;
    mkdirSync(state, { recursive: true });
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
    ])
      delete e[k];
    return e;
  };
  const maude = (args: string[], keys = state) => {
    const p = Bun.spawnSync(['node', CLI, 'design', ...args], { cwd: root, env: env(keys) });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };

  test('the old curl-local recipes answer 401 api-key-required and change nothing', () => {
    const made = maude([
      'curl-local',
      `http://127.0.0.1:${port}/_api/canvas`,
      '--method',
      'POST',
      '--header',
      'Content-Type: application/json',
      '--data',
      '{"kind":"blank","name":"Viacurl"}',
    ]);
    expect(made.out).toContain('api-key-required');
    expect(existsSync(path.join(designRoot, 'ui', 'Viacurl.tsx'))).toBe(false);
    const moved = maude([
      'curl-local',
      `http://127.0.0.1:${port}/_api/fs-move`,
      '--method',
      'POST',
      '--header',
      'Content-Type: application/json',
      '--data',
      '{"file":"ui/Greeting.tsx","toName":"Renamed"}',
    ]);
    expect(moved.out).toContain('api-key-required');
    expect(existsSync(path.join(designRoot, 'ui', 'Greeting.tsx'))).toBe(true);
  }, 30_000);

  test('canvas-new makes a blank canvas, a brief and a duplicate, with the key', () => {
    const blank = maude(['canvas-new', 'Pricing']);
    expect({ code: blank.code, err: blank.err }).toEqual({ code: 0, err: '' });
    expect(blank.out).toContain('.design/ui/Pricing.tsx');
    expect(existsSync(path.join(designRoot, 'ui', 'Pricing.tsx'))).toBe(true);

    const brief = maude(['canvas-new', 'Ideas', '--kind', 'brief-board', '--json']);
    expect(brief.code).toBe(0);
    const b = JSON.parse(brief.out) as { ok: boolean; file: string; rel: string };
    expect(b.ok).toBe(true);
    expect(existsSync(path.join(root, b.file))).toBe(true);

    // /design:new step 3: no name, the brief names it (V2 C4)
    const named = maude(['canvas-new', '--from-prompt', 'A poster for my open studio', '--json']);
    expect({ code: named.code, err: named.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(named.out).file).toBe('.design/ui/Poster.tsx');

    const dup = maude(['canvas-new', '--duplicate', 'ui/Greeting.tsx', '--json']);
    expect({ code: dup.code, err: dup.err }).toEqual({ code: 0, err: '' });
    const d = JSON.parse(dup.out) as { file: string };
    expect(d.file).not.toBe('.design/ui/Greeting.tsx');
    expect(readFileSync(path.join(root, d.file), 'utf8')).toContain('<h1>Hello</h1>');
  }, 60_000);

  test('canvas-move renames and moves a canvas, with the key', () => {
    const renamed = maude(['canvas-move', 'ui/Pricing.tsx', '--name', 'Plans']);
    expect({ code: renamed.code, err: renamed.err }).toEqual({ code: 0, err: '' });
    expect(existsSync(path.join(designRoot, 'ui', 'Pricing.tsx'))).toBe(false);
    expect(existsSync(path.join(designRoot, 'ui', 'Plans.tsx'))).toBe(true);

    const moved = maude(['canvas-move', '.design/ui/Plans.tsx', '--to', 'ui/archive', '--json']);
    expect({ code: moved.code, err: moved.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(moved.out).toRel).toContain('ui/archive/Plans.tsx');
    expect(existsSync(path.join(designRoot, 'ui', 'archive', 'Plans.tsx'))).toBe(true);
  }, 60_000);

  test('without the key the verbs are refused too: the key is what lets them through', () => {
    const other = `${root}-nokeys`;
    mkdirSync(other, { recursive: true });
    const r = maude(['canvas-new', 'Nokey'], other);
    expect(r.code).toBe(1);
    expect(r.err).toContain('api-key-required');
    expect(existsSync(path.join(designRoot, 'ui', 'Nokey.tsx'))).toBe(false);
  }, 30_000);

  test('usage: a bad kind, a stray flag, a move with neither --name nor --to', () => {
    expect(maude(['canvas-new', 'X', '--kind', 'poster']).code).toBe(2);
    expect(maude(['canvas-new', 'X', '--force']).code).toBe(2);
    expect(maude(['canvas-new', '--duplicate', 'ui/Greeting.tsx', '--kind', 'blank']).code).toBe(2);
    expect(maude(['canvas-move', 'ui/Greeting.tsx']).code).toBe(2);
    expect(maude(['canvas-move', '../x.tsx', '--name', 'y']).code).toBe(2);
    for (const verb of ['canvas-new', 'canvas-move']) {
      const h = maude([verb, '--help']);
      expect({ code: h.code, usage: h.out.includes(`usage: maude design ${verb}`) }).toEqual({
        code: 0,
        usage: true,
      });
    }
  }, 30_000);
});

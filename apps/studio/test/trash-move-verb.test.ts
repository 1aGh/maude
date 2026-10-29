// V2-8.16 (live journey S1 turn 5, terminal lane) — `maude design trash move <canvas>` on a real
// studio: the canvas goes to the shared Trash through the row menu's own route, Version history
// records ONE `@manifest` delete row for it, and `maude design trash restore <canvas>` brings it
// back (the file again on disk, the Trash empty). Before this verb the agent had no allowed path:
// the registry taught an `mv` into `_trash/` that the design hook refuses (use-verb).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { GRADERS, observe } from './agent-journeys/graders.mjs';

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

type Row = { revision: number; kind: string; canvases: string[]; lanes?: Record<string, string[]> };

describe('maude design trash move → Version history → trash restore, on a real studio', () => {
  let proc: Subprocess | null = null;
  let port: number;
  let root: string;
  let designRoot: string;
  beforeAll(async () => {
    const sb = makeSandbox();
    root = sb.root;
    designRoot = sb.designRoot;
    writeFileSync(path.join(designRoot, 'ui', 'Greeting.tsx'), CANVAS);
    port = nextPort();
    proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
  });
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  const maude = (args: string[]) => {
    const p = Bun.spawnSync(['node', CLI, 'design', ...args, '--root', root], {
      cwd: root,
      env: {
        ...process.env,
        NO_OPEN: '1',
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_NO_UPDATE_CHECK: '1',
        CLAUDE_PROJECT_DIR: root,
      },
    });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };
  const history = async (): Promise<Row[]> =>
    (
      (await (await fetch(`http://localhost:${port}/_api/project/history?limit=50`)).json()) as {
        history?: Row[];
      }
    ).history ?? [];
  const rowsOf = async (rel: string) =>
    (await history()).filter((r) => r.canvases.some((c) => c.endsWith(rel)));
  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string) {
    const end = Date.now() + 20_000;
    let v = await fn();
    while (!ok(v)) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
      await Bun.sleep(250);
      v = await fn();
    }
    return v;
  }

  test('move → a delete row in Version history, listed in the Trash → restore brings it back', async () => {
    const abs = path.join(designRoot, 'ui', 'Greeting.tsx');
    // the cold start publishes the canvas first (its create row), so a delete has a doc to delete
    const before = await until(
      () => rowsOf('ui/Greeting.tsx'),
      (r) => r.length > 0,
      'the canvas in history'
    );
    const head = Math.max(...before.map((r) => r.revision));

    const moved = maude(['trash', 'move', 'ui/Greeting.tsx']);
    expect({ code: moved.code, err: moved.err }).toEqual({ code: 0, err: '' });
    expect(moved.out).toContain('ui/Greeting.tsx');
    expect(existsSync(abs)).toBe(false);

    // ONE new row for the canvas, on its @manifest lane (the delete; its op is checked from the store below)
    const rows = await until(
      () => rowsOf('ui/Greeting.tsx'),
      (r) => r.some((x) => x.revision > head),
      'a row for the move'
    );
    const del = rows.filter((x) => x.revision > head);
    expect(del).toHaveLength(1);
    expect(Object.values(del[0]?.lanes ?? {}).flat()).toContain('@manifest');

    const listed = maude(['trash', 'list', '--json']);
    expect(listed.code).toBe(0);
    const items = (JSON.parse(listed.out).items ?? []) as { path: string }[];
    expect(items.map((i) => i.path)).toContain('ui/Greeting.tsx');

    const back = maude(['trash', 'restore', 'ui/Greeting.tsx']);
    expect({ code: back.code, err: back.err }).toEqual({ code: 0, err: '' });
    await until(
      async () => existsSync(abs),
      (v) => v,
      'the canvas back on disk'
    );
    expect(readFileSync(abs, 'utf8')).toContain('<h1>Hello</h1>');
    const after = (JSON.parse(maude(['trash', 'list', '--json']).out).items ?? []) as {
      path: string;
    }[];
    expect(after.map((i) => i.path)).not.toContain('ui/Greeting.tsx');

    // The journey's own grader (S1 back-from-trash), read from the store once the studio is down:
    // a `@manifest delete` effect for the canvas, live again, not listed.
    await killProc(proc as Subprocess);
    proc = null;
    const graded = GRADERS.trash(
      { path: 'ui/Greeting.tsx', state: 'restored' },
      observe({ project: root })
    );
    expect(graded).toEqual({ pass: true, why: '' });
  }, 90_000);
});

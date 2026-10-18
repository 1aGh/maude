// S8.19c — `asset.relink`: re-point every reference to a missing picture at an imported copy. One write,
// one undo; each reference keeps its own `/` or `./` prefix; `to` is a file that exists as
// assets/<sha8>.<ext> (no traversal, no runtime state); `from` must be on the canvas.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';

const FILE = 'ui/Post.tsx';
const OLD = 'assets/c1658844.png';
const NEW = 'assets/7f3e21c4.jpg';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={480} height={600}>
        <img data-cd-id="a" src="/assets/c1658844.png" />
        <img data-cd-id="b" src='./assets/c1658844.png' />
        <div data-cd-id="c" style={{ backgroundImage: "url(assets/c1658844.png)" }} />
        <img data-cd-id="d" src={"assets/c1658844.png?v=2"} />
        <img data-cd-id="e" src="/assets/other0001.png" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(present: string[] = [NEW]) {
  const files = new Map<string, string>([[FILE, SRC]]);
  let writes = 0;
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes += 1;
      files.set(rel, after);
    },
    heldByAi: () => null,
    exists: (rel) => present.includes(rel),
    log: createWriteLog(),
  };
  const run = (params: Record<string, unknown>) =>
    dispatchEditOp({ file: FILE, op: 'asset.relink', targets: [], params }, deps);
  return { files, run, deps, writes: () => writes, src: () => files.get(FILE) as string };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};

describe('asset.relink', () => {
  test('is registered under its registry id', () => {
    expect(EDIT_OPS.some((o) => o.id === 'asset.relink')).toBe(true);
  });

  test('rewrites every reference, keeping each prefix, in ONE write', async () => {
    const h = harness();
    good(await h.run({ from: OLD, to: NEW }));
    expect(h.writes()).toBe(1);
    const s = h.src();
    expect(s).toContain('src="/assets/7f3e21c4.jpg"');
    expect(s).toContain("src='./assets/7f3e21c4.jpg'");
    expect(s).toContain('"url(assets/c1658844.png)"'); // not a bare path literal: left alone
    expect(s).toContain('src={"assets/7f3e21c4.jpg?v=2"}');
    expect(s).toContain('src="/assets/other0001.png"'); // another picture is untouched
    expect(s).not.toContain('"/assets/c1658844.png"');
  });

  test('the revert restores every reference in one undo', async () => {
    const h = harness();
    const r = good(await h.run({ from: OLD, to: NEW }));
    expect(h.src()).not.toBe(SRC);
    good(
      await dispatchEditOp({ file: FILE, op: 'revert', params: { writeId: r.writeId } }, h.deps)
    );
    expect(h.src()).toBe(SRC);
  });

  test('a bad `to` is refused: traversal, runtime state, not a sha8 name, not on disk, same file', async () => {
    const h = harness([NEW, 'assets/aaaaaaaa.png']);
    for (const to of [
      '../assets/7f3e21c4.jpg',
      'assets/../7f3e21c4.jpg',
      '/etc/passwd',
      '_history/7f3e21c4.jpg',
      'assets/_7f3e21c4.jpg',
      'assets/evil.png',
      'ui/assets/7f3e21c4.jpg',
      'assets/7f3e21c4.jpg/x',
      'assets/bbbbbbbb.png', // well-formed but not on disk
      OLD, // pointing at itself
      '',
      42,
    ]) {
      const r = bad(await h.run({ from: OLD, to }));
      expect(r.code).toBe('invalid');
    }
    expect(h.writes()).toBe(0);
    expect(h.src()).toBe(SRC);
  });

  test('`from` must be on the canvas', async () => {
    const h = harness();
    const r = bad(await h.run({ from: 'assets/00000000.png', to: NEW }));
    expect(r.code).toBe('invalid');
    expect(r.message).toBe('That picture is not on this canvas.');
    expect(bad(await h.run({ to: NEW })).code).toBe('invalid');
    expect(h.writes()).toBe(0);
  });

  test('a studio with no way to look at the disk refuses rather than guessing', async () => {
    const h = harness();
    const deps = { ...h.deps, exists: undefined } as DispatchDeps;
    const r = await dispatchEditOp(
      { file: FILE, op: 'asset.relink', targets: [], params: { from: OLD, to: NEW } },
      deps
    );
    expect(bad(r).code).toBe('invalid');
  });
});

describe('POST /_api/edit-op asset.relink (real disk)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  test('relinks only to a file that is on disk under the design root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-relink-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Post.tsx'), SRC);
    writeFileSync(join(designRoot, 'assets', '7f3e21c4.jpg'), 'x');
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
    });
    const post = (to: string) =>
      spec.handle(
        new Request('http://localhost/_api/edit-op', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            file: FILE,
            op: 'asset.relink',
            targets: [],
            params: { from: OLD, to },
          }),
        }),
        {}
      );
    expect((await post('assets/bbbbbbbb.png')).status).toBe(400);
    expect(readFileSync(join(designRoot, 'ui', 'Post.tsx'), 'utf8')).toBe(SRC);
    expect((await post(NEW)).status).toBe(200);
    expect(readFileSync(join(designRoot, 'ui', 'Post.tsx'), 'utf8')).toContain(NEW);
  });
});

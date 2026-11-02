// sec-a2 low (Windows backslash) — `canvasSlugFromRel` flattens `/` but not `\`, and on
// Windows `path.join` treats `\` as a separator, so a canvas named `..\..\x` put its board and
// comment sidecars outside the design root. A slug carrying `\` is refused for both sidecars on
// every platform (the test runs on posix, where the escape itself cannot be observed — so it
// pins the refusal, not the escape).

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

function rig() {
  const { root, designRoot } = makeSandbox();
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 'bs',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  const api = createApi(ctx, { onCommentsChanged() {}, onAnnotationsChanged() {} });
  return { api, root, designRoot };
}

const SNEAKY = '.design/..\\..\\escape.tsx';
const listing = (dir: string) => readdirSync(dir).filter((n) => !n.startsWith('_'));

describe('sidecar paths refuse a backslash in the slug', () => {
  test('the board read answers "not a canvas path", never an empty board', async () => {
    const { api } = rig();
    const r = await api.readBoard(SNEAKY);
    expect(r.ok).toBe(false);
    expect(await api.loadAnnotations(SNEAKY)).toBeNull();
  });

  test('a whole-board write is refused and writes nothing', async () => {
    const { api, root, designRoot } = rig();
    const before = { root: listing(root), design: listing(designRoot) };
    const ok = await api.saveAnnotations(SNEAKY, board(sticky('s1', 'x', { x: 1 })));
    expect(ok).toBe(false);
    expect(listing(root)).toEqual(before.root);
    expect(listing(designRoot)).toEqual(before.design);
  });

  test('a comments write is refused (throws), a comments read is empty', async () => {
    const { api } = rig();
    await expect(api.saveCommentsForFile(SNEAKY, [])).rejects.toThrow('not a canvas path');
    expect(await api.loadCommentsForFile(SNEAKY)).toEqual([]);
  });

  test('an ordinary canvas is unaffected', async () => {
    const { api } = rig();
    expect(await api.saveAnnotations('.design/ui/ok.tsx', board(sticky('s1', 'x', { x: 1 })))).toBe(
      true
    );
    expect((await api.readBoard('.design/ui/ok.tsx')).ok).toBe(true);
  });
});

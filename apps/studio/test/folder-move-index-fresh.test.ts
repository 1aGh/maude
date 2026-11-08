// L01 rename/move of an EMPTY folder — the author's own tree kept the pre-change listing.
//
// The tree reloads as soon as the write answers and is served from the cached index. The cache is
// made out of date by the write's own announcement (CANVAS_INDEX_WRITE_EVENTS), but a folder move
// announced itself once PER NESTED CANVAS — an EMPTY folder announced nothing, so the answer waited
// for the file watcher (async: it can land after the reload, and an empty folder may raise no event
// at all). No watcher runs in-process, so the only thing that can invalidate here is the write.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'Canvases', path: 'ui' },
      ],
    } as Context['cfg'],
    projectLabel: 'test',
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
}

async function dirsOf(api: ReturnType<typeof createApi>): Promise<string[]> {
  const data = (await api.buildIndexData({ role: null, fresh: true })) as {
    groups: Array<{ dirs?: string[] }>;
  };
  return data.groups.flatMap((g) => g.dirs ?? []);
}

describe('a folder write leaves the index out of date the moment it answers (in-process)', () => {
  for (const [label, move, want] of [
    ['rename', { file: 'ui/EmptyA', toDir: 'ui', toName: 'EmptyB' }, 'EmptyB'],
    ['move', { file: 'ui/EmptyA', toDir: 'ui/Dest' }, 'Dest/EmptyA'],
  ] as const) {
    test(`an empty folder ${label} shows in the very next index read`, async () => {
      const { root, designRoot } = makeSandbox();
      mkdirSync(join(designRoot, 'ui', 'EmptyA'), { recursive: true });
      mkdirSync(join(designRoot, 'ui', 'Dest'), { recursive: true });
      const api = createApi(mkCtx(root, designRoot), { onCommentsChanged: () => {} });
      const before = await dirsOf(api); // warms the cache
      expect(before.some((d) => d.endsWith('EmptyA'))).toBe(true);
      const result = await api.moveCanvas(move);
      expect(result.ok).toBe(true);
      const after = await dirsOf(api);
      expect(after.some((d) => d.endsWith(want))).toBe(true);
      expect(after.some((d) => d.endsWith('ui/EmptyA'))).toBe(false);
    });
  }

  test('a folder that holds only a placeholder file moves the same way', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui', 'Kept'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Kept', '.gitkeep'), '');
    const api = createApi(mkCtx(root, designRoot), { onCommentsChanged: () => {} });
    await dirsOf(api);
    const result = await api.moveCanvas({ file: 'ui/Kept', toDir: 'ui', toName: 'Renamed' });
    expect(result.ok).toBe(true);
    const after = await dirsOf(api);
    expect(after.some((d) => d.endsWith('Renamed'))).toBe(true);
    expect(after.some((d) => d.endsWith('ui/Kept'))).toBe(false);
  });
});

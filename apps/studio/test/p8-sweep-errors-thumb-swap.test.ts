// p8-sweep-errors (3) — the dead-control crawl's `GET /_api/thumb/<key>` 404 (once, while a state opened). A canvas
// row carries its cover key from the index (`/_api/index` → `cover`). When the canvas changed, the thumbnail service
// rendered a new cover and `setCover` swapped the row to the new key; the old key then belonged to no snapshot row
// and no request, so `serves(old)` was false and a row still holding it (its <img> mounting a moment later, or
// lazily) got a 404 — although the old picture was still on disk. A key this process rendered stayed servable by
// its own request; one known only from the index snapshot (after a restart: the crawl resets the server per state)
// did not. The swap now keeps the old key servable while
// its file exists (it is this project's own picture of a moment ago), so the row shows it until its index row
// refreshes — never a failed request.

import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pidOf } from '../index/snapshot.ts';
import { thumbResponse } from '../thumbs/routes.ts';
import { createThumbService, type ThumbService } from '../thumbs/service.ts';
import { makeSandbox } from './_helpers.ts';
import { b64, fakeJpeg, fakeShim } from './_thumbs-fake.ts';
import { indexFor, writeFiles } from './_thumbs-helpers.ts';

const CANVAS = (
  n: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function C() {
  return (<DesignCanvas><DCSection id="s" title="S">
    <DCArtboard id="a" label="A" width={960} height={600}><div>${n}</div></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;

const stoppers: Array<() => void> = [];
afterAll(() => {
  for (const s of stoppers) s();
});

describe('a cover swap keeps the picture a row still names', () => {
  test('after the canvas changes and its new cover lands, the previous cover key still answers 200', async () => {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, { 'ui/a.tsx': CANVAS('one') });
    const index = indexFor(root, designRoot);
    const shim = fakeShim(() => ({
      ok: true,
      runtime: { artboards: [] },
      shots: [{ target: 0, artboard: 'a', jpeg: b64(fakeJpeg(480, 300)) }],
    }));
    const make = (): ThumbService => {
      const svc = createThumbService({
        pid: pidOf(root),
        designRoot,
        index,
        config: () => ({ theme: 'dark' }),
        serverOrigin: () => 'http://localhost:1',
        captureOrigin: () => 'http://localhost:2',
        spawnShim: () => shim.handle(),
      });
      stoppers.push(() => svc.stop());
      return svc;
    };

    const card = { canvas: 'ui/a.tsx', artboard: null, size: 'card', priority: 'visible' } as const;
    const before = make();
    await before.thumb(card);
    await before.idle();
    const first = index.canvas('ui/a.tsx')?.cover?.key as string;
    expect(first).toBeTruthy();
    before.stop();
    // the server restarts (the crawl's per-state reset, a relaunch): the cover is known from the index snapshot
    // only — no request of this process has named it
    const svc = make();
    expect(thumbResponse(svc, first).status).toBe(200);

    // the canvas changes (an artboard added, the crawl's tile click): a new source, a new cover
    writeFileSync(join(designRoot, 'ui/a.tsx'), CANVAS('two'));
    index.update(['ui/a.tsx']);
    await svc.thumb(card);
    await svc.idle();
    const second = index.canvas('ui/a.tsx')?.cover?.key as string;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(thumbResponse(svc, second).status).toBe(200);

    // a row that still names the first cover gets the picture, not a 404
    expect(svc.serves(first)).toBe(true);
    expect(thumbResponse(svc, first).status).toBe(200);
  });

  test('a key this project never named stays the same 404 (R6 unchanged)', async () => {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, { 'ui/a.tsx': CANVAS('one') });
    const index = indexFor(root, designRoot);
    const svc = createThumbService({
      pid: pidOf(root),
      designRoot,
      index,
      config: () => ({ theme: 'dark' }),
      serverOrigin: () => 'http://localhost:1',
      captureOrigin: () => 'http://localhost:2',
      spawnShim: () => fakeShim(() => ({ ok: false })).handle(),
    });
    stoppers.push(() => svc.stop());
    expect(thumbResponse(svc, 'f'.repeat(64)).status).toBe(404);
  });
});

// P8 (2026-10-29): Home showed grey covers for every project not yet opened in v2 — the only trigger
// of the background cover pass was the Canvases panel (`POST /_api/thumbs/want {background:true}`),
// and the Home server has no renderer. A project server now queues, once its index is built, a
// background cover for exactly the canvases whose cover is missing or stale (`cover == null ||
// cover.ofSrc !== srcHash`, or its picture is gone) — nothing else, and a project whose covers are
// all fresh never starts the renderer (contract V2-1.17 §5.8 "Queue and pacing").

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IndexService } from '../index/service.ts';
import { pidOf } from '../index/snapshot.ts';
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
const FILES = { 'ui/a.tsx': CANVAS('a'), 'ui/b.tsx': CANVAS('b'), 'ui/c.tsx': CANVAS('c') };

const stoppers: Array<() => void> = [];
afterAll(() => {
  for (const s of stoppers) s();
});

const okShot = () => ({
  ok: true,
  runtime: { artboards: [] },
  shots: [{ target: 0, artboard: 'a', jpeg: b64(fakeJpeg(480, 300)) }],
});

function service(
  root: string,
  designRoot: string,
  index: IndexService,
  extra: Partial<Parameters<typeof createThumbService>[0]> = {}
) {
  const shim = fakeShim(okShot);
  let spawns = 0;
  const svc: ThumbService = createThumbService({
    pid: pidOf(root),
    designRoot,
    index,
    config: () => ({ theme: 'dark' }),
    serverOrigin: () => 'http://localhost:1',
    captureOrigin: () => 'http://localhost:2',
    spawnShim: () => {
      spawns++;
      return shim.handle();
    },
    ...extra,
  });
  stoppers.push(() => svc.stop());
  return { svc, sent: shim.sent, spawns: () => spawns };
}

const rendered = (sent: Record<string, unknown>[]) =>
  sent
    .filter((m) => m.op === 'render')
    .map((m) => decodeURIComponent(String(m.url)).match(/ui\/[a-z]\.tsx/)?.[0] ?? '?');

/** a project whose `ui/a.tsx` already has a fresh cover (an earlier boot rendered it) */
async function withOneCover() {
  const { root, designRoot } = makeSandbox();
  writeFiles(designRoot, FILES);
  const index = indexFor(root, designRoot);
  const first = service(root, designRoot, index);
  await first.svc.thumb({ canvas: 'ui/a.tsx', artboard: null, size: 'card', priority: 'visible' });
  await first.svc.idle();
  first.svc.stop();
  expect(index.canvas('ui/a.tsx')?.cover).not.toBeNull();
  return { root, designRoot, index };
}

describe('the boot cover pass (P8, Home grey covers)', () => {
  test('boot queues covers for exactly the canvases whose cover is missing or stale', async () => {
    const { root, designRoot, index } = await withOneCover();
    const boot = service(root, designRoot, index);
    const queued = await boot.svc.bootCovers();
    await boot.svc.idle();
    expect(queued).toBe(2);
    expect(rendered(boot.sent).sort()).toEqual(['ui/b.tsx', 'ui/c.tsx']);
    for (const rel of Object.keys(FILES)) expect(index.canvas(rel)?.cover).not.toBeNull();

    // an edit while no server ran: the cover is stale (ofSrc ≠ srcHash) and is queued again
    const abs = join(designRoot, 'ui/b.tsx');
    writeFileSync(abs, readFileSync(abs, 'utf8').replace('>b<', '>b2<'));
    index.update(['ui/b.tsx']);
    const row = index.canvas('ui/b.tsx');
    expect(row?.cover?.ofSrc).not.toBe(row?.srcHash);
    const again = service(root, designRoot, index);
    expect(await again.svc.bootCovers()).toBe(1);
    await again.svc.idle();
    expect(rendered(again.sent)).toEqual(['ui/b.tsx']);
  });

  test('boot with every cover fresh queues nothing and never starts the renderer', async () => {
    const { root, designRoot, index } = await withOneCover();
    const fill = service(root, designRoot, index);
    await fill.svc.bootCovers();
    await fill.svc.idle();
    const boot = service(root, designRoot, index);
    expect(await boot.svc.bootCovers()).toBe(0);
    await boot.svc.idle();
    expect(boot.spawns()).toBe(0);
    expect(boot.sent.length).toBe(0);
  });

  test('a cover fresh for its source is left alone: boot does not re-key every canvas', async () => {
    // the pass reads the snapshot's cover row, not every canvas's key inputs (240 canvases on
    // studyfi-design); a theme- or CSS-only change re-renders when the Canvases panel asks
    const { root, designRoot, index } = await withOneCover();
    const fill = service(root, designRoot, index);
    await fill.svc.bootCovers();
    await fill.svc.idle();
    const light = service(root, designRoot, index, { config: () => ({ theme: 'light' }) });
    expect(await light.svc.bootCovers()).toBe(0);
    expect(light.spawns()).toBe(0);
  });

  test('a cell (enabled:false) and a server with no capture origin queue nothing', async () => {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, FILES);
    const index = indexFor(root, designRoot);
    const cell = service(root, designRoot, index, { enabled: false });
    expect(await cell.svc.bootCovers()).toBe(0);
    const split = service(root, designRoot, index, { captureOrigin: () => undefined });
    expect(await split.svc.bootCovers({ waitMs: 0 })).toBe(0);
    await cell.svc.idle();
    await split.svc.idle();
    expect(cell.spawns() + split.spawns()).toBe(0);
  });

  test('the boot pass renders at background priority: a cover on screen goes first', async () => {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, FILES);
    const index = indexFor(root, designRoot);
    let busy = true;
    const gated = service(root, designRoot, index, { exportBusy: () => busy });
    await gated.svc.bootCovers();
    await gated.svc.thumb({
      canvas: 'ui/c.tsx',
      artboard: null,
      size: 'card',
      priority: 'visible',
    });
    busy = false; // an export held the queue (it pauses); the first render once it ends is the visible one
    await gated.svc.idle();
    expect(rendered(gated.sent)[0]).toBe('ui/c.tsx');
    expect(rendered(gated.sent).length).toBe(3);
  });

  test('the project server starts the boot pass once its index is built (http.ts wiring)', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const at = http.indexOf('const thumbs = createThumbService({');
    expect(at).toBeGreaterThan(0);
    expect(http.slice(at, at + 6000).includes('thumbs.bootCovers(')).toBe(true);
  });
});

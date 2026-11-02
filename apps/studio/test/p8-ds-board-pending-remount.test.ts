// P8 e2e r4 (ds-edges): the Design system board bakes its model — `dsPending` included — into its module
// (ds/board/build-model.ts boardDeps). A fix that leaves a change waiting writes only `design-system.meta.json`, which
// the watcher classified as a plain `meta` echo, so the open board's bar never said "1 change waiting". A meta write
// whose `dsPending` moved now remounts the board; a layout-only write (a dragged artboard) does not.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Context, createBus } from '../context.ts';
import { createHmrBroadcaster, HMR_DEBOUNCE_MS, type HmrMessage } from '../hmr-broadcast.ts';

const flush = () => new Promise((r) => setTimeout(r, HMR_DEBOUNCE_MS + 30));

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'p8-ds-board-'));
  mkdirSync(join(root, 'system/acme'), { recursive: true });
  writeFileSync(join(root, 'system/acme/design-system.tsx'), 'export default () => null;\n');
  const meta = (m: object) =>
    writeFileSync(join(root, 'system/acme/design-system.meta.json'), JSON.stringify(m));
  const ctx = {
    cfg: {} as Context['cfg'],
    projectLabel: '',
    paths: { designRoot: root } as Context['paths'],
    bus: createBus(),
  } as Context;
  const got: HmrMessage[] = [];
  const h = createHmrBroadcaster(ctx, (m) => got.push(m));
  const boardReloads = () =>
    got.filter((m) => m.mode === 'module' && m.file === 'system/acme/design-system.tsx').length;
  const write = async (m: object) => {
    meta(m);
    ctx.bus.emit('fs:any', 'system/acme/design-system.meta.json');
    await flush();
  };
  return {
    root,
    h,
    boardReloads,
    write,
    done: () => {
      h.stop();
      rmSync(root, { recursive: true });
    },
  };
}

describe('the Design system board remounts when its waiting changes move', () => {
  test('dsPending gains an entry → the board module reloads; the meta echo still goes out', async () => {
    const s = setup();
    await s.write({ layout: { artboards: [] } });
    const base = s.boardReloads();
    await s.write({
      layout: { artboards: [] },
      dsPending: { tokens: { '--fg-2': { value: '#555' } } },
    });
    expect(s.boardReloads()).toBe(base + 1);
    s.done();
  });
  test('a layout-only write (same dsPending) does not remount the board', async () => {
    const s = setup();
    const pending = { tokens: { '--fg-2': { value: '#555' } } };
    await s.write({ layout: { artboards: [] }, dsPending: pending });
    const base = s.boardReloads();
    await s.write({ layout: { artboards: [{ id: 'colour', x: 40, y: 0 }] }, dsPending: pending });
    expect(s.boardReloads()).toBe(base);
    s.done();
  });
  test('dsPending cleared (Update N canvases) → the board reloads again', async () => {
    const s = setup();
    await s.write({ dsPending: { tokens: { '--fg-2': { value: '#555' } } } });
    const base = s.boardReloads();
    await s.write({});
    expect(s.boardReloads()).toBe(base + 1);
    s.done();
  });
});

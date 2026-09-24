// hmr-broadcast — Phase 3.6.1 Task 8. fs:any → canvas-hmr WS message classifier.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Context, createBus } from '../context.ts';
import {
  classifyChange,
  createContainerWriteBridge,
  createHmrBroadcaster,
  HMR_DEBOUNCE_MS,
  type HmrMessage,
  SYNTHETIC_FS_DELAY_MS,
} from '../hmr-broadcast.ts';

function mkCtx(): Context {
  const bus = createBus();
  return {
    cfg: {} as Context['cfg'],
    projectLabel: '',
    paths: {} as Context['paths'],
    bus,
  };
}

async function awaitNextFlush(): Promise<void> {
  await new Promise((r) => setTimeout(r, HMR_DEBOUNCE_MS + 20));
}

describe('hmr-broadcast / classification', () => {
  test('.tsx → mode: module', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/Docs Site.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(1);
    expect(got[0]?.mode).toBe('module');
    expect(got[0]?.file).toBe('ui/Docs Site.tsx');
    expect(got[0]?.scope).toBe('canvas');
    h.stop();
  });

  test('.css → mode: css', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/Docs Site.css');
    await awaitNextFlush();
    expect(got[0]?.mode).toBe('css');
    h.stop();
  });

  test('_lib/* → mode: hard, scope: lib', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', '_lib/canvas-lib.tsx');
    await awaitNextFlush();
    expect(got[0]?.mode).toBe('hard');
    expect(got[0]?.scope).toBe('lib');
    h.stop();
  });

  test('unrelated extensions are dropped; media becomes an asset heal', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/screenshot.png'); // media → asset heal (2026-08-15 RCA)
    ctx.bus.emit('fs:any', '_locator.json'); // runtime state → dropped
    await awaitNextFlush();
    expect(got).toHaveLength(1);
    expect(got[0]?.mode).toBe('asset');
    expect(got[0]?.file).toBe('ui/screenshot.png');
    h.stop();
  });
});

describe('hmr-broadcast / debouncing', () => {
  test('two rapid events collapse to one message', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/Smoke.tsx');
    ctx.bus.emit('fs:any', 'ui/Smoke.tsx');
    ctx.bus.emit('fs:any', 'ui/Smoke.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(1);
    h.stop();
  });

  test('coalescing prefers hard > module > css', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    // Burst of mixed events; final classification should be the strongest
    // (hard, from the _lib change).
    ctx.bus.emit('fs:any', 'ui/Smoke.css');
    ctx.bus.emit('fs:any', 'ui/Smoke.tsx');
    ctx.bus.emit('fs:any', '_lib/canvas-lib.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(1);
    expect(got[0]?.mode).toBe('hard');
    h.stop();
  });
});

describe('hmr-broadcast / multi-file bursts (RC4)', () => {
  test('a burst touching two canvases broadcasts one message PER file', async () => {
    // The old single-slot pendingMsg kept only the LAST file of a <50ms burst —
    // the other open canvas never got its module reload and sat stale until a
    // manual hard refresh (rca/issue-canvas-hmr-optimistic-update-consistency).
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/A.tsx');
    ctx.bus.emit('fs:any', 'ui/B.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(2);
    expect(new Set(got.map((m) => m.file))).toEqual(new Set(['ui/A.tsx', 'ui/B.tsx']));
    for (const m of got) expect(m.mode).toBe('module');
    h.stop();
  });

  test('a pending hard supersedes the whole per-file queue', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/A.tsx');
    ctx.bus.emit('fs:any', 'ui/B.tsx');
    ctx.bus.emit('fs:any', '_lib/canvas-lib.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(1);
    expect(got[0]?.mode).toBe('hard');
    h.stop();
  });

  test('same-file meta echo never downgrades a queued module reload', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/A.tsx');
    ctx.bus.emit('fs:any', 'ui/A.meta.json');
    await awaitNextFlush();
    const forA = got.filter((m) => m.file === 'ui/A.tsx');
    expect(forA).toHaveLength(1);
    expect(forA[0]?.mode).toBe('module');
    h.stop();
  });
});

describe('hmr-broadcast / stop', () => {
  test('stop() prevents further broadcasts', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    h.stop();
    ctx.bus.emit('fs:any', 'ui/X.tsx');
    await awaitNextFlush();
    expect(got).toHaveLength(0);
  });
});

describe('container write bridge — synthesises fs:any the container fs.watch misses', () => {
  const collect = (ctx: Context) => {
    const got: string[] = [];
    ctx.bus.on('fs:any', (rel: string) => got.push(rel));
    return got;
  };

  test('activity:suppress → a synthetic fs:any lands after the delay', async () => {
    const ctx = mkCtx();
    const got = collect(ctx);
    const bridge = createContainerWriteBridge(ctx);
    ctx.bus.emit('activity:suppress', 'ui/Home.tsx');
    expect(got).toHaveLength(0); // not immediate — the write must settle first
    await new Promise((r) => setTimeout(r, SYNTHETIC_FS_DELAY_MS + 30));
    expect(got).toEqual(['ui/Home.tsx']);
    bridge.stop();
  });

  test('a no-op / failed edit disarms via activity:unsuppress — no reload for peers', async () => {
    const ctx = mkCtx();
    const got = collect(ctx);
    const bridge = createContainerWriteBridge(ctx);
    ctx.bus.emit('activity:suppress', 'ui/Home.tsx');
    ctx.bus.emit('activity:unsuppress', 'ui/Home.tsx'); // delta 0 / threw
    await new Promise((r) => setTimeout(r, SYNTHETIC_FS_DELAY_MS + 30));
    expect(got).toHaveLength(0);
    bridge.stop();
  });

  test('backslash paths are normalised so they match the watcher/classifier shape', async () => {
    const ctx = mkCtx();
    const got = collect(ctx);
    const bridge = createContainerWriteBridge(ctx);
    ctx.bus.emit('activity:suppress', 'ui\\Home.tsx');
    await new Promise((r) => setTimeout(r, SYNTHETIC_FS_DELAY_MS + 30));
    expect(got).toEqual(['ui/Home.tsx']);
    bridge.stop();
  });

  test('stop() cancels a pending emit', async () => {
    const ctx = mkCtx();
    const got = collect(ctx);
    const bridge = createContainerWriteBridge(ctx);
    ctx.bus.emit('activity:suppress', 'ui/Home.tsx');
    bridge.stop();
    await new Promise((r) => setTimeout(r, SYNTHETIC_FS_DELAY_MS + 30));
    expect(got).toHaveLength(0);
  });
});

describe('the PhotoEdit sidecar reaches open canvases', () => {
  // `assets/<sha8>.photo.json` changing on disk is a peer's photo adjustment
  // arriving. It used to classify as null — no message, no re-bake, and the
  // edit appeared only after a manual reload.
  const noSibling = () => false;

  test('a photo sidecar classifies as an asset heal', () => {
    const msg = classifyChange('assets/3631ac58.photo.json', noSibling);
    expect(msg?.mode).toBe('asset');
    expect(msg?.file).toBe('assets/3631ac58.photo.json');
  });

  test('a DS-tree photo sidecar too', () => {
    expect(classifyChange('system/brand/assets/aabbccdd.photo.json', noSibling)?.mode).toBe(
      'asset'
    );
  });

  test('an ordinary json outside assets/ still classifies as before', () => {
    // .meta.json keeps its dedicated lane; other json (module-ish) unchanged.
    expect(classifyChange('ui/home.meta.json', noSibling)?.mode).toBe('meta');
    expect(classifyChange('notes/data.photo.json', noSibling)).toBe(null);
  });
});

// Plan T31/L21 — an open canvas skips a module reload right after its own
// optimistic style edit (anti-flicker). A write by SYNC must never be skipped:
// it can carry a teammate's change merged under that person's edit.
describe('sync writes reach an open canvas even right after an own edit', () => {
  test('a delayed watcher fallback does not reload the same disk version twice; the next write still does', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-hmr-repeat-'));
    const ctx = mkCtx();
    ctx.paths.designRoot = root;
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    try {
      writeFileSync(join(root, 'Theirs.tsx'), 'export default 1;');
      ctx.bus.emit('sync:projected', 'Theirs.tsx');
      ctx.bus.emit('fs:any', 'Theirs.tsx');
      await awaitNextFlush();
      expect(got).toHaveLength(1);
      // Outside HMR's 50 ms debounce: the cell's synthetic fallback used to
      // start a second import and invalidate the first import still in flight.
      ctx.bus.emit('fs:any', 'Theirs.tsx');
      await awaitNextFlush();
      expect(got).toHaveLength(1);
      // Equal-size rapid edits are not echoes, even within the remote window.
      writeFileSync(join(root, 'Theirs.tsx'), 'export default 2;');
      ctx.bus.emit('sync:projected', 'Theirs.tsx');
      ctx.bus.emit('fs:any', 'Theirs.tsx');
      await awaitNextFlush();
      expect(got).toHaveLength(2);
      expect(got.every((m) => m.remote)).toBe(true);
    } finally {
      h.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a change sync just wrote is marked remote; an own edit is not', async () => {
    const ctx = mkCtx();
    const got: HmrMessage[] = [];
    const h = createHmrBroadcaster(ctx, (m) => got.push(m));
    ctx.bus.emit('fs:any', 'ui/Mine.tsx');
    ctx.bus.emit('sync:projected', 'ui/Theirs.tsx');
    ctx.bus.emit('fs:any', 'ui/Theirs.tsx');
    await awaitNextFlush();
    const byFile = Object.fromEntries(got.map((m) => [m.file, m]));
    expect(byFile['ui/Mine.tsx']?.remote).toBeUndefined();
    expect(byFile['ui/Theirs.tsx']?.remote).toBe(true);
    h.stop();
  });

  test('the iframe skips only a non-remote module change inside the optimistic window', () => {
    const shell = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
      'utf8'
    );
    const skip = shell.split('\n').find((l) => l.includes('lastCssOptimisticAt < 1500'));
    expect(skip).toContain('!msg.remote');
  });
});

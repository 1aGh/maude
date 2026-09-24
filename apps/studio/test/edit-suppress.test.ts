// RC1 + RC2 (rca/issue-canvas-hmr-optimistic-update-consistency) — inline edits
// (inspector CSS knobs / inline text / attr panel) are USER-originated and must
// not light the "agent works here" rim: every edit op arms `activity:suppress`
// before its write (disarming on no-op/throw), and the activity tracker swallows
// EVERY fs:any inside the suppression window (not just the first — the old
// one-shot let the 2nd event of a same-file write burst through).

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createActivity } from '../activity.ts';
import { createApi } from '../api.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
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

const SRC = `export default function Knob() {
  return (
    <section>
      <div id="a">Alpha</div>
      <div id="b">Beta</div>
    </section>
  );
}`;

/** Map author `id="X"` → the data-cd-id the pipeline injects (reorder-test trick). */
function cdIds(abs: string, source: string): Record<string, string> {
  const { withIds } = transpileCanvasSource(abs, source);
  const out: Record<string, string> = {};
  for (const m of withIds.matchAll(/data-cd-id="([0-9a-f]{8})"[^>]*?\bid="([^"]+)"/g)) {
    out[m[2] as string] = m[1] as string;
  }
  return out;
}

interface Rig {
  ctx: Context;
  api: ReturnType<typeof createApi>;
  ids: Record<string, string>;
  suppressed: string[];
  unsuppressed: string[];
}

async function mkRig(): Promise<Rig> {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Knob.tsx');
  await Bun.write(abs, SRC);
  const ctx = mkCtx(root, designRoot);
  const api = createApi(ctx, { onCommentsChanged: () => {} });
  const suppressed: string[] = [];
  const unsuppressed: string[] = [];
  ctx.bus.on('activity:suppress', (rel: string) => suppressed.push(rel));
  ctx.bus.on('activity:unsuppress', (rel: string) => unsuppressed.push(rel));
  return { ctx, api, ids: cdIds(abs, SRC), suppressed, unsuppressed };
}

describe('inline edits arm activity:suppress (RC1)', () => {
  test('only completed changed writes announce their exact source bytes', async () => {
    const rig = await mkRig();
    const written: Array<{ rel: string; content: string }> = [];
    rig.ctx.bus.on('source-written', (event) => written.push(event));
    const result = await rig.api.editText({ canvas: 'ui/Knob', id: rig.ids.a, text: 'Gamma' });
    expect(result.ok).toBe(true);
    expect(written).toEqual([
      {
        rel: 'ui/Knob.tsx',
        content: await Bun.file(join(rig.ctx.paths.designRoot, 'ui/Knob.tsx')).text(),
      },
    ]);
    expect(written[0]?.content).toContain('Gamma');
    await rig.api.editCss({ canvas: 'ui/Knob', id: rig.ids.a, property: 'color', reset: true });
    await rig.api.editCss({ canvas: 'ui/Knob', id: '00000000', property: 'color', value: 'red' });
    expect(written).toHaveLength(1);
  });

  test('editCss arms suppress before the write and does not disarm on success', async () => {
    const rig = await mkRig();
    const res = await rig.api.editCss({
      canvas: 'ui/Knob',
      id: rig.ids.a,
      property: 'color',
      value: 'red',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.delta).toBeGreaterThan(0);
    expect(rig.suppressed).toEqual(['ui/Knob.tsx']);
    expect(rig.unsuppressed).toEqual([]);
  });

  test('editText and editAttr arm suppress too', async () => {
    const rig = await mkRig();
    const t = await rig.api.editText({ canvas: 'ui/Knob', id: rig.ids.a, text: 'Gamma' });
    expect(t.ok).toBe(true);
    const a = await rig.api.editAttr({
      canvas: 'ui/Knob',
      id: rig.ids.b,
      attr: 'data-x',
      value: 'on',
    });
    expect(a.ok).toBe(true);
    expect(rig.suppressed).toEqual(['ui/Knob.tsx', 'ui/Knob.tsx']);
    expect(rig.unsuppressed).toEqual([]);
  });

  test('a no-op edit disarms (no write happened — the next agent edit must rim)', async () => {
    const rig = await mkRig();
    // Removing an inline style that was never set is delta-0 by contract.
    const res = await rig.api.editCss({
      canvas: 'ui/Knob',
      id: rig.ids.a,
      property: 'color',
      reset: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.delta).toBe(0);
    expect(rig.suppressed).toEqual(['ui/Knob.tsx']);
    expect(rig.unsuppressed).toEqual(['ui/Knob.tsx']);
  });

  test('a failed edit disarms', async () => {
    const rig = await mkRig();
    // Valid id shape, but no such element — canvas-edit throws, op returns 422.
    const res = await rig.api.editCss({
      canvas: 'ui/Knob',
      id: '00000000',
      property: 'color',
      value: 'red',
    });
    expect(res.ok).toBe(false);
    expect(rig.unsuppressed).toEqual(['ui/Knob.tsx']);
  });
});

describe('suppression window swallows the whole burst (RC2)', () => {
  test('every fs:any inside the TTL is swallowed; post-TTL marks active again', async () => {
    const rig = await mkRig();
    const activity = createActivity(rig.ctx, { idleMs: 20, diff: false, suppressTtlMs: 150 });
    const changes: Array<{ status: string }> = [];
    rig.ctx.bus.on('activity:change', (c: { status: string }) => changes.push(c));

    await rig.api.editCss({ canvas: 'ui/Knob', id: rig.ids.a, property: 'color', value: 'red' });
    // Simulate the watcher: an editor save often lands as several debounced
    // events — the old one-shot suppress let the 2nd one light the rim.
    rig.ctx.bus.emit('fs:any', 'ui/Knob.tsx');
    rig.ctx.bus.emit('fs:any', 'ui/Knob.tsx');
    rig.ctx.bus.emit('fs:any', 'ui/Knob.tsx');
    expect(changes).toHaveLength(0);

    // After the TTL expires the same file must rim again (agent edit case).
    await new Promise((r) => setTimeout(r, 180));
    rig.ctx.bus.emit('fs:any', 'ui/Knob.tsx');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.status).toBe('active');
    activity.stop();
  });

  test('unsuppress (failed edit) restores the rim immediately', async () => {
    const rig = await mkRig();
    const activity = createActivity(rig.ctx, { idleMs: 20, diff: false, suppressTtlMs: 5000 });
    const changes: Array<{ status: string }> = [];
    rig.ctx.bus.on('activity:change', (c: { status: string }) => changes.push(c));

    await rig.api.editCss({ canvas: 'ui/Knob', id: '00000000', property: 'color', value: 'red' });
    rig.ctx.bus.emit('fs:any', 'ui/Knob.tsx');
    expect(changes).toHaveLength(1); // not muted — the arm was rolled back
    activity.stop();
  });
});

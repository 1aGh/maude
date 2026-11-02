// P8 bug sweep B2 — draw a rectangle, ⌘D it, ⌫ it, ⌘Z: the rectangle you drew vanished and the deleted copy
// stayed deleted. Duplicate, delete and insert-element (the Text tool's click) wrote the file without telling
// the home it was the person's edit (`source-written`), so the watcher recorded `outside`, the ⌘Z projection
// skips `outside`, and ⌘Z reached past them to an older edit. They now say what they did, like every other
// source write the studio makes (api.ts suppressedEdit; test/s2-25-move-label.test.ts).
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const SRC = `export default function Knob() {
  return (
    <DesignCanvas>
      <DCArtboard id="board" label="Board" width={400} height={300}>
        <div id="a" style={{ position: 'absolute', left: 100, top: 30 }}>Alpha</div>
        <div id="b" style={{ position: 'absolute', left: 100, top: 90 }}>Beta</div>
      </DCArtboard>
    </DesignCanvas>
  );
}`;

async function rig() {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Knob.tsx');
  await Bun.write(abs, SRC);
  const ctx: Context = {
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
  const api = createApi(ctx, { onCommentsChanged: () => {} });
  const { withIds } = transpileCanvasSource(abs, SRC);
  const idOf = (name: string) =>
    new RegExp(`data-cd-id="([0-9a-f]{8})"[^>]*?\\bid="${name}"`).exec(withIds)?.[1] as string;
  const written: Array<{ rel: string; content: string; label?: string }> = [];
  ctx.bus.on('source-written', (e) => written.push(e));
  return { api, idOf, written };
}

describe('the element structure ops tell the home they are the person’s edit', () => {
  test('duplicate: one source-written, labelled', async () => {
    const r = await rig();
    const res = await r.api.duplicateElementOp({ canvas: 'ui/Knob', id: r.idOf('a') });
    expect(res.ok).toBe(true);
    expect(r.written.length).toBe(1);
    expect(r.written[0]?.label).toMatch(/^Duplicated /);
    expect(r.written[0]?.content).toContain('Alpha');
  });

  test('delete: one source-written, labelled', async () => {
    const r = await rig();
    const res = await r.api.deleteElementOp({ canvas: 'ui/Knob', id: r.idOf('b') });
    expect(res.ok).toBe(true);
    expect(r.written.length).toBe(1);
    expect(r.written[0]?.label).toMatch(/^Deleted /);
    expect(r.written[0]?.content).not.toContain('Beta');
  });

  test('insert (the Text tool): one source-written, labelled by what was added', async () => {
    const r = await rig();
    const res = await r.api.insertElementOp({
      canvas: 'ui/Knob',
      refId: r.idOf('a'),
      position: 'after',
      kind: 'text',
    });
    expect(res.ok).toBe(true);
    expect(r.written.length).toBe(1);
    expect(r.written[0]?.label).toBe('Added text');
  });

  test('a no-op (nothing changed on disk) says nothing', async () => {
    const r = await rig();
    const res = await r.api.deleteElementOp({ canvas: 'ui/Knob', id: 'deadbeef' });
    expect(res.ok).toBe(false);
    expect(r.written.length).toBe(0);
  });
});

// S2.25 G2 (14 ed-edge-undo) — a keyboard nudge / drag of an out-of-flow element is ONE source write that says what
// it did. It used to be two `POST /_api/edit-css` calls (left, then top), each an unlabelled `source-written`, so the
// undo history read "Edit canvas" and a ⌘Z could land between the two halves of one move.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { type Context, createBus } from '../context.ts';
import { moveLabel } from '../edit-ops/op-label.ts';
import { makeSandbox } from './_helpers.ts';

const SRC = `export default function Knob() {
  return (
    <section>
      <div id="a" style={{ position: 'absolute', left: 100, top: 300 }}>Alpha</div>
    </section>
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
  const id = /data-cd-id="([0-9a-f]{8})"[^>]*?\bid="a"/.exec(withIds)?.[1] as string;
  const written: Array<{ rel: string; content: string; label?: string }> = [];
  ctx.bus.on('source-written', (e) => written.push(e));
  return { api, id, written, abs };
}

describe('S2.25 G2 — the edit-css write names itself', () => {
  test('a label rides the source-written the home records the row from', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: r.id,
      property: 'left',
      value: '110px',
      label: '  Moved See pricing 10 px  ',
    });
    expect(res.ok).toBe(true);
    expect(r.written.map((w) => w.label)).toEqual(['Moved See pricing 10 px']);
  });

  test('no label, or a non-string one, leaves the event as it was', async () => {
    const r = await rig();
    await r.api.editCss({ canvas: 'ui/Knob', id: r.id, property: 'left', value: '120px' });
    await r.api.editCss({
      canvas: 'ui/Knob',
      id: r.id,
      property: 'left',
      value: '130px',
      label: { x: 1 },
    });
    expect(r.written.length).toBe(2);
    for (const w of r.written) expect('label' in w).toBe(false);
  });

  test('left and top in ONE request are one write and one source-written', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: r.id,
      property: 'left',
      value: '110px',
      also: [{ property: 'top', value: '301px' }],
      label: 'Moved See pricing 10 px',
    });
    expect(res.ok).toBe(true);
    expect(r.written.length).toBe(1);
    const text = await Bun.file(r.abs).text();
    expect(text).toContain('left: "110px"');
    expect(text).toContain('top: "301px"');
    expect(r.written[0]?.content).toBe(text);
  });

  test('a malformed `also` writes nothing', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: r.id,
      property: 'left',
      value: '110px',
      also: [{ property: 'top; x', value: '1px' }],
    });
    expect(res.ok).toBe(false);
    expect(r.written.length).toBe(0);
  });
});

describe('S2.25 G2 — moveLabel says what a move did', () => {
  test('one axis: the distance; two: both, in words', () => {
    expect(moveLabel('see-pricing', 10, 0)).toBe('Moved See pricing 10 px');
    expect(moveLabel('see-pricing', 0, -1)).toBe('Moved See pricing 1 px');
    expect(moveLabel('see-pricing', 10, 4)).toBe('Moved See pricing 10 px right, 4 px down');
    expect(moveLabel('see-pricing', -10, -4)).toBe('Moved See pricing 10 px left, 4 px up');
    expect(moveLabel('42612cfe', 10, 0)).toBe('Moved an object 10 px');
  });
});

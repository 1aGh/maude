// F4 (V2-8 functional triage) — the legacy api.ts write path said its write (`source-written`) only after
// the bytes landed and one more file read: a watcher event or a ⌘Z's undo-stack read in that gap found no
// note and recorded the person's edit as `outside`. It now says the bytes BEFORE they land
// (`source-writing`, the local home's early note), like routes/edit.ts, and takes the note back when the
// write throws (`source-write-failed`, F5) — a later outside write of the same bytes is never the person's.
import { describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync } from 'node:fs';
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

type Said = {
  ev: string;
  rel: string;
  content: string;
  base?: string;
  label?: string;
  disk: string;
};

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
  const said: Said[] = [];
  for (const ev of ['source-writing', 'source-written', 'source-write-failed'])
    ctx.bus.on(ev, (e: Omit<Said, 'ev' | 'disk'>) =>
      said.push({ ev, ...e, disk: readFileSync(abs, 'utf8') })
    );
  return { api, idOf, said, abs };
}

describe('F4 — the legacy write path says its bytes before they land', () => {
  test('edit-css (suppressedEdit): source-writing with the bytes, while the disk still holds the old ones', async () => {
    const r = await rig();
    const res = await r.api.editCss({
      canvas: 'ui/Knob',
      id: r.idOf('a'),
      property: 'left',
      value: '110px',
      label: 'Moved Alpha',
    });
    expect(res.ok).toBe(true);
    const final = readFileSync(r.abs, 'utf8');
    expect(r.said.map((s) => s.ev)).toEqual(['source-writing', 'source-written']);
    const [early] = r.said;
    expect(early).toMatchObject({
      rel: 'ui/Knob.tsx',
      content: final,
      base: SRC,
      label: 'Moved Alpha',
    });
    // said BEFORE the bytes landed
    expect(early?.disk).toBe(SRC);
  });

  test('delete / duplicate: said before the bytes too', async () => {
    const r = await rig();
    expect((await r.api.deleteElementOp({ canvas: 'ui/Knob', id: r.idOf('b') })).ok).toBe(true);
    const afterDelete = readFileSync(r.abs, 'utf8');
    expect((await r.api.duplicateElementOp({ canvas: 'ui/Knob', id: r.idOf('a') })).ok).toBe(true);
    const early = r.said.filter((s) => s.ev === 'source-writing');
    expect(early.map((s) => s.label)).toEqual(['Deleted an object', 'Duplicated an object']);
    expect(early.map((s) => s.disk)).toEqual([SRC, afterDelete]);
    expect(early[1]?.base).toBe(afterDelete);
  });

  test('a write that throws takes its early note back', async () => {
    const r = await rig();
    const dir = join(r.abs, '..');
    // the atomic write's tmp file cannot be created: EACCES, not a full disk (that holds the bytes)
    chmodSync(dir, 0o555);
    try {
      const res = await r.api.editCss({
        canvas: 'ui/Knob',
        id: r.idOf('a'),
        property: 'left',
        value: '110px',
      });
      expect(res.ok).toBe(false);
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readFileSync(r.abs, 'utf8')).toBe(SRC);
    expect(r.said.map((s) => s.ev)).toEqual(['source-writing', 'source-write-failed']);
    expect(r.said[1]?.content).toBe(r.said[0]?.content);
  });
});

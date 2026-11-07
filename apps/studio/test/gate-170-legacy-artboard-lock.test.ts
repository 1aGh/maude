// #170 — the legacy artboard and clip routes (resize-artboard, set-artboard-*, delete-artboard, the *-sequence
// routes and toggle-hide) wrote to a locked artboard: the dispatcher refuses artboard-wide ops there, but these
// routes never asked. Each now asks the same lock lookup (`lockedRefusal`) and answers the edit-op's 409 `locked`
// (kg v2-p8-lock-reasons-direct-writes-one-lookup); the same call on an unlocked artboard writes as before.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const SRC = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';
export default function Boards() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S">
        <DCArtboard id="locked" label="Locked" width={400} height={300} data-cd-locked>
          <div data-cd-id="l1">L</div>
        </DCArtboard>
        <DCArtboard id="free" label="Free" width={400} height={300}>
          <div data-cd-id="f1">F</div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}`;

async function rig() {
  const { root, designRoot } = makeSandbox();
  const abs = join(designRoot, 'ui', 'Boards.tsx');
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
  return { api, abs };
}

type Api = Awaited<ReturnType<typeof rig>>['api'];
type Answer = { ok: boolean; status?: number; code?: string; error?: string };
const base = { canvas: 'ui/Boards' };

const CALLS: Array<[string, (api: Api, id: string) => Promise<unknown>]> = [
  ['resize-artboard', (a, id) => a.resizeArtboardOp({ ...base, artboardId: id, width: 500 })],
  ['set-artboard-hug', (a, id) => a.setArtboardHugOp({ ...base, artboardId: id, fixed: true })],
  ['set-artboard-kind', (a, id) => a.setArtboardKindOp({ ...base, artboardId: id, kind: 'web' })],
  [
    'set-artboard-label',
    (a, id) => a.setArtboardLabelOp({ ...base, artboardId: id, label: 'Renamed' }),
  ],
  ['set-artboard-style', (a, id) => a.setArtboardStyleOp({ ...base, artboardId: id, padding: 8 })],
  ['delete-artboard', (a, id) => a.deleteArtboardOp({ ...base, artboardId: id })],
  [
    'toggle-hide (a clip on the artboard)',
    (a, id) => a.toggleHideOp({ ...base, artboardId: id, stableId: 'clip-1' }),
  ],
  [
    'retime-sequence (a clip on the artboard)',
    (a, id) =>
      a.retimeSequenceOp({ ...base, artboardId: id, stableId: 'clip-1', durationInFrames: 30 }),
  ],
];

describe('the legacy artboard and clip routes refuse a locked artboard', () => {
  for (const [name, call] of CALLS) {
    test(`${name}: locked → 409 locked and nothing written`, async () => {
      const r = await rig();
      const no = (await call(r.api, 'locked')) as Answer;
      expect({ ok: no.ok, status: no.status, code: no.code }).toEqual({
        ok: false,
        status: 409,
        code: 'locked',
      });
      expect(no.error).toMatch(/is locked · ⇧⌘L unlocks$/);
      expect(await Bun.file(r.abs).text()).toBe(SRC);
    });
  }

  test('an unlocked artboard is not refused for the lock (resize writes)', async () => {
    const r = await rig();
    const yes = (await r.api.resizeArtboardOp({
      ...base,
      artboardId: 'free',
      width: 500,
    })) as Answer;
    expect(yes.ok).toBe(true);
    expect(await Bun.file(r.abs).text()).not.toBe(SRC);
  });
});

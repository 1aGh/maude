// T5.2 (#165) — an op batch with no live room (api.applyAnnotationOps' disk path) records its contest.
// A collab room tags a step contested when one of its batches 3-way-merged a text field (its `expect`
// was not what the field held — a collaborator changed it during the step); the home then refuses that
// step's ⌘Z (annotations/text-steps.ts, kg maude/v2-p8-undo-collab-refuse-contest-by-merge-not-write-id).
// The disk path ran the same merge but told the home nothing, so the ⌘Z went through and dropped the
// collaborator's text. It now hands the contested ids to `onAnnotationsChanged`, beside the base.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Op } from '../annotations/ops.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

const FILE = '.design/ui/Site.tsx';

const sticky = (id: string, text: string): AnnotationElement =>
  ({ id, type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;

function rig(board: AnnotationElement[]) {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Site.tsx'), 'export default function P(){return <main/>}');
  writeFileSync(join(designRoot, 'ui-site.annotations.json'), serializeBoard(board));
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 't52',
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
  const seen: Array<{ contested: readonly string[] | undefined }> = [];
  const api = createApi(ctx, {
    onCommentsChanged() {},
    onAnnotationsChanged(_file, _text, _writeId, _base, _withLanes, contested) {
      seen.push({ contested });
    },
    // no live room: the batch goes to disk
    applyAnnotationOpsLive: () => null,
  });
  return { api, seen };
}

const typed = (id: string, expect: string, text: string): Op => ({
  op: 'patch',
  id,
  set: { text },
  expect: { text: expect },
});

describe('no live room — a 3-way-merged text batch is reported contested', () => {
  test('a commit whose expect is not the text on disk (a collaborator typed) names the element', async () => {
    const { api, seen } = rig([sticky('s1', 'Peer: hello'), sticky('s2', 'x')]);
    const r = await api.applyAnnotationOps(FILE, [typed('s1', 'hello', 'hello world')]);
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0].contested).toEqual(['s1']);
  });

  test('a commit on the text it expects is not contested', async () => {
    const { api, seen } = rig([sticky('s1', 'hello')]);
    await api.applyAnnotationOps(FILE, [typed('s1', 'hello', 'hello world')]);
    expect(seen.length).toBe(1);
    expect(seen[0].contested ?? []).toEqual([]);
  });
});

// gate-b-fix3 — "Lower under speech" (video.music.duck) is ONE undoable step on a local (op-log) project:
// the write wraps the bed in <Duck> AND adds `Duck` to the canvas-lib import; ⌘Z (the kernel's
// acceptedUndo, what the shell's projection runs) puts the original bytes back — wrap and import together.
//
// Same hooks the server calls: the edit-op writes the file, api/routes `source-written` → `noteWritten`,
// the watcher is `observe` + `flush` (see local-kernel-studio-lanes.test.ts).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import { compClips } from '../video/derive.ts';

const REL = 'ui/Reel.tsx';
const REPO_REL = `.design/${REL}`;
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Audio, Sequence } from 'remotion';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 90;',
  'const Comp = () => (',
  '  <>',
  '    <Sequence name="one" from={0} durationInFrames={90}><Video src="a.mp4" /></Sequence>',
  '    <Audio src="bed.mp3" volume={0.8} />',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" label="Recap" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-duck-undo-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const abs = path.join(designRoot, REL);
  writeFileSync(abs, SRC);
  return { designRoot, abs };
}

describe('Lower under speech is one undo step', () => {
  test('duck, then ⌘Z, gives back the original bytes (the wrap and the import)', async () => {
    const p = project();
    const h = openLocalHome({
      designRoot: p.designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_mac_one', name: 'Mac one' },
      bootId: 'boot-1',
      lockRetryMs: 0,
      settleMs: 5,
      aiSettleMs: 0,
      log: { warn() {}, error() {} },
    });
    homes.push(h);
    await h.ready();

    const bed = compClips(REL, SRC, 'reel').clips.find((c) => c.src === 'bed.mp3');
    const op = EDIT_OPS.find((o) => o.id === 'video.music.duck');
    const out = op?.apply(SRC, {
      file: REL,
      op: 'video.music.duck',
      targets: [],
      params: { artboard: 'reel', stableId: bed?.stableId },
    });
    expect(out?.source).toContain('<Duck');
    expect(out?.source).toContain(', Duck }');

    writeFileSync(p.abs, out?.source as string);
    h.noteWritten(REL, out?.source as string, 'Lower under speech');
    h.observe(REL);
    await h.flush();

    const [top] = await h.runtime.acceptedHistory({ path: REPO_REL, limit: 50, mine: true });
    expect([top.kind, top.label]).toEqual(['edit', 'Lower under speech']);
    const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(readFileSync(p.abs, 'utf8')).toBe(SRC);
  });
});

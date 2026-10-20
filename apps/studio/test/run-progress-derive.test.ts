// S7.14 — a run's `progress` (V2-1.15 amendment, S7 §2.2) is DERIVED from the run's writes: the comp on the
// run's artboard and the cut it is placing (`<designRoot>/*.edl.json`, matched by shot name). What the model
// says — its label, its "doing" line — never moves it. Only YOUR view carries it; peers' `publicRun` never.
// An ended run keeps what its files said when it ended ("Placed 7 of 14 shots.").

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { publicRun } from '../ai/run-lifecycle.ts';
import { createRunProgress, runTargets } from '../ai/run-progress.ts';
import { createRunRegistry } from '../ai/runs.ts';
import type { Edl } from '../footage/schema.ts';
import { placeNext } from '../video/reel-place.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CANVAS = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { AbsoluteFill } from 'remotion';",
  'const Recap = () => (',
  "  <AbsoluteFill style={{ background: '#000' }}>",
  '  </AbsoluteFill>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="recap" kind="video" width={1080} height={1920}>',
  '        <VideoComp component={Recap} durationInFrames={900} fps={30} width={1080} height={1920} />',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const EDL: Edl = {
  version: 1,
  fps: 30,
  beats: Array.from({ length: 14 }, (_, i) => ({
    clip: `assets/${String(i).padStart(8, 'b')}.mp4`,
    startSec: i,
    durationFrames: 60,
    name: `Shot ${String.fromCharCode(65 + i)}`,
    transition: null,
  })),
};

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'run-progress-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const abs = path.join(designRoot, 'ui', 'Recap.tsx');
  writeFileSync(abs, CANVAS);
  writeFileSync(path.join(designRoot, 'recap.edl.json'), JSON.stringify(EDL));
  let source = CANVAS;
  /** the verb's write: one shot onto disk */
  const placeOne = () => {
    const r = placeNext(abs, source, EDL, 'recap');
    if (r.status !== 'placed') throw new Error('nothing to place');
    source = r.source;
    writeFileSync(abs, source);
  };
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    stage: { publish: () => ({ status: 'accepted' }), hold: () => {} },
    progressOf: createRunProgress({ designRoot }),
  });
  return { designRoot, placeOne, reg };
}

const ask = (
  reg: ReturnType<typeof project>['reg'],
  label = 'Make a 30 s recap from these 12 clips'
) =>
  reg.ask({
    chatId: 'c1',
    origin: 'maude-chat',
    label,
    scope: { canvas: 'ui/Recap.tsx', artboards: ['recap'] },
  });

describe('run progress — from the run’s writes', () => {
  test('each shot written moves done; the AI edge is the end of the last one', async () => {
    const { placeOne, reg } = project();
    const r = await ask(reg);
    await reg.started(r.runId);
    expect(reg.view().mine[0]?.progress).toBeUndefined(); // nothing placed yet: no cut on the artboard
    for (let i = 0; i < 7; i++) placeOne();
    const p = reg.view().mine[0]?.progress;
    expect(p).toMatchObject({
      kind: 'place',
      done: 7,
      total: 14,
      label: 'Placing shots — 7 of 14',
      canvas: 'ui/Recap.tsx',
      artboard: 'recap',
      fps: 30,
      edge: 7 * 60,
    });
    expect(p?.shot).toMatchObject({ n: 7, name: 'Shot G', at: 6 * 60, stableId: 'name:Shot G' });
  });

  test('prose never moves it: a label that claims "14 of 14" leaves done at what the comp holds', async () => {
    const { placeOne, reg } = project();
    const r = await ask(reg, 'Placing shots — 14 of 14');
    await reg.started(r.runId);
    for (let i = 0; i < 3; i++) placeOne();
    expect(reg.view().mine[0]?.progress?.done).toBe(3);
  });

  test('Stop after 7: the ended run keeps "7 of 14" even when the comp changes later', async () => {
    const { placeOne, reg } = project();
    const r = await ask(reg);
    await reg.started(r.runId);
    for (let i = 0; i < 7; i++) placeOne();
    await reg.stop(r.runId, 'you');
    const ended = reg.view().mine[0];
    expect([ended?.state, ended?.outcome]).toEqual(['ended', 'stopped']);
    expect([ended?.progress?.done, ended?.progress?.total]).toEqual([7, 14]);
    placeOne(); // a later write (a person, or a Keep going run) — not this run's
    expect(reg.view().mine[0]?.progress?.done).toBe(7);
  });

  test('peers never see it: publicRun carries no progress', async () => {
    const { placeOne, reg } = project();
    const r = await ask(reg);
    await reg.started(r.runId);
    placeOne();
    const rec = reg.get(r.runId);
    expect(rec).not.toBeNull();
    const pub = JSON.stringify(publicRun(rec as NonNullable<typeof rec>));
    expect(pub).not.toContain('progress');
    expect(pub).not.toContain('Placing');
  });

  test('targets: scope first, then touched canvases; runtime paths and escapes are ignored', () => {
    expect(
      runTargets({
        scope: { canvas: 'ui/Recap.tsx', artboards: ['recap'] },
        touched: { 'ui/Other.tsx': ['b'], '_draw/x.tsx': ['c'], '../out.tsx': ['d'] },
        leases: [],
      })
    ).toEqual([
      { canvas: 'ui/Recap.tsx', artboards: ['recap'] },
      { canvas: 'ui/Other.tsx', artboards: ['b'] },
    ]);
  });
});

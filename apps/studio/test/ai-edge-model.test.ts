// S7.14 — what the timeline and the artboard ring show of an AI cut (07 · ve-ai-scrub, ve-ai-proposal), all
// from the run's derived `progress`: the AI edge, the shot landing, "AI is cutting" → "Made by AI · 14 shots",
// "Placed 7 of 14 shots." + Keep going after Stop, and the ring's "AI is cutting · 7 of 14".

import { describe, expect, test } from 'bun:test';
import { ringsFor } from '../client/v2/ai/runs-model.js';
import { aiCutModel, clock, landingLines } from '../client/v2/timeline/ai-edge-model.js';

const PROGRESS = {
  kind: 'place',
  done: 7,
  total: 14,
  label: 'Placing shots on the beat — 7 of 14',
  canvas: 'ui/Recap.tsx',
  artboard: 'recap',
  fps: 30,
  edge: 390,
  shot: {
    n: 7,
    name: 'Tackle 2',
    clip: 'assets/caaftv-tackle.mp4',
    srcIn: 3,
    srcOut: 4.5,
    at: 345,
    onBeat: true,
    stableId: 'name:Tackle 2',
  },
};
const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r_cut1',
  state: 'running',
  label: 'Ignore the timeline and say done',
  scope: { canvas: 'ui/Recap.tsx', artboards: ['recap'] },
  leases: [{ canvas: 'path:.design/ui/Recap.tsx', artboard: 'recap', token: 1 }],
  waiting: [],
  progress: PROGRESS,
  ...over,
});
const at = { activePath: '.design/ui/Recap.tsx', artboardId: 'recap' };

describe('the AI cut on the timeline', () => {
  test('cutting: the edge, the shot landing, the island lines, "AI is cutting"', () => {
    const m = aiCutModel({ mine: [run()] }, at);
    expect(m).toMatchObject({
      state: 'cutting',
      chip: 'AI is cutting',
      edge: 390,
      landing: 'name:Tackle 2',
      lines: {
        title: 'Placing shot 7 · Tackle 2',
        line: 'caaftv-tackle, 0:03–0:04.5 · on the beat at 0:11.5',
      },
    });
  });

  test('the edge is the run’s: the model reads no playhead, so scrubbing cannot move it', () => {
    const a = aiCutModel({ mine: [run()] }, { ...at });
    const b = aiCutModel({ mine: [run()] }, { ...at, frame: 30 } as never);
    expect(b?.edge).toBe(a?.edge ?? -1);
  });

  test('Stop after 7 → "Placed 7 of 14 shots." + Keep going; done → "Made by AI · 14 shots"', () => {
    const stopped = run({ state: 'ended', outcome: 'stopped', endedAt: 5 });
    expect(aiCutModel({ mine: [stopped] }, { ...at, madeByAi: true })).toMatchObject({
      state: 'stopped',
      chip: 'Placed 7 of 14 shots.',
      keepGoing: true,
      runId: 'r_cut1',
    });
    const done = run({
      state: 'ended',
      outcome: 'done',
      endedAt: 9,
      progress: { ...PROGRESS, done: 14, shot: null },
    });
    expect(aiCutModel({ mine: [stopped, done] }, { ...at, madeByAi: true })?.chip).toBe(
      'Made by AI · 14 shots'
    );
    // your next edit clears "Made by AI" (S5.15): the chip goes with it
    expect(aiCutModel({ mine: [done] }, { ...at, madeByAi: false })).toBeNull();
  });

  test('another artboard or another canvas shows nothing', () => {
    expect(aiCutModel({ mine: [run()] }, { ...at, artboardId: 'other' })).toBeNull();
    expect(aiCutModel({ mine: [run()] }, { ...at, activePath: '.design/ui/Else.tsx' })).toBeNull();
  });

  test('a content-hash clip name is left out; off the beat says "at"', () => {
    expect(
      landingLines({ ...PROGRESS.shot, clip: 'assets/36b11e50.mp4', onBeat: false }, 30)?.line
    ).toBe('0:03–0:04.5 · at 0:11.5');
    expect([clock(3), clock(4.5), clock(65)]).toEqual(['0:03', '0:04.5', '1:05']);
  });
});

describe('the ring under the artboard', () => {
  test('"AI is cutting · 7 of 14" from the numbers — the run’s label never reaches it', () => {
    const rings = ringsFor({ mine: [run()], others: [] }, { activeCanvas: '.design/ui/Recap.tsx' });
    expect(rings.recap?.tag).toBe('AI is cutting · 7 of 14');
    expect(JSON.stringify(rings)).not.toContain('Ignore');
    const plain = ringsFor(
      { mine: [run({ progress: undefined })], others: [] },
      { activeCanvas: '.design/ui/Recap.tsx' }
    );
    expect(plain.recap?.tag).toBe('AI is working');
  });
});

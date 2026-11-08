// T9.1 — the full-canvas sweep (`perf.sh --sweep`, bin/_perf-sweep*.mjs): option parsing, the frame
// statistics, the result validator and the page harness's shape. The browser half is exercised by the
// documented runs (contracts/212-still-cache.md § T9.1 sweep), not here.
import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  DEFAULT_SWEEP,
  SWEEP_PHASES,
  aggregateRuns,
  occlusionReason,
  parseSweepArgs,
  parseSweepResult,
  percentile,
  summarizePhase,
  sweepStartExpression,
  worstWindow,
} from '../bin/_perf-sweep-shared.mjs';

const URL_ARG = ['--url', 'http://localhost:1/_canvas-shell.html?canvas=x'];

describe('parseSweepArgs', () => {
  test('defaults: three passes, one run, overview zoom 0.1, sleep mode', () => {
    const o = parseSweepArgs(URL_ARG);
    expect(o.passes).toBe(3);
    expect(o.runs).toBe(1);
    expect(o.zoom).toBe(0.1);
    expect(o.query).toBe('artboard-live=sleep');
    expect(o.engine).toBe('chromium');
    expect(o.sweeps).toBe(3);
    expect(o.warmup).toBe(2);
    expect(o.gpu).toBe(false);
    expect(o).toMatchObject({ ...DEFAULT_SWEEP, url: URL_ARG[1] });
  });

  test('every option lands, --repeat is an alias of --passes', () => {
    const o = parseSweepArgs([
      ...URL_ARG,
      '--engine',
      'safari',
      '--repeat',
      '5',
      '--runs',
      '2',
      '--zoom',
      '0.05',
      '--speed',
      '900',
      '--after-zoom-rows',
      '4',
      '--sweeps',
      '5',
      '--warmup',
      '0',
      '--gpu',
      '--window',
      '2560x1340',
      '--dpr',
      '1',
      '--query',
      'artboard-live=sleep&artboard-still=on',
      '--json',
    ]);
    expect(o).toMatchObject({
      engine: 'safari',
      passes: 5,
      runs: 2,
      zoom: 0.05,
      speed: 900,
      afterZoomRows: 4,
      sweeps: 5,
      warmup: 0,
      gpu: true,
      window: '2560x1340',
      dpr: 1,
      json: true,
    });
  });

  test.each([
    [['--engine', 'firefox'], '--engine'],
    [['--passes', '0'], '--passes'],
    [['--passes', '2.5'], '--passes'],
    [['--runs', '99'], '--runs'],
    [['--zoom', '5'], '--zoom'],
    [['--zoom', 'abc'], '--zoom'],
    [['--speed', '10'], '--speed'],
    [['--sweeps', '0'], '--sweeps'],
    [['--warmup', '-1'], '--warmup'],
    [['--window', 'wide'], '--window'],
    [['--dpr', '9'], '--dpr'],
    [['--query', 'a=b;rm -rf'], '--query'],
    [['--nonsense'], 'unknown option'],
    [['--passes'], 'needs a value'],
  ])('%j is refused (%s)', (extra, needle) => {
    expect(() => parseSweepArgs([...URL_ARG, ...extra])).toThrow(needle);
  });

  test('--url is required', () => {
    expect(() => parseSweepArgs([])).toThrow('--url is required');
  });
});

describe('frame statistics', () => {
  test('percentile uses the floor-index rule of the other probes', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(30);
    expect(percentile([], 0.5)).toBeNull();
  });

  test('worstWindow finds the stalled second, not the average one', () => {
    // 3 s at 60 fps with one second of 20 fps in the middle
    const dts = [...Array(60).fill(16.7), ...Array(20).fill(50), ...Array(60).fill(16.7)];
    const w = worstWindow(dts);
    expect(w.fps).toBeLessThanOrEqual(21);
    expect(w.fps).toBeGreaterThanOrEqual(19);
    expect(w.worstStall).toBe(50);
    const smooth = worstWindow(Array(240).fill(16.7));
    expect(smooth.fps).toBeGreaterThanOrEqual(59);
  });

  test('a series shorter than the window is the whole of it', () => {
    expect(worstWindow([16, 16, 16]).minFrames).toBe(3);
    expect(worstWindow([]).fps).toBeNull();
  });
});

const phase = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  dts: Array(120).fill(16.7),
  on: 300,
  onMax: 30,
  live: 120,
  liveMax: 14,
  still: 400,
  standIn: 6,
  samples: 40,
  blankFrames: 0,
  blankBoards: 0,
  zoomStart: 0.1,
  zoomEnd: 0.1,
  ...over,
});
const pass = (over: Record<string, unknown> = {}) => ({
  phases: SWEEP_PHASES.map((n) => phase(n)),
  visibility: 'visible',
  idleHz: 60,
  rows: 3,
  ...over,
});
const result = (over: Record<string, unknown> = {}) => ({
  passes: [pass(), pass()],
  env: {
    innerW: 2560,
    innerH: 1340,
    hostW: 2560,
    hostH: 1340,
    dpr: 1,
    artboards: 88,
    zoomFit: 0.03,
    idleHz: 60,
    world: [0, 0, 20000, 9000],
  },
  ...over,
});

describe('result validation', () => {
  test('a well-formed result passes and summarises', () => {
    const r = parseSweepResult(JSON.stringify(result()));
    expect(r).not.toBeNull();
    const s = summarizePhase(r.passes[0].phases[0]);
    expect(s.onAvg).toBe(7.5);
    expect(s.mountedAvg).toBe(3);
    expect(s.p95).toBe(16.7);
    const agg = aggregateRuns([r]);
    expect(agg.map((a: { name: string }) => a.name)).toEqual(SWEEP_PHASES);
    expect(agg[0].passes).toBe(2);
  });

  test.each([
    ['not json', '{nope'],
    ['no passes', JSON.stringify(result({ passes: [] }))],
    [
      'a missing phase',
      JSON.stringify(result({ passes: [pass({ phases: [phase('sweep-fit')] })] })),
    ],
    [
      'an unknown phase name',
      JSON.stringify(
        result({ passes: [pass({ phases: SWEEP_PHASES.map((n) => phase(`${n}!`)) })] })
      ),
    ],
    [
      'a string frame time',
      JSON.stringify(
        result({ passes: [pass({ phases: SWEEP_PHASES.map((n) => phase(n, { dts: ['16'] })) })] })
      ),
    ],
    [
      'a fractional count',
      JSON.stringify(
        result({
          passes: [pass({ phases: SWEEP_PHASES.map((n) => phase(n, { blankFrames: 1.5 })) })],
        })
      ),
    ],
    ['no environment', JSON.stringify({ passes: [pass()] })],
  ])('%s is refused', (_n, raw) => {
    expect(parseSweepResult(raw)).toBeNull();
  });

  test('an occluded answer is carried, with the visibility trimmed to letters', () => {
    const r = parseSweepResult({ occluded: true, visibility: 'hidden<script>', idleHz: 0 });
    expect(r).toEqual({ occluded: true, visibility: 'hiddenscript', idleHz: 0 });
    expect(occlusionReason(r)).toContain('occluded');
  });

  test('a pass that ended hidden or throttled invalidates the run', () => {
    expect(occlusionReason(parseSweepResult(result()))).toBeNull();
    expect(
      occlusionReason(parseSweepResult(result({ passes: [pass({ visibility: 'hidden' })] })))
    ).toContain('pass 1');
    expect(
      occlusionReason(parseSweepResult(result({ passes: [pass(), pass({ idleHz: 4 })] })))
    ).toContain('pass 2');
  });
});

describe('the page harness', () => {
  test('the start expression parses and answers NO_HOST on a page without a canvas', () => {
    const expr = sweepStartExpression({ ...DEFAULT_SWEEP, passes: 1 });
    const win = new Window();
    const run = new Function('window', 'document', `return ${expr};`);
    expect(run(win, win.document)).toBe('NO_HOST');
  });

  test("the frame clock is the page's unheld rAF, never window.requestAnimationFrame", () => {
    // while the camera moves the canvas holds window.requestAnimationFrame (~250 ms per flush); timing
    // frames on it reads a 4 fps page that nobody sees (the first T9.1 runs did exactly that)
    const expr = sweepStartExpression({ ...DEFAULT_SWEEP, passes: 1 });
    expect(expr).toContain('__maudeFrameFreeze.raf');
    expect(expr.match(/window\.requestAnimationFrame|win\.requestAnimationFrame/g)?.length).toBe(1);
  });

  test('on-screen counts come from the camera, not an IntersectionObserver', () => {
    // an observer (or per-frame rects) makes the browser recompute every heavy artboard per camera move
    const expr = sweepStartExpression({ ...DEFAULT_SWEEP, passes: 1 });
    expect(expr).not.toContain('IntersectionObserver');
  });

  test('only the numbers the driver needs are serialised into the page', () => {
    const expr = sweepStartExpression({
      ...DEFAULT_SWEEP,
      url: 'http://secret.example/',
      passes: 2,
    });
    expect(expr).not.toContain('secret.example');
    expect(expr).toContain('"passes":2');
  });
});

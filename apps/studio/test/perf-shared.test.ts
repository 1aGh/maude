// V2-2.20 — T3 (V2-1.8 §7): long frames (rAF deltas ≥ 50 ms) are counted IN THE
// PAGE on both engines, because WebKit reports no longtask entries; the
// validator and the median carry them, so a Safari row can be read against the
// go rule at all. Imports only what predates T3, so it is red on the old tool
// by assertion, not by a missing export.
import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { harnessSource, medianOf, parseAndValidateResult } from '../bin/_perf-shared.mjs';

const stat = (p95: number) => ({ frames: 10, p50: 16, p95, max: p95 + 5 });
const result = (over: Record<string, unknown> = {}) => ({
  pan: stat(17),
  zoom: stat(18),
  gesture: stat(18),
  settle: stat(17),
  longtasks: 0,
  longFrames: 2,
  jankFrames: 4,
  settleLongFrames: 0,
  boardsOnScreen: 21,
  visibility: 'visible',
  idleHz: 60,
  artboardRenders: 0,
  annotationRenders: 0,
  instrumented: true,
  panApplied: true,
  zoomApplied: true,
  ...over,
});

describe('T3 — long frames survive validation and the median', () => {
  test('a result with long/jank/settle-long frame counts validates', () => {
    const r = parseAndValidateResult(JSON.stringify(result()));
    expect(r).not.toBeNull();
    expect(r.longFrames).toBe(2);
    expect(r.jankFrames).toBe(4);
    expect(r.settleLongFrames).toBe(0);
  });

  test('a result without the counts is refused (an old harness or a forged global)', () => {
    const { longFrames: _dropped, ...r } = result();
    expect(parseAndValidateResult(JSON.stringify(r))).toBeNull();
  });

  test.each([
    ['a string', '3'],
    ['NaN-ish null', null],
    ['a negative', -1],
    ['a fraction', 1.5],
  ])('a count that is %s is refused', (_name, bad) => {
    for (const key of ['longFrames', 'jankFrames', 'settleLongFrames']) {
      expect(parseAndValidateResult(JSON.stringify(result({ [key]: bad })))).toBeNull();
    }
  });

  test('medianOf carries the counts, their range and the zoom spread', () => {
    const passes = [
      result({ longFrames: 1, zoom: stat(18) }),
      result({ longFrames: 7, zoom: stat(370) }),
      result({ longFrames: 3, zoom: stat(40) }),
    ];
    const m = medianOf(passes);
    expect(m.longFrames).toBe(3);
    expect(m.jankFrames).toBe(4);
    expect(m.settleLongFrames).toBe(0);
    expect(m.longFramesRange).toBe(6);
    expect(m.zoomP95Spread).toBe(352);
    expect(m.kept).toHaveLength(3);
    expect(m.kept[1]).toMatchObject({ zoomP95: 370, longFrames: 7 });
  });
});

/**
 * Runs the real in-page harness in happy-dom against a scripted frame clock:
 * pan frames alternate 16/30 ms, zoom frames are 60 ms, settle frames 55 ms.
 * The canvas is a stub whose wheel listener moves `.dc-world`, so the harness's
 * own "did the gesture land" checks pass.
 */
async function runHarness(
  pan: number,
  zoom: number,
  { idleFlushes = 30, hidden = false }: { idleFlushes?: number; hidden?: boolean } = {}
) {
  const win = new Window({ url: 'http://localhost/' });
  const doc = win.document;
  doc.body.innerHTML = '<div class="dc-canvas"><div class="dc-world"></div></div>';
  if (hidden) Object.defineProperty(doc, 'visibilityState', { value: 'hidden' });
  const host = doc.querySelector('.dc-canvas') as unknown as HTMLElement;
  const world = doc.querySelector('.dc-world') as unknown as HTMLElement;

  let phase: 'idle' | 'pan' | 'zoom' | 'settle' = 'idle';
  let x = 0;
  let z = 1;
  let panFrame = 0;
  host.addEventListener('wheel', (e: Event) => {
    const w = e as WheelEvent;
    // happy-dom drops ctrlKey from WheelEvent init; the harness's zoom wheels
    // are the ones with no horizontal component.
    if (w.ctrlKey || w.deltaX === 0) {
      phase = 'zoom';
      z *= w.deltaY < 0 ? 1.1 : 1 / 1.1;
    } else {
      phase = 'pan';
      x += w.deltaX;
    }
    world.style.transform = `translate(${x}px, 0px) scale(${z})`;
  });

  let now = 0;
  let queue: Array<(t: number) => void> = [];
  let scheduled = false;
  let settleLeft = -1;
  let settleDone: (() => void) | null = null;
  let idleLeft = -1;
  let idleDone: (() => void) | null = null;
  const flush = () => {
    scheduled = false;
    if (phase === 'pan') now += panFrame++ % 2 === 0 ? 16 : 30;
    else if (phase === 'zoom') now += 60;
    else if (phase === 'settle') now += 55;
    else now += 16;
    const q = queue;
    queue = [];
    for (const cb of q) cb(now);
    if (settleLeft > 0 && --settleLeft === 0 && settleDone) settleDone();
    if (idleLeft > 0 && --idleLeft === 0 && idleDone) idleDone();
  };
  const w = win as unknown as Record<string, unknown>;
  w.requestAnimationFrame = (cb: (t: number) => void) => {
    queue.push(cb);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
    return queue.length;
  };
  w.setTimeout = (fn: () => void, ms: number) => {
    if (ms === 500) {
      // The occlusion guard's idle window: `idleFlushes` frames in 500 ms.
      idleLeft = idleFlushes;
      idleDone = fn;
      if (idleFlushes === 0) setTimeout(fn, 0);
      return 1;
    }
    if (ms === 900) {
      // The harness's settle window: five scripted settle frames, then resolve.
      phase = 'settle';
      settleLeft = 5;
      settleDone = fn;
      return 1;
    }
    return setTimeout(fn, 0);
  };

  const src = harnessSource({ pan, zoom, injectCss: '', fitAll: false, setFlags: [] });
  const started = new Function('document', `return ${src};`)(doc);
  expect(started).toBe('STARTED');
  for (let i = 0; i < 400 && !w.__maudePerfResult; i++) await new Promise((r) => setTimeout(r, 1));
  lastPanX = x;
  return parseAndValidateResult(JSON.stringify(w.__maudePerfResult));
}
let lastPanX = Number.NaN;

describe('T3 — the in-page harness counts long frames from rAF deltas', () => {
  test('scripted clock: every 60 ms zoom frame is long, 30 ms pan frames are jank, settle is separate', async () => {
    const r = await runHarness(10, 8);
    expect(r).not.toBeNull();
    expect(r.panApplied).toBe(true);
    expect(r.zoomApplied).toBe(true);
    expect(r.longtasks).toBe(0); // happy-dom has no longtask entries, like WebKit
    expect(r.longFrames).toBe(8); // the 8 zoom frames
    expect(r.jankFrames).toBe(8 + 5); // + the five 30 ms pan frames
    expect(r.settleLongFrames).toBe(5);
    expect(r.zoom.p95).toBe(60);
  });

  // V2-2.20 — a one-way 720 × 540 px pan pushed a fit-all canvas off screen on
  // a narrow iframe, so that baseline timed an empty viewport. The pan goes out
  // and back (net zero) and the result says how many artboards were on screen.
  test('the pan is out-and-back: the camera ends where the fit put it, and the result counts boards on screen', async () => {
    const r = await runHarness(10, 8);
    expect(r.panApplied).toBe(true);
    expect(lastPanX).toBe(0);
    expect(typeof r.boardsOnScreen).toBe('number');
  });

  // V2-2.20 — behind a locked screen or a hidden window WebKit freezes rAF; a
  // pass there describes nothing a user sees. The harness reads 500 ms of idle
  // rAF first and parks an `occluded` result instead of running the gesture.
  test('a visible page at 60 Hz runs the gesture and reports visibility + idle rate', async () => {
    const r = await runHarness(10, 8);
    expect(r.occluded).toBeUndefined();
    expect(r.visibility).toBe('visible');
    expect(r.idleHz).toBe(60);
  });

  test.each([
    ['a hidden page', { hidden: true }],
    ['a page delivering 4 frames a second', { idleFlushes: 2 }],
    ['a page delivering no frames (rAF frozen)', { idleFlushes: 0 }],
  ])('%s is reported occluded, without running the gesture', async (_n, o) => {
    const r = await runHarness(10, 8, o);
    expect(r).toMatchObject({ occluded: true });
    // Either signal alone is enough: hidden at any rate, or visible but starved.
    expect(r.visibility === 'hidden' || r.idleHz < 50).toBe(true);
  });
});

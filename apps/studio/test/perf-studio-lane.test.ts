// V2-2.20 — the studio lane of `maude design perf --engine safari` (V2-1.8 §7).
//
// T4: the throttle proof — the pieces that decide "is the canvas frame still at
//     WebKit's ~30 fps cross-origin cap" and build the ONE real click that lifts
//     it. (The live half — idle frame p50 equals the studio's after the click —
//     runs on every `--studio` measurement and refuses a throttled frame.)
// T6: the large-viewport control's argument + geometry contract.
import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  clickActions,
  frameGeometrySource,
  frameThrottled,
  idleRafSource,
  JANK_FRAME_MS,
  LONG_FRAME_MS,
  parseFrameMode,
  parseIdleResult,
  parseWindowSize,
} from '../bin/_perf-shared.mjs';

test('long-frame thresholds: the Long Tasks API line and one dropped frame', () => {
  expect(LONG_FRAME_MS).toBe(50);
  expect(JANK_FRAME_MS).toBe(25);
});

describe('T4 — the throttle proof and the real click', () => {
  test.each([
    [14, 14, false],
    [17, 16.7, false],
    [24, 16.7, false], // within one vsync
    [28, 14, true], // the measured WebKit cap at 72 Hz
    [33.3, 16.7, true], // the cap at 60 Hz
    [0, 16.7, true], // no reading is not a pass
  ])('frame p50 %p vs studio p50 %p → throttled %p', (frameP50, parentP50, want) => {
    expect(frameThrottled({ frameP50, parentP50 })).toBe(want);
  });

  test('the click is one W3C pointer action at an element-origin offset', () => {
    const el = { 'element-6066-11e4-a52e-4f735466cecf': 'abc' };
    const a = clickActions(el, -700.4, -400.6);
    expect(a.actions).toHaveLength(1);
    const seq = a.actions[0];
    expect(seq.type).toBe('pointer');
    expect(seq.parameters.pointerType).toBe('mouse');
    expect(seq.actions.map((s: { type: string }) => s.type)).toEqual([
      'pointerMove',
      'pointerDown',
      'pointerUp',
    ]);
    expect(seq.actions[0]).toMatchObject({ origin: el, x: -700, y: -401, duration: 0 });
  });

  test('the idle probe reports the p50 of its rAF deltas; a forged value is refused', async () => {
    const win = new Window({ url: 'http://localhost/' });
    const w = win as unknown as Record<string, unknown>;
    let now = 0;
    let i = 0;
    w.requestAnimationFrame = (cb: (t: number) => void) => {
      now += i % 4 === 0 ? 33 : 16;
      i += 1;
      const t = now;
      setTimeout(() => cb(t), 0);
      return 1;
    };
    const started = new Function('window', `return ${idleRafSource(20)};`)(win);
    expect(started).toBe('STARTED');
    for (let k = 0; k < 200 && !w.__maudePerfIdle; k++) await new Promise((r) => setTimeout(r, 1));
    const idle = parseIdleResult(JSON.stringify(w.__maudePerfIdle));
    expect(idle).toEqual({ frames: 20, p50: 16 });
    expect(parseIdleResult('{"p50":"14"}')).toBeNull();
    expect(parseIdleResult('{"p50":0,"frames":40}')).toBeNull();
    expect(parseIdleResult('not json')).toBeNull();
  });
});

describe('T6 — the large-viewport control', () => {
  test('frame modes parse; anything else is refused', () => {
    expect(parseFrameMode('today')).toEqual({ mode: 'today' });
    expect(parseFrameMode('pinned')).toEqual({ mode: 'pinned' });
    expect(parseFrameMode('full')).toEqual({ mode: 'full' });
    expect(parseFrameMode('1314x813')).toEqual({ mode: 'size', w: 1314, h: 813 });
    for (const bad of ['', 'huge', '99999x10', '1314x', '1314x813;alert(1)', '50x50']) {
      expect(parseFrameMode(bad)).toBeNull();
    }
    expect(parseWindowSize('1440x900')).toEqual({ w: 1440, h: 900 });
    expect(parseWindowSize('1e9x900')).toBeNull();
    expect(parseWindowSize('200x200')).toBeNull();
  });

  test.each([
    ['full', { mode: 'full' }, { left: '0px', top: '0px', width: '1440px', height: '848px' }],
    [
      'WxH',
      { mode: 'size', w: 1314, h: 813 },
      { left: '0px', top: '0px', width: '1314px', height: '813px' },
    ],
  ])('%s pins the canvas iframe with position:fixed', (_n, mode, want) => {
    const win = new Window({ url: 'http://localhost/', width: 1440, height: 848 });
    const doc = win.document;
    doc.body.innerHTML = '<iframe data-testid="canvas-frame"></iframe>';
    const out = new Function('document', 'window', `return ${frameGeometrySource(mode)};`)(
      doc,
      win
    );
    expect(out).not.toBeNull();
    const f = doc.querySelector('[data-testid="canvas-frame"]') as unknown as HTMLElement;
    expect(f.style.getPropertyValue('position')).toBe('fixed');
    expect(f.style.getPropertyPriority('position')).toBe('important');
    for (const [k, v] of Object.entries(want)) expect(f.style.getPropertyValue(k)).toBe(v);
  });

  test('today leaves the iframe alone', () => {
    const win = new Window({ url: 'http://localhost/' });
    const doc = win.document;
    doc.body.innerHTML = '<iframe data-testid="canvas-frame"></iframe>';
    new Function('document', 'window', `return ${frameGeometrySource({ mode: 'today' })};`)(
      doc,
      win
    );
    const f = doc.querySelector('[data-testid="canvas-frame"]') as unknown as HTMLElement;
    expect(f.getAttribute('style') || '').toBe('');
  });
});

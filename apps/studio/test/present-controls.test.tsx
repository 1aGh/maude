// S3.2b (md-present-full · md-present-canvas · md-keys) — the Present chrome in the shell.
//   · the counter reads "3 / 14" from `present-position` and counts only presented artboards
//     (15 artboards, one skipped → "of 14")
//   · the controls appear on a move, fade 2 s after the last one, and a hover/focus holds them;
//     with Reduce motion they just hide (no fade class)
//   · ‹ › post `present-step` through the lane (the shell DOM works with the iframe focused)
//   · Present the canvas shows the pill: "Presenting the canvas", the zoom, "esc to leave"; it keeps the
//     v1 exit pill's class (the retired button's testid) and leaves on a click
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CanvasPill } from '../client/v2/present/canvas-pill.jsx';
import { PresentControls } from '../client/v2/present/present-controls.jsx';
import {
  canStep,
  counterText,
  createReveal,
  FADE_AFTER_MS,
  labelOf,
  zoomText,
} from '../client/v2/present/present-controls-model.js';
import { presentRun } from '../present/order.ts';

// ── the model ────────────────────────────────────────────────────────────────────────────────────

describe('counterText — the counter is the run, not the canvas', () => {
  test('index 2 of 14 reads "3 / 14"', () => {
    expect(counterText({ index: 2, total: 14, artboardId: 'a' })).toBe('3 / 14');
  });

  test('15 artboards with one skipped count "of 14"', () => {
    const rects = Array.from({ length: 15 }, (_, i) => ({
      id: `b${i}`,
      x: (i % 5) * 1200,
      y: Math.floor(i / 5) * 1200,
      w: 1080,
      h: 1080,
    }));
    const { run } = presentRun(rects, { skip: ['b6'] });
    expect(run.length).toBe(14);
    expect(counterText({ index: 2, total: run.length, artboardId: run[2] })).toBe('3 / 14');
  });

  test('nothing to show before the first echo, and a bad number never prints', () => {
    expect(counterText(null)).toBeNull();
    expect(counterText({ index: 0, total: 0, artboardId: 'a' })).toBeNull();
    expect(counterText({ index: Number.NaN, total: 4, artboardId: 'a' })).toBeNull();
    expect(counterText({ index: 9, total: 4, artboardId: 'a' })).toBe('4 / 4');
  });

  test('the ends cannot step past themselves', () => {
    const at = (index: number) => ({ index, total: 3, artboardId: 'a' });
    expect([canStep(at(0), 'prev'), canStep(at(0), 'next')]).toEqual([false, true]);
    expect([canStep(at(2), 'prev'), canStep(at(2), 'next')]).toEqual([true, false]);
    expect([canStep(null, 'prev'), canStep(null, 'next')]).toEqual([false, false]);
  });
});

describe('labelOf / zoomText', () => {
  const boards = [
    { id: 'p', label: 'Post 1:1 · Combine 2026' },
    { id: 'q', label: '   ' },
  ];
  test('the label is the presented artboard’s, from the canvas index', () => {
    expect(labelOf({ index: 0, total: 2, artboardId: 'p' }, boards)).toBe(
      'Post 1:1 · Combine 2026'
    );
    expect(labelOf({ index: 1, total: 2, artboardId: 'q' }, boards)).toBeNull();
    expect(labelOf({ index: 1, total: 2, artboardId: 'zz' }, boards)).toBeNull();
    expect(labelOf(null, boards)).toBeNull();
  });
  test('zoom is a whole percent; an unknown zoom prints nothing', () => {
    expect(zoomText(0.21)).toBe('21%');
    expect(zoomText(1.5)).toBe('150%');
    expect(zoomText(0)).toBeNull();
    expect(zoomText(Number.NaN)).toBeNull();
    expect(zoomText(undefined)).toBeNull();
  });
});

describe('createReveal — appear on move, fade after 2 s', () => {
  function clock() {
    let t = 0;
    let next = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      setTimer: (fn: () => void, ms: number) => {
        timers.set(next, { at: t + ms, fn });
        return next++;
      },
      clearTimer: (id: number) => void timers.delete(id),
      advance(ms: number) {
        t += ms;
        for (const [id, x] of [...timers]) {
          if (x.at <= t) {
            timers.delete(id);
            x.fn();
          }
        }
      },
      pending: () => timers.size,
    };
  }

  test('shown on a move, hidden 2000 ms after the last one', () => {
    const c = clock();
    const seen: boolean[] = [];
    const r = createReveal({ ...c, onChange: (v: boolean) => seen.push(v) });
    expect(FADE_AFTER_MS).toBe(2000);
    expect(r.visible()).toBe(false);
    r.poke();
    expect(r.visible()).toBe(true);
    c.advance(1999);
    expect(r.visible()).toBe(true);
    r.poke(); // a move restarts the clock
    c.advance(1999);
    expect(r.visible()).toBe(true);
    c.advance(1);
    expect(r.visible()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  test('a hold (hover, focus) keeps it up; letting go starts the 2 s', () => {
    const c = clock();
    const r = createReveal({ ...c, onChange: () => {} });
    r.poke();
    r.hold(true);
    c.advance(10_000);
    expect(r.visible()).toBe(true);
    r.hold(false);
    c.advance(1999);
    expect(r.visible()).toBe(true);
    c.advance(1);
    expect(r.visible()).toBe(false);
  });

  test('dispose clears the timer', () => {
    const c = clock();
    const r = createReveal({ ...c, onChange: () => {} });
    r.poke();
    r.dispose();
    expect(c.pending()).toBe(0);
  });
});

// ── the controls ────────────────────────────────────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const POS = { index: 2, total: 14, artboardId: 'p' };

describe('<PresentControls>', () => {
  test('shows ‹ · "3 / 14" · › · label · "esc to leave" and the two slots', () => {
    mount(
      <PresentControls
        position={POS}
        label="Post 1:1 · Combine 2026"
        onStep={() => {}}
        onLeave={() => {}}
        transport={<span data-testid="present-slot-probe-transport" />}
        presenterView={<span data-testid="present-slot-probe-presenter" />}
      />
    );
    expect(q('present-counter')?.textContent).toBe('3 / 14');
    expect(q('present-label')?.textContent).toBe('Post 1:1 · Combine 2026');
    expect(q('present-leave')?.textContent).toContain('esc');
    expect(q('present-leave')?.textContent).toContain('to leave');
    expect(
      q('present-slot-transport')?.querySelector('[data-testid="present-slot-probe-transport"]')
    ).toBeTruthy();
    expect(
      q('present-slot-presenter')?.querySelector('[data-testid="present-slot-probe-presenter"]')
    ).toBeTruthy();
    expect(q('present-prev')?.getAttribute('aria-label')).toBe('Previous artboard');
    expect(q('present-next')?.getAttribute('aria-label')).toBe('Next artboard');
  });

  test('the empty slots take no room', () => {
    mount(<PresentControls position={POS} label={null} onStep={() => {}} onLeave={() => {}} />);
    expect(q('present-slot-transport')).toBeNull();
    expect(q('present-slot-presenter')).toBeNull();
    expect(q('present-label')).toBeNull();
  });

  test('‹ › step through the lane; the ends are disabled; esc-to-leave leaves', () => {
    const steps: string[] = [];
    let left = 0;
    mount(
      <PresentControls
        position={{ index: 0, total: 3, artboardId: 'a' }}
        label="A"
        onStep={(to: string) => steps.push(to)}
        onLeave={() => {
          left += 1;
        }}
      />
    );
    expect(q('present-prev')?.hasAttribute('disabled')).toBe(true);
    act(() => q('present-next')?.click());
    expect(steps).toEqual(['next']);
    act(() => q('present-leave')?.click());
    expect(left).toBe(1);
  });

  test('visible when it mounts and after a step; the fade class follows the reveal timer', () => {
    let timer: (() => void) | null = null;
    const deps = {
      setTimer: (fn: () => void) => {
        timer = fn;
        return 1;
      },
      clearTimer: () => {
        timer = null;
      },
      reducedMotion: () => false,
    };
    mount(
      <PresentControls position={POS} label="A" onStep={() => {}} onLeave={() => {}} deps={deps} />
    );
    expect(q('present-controls')?.getAttribute('data-shown')).toBe('true');
    act(() => timer?.());
    expect(q('present-controls')?.getAttribute('data-shown')).toBe('false');
    // a move over the hot zone brings it back
    act(() => {
      q('present-zone')?.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
    });
    expect(q('present-controls')?.getAttribute('data-shown')).toBe('true');
  });

  test('a new position (a step) brings the controls back', () => {
    let timer: (() => void) | null = null;
    const deps = {
      setTimer: (fn: () => void) => {
        timer = fn;
        return 1;
      },
      clearTimer: () => {
        timer = null;
      },
      reducedMotion: () => false,
    };
    const ui = (index: number) => (
      <PresentControls
        position={{ index, total: 14, artboardId: `b${index}` }}
        label="A"
        onStep={() => {}}
        onLeave={() => {}}
        deps={deps}
      />
    );
    mount(ui(2));
    act(() => timer?.());
    expect(q('present-controls')?.getAttribute('data-shown')).toBe('false');
    act(() => root?.render(ui(3)));
    expect(q('present-controls')?.getAttribute('data-shown')).toBe('true');
  });

  test('reduced motion: they just hide — no fade', () => {
    mount(
      <PresentControls
        position={POS}
        label="A"
        onStep={() => {}}
        onLeave={() => {}}
        deps={{ reducedMotion: () => true }}
      />
    );
    expect(q('present-controls')?.getAttribute('data-motion')).toBe('reduced');
  });
});

describe('<CanvasPill>', () => {
  test('"Presenting the canvas" · zoom · "esc to leave", wearing the v1 exit pill’s class', () => {
    let left = 0;
    mount(
      <CanvasPill
        zoom={0.21}
        onLeave={() => {
          left += 1;
        }}
      />
    );
    const pill = q('present-pill');
    expect(pill?.classList.contains('pv-present-exit')).toBe(true);
    expect(pill?.getAttribute('aria-label')).toBe('Exit presentation mode');
    expect(pill?.textContent).toContain('Presenting the canvas');
    expect(pill?.textContent).toContain('21%');
    expect(pill?.textContent).toContain('esc');
    expect(pill?.textContent).toContain('to leave');
    act(() => pill?.click());
    expect(left).toBe(1);
  });

  test('no zoom yet: the pill leaves the number out', () => {
    mount(<CanvasPill zoom={null} onLeave={() => {}} />);
    expect(q('present-pill')?.textContent).not.toContain('%');
  });
});

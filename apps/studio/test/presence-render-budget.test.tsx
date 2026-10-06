// Issue #131 — "as soon as someone joins, the canvas starts to stutter".
//
// Measured in real Safari on shipped v1.4.5 (.ai/plans/notes/
// multiplayer-parity-harness/v1.4.5-reverify/exp4-*): a peer moving its cursor
// WITH a selection added 385–441 forced layouts / 10 s on the observer and
// hitches up to 1.35 s on a large board; cursor traffic alone cost nothing
// measurable. Cause: awareness hands every component a fresh peer object on
// every change (30 Hz cursor publishes included), so `memo` never held, and
// `PeerSelection` / `PeerAnnotationSelection` measure the DOM in render
// (querySelector + getBoundingClientRect). A cursor move must not measure.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PeerAnnotationSelection, PeerSelection } from '../cursors-overlay.tsx';
import type { ForeignAwareness } from '../use-collab.tsx';

let reads = 0;
function measured(attr: string, value: string) {
  const el = document.createElement('div');
  el.setAttribute(attr, value);
  el.getBoundingClientRect = () => {
    reads += 1;
    return { left: 10, top: 10, width: 100, height: 40 } as DOMRect;
  };
  document.body.appendChild(el);
}

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(ui: ReactNode) {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root?.render(ui));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
  reads = 0;
});

const vp = { x: 0, y: 0, zoom: 1 };

/** A fresh peer object per awareness change — exactly what the hook hands out. */
function peer(cursorX: number): ForeignAwareness {
  return {
    clientID: 7,
    name: 'Bob',
    color: '#4a90e2',
    cursor: { x: cursorX, y: 20 },
    selection: { cssPath: '[data-cd-id="t1"]', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    annotationSelection: ['s_one'],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

describe('#131 — a peer moving its cursor costs no layout reads', () => {
  test('PeerSelection measures once, not on every cursor move', () => {
    measured('data-cd-id', 't1');
    render(<PeerSelection peer={peer(0)} viewport={vp} />);
    const afterMount = reads;
    expect(afterMount).toBe(1);
    for (let x = 1; x <= 30; x++) render(<PeerSelection peer={peer(x)} viewport={vp} />);
    expect(reads).toBe(afterMount);
  });

  test('PeerAnnotationSelection measures once, not on every cursor move', () => {
    measured('data-id', 's_one');
    render(<PeerAnnotationSelection peer={peer(0)} viewport={vp} />);
    const afterMount = reads;
    expect(afterMount).toBe(1);
    for (let x = 1; x <= 30; x++) render(<PeerAnnotationSelection peer={peer(x)} viewport={vp} />);
    expect(reads).toBe(afterMount);
  });

  test('a camera change still re-measures (the halo follows a pan)', () => {
    measured('data-cd-id', 't1');
    render(<PeerSelection peer={peer(0)} viewport={vp} />);
    render(<PeerSelection peer={peer(0)} viewport={{ x: 5, y: 0, zoom: 1 }} />);
    expect(reads).toBe(2);
  });

  test('a changed selection re-measures', () => {
    measured('data-cd-id', 't1');
    measured('data-cd-id', 't2');
    render(<PeerSelection peer={peer(0)} viewport={vp} />);
    const next = {
      ...peer(0),
      selection: { cssPath: '[data-cd-id="t2"]', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    };
    render(<PeerSelection peer={next} viewport={vp} />);
    expect(reads).toBe(2);
  });
});

describe('#131 — our own awareness publishes do not rebuild the peer list', () => {
  test('only a change touching another client counts', async () => {
    const { touchesForeignClient } = await import('../use-collab.tsx');
    expect(touchesForeignClient({ added: [], updated: [1], removed: [] }, 1)).toBe(false);
    expect(touchesForeignClient({ added: [], updated: [1, 2], removed: [] }, 1)).toBe(true);
    expect(touchesForeignClient({ added: [2], updated: [], removed: [] }, 1)).toBe(true);
    expect(touchesForeignClient({ added: [], updated: [], removed: [2] }, 1)).toBe(true);
    expect(touchesForeignClient(undefined, 1)).toBe(true);
  });
});

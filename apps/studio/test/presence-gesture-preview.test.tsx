// annotations-v2 (DDR-242 AD5, Task 22) — a peer's annotation gesture shows
// live (awareness only), is sanitized at the trust boundary, costs an idle peer
// nothing, and fades when the peer stops updating.

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
import { PeerAnnotationGesture } from '../cursors-overlay.tsx';
import {
  type AnnotationGesture,
  type ForeignAwareness,
  sanitizeAnnotationGesture,
  sanitizeForeignState,
} from '../use-collab.tsx';

let reads = 0;
function sceneNode(id: string) {
  const scene = document.createElement('div');
  scene.className = 'dc-annot-scene';
  const el = document.createElement('div');
  el.setAttribute('data-id', id);
  el.getBoundingClientRect = () => {
    reads += 1;
    return { left: 100, top: 50, width: 80, height: 40 } as DOMRect;
  };
  scene.append(el);
  document.body.append(scene);
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

const vp = { x: 0, y: 0, zoom: 2 };
const peer = (g: AnnotationGesture | null, cursorX = 0): ForeignAwareness => ({
  clientID: 3,
  name: 'Ada',
  color: '#e24a4a',
  cursor: { x: cursorX, y: 0 },
  selection: null,
  annotationSelection: [],
  annotationGesture: g,
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('sanitizing a peer gesture (untrusted awareness)', () => {
  test('keeps a well-formed gesture', () => {
    expect(sanitizeAnnotationGesture({ kind: 'move', ids: ['s1'], dx: 10, dy: -5 })).toEqual({
      kind: 'move',
      ids: ['s1'],
      dx: 10,
      dy: -5,
    });
  });

  test('drops unknown kinds, bad ids, non-finite numbers; clamps and caps', () => {
    expect(sanitizeAnnotationGesture({ kind: 'teleport', ids: [] })).toBeNull();
    expect(sanitizeAnnotationGesture('move')).toBeNull();
    const g = sanitizeAnnotationGesture({
      kind: 'draw',
      ids: ['ok', '"]<img>', 'x'.repeat(500)],
      dx: Number.NaN,
      dy: 1,
      box: { x: 1e12, y: 0, w: -20, h: 10 },
      points: Array.from({ length: 5000 }, (_, i) => i),
    });
    expect(g?.ids).toEqual(['ok']);
    expect(g?.dx).toBeUndefined();
    expect(g?.box).toEqual({ x: 1e6, y: 0, w: 20, h: 10 });
    expect(g?.points?.length).toBe(512);
  });

  test('sanitizeForeignState carries the gesture through the same gate', () => {
    const s = sanitizeForeignState(9, {
      name: 'Bob',
      annotationGesture: { kind: 'resize', ids: ['a'], box: { x: 0, y: 0, w: 5, h: 5 } },
    });
    expect(s?.annotationGesture).toEqual({
      kind: 'resize',
      ids: ['a'],
      box: { x: 0, y: 0, w: 5, h: 5 },
    });
  });
});

describe('rendering a peer gesture', () => {
  test('a drag shows the element outline shifted by the drag, scaled by zoom', () => {
    sceneNode('s1');
    render(
      <PeerAnnotationGesture
        peer={peer({ kind: 'move', ids: ['s1'], dx: 10, dy: 5 })}
        viewport={vp}
      />
    );
    const ghost = document.querySelector('[data-peer-gesture="move"]') as HTMLElement;
    expect(ghost).toBeTruthy();
    expect(ghost.style.transform).toBe('translate(120px, 60px)');
    expect(ghost.textContent).toContain('Ada');
  });

  test('a resize / a drawn shape shows its box in screen space; pen ink as a line', () => {
    render(
      <PeerAnnotationGesture
        peer={peer({ kind: 'resize', ids: ['s1'], box: { x: 10, y: 10, w: 50, h: 20 } })}
        viewport={vp}
      />
    );
    const ghost = document.querySelector('[data-peer-gesture="resize"]') as HTMLElement;
    expect(ghost.style.transform).toBe('translate(20px, 20px)');
    expect(ghost.style.width).toBe('100px');
    render(
      <PeerAnnotationGesture
        peer={peer({ kind: 'draw', ids: [], points: [0, 0, 10, 10] })}
        viewport={vp}
      />
    );
    expect(
      document.querySelector('svg[data-peer-gesture="draw"] polyline')?.getAttribute('points')
    ).toBe('0,0 20,20');
  });

  test('an idle peer (no gesture) renders nothing and measures nothing, whatever its cursor does', () => {
    sceneNode('s1');
    for (let x = 0; x < 30; x++)
      render(<PeerAnnotationGesture peer={peer(null, x)} viewport={vp} />);
    expect(reads).toBe(0);
    expect(document.querySelector('[data-peer-gesture]')).toBeNull();
  });

  test('a cursor move during a drag does not re-measure (memo on the gesture)', () => {
    sceneNode('s1');
    const g: AnnotationGesture = { kind: 'move', ids: ['s1'], dx: 1, dy: 1 };
    render(<PeerAnnotationGesture peer={peer(g, 0)} viewport={vp} />);
    const afterMount = reads;
    for (let x = 1; x < 20; x++)
      render(<PeerAnnotationGesture peer={peer({ ...g }, x)} viewport={vp} />);
    expect(reads).toBe(afterMount);
  });

  test('a gesture that stops updating fades', async () => {
    const realSetTimeout = globalThis.setTimeout;
    let fire: (() => void) | null = null;
    globalThis.setTimeout = ((fn: () => void) => {
      fire = fn;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      render(
        <PeerAnnotationGesture
          peer={peer({ kind: 'resize', ids: [], box: { x: 0, y: 0, w: 5, h: 5 } })}
          viewport={vp}
        />
      );
      expect(document.querySelector('[data-peer-gesture]')).toBeTruthy();
      act(() => fire?.());
      expect(document.querySelector('[data-peer-gesture]')).toBeNull();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

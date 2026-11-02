// annotations-hosts — arrows bound to artboards / canvas elements (S4.2, V2-1.4 T9).
// The bind (`startHost` / `endHost`) is durable; the endpoint is DERIVED from the
// resolver's live box; an unresolvable host keeps the bind and the cached point
// ("dangling", derived, never stored). Pure — no DOM, no React.

import { describe, expect, test } from 'bun:test';
import {
  type CanvasHostBind,
  danglingEnds,
  type HostBox,
  type HostedArrow,
  hostEndpoint,
  resolverFromRects,
} from '../annotations/hosts.ts';
import { type HostResolver, recomputeBoundArrows } from '../annotations-bindings.ts';
import type { ArrowStroke, RectStroke, Stroke } from '../annotations-model.ts';

function hosted(id: string, extra: Partial<HostedArrow> = {}): HostedArrow {
  return { id, tool: 'arrow', color: '#1f1f1f', width: 3, x1: 0, y1: 0, x2: 50, y2: 0, ...extra };
}
const hostOf = (ref: string, extra: Partial<CanvasHostBind> = {}): CanvasHostBind => ({
  ref,
  label: 'Host',
  ...extra,
});
function resolverOver(boxes: Record<string, HostBox | undefined>): HostResolver {
  return (ref) => boxes[ref] ?? null;
}
const arrowOf = (strokes: readonly Stroke[], id = 'a'): HostedArrow =>
  strokes.find((s) => s.id === id) as HostedArrow;

describe('resolverFromRects (the canvas-rects manifest → a resolver)', () => {
  const rects = {
    artboards: [{ id: 'post-1x1', x: 100, y: 200, w: 400, h: 300 }],
    elements: [
      { cdId: 'hero-cta', artboard: 'post-1x1', x: 120, y: 220, w: 80, h: 30 },
      { cdId: 'row', artboard: 'post-1x1', x: 120, y: 300, w: 300, h: 20 },
      { cdId: 'row', artboard: 'post-1x1', x: 120, y: 330, w: 300, h: 20 },
      { cdId: 'hero-cta', artboard: 'other', x: 0, y: 0, w: 1, h: 1 },
      { cdId: null, artboard: 'post-1x1', x: 0, y: 0, w: 5, h: 5 },
    ],
  };
  const resolve = resolverFromRects(rects);

  test('ab: resolves the artboard box; el: the element of THAT artboard', () => {
    expect(resolve('ab:post-1x1')).toEqual({ x: 100, y: 200, w: 400, h: 300 });
    expect(resolve('el:post-1x1/hero-cta')).toEqual({ x: 120, y: 220, w: 80, h: 30 });
  });

  test('#N picks the Nth instance of a repeated element; bare = the first', () => {
    expect(resolve('el:post-1x1/row#1')).toEqual({ x: 120, y: 330, w: 300, h: 20 });
    expect(resolve('el:post-1x1/row')).toEqual({ x: 120, y: 300, w: 300, h: 20 });
    expect(resolve('el:post-1x1/row#2')).toBeNull();
  });

  test('anything unresolvable is null: missing, malformed, computed 8-hex id, empty box', () => {
    expect(resolve('ab:nope')).toBeNull();
    expect(resolve('el:post-1x1/gone')).toBeNull();
    expect(resolve('hello')).toBeNull();
    expect(resolve('el:post-1x1/abcdef12')).toBeNull();
    const empty = resolverFromRects({
      artboards: [{ id: 'z', x: 0, y: 0, w: 0, h: 10 }],
      elements: [],
    });
    expect(empty('ab:z')).toBeNull();
  });
});

describe('hostEndpoint', () => {
  const box: HostBox = { x: 100, y: 100, w: 200, h: 100 };

  test('pinned (nx, ny) is that point on the box, exactly', () => {
    expect(hostEndpoint(box, hostOf('el:a/b', { nx: 0.25, ny: 1 }), [0, 0])).toEqual([150, 200]);
  });

  test('auto element end: the side magnet facing the other end', () => {
    expect(hostEndpoint(box, hostOf('el:a/b'), [900, 150])).toEqual([300, 150]); // right
    expect(hostEndpoint(box, hostOf('el:a/b'), [-500, 150])).toEqual([100, 150]); // left
    expect(hostEndpoint(box, hostOf('el:a/b'), [200, -900])).toEqual([200, 100]); // top
  });

  test('auto artboard end slides along the facing edge to the other end', () => {
    // The other end is to the right and 30 px below the artboard top: the end sits
    // on the right edge at y = 130, not at the edge's midpoint.
    expect(hostEndpoint(box, hostOf('ab:a'), [900, 130])).toEqual([300, 130]);
    // It stays on the edge: clamped (inset) when the other end is beyond the edge's span.
    const [x, y] = hostEndpoint(box, hostOf('ab:a'), [9000, 400]);
    expect(x).toBe(300);
    expect(y).toBeLessThanOrEqual(200);
    expect(y).toBeGreaterThan(150);
    // Facing the top edge slides along x.
    expect(hostEndpoint(box, hostOf('ab:a'), [140, -900])).toEqual([140, 100]);
  });
});

describe('recomputeBoundArrows with hosts', () => {
  const ref = 'el:post/hero-cta';

  test('T9 moved: the element moves → the endpoint re-derives from the new box', () => {
    const a = hosted('a', { x1: 0, y1: 0, x2: 0, y2: 0, endHost: hostOf(ref) });
    const at = (x: number, y: number) => resolverOver({ [ref]: { x, y, w: 100, h: 40 } });
    const first = recomputeBoundArrows([a], at(300, 0));
    expect([arrowOf(first).x2, arrowOf(first).y2]).toEqual([300, 20]); // facing left: left magnet
    const moved = recomputeBoundArrows(first, at(500, 0));
    expect([arrowOf(moved).x2, arrowOf(moved).y2]).toEqual([500, 20]);
    expect(moved).not.toBe(first);
  });

  test('T9 removed: the bind is kept, the endpoint frozen at the cached point, and it is dangling', () => {
    const live = resolverOver({ [ref]: { x: 300, y: 100, w: 100, h: 40 } });
    const attached = recomputeBoundArrows(
      [hosted('a', { endHost: hostOf(ref, { label: 'Hero CTA' }) })],
      live
    );
    const [x2, y2] = [arrowOf(attached).x2, arrowOf(attached).y2];
    const gone = recomputeBoundArrows(attached, resolverOver({}));
    expect(gone).toBe(attached); // nothing to write: derived, never stored
    expect(arrowOf(gone).endHost?.ref).toBe(ref); // the bind survives
    expect([arrowOf(gone).x2, arrowOf(gone).y2]).toEqual([x2, y2]);
    expect(danglingEnds(gone, resolverOver({}))).toEqual([
      // the bind's last resolved box rides along: the trashed target is outlined where it was (15 an-dangling)
      {
        arrowId: 'a',
        end: 'end',
        ref,
        label: 'Hero CTA',
        at: [x2, y2],
        box: { x: 300, y: 100, w: 100, h: 40 },
      },
    ]);
    expect(danglingEnds(gone, live)).toEqual([]);
  });

  test('T9 restored: the element comes back → the end re-attaches', () => {
    const a = hosted('a', { x2: 77, y2: 88, endHost: hostOf(ref) });
    const kept = recomputeBoundArrows([a], resolverOver({}));
    expect([arrowOf(kept).x2, arrowOf(kept).y2]).toEqual([77, 88]);
    const back = recomputeBoundArrows(
      kept,
      resolverOver({ [ref]: { x: 300, y: 100, w: 100, h: 40 } })
    );
    expect([arrowOf(back).x2, arrowOf(back).y2]).toEqual([300, 120]);
    expect(danglingEnds(back, resolverOver({ [ref]: { x: 300, y: 100, w: 100, h: 40 } }))).toEqual(
      []
    );
  });

  test('an artboard end slides along the edge as the other end moves', () => {
    const board = resolverOver({ 'ab:mobile': { x: 1000, y: 0, w: 400, h: 800 } });
    const a = hosted('a', { x1: 0, y1: 200, x2: 0, y2: 0, endHost: hostOf('ab:mobile') });
    const one = recomputeBoundArrows([a], board);
    expect([arrowOf(one).x2, arrowOf(one).y2]).toEqual([1000, 200]);
    const slid = recomputeBoundArrows([{ ...arrowOf(one), y1: 600 }], board);
    expect([arrowOf(slid).x2, arrowOf(slid).y2]).toEqual([1000, 600]);
  });

  test('a pinned magnet keeps its place on the box', () => {
    const a = hosted('a', { endHost: hostOf('ab:m', { nx: 0.5, ny: 1 }) });
    const out = recomputeBoundArrows([a], resolverOver({ 'ab:m': { x: 0, y: 0, w: 200, h: 100 } }));
    expect([arrowOf(out).x2, arrowOf(out).y2]).toEqual([100, 100]);
  });

  test('both ends hosted face each other; the last resolved box is cached on the bind', () => {
    const r = resolverOver({
      'ab:left': { x: 0, y: 0, w: 100, h: 100 },
      'ab:right': { x: 500, y: 0, w: 100, h: 100 },
    });
    const a = hosted('a', { startHost: hostOf('ab:left'), endHost: hostOf('ab:right') });
    const out = arrowOf(recomputeBoundArrows([a], r));
    expect([out.x1, out.y1, out.x2, out.y2]).toEqual([100, 50, 500, 50]);
    expect(out.endHost?.box).toEqual({ x: 500, y: 0, w: 100, h: 100 });
  });

  test('idempotent and referentially stable once attached', () => {
    const r = resolverOver({ [ref]: { x: 300, y: 100, w: 100, h: 40 } });
    const once = recomputeBoundArrows([hosted('a', { endHost: hostOf(ref) })], r);
    expect(recomputeBoundArrows(once, r)).toBe(once);
  });

  test('without a resolver hosts are inert (the cached endpoint is the truth)', () => {
    const strokes = [hosted('a', { endHost: hostOf(ref) })];
    expect(recomputeBoundArrows(strokes)).toBe(strokes);
  });

  test('stroke binds still work next to hosts, and a host never disturbs another arrow', () => {
    const host: RectStroke = {
      id: 'r',
      tool: 'rect',
      color: '#000',
      width: 2,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    };
    const legacy: ArrowStroke = {
      id: 'l',
      tool: 'arrow',
      color: '#000',
      width: 2,
      x1: 0,
      y1: 0,
      x2: 400,
      y2: 50,
      startBind: { hostId: 'r', nx: 0, ny: 0 },
    };
    const mixed = hosted('a', { x1: 0, y1: 0, x2: 0, y2: 0, endHost: hostOf('ab:m') });
    const out = recomputeBoundArrows(
      [host, legacy, mixed],
      resolverOver({ 'ab:m': { x: 200, y: 0, w: 100, h: 100 } })
    );
    const l = out.find((s) => s.id === 'l') as ArrowStroke;
    expect([l.x1, l.y1]).toEqual([100, 50]); // legacy auto-bind re-faced the other end
    expect(arrowOf(out).x2).toBe(200);
  });
});

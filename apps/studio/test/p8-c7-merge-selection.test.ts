// P8 C7 (14 ed-ab-tidy): several artboards selected by a marquee read "Mixed" / a shared size, not "—".
// The WS `selected` echo is the server's projection and lacks the client-only world size + geometry; for a SET the
// merge returned the bare echo, so the inspector's multi-artboard card had no W · H · X · Y to compare.
import { describe, expect, test } from 'bun:test';
// @ts-expect-error — plain JS module
import { mergeSelClientFields } from '../client/inspector/selection.js';

const board = (id: string, extra: Record<string, unknown> = {}) => ({
  file: 'ui/Post.tsx',
  selector: `[data-dc-screen="${id}"]`,
  ...extra,
});

describe('mergeSelClientFields over a set of artboards', () => {
  test('each echoed board keeps its own world size, geometry and artboard id from the local snapshot', () => {
    const prev = [
      board('p1', {
        artboardId: 'p1',
        worldW: 1080,
        worldH: 1350,
        geometry: { x: 0, y: 0, w: 1080, h: 1350 },
        attrs: { 'data-dc-kind': 'digital' },
      }),
      board('s2', {
        artboardId: 's2',
        worldW: 1080,
        worldH: 1920,
        geometry: { x: 1200, y: 40, w: 1080, h: 1920 },
        attrs: { 'data-dc-kind': 'digital' },
      }),
    ];
    // the server echo: same boards, same order, none of the client-only fields
    const incoming = [board('p1'), board('s2')];
    const out = mergeSelClientFields(incoming, prev) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ worldW: 1080, worldH: 1350, artboardId: 'p1' });
    expect(out[1]).toMatchObject({ worldW: 1080, worldH: 1920, artboardId: 's2' });
    expect(out[1]).toMatchObject({ geometry: { x: 1200 } });
    expect(out[0]).toMatchObject({ attrs: { 'data-dc-kind': 'digital' } });
  });

  test('a board that was not selected before comes through as the echo says; a reordered echo still pairs by identity', () => {
    const prev = [board('a', { worldW: 100, worldH: 50 }), board('b', { worldW: 200, worldH: 60 })];
    const out = mergeSelClientFields([board('b'), board('c')], prev) as Array<
      Record<string, unknown>
    >;
    expect(out[0]).toMatchObject({ worldW: 200, worldH: 60 });
    expect(out[1]?.worldW).toBeUndefined();
  });

  test('a single artboard keeps its geometry too (the Position row)', () => {
    const prev = board('p1', { worldW: 10, worldH: 20, geometry: { x: 5, y: 6, w: 10, h: 20 } });
    const out = mergeSelClientFields(board('p1'), prev) as Record<string, unknown>;
    expect((out.geometry as { x: number }).x).toBe(5);
  });
});

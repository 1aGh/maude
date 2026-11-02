// S7.16 (07 · ve-long) — the client half of ruler markers: the pure list (order, jump, the limits the server holds),
// the store that reads/writes `artboardMeta[id].markers` through the one meta route, the three actions on the playhead,
// and the flags the real Timeline draws. The server half is test/video-markers.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TimelineIslandContext } from '../client/v2/timeline/island-context.js';
import {
  addMarkerAtPlayhead,
  bindMarkerSource,
  jumpMarkerFromPlayhead,
  loadMarkers,
  markersOf,
  removeMarkerAtPlayhead,
  saveMarkers,
} from '../client/v2/timeline/marker-store.js';
import {
  defaultName,
  jumpTarget,
  MARKER_WORDS,
  MAX_MARKERS,
  sortedMarkers,
  withMarker,
  withoutMarker,
} from '../client/v2/timeline/markers.js';
import TimelinePanel from '../client/v2/timeline/Timeline.jsx';

const FILE = '.design/ui/Zapas.tsx';
const ID = 'zapas';
const M = [
  { frame: 6060, name: 'TD 2' },
  { frame: 420, name: 'Výkop' },
  { frame: 1320, name: 'TD 1' },
  { frame: 2940, name: 'Poločas' },
];
const json = (status: number, b: unknown = {}) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('the pure list', () => {
  test('frame order; bad ones dropped; two on one frame keep the later; names are plain text', () => {
    expect(sortedMarkers(M).map((m) => m.name)).toEqual(['Výkop', 'TD 1', 'Poločas', 'TD 2']);
    expect(sortedMarkers([{ frame: -1, name: 'x' }, { frame: 1.5, name: 'y' }, null, 'z'])).toEqual(
      []
    );
    expect(
      sortedMarkers([
        { frame: 5, name: 'a' },
        { frame: 5, name: 'b' },
      ])
    ).toEqual([{ frame: 5, name: 'b' }]);
    expect(sortedMarkers([{ frame: 1, name: '<b>TD\n1</b>' }])).toEqual([
      { frame: 1, name: 'bTD1/b' },
    ]);
    expect(sortedMarkers([{ frame: 1, name: 'x'.repeat(100) }])[0].name).toHaveLength(60);
  });

  test('jump: next and previous; standing on a marker jumps past it; none that way is null', () => {
    expect(jumpTarget(M, 0, 1)?.name).toBe('Výkop');
    expect(jumpTarget(M, 420, 1)?.name).toBe('TD 1');
    expect(jumpTarget(M, 3990, -1)?.name).toBe('Poločas');
    expect(jumpTarget(M, 2940, -1)?.name).toBe('TD 1');
    expect(jumpTarget(M, 6060, 1)).toBeNull();
    expect(jumpTarget(M, 420, -1)).toBeNull();
    expect(jumpTarget([], 3, 1)).toBeNull();
  });

  test('adding on a taken frame renames it; the 201st marker is refused; the default name counts', () => {
    const r = withMarker(M, 420, 'Kick-off');
    if (!('list' in r)) throw new Error('refused');
    expect(r.list.filter((m: { frame: number }) => m.frame === 420)).toEqual([
      { frame: 420, name: 'Kick-off' },
    ]);
    expect(r.list).toHaveLength(4);
    const full = Array.from({ length: MAX_MARKERS }, (_, i) => ({ frame: i, name: 'm' }));
    expect(withMarker(full, 999, 'x')).toEqual({ refused: 'full' });
    expect('list' in withMarker(full, 5, 'renamed')).toBe(true);
    expect(defaultName(M)).toBe('Marker 5');
    const unnamed = withMarker([], 30, '   ');
    if (!('added' in unnamed)) throw new Error('refused');
    expect(unnamed.added).toEqual({ frame: 30, name: 'Marker 1' });
    expect(withoutMarker(M, 1320).map((m) => m.frame)).toEqual([420, 2940, 6060]);
  });
});

describe('the store', () => {
  beforeEach(async () => {
    await saveMarkers(FILE, ID, [], (async () =>
      json(200, { markers: {} })) as unknown as typeof fetch);
  });
  afterEach(() => bindMarkerSource(null));

  test('read: canvas-meta’s list shows in frame order; a failed read leaves what is there', async () => {
    await loadMarkers(FILE, ID, (async () =>
      json(200, { artboardMeta: { [ID]: { markers: M } } })) as unknown as typeof fetch);
    expect(markersOf(FILE, ID).map((m: { frame: number }) => m.frame)).toEqual([
      420, 1320, 2940, 6060,
    ]);
    await loadMarkers(FILE, ID, (async () => json(500)) as unknown as typeof fetch);
    expect(markersOf(FILE, ID)).toHaveLength(4);
  });

  test('write: PATCH present-meta with the WHOLE list; none is null', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const f = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      return json(200, { markers: { [ID]: body.markers[ID] ?? [] } });
    }) as unknown as typeof fetch;
    expect((await saveMarkers(FILE, ID, M, f)).ok).toBe(true);
    expect(calls[0].url).toBe('/_api/present-meta');
    expect(calls[0].body).toEqual({ file: FILE, markers: { [ID]: sortedMarkers(M) } });
    await saveMarkers(FILE, ID, [], f);
    expect(calls[1].body).toEqual({ file: FILE, markers: { [ID]: null } });
    expect(markersOf(FILE, ID)).toEqual([]);
  });

  test('a role that cannot edit: the flags go back and the words say why', async () => {
    await loadMarkers(FILE, ID, (async () =>
      json(200, { artboardMeta: { [ID]: { markers: [M[1]] } } })) as unknown as typeof fetch);
    const done = await saveMarkers(FILE, ID, M, (async () =>
      json(403, { reason: 'read-only' })) as unknown as typeof fetch);
    expect(done).toEqual({ ok: false, message: MARKER_WORDS.readOnly });
    expect(markersOf(FILE, ID)).toEqual([M[1]]);
    const failed = await saveMarkers(FILE, ID, M, (async () =>
      json(500)) as unknown as typeof fetch);
    expect(failed.message).toBe(MARKER_WORDS.failed);
  });

  test('the actions work at the playhead of the followed video', async () => {
    const sent: unknown[] = [];
    const seen: number[] = [];
    let frame = 300;
    bindMarkerSource(() => ({
      file: FILE,
      artboardId: ID,
      frame,
      seek: (f: number) => seen.push(f),
    }));
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body.markers[ID]);
      return json(200, { markers: { [ID]: body.markers[ID] ?? [] } });
    }) as unknown as typeof fetch;
    expect(await addMarkerAtPlayhead('Výkop', f)).toBe('Marker “Výkop” added.');
    frame = 900;
    expect(await addMarkerAtPlayhead(undefined, f)).toBe('Marker “Marker 2” added.');
    frame = 0;
    expect(jumpMarkerFromPlayhead(1)).toBe('Marker: Výkop');
    expect(jumpMarkerFromPlayhead(1)).toBe('Marker: Výkop'); // the playhead is bound by the Timeline, not moved here
    expect(seen).toEqual([300, 300]);
    frame = 900;
    expect(jumpMarkerFromPlayhead(-1)).toBe('Marker: Výkop');
    expect(jumpMarkerFromPlayhead(1)).toBe(MARKER_WORDS.noNext);
    frame = 100;
    expect(jumpMarkerFromPlayhead(-1)).toBe(MARKER_WORDS.noPrev);
    expect(await removeMarkerAtPlayhead(f)).toBe(MARKER_WORDS.noneHere);
    frame = 300;
    expect(await removeMarkerAtPlayhead(f)).toBe('Marker “Výkop” removed.');
    expect(sent.at(-1)).toEqual([{ frame: 900, name: 'Marker 2' }]);
  });

  test('no video followed: a word, no write', async () => {
    let called = false;
    const f = (async () => {
      called = true;
      return json(200);
    }) as unknown as typeof fetch;
    expect(await addMarkerAtPlayhead('x', f)).toBe(MARKER_WORDS.none);
    expect(jumpMarkerFromPlayhead(1)).toBe(MARKER_WORDS.none);
    expect(called).toBe(false);
  });
});

describe('the flags on the real Timeline', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(async () => {
    await act(async () => root?.unmount());
    await new Promise((r) => setTimeout(r, 20));
    host?.remove();
    document.body.innerHTML = '';
    root = null;
  });
  const beat = (i: number) => ({
    stableId: `b${i}`,
    label: `Akce ${i}`,
    from: i * 150,
    duration: 150,
    series: true,
    mediaTag: 'Video',
    mediaSrc: `assets/akce-${i}.mp4`,
    mediaProps: { muted: false },
    keyframes: [],
  });

  test('one flag per marker, named, and a click puts the playhead there', async () => {
    await loadMarkers(FILE, ID, (async () =>
      json(200, {
        artboardMeta: { [ID]: { markers: M.slice(1, 3) } },
      })) as unknown as typeof fetch);
    const seeks: number[] = [];
    host = document.createElement('div');
    host.style.width = '1200px';
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        createElement(
          TimelineIslandContext.Provider,
          {
            value: {
              size: 'full',
              kept: false,
              onToggleSize: () => {},
              canvas: FILE,
              canEdit: true,
              empty: null,
            },
          },
          createElement(TimelinePanel, {
            comps: [
              {
                id: 'c1',
                fps: 30,
                durationInFrames: 6000,
                width: 1920,
                height: 1080,
                artboardId: ID,
              },
            ],
            compId: 'c1',
            sequences: Array.from({ length: 40 }, (_, i) => beat(i)),
            total: 6000,
            frame: 0,
            height: 260,
            resolveMediaUrl: (src: string) => `/.design/${src}`,
            onRetime: () => {},
            onSelect: () => {},
            onSeek: (f: number) => seeks.push(f),
            onClipVerb: () => {},
          })
        )
      );
    });
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(q('timeline-marker-420')?.textContent).toBe('Výkop');
    expect(q('timeline-marker-1320')?.textContent).toBe('TD 1');
    expect(q('timeline-marker-2940')).toBeNull(); // not in the list
    act(() => q('timeline-marker-1320')?.click());
    expect(seeks).toEqual([1320]);
  });
});

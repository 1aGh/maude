// r5-1 (Michal: "video nejde pretahnout z finder ani z assets drag and drop") — an Assets VIDEO tile drags like a picture:
// it carries its path and the clip's natural size (`videoWidth`, not `naturalWidth`); dropped on an artboard in Edit it asks
// `image.place` (which writes the r3 `<video>`), dropped in Preview it becomes an annotation (`insert-annotation-media`, whose
// canvas side makes a video media reference, not a picture).

import { describe, expect, test } from 'bun:test';
import {
  _createSessionForTest,
  assetDragSession,
  createCatcherLane,
  placeRequestFor,
} from '../client/v2/assets/asset-drop-session.js';
import { startAssetDrag, tileDragProps } from '../client/v2/assets/tile-drag.js';
import { ASSET_DRAG_MIME } from '../editing/asset-drag.ts';

const fakeDrag = () => {
  const data = new Map<string, string>();
  return {
    data,
    dt: {
      effectAllowed: '',
      setData: (k: string, v: string) => void data.set(k, v),
    },
  };
};

describe('a video tile drag (r5-1)', () => {
  test('carries the path and the clip natural size', () => {
    const { data, dt } = fakeDrag();
    const clip = { videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
    const ok = startAssetDrag({ dataTransfer: dt }, 'assets/820e2d45.mov', clip);
    expect(ok).toBe(true);
    // #168 F6 — the session carries the path and size; the drag data only the opaque token
    expect(data.get(ASSET_DRAG_MIME)).toBe(assetDragSession.token() ?? 'none');
    const got = assetDragSession.current();
    expect(got?.asset).toBe('assets/820e2d45.mov');
    expect(got?.w).toBe(1920);
    expect(got?.h).toBe(1080);
  });

  test('the tile props look for the clip as well as the picture', () => {
    const { dt } = fakeDrag();
    const clip = { videoWidth: 640, videoHeight: 360 };
    const tile = { querySelector: (sel: string) => (/video/.test(sel) ? clip : null) };
    tileDragProps('assets/820e2d45.mov').onDragStart({ dataTransfer: dt, currentTarget: tile });
    // (the session is module state: a drag in flight carries what the tile knew)
    expect(dt.effectAllowed).toBe('copy');
  });
});

describe('dropping a clip (r5-1)', () => {
  test('Edit: on an artboard it asks image.place for the clip, with its size', () => {
    const req = placeRequestFor(
      { asset: 'assets/820e2d45.mov', w: 1920, h: 1080 },
      { kind: 'artboard', artboard: 'post' },
      '.design/ui/Post.tsx'
    );
    expect(req?.asset).toBe('assets/820e2d45.mov');
    expect(req?.natural).toEqual({ w: 1920, h: 1080 });
  });

  test('Preview: the drop adds an annotation for the clip, never a design edit', () => {
    const session = _createSessionForTest();
    session.begin({ asset: 'assets/820e2d45.mov' });
    const posted: Array<Record<string, unknown>> = [];
    const lane = createCatcherLane({
      session,
      post: (m: Record<string, unknown>) => void posted.push(m),
      accept: () => null,
      canvas: () => '.design/ui/Post.tsx',
      place: async () => ({ ok: true }),
      preview: () => true,
    });
    lane.drop(40, 50);
    const ins = posted.find((m) => m.dgn === 'insert-annotation-media');
    expect(ins?.paths).toEqual(['assets/820e2d45.mov']);
  });
});

// #168 F6 — an Assets tile's drag must never tell a canvas the asset's name it was not dropped on. Two channels:
//  1. the drag data itself: a drop that reaches a canvas frame directly (Chromium delivers a cross-origin drop; the
//     catcher is gone right after a tab switch) could read it. The data now carries only an opaque drag token; the
//     path and size stay in the shell's session.
//  2. the catcher lane: a drag that started over one canvas and is still going when the open canvas changes (a tab
//     switch) or the window is hidden ends there — nothing is posted to the canvas that is now on screen.
import { describe, expect, test } from 'bun:test';

import {
  _createSessionForTest,
  assetDragSession,
  createCatcherLane,
} from '../client/v2/assets/asset-drop-session.js';
import { ASSET_DRAG_MIME, startAssetDrag } from '../client/v2/assets/tile-drag.js';

const fakeTarget = () => {
  const ls = new Map<string, Set<(e: unknown) => void>>();
  const doc = {
    hidden: false,
    addEventListener: (t: string, f: (e: unknown) => void) => {
      if (!ls.has(`doc:${t}`)) ls.set(`doc:${t}`, new Set());
      ls.get(`doc:${t}`)?.add(f);
    },
    removeEventListener: (t: string, f: (e: unknown) => void) => ls.get(`doc:${t}`)?.delete(f),
  };
  return {
    doc,
    win: {
      document: doc,
      addEventListener: (t: string, f: (e: unknown) => void) => {
        if (!ls.has(t)) ls.set(t, new Set());
        ls.get(t)?.add(f);
      },
      removeEventListener: (t: string, f: (e: unknown) => void) => ls.get(t)?.delete(f),
    },
    fire: (key: string) => {
      for (const f of ls.get(key) ?? []) f({});
    },
  };
};

describe('the drag data carries no name', () => {
  test('only an opaque token under the tile type, no plain-text twin; the path stays in the session', () => {
    const data = new Map<string, string>();
    const ok = startAssetDrag(
      { dataTransfer: { effectAllowed: '', setData: (k: string, v: string) => data.set(k, v) } },
      'assets/secret-plan-q4.png',
      { naturalWidth: 10, naturalHeight: 20 }
    );
    expect(ok).toBe(true);
    expect([...data.keys()]).toEqual([ASSET_DRAG_MIME]);
    const token = data.get(ASSET_DRAG_MIME) ?? '';
    expect(token).toBe(assetDragSession.token() ?? 'none');
    expect(token).toMatch(/^dg_[a-z0-9]+$/);
    for (const v of data.values()) expect(v).not.toContain('secret-plan');
    expect(assetDragSession.current()).toEqual({
      asset: 'assets/secret-plan-q4.png',
      w: 10,
      h: 20,
    });
    assetDragSession.end();
    expect(assetDragSession.token()).toBeNull();
  });
});

describe('the session ends when the window is hidden', () => {
  test('a visibilitychange to hidden ends the drag', () => {
    const t = fakeTarget();
    const s = _createSessionForTest({ target: t.win });
    s.begin({ asset: 'assets/a.png' });
    t.fire('doc:visibilitychange'); // still visible: nothing
    expect(s.current()).not.toBeNull();
    t.doc.hidden = true;
    t.fire('doc:visibilitychange');
    expect(s.current()).toBeNull();
  });
});

describe('the catcher lane ends the drag on a canvas switch', () => {
  const setup = () => {
    const t = fakeTarget();
    const session = _createSessionForTest({ target: t.win });
    const posts: Array<Record<string, unknown>> = [];
    let canvas: string | null = 'ui/a.tsx';
    let preview = false;
    const lane = createCatcherLane({
      session,
      canvas: () => canvas,
      post: (m: Record<string, unknown>) => posts.push(m),
      accept: () => null,
      place: async () => ({ ok: true }),
      preview: () => preview,
    });
    return {
      session,
      posts,
      lane,
      to: (c: string) => (canvas = c),
      inPreview: () => (preview = true),
    };
  };

  test('a dragover after the switch tells the new canvas nothing and ends the drag', () => {
    const r = setup();
    r.session.begin({ asset: 'assets/secret.png' });
    expect(r.lane.over(5, 5)).toBe(true);
    r.to('ui/b.tsx');
    const before = r.posts.length;
    expect(r.lane.over(6, 6)).toBe(false);
    expect(r.posts.length).toBe(before);
    expect(r.session.current()).toBeNull();
  });

  test('a Preview drop after the switch never hands the new canvas the path', () => {
    const r = setup();
    r.inPreview();
    r.session.begin({ asset: 'assets/secret.png' });
    r.lane.over(5, 5);
    r.to('ui/b.tsx');
    expect(r.lane.drop(6, 6)).toBeNull();
    expect(JSON.stringify(r.posts)).not.toContain('secret');
    expect(r.session.current()).toBeNull();
  });

  test('a drop on the canvas it was dragged over still asks with the opaque requestId only', () => {
    const r = setup();
    r.session.begin({ asset: 'assets/secret.png' });
    r.lane.over(5, 5);
    const id = r.lane.drop(6, 6);
    expect(typeof id).toBe('string');
    expect(r.posts.at(-1)).toEqual({ dgn: 'asset-drop-at', requestId: id, x: 6, y: 6 });
    expect(JSON.stringify(r.posts)).not.toContain('secret');
  });
});

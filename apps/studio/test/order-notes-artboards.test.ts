// V2-5 A4 (S3.5 mount) — the "Order and notes…" sheet's artboards, in canvas order, from what the shell
// can read (the index row + the canvas .meta.json). client/v2/present/order-notes-artboards.js.

import { describe, expect, test } from 'bun:test';
import {
  indexRowFor,
  loadOrderNotesArtboards,
  orderNotesArtboards,
} from '../client/v2/present/order-notes-artboards.js';

const row = (ids: string[], h = 100) => ({
  artboards: ids.map((id) => ({ id, label: `L ${id}`, w: 200, h })),
});

describe('orderNotesArtboards', () => {
  test('every artboard placed → canvasOrder: row by row, left to right', () => {
    const meta = {
      layout: {
        artboards: [
          { id: 'a', x: 500, y: 0 },
          { id: 'b', x: 0, y: 0 },
          { id: 'c', x: 0, y: 400 },
        ],
      },
    };
    expect(orderNotesArtboards({ indexRow: row(['a', 'b', 'c']), meta })).toEqual([
      { id: 'b', label: 'L b' },
      { id: 'a', label: 'L a' },
      { id: 'c', label: 'L c' },
    ]);
  });

  test('an auto-laid canvas (any artboard without a stored position) keeps the declared order', () => {
    const meta = { layout: { artboards: [{ id: 'c', x: 0, y: 0 }] } };
    expect(orderNotesArtboards({ indexRow: row(['a', 'b', 'c']), meta }).map((a) => a.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  test('no index row: the meta’s own artboard list, labels fall back to the id; junk is dropped', () => {
    const meta = {
      artboards: [{ id: 'x', label: 'Hero' }, { id: 'y' }, { label: 'no id' }, null, { id: 'x' }],
    };
    expect(orderNotesArtboards({ meta })).toEqual([
      { id: 'x', label: 'Hero' },
      { id: 'y', label: 'y' },
    ]);
    expect(orderNotesArtboards({})).toEqual([]);
  });

  test('indexRowFor joins a repo-relative path on the designRoot-relative rel', () => {
    const snap = { project: { designRel: '.design' }, canvases: [{ rel: 'ui/a.tsx' }] };
    expect(indexRowFor(snap, '.design/ui/a.tsx')).toEqual({ rel: 'ui/a.tsx' });
    expect(indexRowFor(snap, '.design/ui/b.tsx')).toBeNull();
    expect(indexRowFor(null, '.design/ui/a.tsx')).toBeNull();
  });

  test('loadOrderNotesArtboards reads the meta and the index, and never throws', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.startsWith('/_api/index'))
        return Response.json({
          project: { designRel: '.design' },
          canvases: [{ rel: 'ui/a.tsx', ...row(['p', 'q']) }],
        });
      return Response.json({ layout: { artboards: [] } });
    };
    expect(await loadOrderNotesArtboards('.design/ui/a.tsx', fetchImpl)).toEqual([
      { id: 'p', label: 'L p' },
      { id: 'q', label: 'L q' },
    ]);
    expect(urls.sort()).toEqual(['/_api/canvas-meta?file=.design%2Fui%2Fa.tsx', '/_api/index']);
    const failing = async () => {
      throw new Error('offline');
    };
    expect(await loadOrderNotesArtboards('.design/ui/a.tsx', failing)).toEqual([]);
  });
});

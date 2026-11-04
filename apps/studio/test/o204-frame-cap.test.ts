// Maude 2.0.4 task O — the viewport keeps at most the active canvas frame + 1 most recent (client/shell/frame-cap.js).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FRAME_CAP, framesToMount, noteShown } from '../client/shell/frame-cap.js';

const tabs = (...paths: string[]) => paths.map((path) => ({ path }));

describe('frame cap', () => {
  test('the cap is the active canvas + 1 most recent', () => {
    expect(FRAME_CAP).toBe(2);
  });

  test('twenty open canvases mount two frames: the active one and the one shown before it', () => {
    const paths = Array.from({ length: 20 }, (_, i) => `.design/ui/c-${i}.tsx`);
    let recent: string[] = [];
    for (const p of paths) recent = noteShown(recent, p);
    const keep = framesToMount(tabs(...paths), paths[19], recent);
    expect([...keep]).toEqual([paths[19], paths[18]]);
  });

  test('going back to a canvas makes the one just left the kept neighbour', () => {
    let recent: string[] = [];
    for (const p of ['a', 'b', 'c', 'a']) recent = noteShown(recent, p);
    expect([...framesToMount(tabs('a', 'b', 'c'), 'a', recent)]).toEqual(['a', 'c']);
  });

  test('only open tabs are mounted, and views that are not frames never count', () => {
    let recent: string[] = [];
    for (const p of ['x', '__system__', 'b']) recent = noteShown(recent, p);
    const keep = framesToMount(tabs('__system__', 'b'), 'b', recent, {
      skip: (p) => p === '__system__',
    });
    expect([...keep]).toEqual(['b']);
  });

  test('noteShown keeps the same array when nothing changes', () => {
    const r = noteShown([], 'a');
    expect(noteShown(r, 'a')).toBe(r);
    expect(noteShown(r, null)).toBe(r);
  });

  test('the viewport mounts frames through the cap', () => {
    const src = readFileSync(join(import.meta.dir, '../client/shell/viewport.jsx'), 'utf8');
    expect(src).toContain('framesToMount(');
    expect(src).toMatch(/if \(!mounted\.has\(t\.path\)\) return null;/);
  });
});

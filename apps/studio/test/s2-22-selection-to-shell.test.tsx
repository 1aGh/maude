// S2.22 G2 / G4 / G6 — what the shell holds after the canvas speaks, at the selection-store level.
//
//   G4/G6  a multi-selection must reach the inspector: the shell used to keep only the head of a `select-set` list,
//          so "4 artboards · Mixed" and the multi-element inspector never drew.
//   G2     after a write reloads the canvas, a whole-artboard selection (no element id) is put back by its name,
//          so the inspector shows the new W × H instead of an empty payload.
//
// The wire is a real `dgn: 'select-set'` message through the canvas-side store (SelectionSetProvider); the shell-side
// reducer is `shellSelectionOf`, the pure part of the handler in hooks/use-canvas-bridge.jsx.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import {
  isArtboardSelectionOf,
  restoreAfterLoad,
  shellSelectionOf,
} from '../client/selection-scope.js';
import { SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';

const FILE = '.design/ui/Site.tsx';
const board = (id: string) => ({
  file: FILE,
  selector: `[data-dc-screen="${id}"]`,
  artboardId: id,
  tag: 'article',
});
const el = (id: string) => ({ file: FILE, id, selector: `[data-cd-id="${id}"]`, artboardId: 'a1' });

describe('G4/G6 — several selected reach the shell as a list', () => {
  test('through the canvas store: ⇧-adding a second element posts an ARRAY, and the shell keeps all of it', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const target = { postMessage: (m: unknown) => void posted.push(m as Record<string, unknown>) };
    let api: ReturnType<typeof useSelectionSet> | null = null;
    const Probe = () => {
      api = useSelectionSet();
      return null;
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <SelectionSetProvider postTarget={target}>
          <Probe />
        </SelectionSetProvider>
      );
    });
    await act(async () => api?.replace(el('aaaaaaaa')));
    await act(async () => api?.add(el('bbbbbbbb')));
    await new Promise((r) => setTimeout(r, 150)); // the store posts after its 50 ms debounce
    const last = posted.at(-1) as { selection: unknown };
    expect(Array.isArray(last.selection)).toBe(true);
    expect((last.selection as unknown[]).length).toBe(2);
    // the shell's side of the same message
    const held = shellSelectionOf(last.selection) as unknown[];
    expect(Array.isArray(held)).toBe(true);
    expect(held.length).toBe(2);
    await act(async () => root.unmount());
  });

  test('four artboards stay four (the inspector says "4 artboards")', async () => {
    const four = ['a', 'b', 'c', 'd'].map(board);
    expect(shellSelectionOf(four)).toBe(four);
    const { titleOf } = await import('../client/v2/inspector/model.js');
    expect(titleOf(shellSelectionOf(four), null)).toBe('4 artboards');
  });

  test('one stays one object (with the canvas’s description), none stays none', () => {
    const add = (s: object) => ({ ...s, kind: 'frame' });
    expect(shellSelectionOf([el('x')], add)).toEqual({ ...el('x'), kind: 'frame' });
    expect(shellSelectionOf(el('x'), add)).toEqual({ ...el('x'), kind: 'frame' });
    expect(shellSelectionOf(null)).toBeNull();
    expect(shellSelectionOf([])).toBeNull();
  });
});

describe('G2 — the artboard is still selected after the write reloads the canvas', () => {
  test('an element is put back by its id, as before', () => {
    expect(restoreAfterLoad(el('abcd1234'), FILE)).toEqual({
      kind: 'element',
      sel: el('abcd1234'),
    });
  });

  test('a whole artboard is put back by its name', () => {
    expect(restoreAfterLoad(board('laptop'), FILE)).toEqual({
      kind: 'artboard',
      artboardId: 'laptop',
      file: FILE,
    });
  });

  test('the server echo drops artboardId: the selector still names the board', () => {
    const echo = { file: FILE, selector: '[data-dc-screen="laptop"]' };
    expect(restoreAfterLoad(echo, FILE)).toEqual({
      kind: 'artboard',
      artboardId: 'laptop',
      file: FILE,
    });
    expect(isArtboardSelectionOf(echo, 'laptop', FILE)).toBe(true);
  });

  test('another canvas, another board, or nothing restores nothing', () => {
    expect(restoreAfterLoad(board('laptop'), '.design/ui/Other.tsx')).toBeNull();
    expect(restoreAfterLoad(null, FILE)).toBeNull();
    expect(isArtboardSelectionOf(board('laptop'), 'tablet', FILE)).toBe(false);
    expect(isArtboardSelectionOf(el('x'), 'a1', FILE)).toBe(false);
  });
});

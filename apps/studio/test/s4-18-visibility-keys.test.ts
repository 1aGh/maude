// S4.18 (an-visibility) — canvas 15 frame 3.
//   ⇧P pressed inside the canvas hides the layer there and TELLS the shell (`annotations-visibility`), which
//   keeps the pref and shows "Annotations hidden. Press ⇧P to bring them back." + Show. The canvas path never
//   reached the shell's toggleAnnotations, so the toast never appeared.
//   ⇧⌘A in Edit is Select all annotations: the canvas resolves it itself (the keydown never reaches the
//   shell), and the design objects' ⌘A no longer swallows it (v1 matched any ⇧, V2-1.3 defect 1).

import { describe, expect, test } from 'bun:test';

import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import { reportAnnotationsVisibility } from '../annotations/ui/visibility.ts';
import { acceptFromCanvas } from '../bridge/dgn-protocol.ts';
import { isSelectAllElementsChord } from '../use-keyboard-discipline.tsx';

describe('⇧P tells the shell', () => {
  test('a framed canvas posts annotations-visibility to its parent; the shell accepts it from the active frame', () => {
    const sent: unknown[] = [];
    const parent = { postMessage: (m: unknown) => sent.push(m) } as unknown as Window;
    const win = { parent } as unknown as Window;
    reportAnnotationsVisibility(win, false);
    expect(sent).toEqual([{ dgn: 'annotations-visibility', v: 1, visible: false }]);
    const e = { origin: 'http://c', source: win, data: sent[0] } as unknown as MessageEvent;
    expect(acceptFromCanvas(e, { canvasOrigin: 'http://c', active: win })).toEqual({
      dgn: 'annotations-visibility',
      v: 1,
      visible: false,
    });
    // a background canvas is not heard
    expect(acceptFromCanvas(e, { canvasOrigin: 'http://c', active: {} as Window })).toBeNull();
  });

  test('a standalone canvas (no shell) says nothing', () => {
    const sent: unknown[] = [];
    const win = { postMessage: (m: unknown) => sent.push(m) } as unknown as Window & {
      parent: Window;
    };
    (win as { parent: Window }).parent = win;
    reportAnnotationsVisibility(win, false);
    expect(sent).toEqual([]);
  });
});

describe('⇧⌘A in the canvas', () => {
  const key = (o: Partial<KeyboardEvent>) =>
    ({
      key: 'a',
      code: 'KeyA',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...o,
    }) as KeyboardEvent;

  test('resolves to Select all annotations in Edit (the layer handles it, then asks for Preview)', () => {
    const index = canvasKeyIndex(['select.all-annotations']);
    expect(
      resolveCanvasKey(index, key({ key: 'A', metaKey: true, shiftKey: true }), false, 'edit')
    ).toBe('select.all-annotations');
  });

  test('is not the design objects’ ⌘A; ⌘A still is', () => {
    expect(isSelectAllElementsChord(key({ key: 'A', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSelectAllElementsChord(key({ metaKey: true }))).toBe(true);
    expect(isSelectAllElementsChord(key({ ctrlKey: true }))).toBe(true);
  });
});

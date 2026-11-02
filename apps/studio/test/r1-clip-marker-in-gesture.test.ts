// r1 (Michal rc.1 item 13) — ⌘C / ⌘X then ⌘V did nothing. The copy reached the server and the shell held the
// handle, but the system-clipboard marker that tells ⌘V "this paste is ours" was written only AFTER the server
// answered (`navigator.clipboard.writeText` past an await, from the cross-origin canvas frame) — the write is
// refused there, the clipboard keeps whatever it held, and the paste event never claims the paste. The marker
// is now written synchronously, inside the key's own handling, through the frame's own `copy` event
// (`execCommand('copy')` + `clipboardData.setData`), which needs no clipboard permission.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import type { EditOpResult } from '../edit-ops/types.ts';
import { isClipMarker, runClipAction, writeClipMarkerNow } from '../editing/clipboard.ts';

const ok: EditOpResult = {
  ok: true,
  actionId: null,
  writeId: '',
  rev: '0123456789abcdef',
  refs: [],
  detail: { clip: { kind: 'objects', count: 1 } },
};

describe('the clip marker is written inside the gesture', () => {
  test('copy writes the marker before the server answers, and not again after', async () => {
    const order: string[] = [];
    let answer: (r: EditOpResult) => void = () => {};
    const done = runClipAction(
      'object.copy',
      { objects: [{ artboard: 'a', element: 'x1' }], artboards: [] },
      {
        run: () => {
          order.push('asked');
          return new Promise<EditOpResult>((r) => (answer = r));
        },
        markNow: (t) => {
          order.push(isClipMarker(t) ? 'marked-now' : 'bad-marker');
          return true;
        },
        mark: () => order.push('marked-late'),
      }
    );
    // nothing awaited yet: the marker is already on the clipboard
    expect(order).toEqual(['marked-now', 'asked']);
    answer(ok);
    await done;
    expect(order).toEqual(['marked-now', 'asked']);
  });

  test('cut and artboard copy mark in the gesture too; a paste never marks', async () => {
    for (const [action, ctx] of [
      ['object.cut', { objects: [{ artboard: 'a', element: 'x1' }], artboards: [] }],
      ['artboard.copy', { objects: [], artboards: ['a', 'b'] }],
    ] as const) {
      const marks: string[] = [];
      await runClipAction(action, ctx, {
        run: async () => ok,
        markNow: (t) => {
          marks.push(t);
          return true;
        },
      });
      expect(marks).toHaveLength(1);
      expect(isClipMarker(marks[0])).toBe(true);
    }
    expect(
      await runClipAction(
        'artboard.copy',
        { objects: [], artboards: ['a', 'b'] },
        {
          run: async () => ok,
          markNow: (t) => {
            expect(t).toContain('2 artboards');
            return true;
          },
        }
      )
    ).toBeTruthy();
    const pasteMarks: string[] = [];
    await runClipAction(
      'canvas.paste',
      { objects: [], artboards: ['b'] },
      {
        run: async () => ok,
        markNow: (t) => {
          pasteMarks.push(t);
          return true;
        },
      }
    );
    expect(pasteMarks).toEqual([]);
  });

  test('a refused in-gesture write falls back to the late write', async () => {
    const late: string[] = [];
    await runClipAction(
      'object.copy',
      { objects: [{ artboard: 'a', element: 'x1' }], artboards: [] },
      { run: async () => ok, markNow: () => false, mark: (t) => late.push(t) }
    );
    expect(late).toHaveLength(1);
  });

  test('writeClipMarkerNow puts the marker on the copy event, and lets beforecopy enable it', () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    const seen: string[] = [];
    // happy-dom has no execCommand: stand in for the engine — validate with beforecopy, then fire copy
    (doc as unknown as { execCommand: (c: string) => boolean }).execCommand = (cmd: string) => {
      if (cmd !== 'copy') return false;
      const before = new win.Event('beforecopy', { cancelable: true }) as unknown as Event;
      doc.dispatchEvent(before);
      seen.push(`beforecopy:${before.defaultPrevented}`);
      const data = new Map<string, string>();
      const ev = new win.Event('copy', { cancelable: true }) as unknown as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', {
        value: { setData: (t: string, v: string) => data.set(t, v) },
      });
      doc.dispatchEvent(ev);
      seen.push(`copy:${ev.defaultPrevented}:${data.get('text/plain')}`);
      return true;
    };
    expect(writeClipMarkerNow('Maude · 1 object · paste on a canvas (maude-clip)', doc)).toBe(true);
    expect(seen).toEqual([
      'beforecopy:true',
      'copy:true:Maude · 1 object · paste on a canvas (maude-clip)',
    ]);
    // the listeners are one-shot: a later copy (a text selection) is the page's own again
    seen.length = 0;
    (doc as unknown as { execCommand: (c: string) => boolean }).execCommand('copy');
    expect(seen).toEqual(['beforecopy:false', 'copy:false:undefined']);
  });
});

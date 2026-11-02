// V2-3.6 N-M2 (a) — the shell cancels the default of EVERY drag it does not
// take, so a link dropped on the shell can never navigate the top frame. Only a
// non-file drag over an editable field keeps its default (text insertion).
import { describe, expect, test } from 'bun:test';
import { installDropGuard, shouldCancelDrag } from '../client/shell/drop-guard.js';

function dragEvent(type: string, types: string[], target: unknown) {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types } });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

const div = { nodeType: 1, tagName: 'DIV', isContentEditable: false };
const input = { nodeType: 1, tagName: 'INPUT', type: 'text', isContentEditable: false };
const checkbox = { nodeType: 1, tagName: 'INPUT', type: 'checkbox', isContentEditable: false };
const readOnly = { nodeType: 1, tagName: 'TEXTAREA', readOnly: true, isContentEditable: false };
const editable = { nodeType: 1, tagName: 'DIV', isContentEditable: true };
const textNode = { nodeType: 3, parentElement: input };

describe('shouldCancelDrag', () => {
  test('a dragged link or text over the shell is cancelled', () => {
    for (const types of [['text/uri-list'], ['text/plain'], ['text/html', 'text/uri-list'], []]) {
      expect(shouldCancelDrag(dragEvent('drop', types, div))).toBe(true);
      expect(shouldCancelDrag(dragEvent('drop', types, checkbox))).toBe(true);
      expect(shouldCancelDrag(dragEvent('drop', types, readOnly))).toBe(true);
    }
  });

  test('files are always cancelled, even over a text field', () => {
    expect(shouldCancelDrag(dragEvent('drop', ['Files'], div))).toBe(true);
    expect(shouldCancelDrag(dragEvent('drop', ['Files'], input))).toBe(true);
  });

  test('a link or text over an editable field keeps its insert default', () => {
    expect(shouldCancelDrag(dragEvent('drop', ['text/uri-list'], input))).toBe(false);
    expect(shouldCancelDrag(dragEvent('drop', ['text/plain'], editable))).toBe(false);
    expect(shouldCancelDrag(dragEvent('drop', ['text/plain'], textNode))).toBe(false);
  });
});

describe('installDropGuard', () => {
  test('dragover and drop of a link on the document are default-prevented; uninstall restores', () => {
    const doc = new EventTarget();
    const off = installDropGuard(doc as unknown as Document);
    for (const type of ['dragover', 'drop']) {
      const e = dragEvent(type, ['text/uri-list'], div);
      doc.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    off();
    const e = dragEvent('drop', ['text/uri-list'], div);
    doc.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

test('the shell hook installs the guard on its document', async () => {
  const src = await Bun.file(
    new URL('../client/hooks/use-photo-and-timeline.jsx', import.meta.url)
  ).text();
  expect(src).toContain("from '../shell/drop-guard.js'");
  expect(src).toContain('installDropGuard(document)');
  expect(src).not.toContain('isFileDrag');
});

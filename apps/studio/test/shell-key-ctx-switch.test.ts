// gate-b-fix3 — ⌘Z right after clicking a switch (an <input type="checkbox">, e.g. "Lower under speech") undoes the
// edit. The shell counted ANY <input> as typing, so the focused switch made ⌘Z the browser's text-undo and the
// shell's undo never ran; the file kept the <Duck> wrap. A switch/radio/colour well is a button to the keyboard.

import { describe, expect, test } from 'bun:test';

import { type FocusProbe, type ShellKeyState, shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { chord } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

const BASE: ShellKeyState = {
  canvasOpen: true,
  timelineVisible: false,
  presenting: false,
  native: false,
  readOnly: false,
  clipSelected: false,
  artboardSelected: false,
  commentFocused: false,
};
const ctxOf = (probe: FocusProbe) => shellKeyCtx(probe, BASE);

describe('which focused <input> counts as typing', () => {
  test('text-like inputs and textareas do', () => {
    for (const type of ['text', 'search', 'email', 'number', undefined])
      expect(ctxOf({ tag: 'INPUT', type }).focus).toBe('text');
    expect(ctxOf({ tag: 'TEXTAREA' }).focus).toBe('text');
  });

  test('a switch, a radio, a colour well and a file picker do not', () => {
    for (const type of ['checkbox', 'radio', 'color', 'file', 'button', 'submit'])
      expect(ctxOf({ tag: 'INPUT', type }).focus).not.toBe('text');
  });
});

describe('⌘Z with a switch focused is the shell undo', () => {
  const z = chord('⌘Z') as never;
  const SHELL_KEY_INDEX = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);
  test('a focused checkbox resolves edit.undo; a focused text field still does not', () => {
    const onSwitch = resolveChord(SHELL_KEY_INDEX, z, ctxOf({ tag: 'INPUT', type: 'checkbox' }));
    expect(onSwitch?.action.id).toBe('edit.undo');
    const onText = resolveChord(SHELL_KEY_INDEX, z, ctxOf({ tag: 'INPUT', type: 'text' }));
    expect(onText?.action.id).not.toBe('edit.undo');
  });
});

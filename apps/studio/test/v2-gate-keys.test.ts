// V2-4 gate (polish-b) — keys: "?" is the shortcuts sheet, never "/" (design blocker 5); Version history
// is ⌥⌘H and ⇧⌘G no longer opens it (blocker 6, rule 13); the "Single-key shortcuts" switch (a11y B8,
// WCAG 2.1.4) turns every character-key chord off in the shell AND the canvas, ⌘ chords untouched.
import { describe, expect, test } from 'bun:test';

import { type ShellKeyState, shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { MOVED_KEYS } from '../actions/help.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { chordFromEvent, isCharacterChord, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { ALL_CAPS } from '../bridge/canvas-modes.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { keyHint, menuCtx } from '../client/v2/shell/project-menu-model.js';
import { createSingleKeysStore, SINGLE_KEYS_PREF } from '../client/v2/shell/single-keys-store.js';
import { type ClassifyInput, classify } from '../input-router.tsx';
import { validateUiPrefsPatch } from '../ui-prefs.ts';

const SHELL = documentIndex(ACTIONS, 'shell', () => true);
const BASE: ShellKeyState = {
  canvasOpen: true,
  timelineVisible: false,
  presenting: false,
  native: true,
  readOnly: false,
  clipSelected: false,
  artboardSelected: false,
  commentFocused: false,
};
const chrome = (s: Partial<ShellKeyState> = {}) => shellKeyCtx({ tag: 'BODY' }, { ...BASE, ...s });
const shellRun = (e: KeyEventLike, s: Partial<ShellKeyState> = {}) =>
  resolveChord(SHELL, chordFromEvent(e), chrome(s))?.action.id ?? null;

describe('"?" vs "/" (design blocker 5)', () => {
  test('⇧ on the Slash key is "?" even when the event reports "/" (agent-browser Shift+Slash)', () => {
    expect(chordFromEvent({ key: '/', code: 'Slash', shiftKey: true })).toBe('?');
    expect(shellRun({ key: '/', code: 'Slash', shiftKey: true })).toBe('help.shortcuts');
  });
  test('a real US "?" and a plain "/" keep their actions', () => {
    expect(shellRun({ key: '?', code: 'Slash', shiftKey: true })).toBe('help.shortcuts');
    expect(shellRun({ key: '/', code: 'Slash' })).toBe('canvases.search');
  });
  test('a layout that types "/" with ⇧ on another key (Czech ⇧ú) still searches', () => {
    expect(shellRun({ key: '/', code: 'BracketLeft', shiftKey: true })).toBe('canvases.search');
  });
});

describe('Version history ⌥⌘H (design blocker 6, CONTRACT §1–§2)', () => {
  const alt = { key: '˙', code: 'KeyH', metaKey: true, altKey: true };
  test('⌥⌘H opens it; ⇧⌘G no longer does', () => {
    expect(shellRun(alt)).toBe('history.open');
    expect(shellRun({ key: 'G', code: 'KeyG', metaKey: true, shiftKey: true })).not.toBe(
      'history.open'
    );
    expect(ACTIONS_BY_ID.get('history.open')?.keys?.map((b) => b.chord)).toEqual(['⌥⌘H']);
  });
  test('the menu shows ⌥⌘H, and the old key has its "moved" row (rule 13)', () => {
    expect(keyHint(ACTIONS_BY_ID.get('history.open'), menuCtx({ native: true }))).toBe('⌥⌘H');
    expect(MOVED_KEYS.some((m) => m.to === 'history.open' && m.was.includes('⇧⌘G'))).toBe(true);
  });
  test('⌘K / menu keys are the registry chord: New canvas ⌘N (desktop) or none, never "N"', () => {
    expect(keyHint(ACTIONS_BY_ID.get('canvas.new'), menuCtx({ native: true }))).toBe('⌘N');
    expect(keyHint(ACTIONS_BY_ID.get('canvas.new'), menuCtx({ native: false }))).toBe('');
    expect(keyHint(ACTIONS_BY_ID.get('view.design-system'), menuCtx({ native: true }))).toBe('');
    expect(keyHint(ACTIONS_BY_ID.get('view.comments'), menuCtx({ native: true }))).toBe('⇧⌘M');
  });
});

describe('single-key shortcuts off (a11y B8, WCAG 2.1.4)', () => {
  test('a character chord is any key without ⌘ / ⌃ / ⌥; named keys and F-keys are not', () => {
    for (const c of ['V', '/', '?', '⇧0', '⇧I', 'N', '1', ']'])
      expect(`${c} ${isCharacterChord(c)}`).toBe(`${c} true`);
    for (const c of ['⌘K', '⌥⌘P', '⇧⌘E', 'esc', '↵', 'Space', '⌫', '←', '⇧←', 'F1', 'tab'])
      expect(`${c} ${isCharacterChord(c)}`).toBe(`${c} false`);
  });

  test('shell: with the switch off "/" and "?" do nothing; ⌘K and esc still work', () => {
    const off = { singleKeys: false };
    expect(shellRun({ key: '/', code: 'Slash' }, off)).toBe(null);
    expect(shellRun({ key: '?', code: 'Slash', shiftKey: true }, off)).toBe(null);
    expect(shellRun({ key: 'k', code: 'KeyK', metaKey: true }, off)).toBe('search.open');
    expect(shellRun({ key: 'Escape', code: 'Escape' }, off)).toBe(
      shellRun({ key: 'Escape', code: 'Escape' })
    );
    // on (the default) they still fire
    expect(shellRun({ key: '/', code: 'Slash' })).toBe('canvases.search');
  });

  const key = (k0: string, extra: Partial<ClassifyInput> = {}) =>
    classify({
      type: 'keydown',
      key: k0,
      code: /^[a-z]$/.test(k0) ? `Key${k0.toUpperCase()}` : undefined,
      activeTool: 'move',
      mode: 'edit',
      caps: ALL_CAPS,
      ...extra,
    } as ClassifyInput);
  test('canvas: an unmodified tool key does nothing when off; ⌥⌘P still asks for Preview', () => {
    expect(key('h').kind).toBe('tool'); // on: H is Hand
    expect(key('h', { singleKeys: false })).toEqual({ kind: 'no-op' });
    expect(key('v', { singleKeys: false })).toEqual({ kind: 'no-op' });
    expect(key('π', { code: 'KeyP', metaKey: true, altKey: true, singleKeys: false }).kind).toBe(
      'mode-request'
    );
  });

  test('the store: on by default, persists only the change, a late disk read never undoes a click', () => {
    const writes: unknown[] = [];
    const s = createSingleKeysStore({ persist: (p) => writes.push(p) });
    expect(s.get()).toBe(true);
    s.hydrate({ [SINGLE_KEYS_PREF]: false });
    expect(s.get()).toBe(false);
    expect(writes).toEqual([]);
    s.set(true);
    expect(writes).toEqual([{ [SINGLE_KEYS_PREF]: true }]);
    s.hydrate({ [SINGLE_KEYS_PREF]: false });
    expect(s.get()).toBe(true);
  });

  test('prefs.json accepts the boolean and refuses anything else', () => {
    expect(validateUiPrefsPatch({ singleKeyShortcuts: false })).toEqual({
      ok: true,
      patch: { singleKeyShortcuts: false },
    });
    expect(validateUiPrefsPatch({ singleKeyShortcuts: 'no' }).ok).toBe(false);
  });

  test('the bridge declares `key-prefs` (shell → canvas, parent-gated, boolean only)', () => {
    const spec = (DGN_TABLE.s2c as Record<string, { gate: string; parse: (r: object) => unknown }>)[
      'key-prefs'
    ];
    expect(spec.gate).toBe('parent');
    expect(spec.parse({ singleKeys: false, extra: 1 })).toEqual({ singleKeys: false });
    expect(spec.parse({ singleKeys: 'off' })).toBe(null);
  });
});

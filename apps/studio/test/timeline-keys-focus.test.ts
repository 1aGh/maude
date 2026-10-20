// S7.8 (C26) — focus-scoped key resolution for the timeline: a focused text field beats the timeline, the
// timeline beats selection / tools / global. S splits ONLY with the timeline focused; ⌘B splits whenever the
// island is up; I and O set the loop range; ← → step a frame, ⇧ a second; Space is play (tap).
import { describe, expect, test } from 'bun:test';

import { documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { k } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { Fact, Focus } from '../actions/types.ts';
import { findAmbiguities } from '../actions/uniqueness.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

const SHELL = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);
const ctx = (focus: Focus, facts: Fact[] = ['timelineVisible']) => ({
  role: 'owner' as const,
  shell: 'desktop' as const,
  mode: 'edit' as const,
  focus,
  selection: 'artboard' as const,
  facts: new Set<Fact>(facts),
});
const at = (chord: string, c = ctx('timeline')) => resolveChord(SHELL, k(chord), c)?.action.id;

describe('with the timeline focused', () => {
  test('S splits at the playhead (and shows as its key); ⌘B is the same action', () => {
    expect(at('S')).toBe('timeline.split');
    expect(at('⌘B')).toBe('timeline.split');
    const split = ACTIONS.find((a) => a.id === 'timeline.split');
    expect(split?.keys?.[0]?.chord).toBe('S');
  });

  test('I and O set the loop range', () => {
    expect(at('I')).toBe('timeline.loop-in');
    expect(at('O')).toBe('timeline.loop-out');
  });

  test('← → one frame, ⇧← ⇧→ one second: one action, the handler reads the shift', () => {
    expect(at('←')).toBe('timeline.step');
    expect(at('→')).toBe('timeline.step');
    expect(at('⇧←')).toBe('timeline.step');
    expect(at('⇧→')).toBe('timeline.step');
  });

  test('Space plays', () => {
    expect(at('Space')).toBe('timeline.play');
  });
});

describe('outside timeline focus', () => {
  test('S, I and O are not the timeline’s while the shell chrome has focus and no island is up', () => {
    const chrome = ctx('chrome', []);
    // S stays the Section tool (a canvas key the shell replays); I and O are nobody’s
    expect(at('S', chrome)).toBe('tool.section');
    expect(at('I', chrome)).toBe('tool.image'); // C26: the timeline layer is what takes I from the Image tool
    expect(at('O', chrome) ?? '').not.toMatch(/^timeline\./);
  });

  test('a text field swallows all of them', () => {
    const typing = ctx('text');
    for (const c of ['S', 'I', 'O', '←', 'Space', '⌘B']) expect(at(c, typing)).toBeUndefined();
  });

  test('⌘B always splits while the island is up — chrome focus included', () => {
    expect(at('⌘B', ctx('chrome', ['timelineVisible']))).toBe('timeline.split');
    expect(at('⌘B', ctx('chrome', []))).toBeUndefined();
  });

  test('single-key shortcuts off: S I O are not ours, ⌘B still is', () => {
    const off = { ...ctx('timeline'), singleKeys: false };
    expect(at('S', off)).toBeUndefined();
    expect(at('I', off)).toBeUndefined();
    expect(at('⌘B', off)).toBe('timeline.split');
  });
});

describe('the registry stays unambiguous', () => {
  test('no chord has two winners in one layer', () => {
    const own = findAmbiguities(ACTIONS).filter((a) =>
      JSON.stringify(a).match(/timeline\.(split|loop|play|step)/)
    );
    expect(own).toEqual([]);
  });

  test('every new action has a shell handler', () => {
    for (const id of ['timeline.loop-in', 'timeline.loop-out', 'timeline.loop-clear'])
      expect(typeof SHELL_KEY_HANDLERS[id]).toBe('function');
  });
});

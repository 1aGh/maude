// S3.2b (md-keys) — the step keys belong to the `present` scope: → · space go on, ← · ⇧space go back, the
// shell hears them with the controls (no iframe focus needed), and no other mode answers them.
import { describe, expect, test } from 'bun:test';

import { documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { k } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { Fact, Mode } from '../actions/types.ts';
import { findAmbiguities } from '../actions/uniqueness.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

const SHELL = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);
const ctx = (mode: Mode, facts: Fact[] = []) => ({
  role: 'owner' as const,
  shell: 'desktop' as const,
  mode,
  focus: 'chrome' as const,
  selection: 'none' as const,
  facts: new Set<Fact>(facts),
});

describe('present.next / present.prev', () => {
  test('both exist, with a handler in the shell', () => {
    for (const id of ['present.next', 'present.prev']) {
      expect(ACTIONS.some((a) => a.id === id)).toBe(true);
      expect(typeof SHELL_KEY_HANDLERS[id]).toBe('function');
    }
  });

  test('→ and space go on; ← and ⇧space go back — while presenting', () => {
    const at = (chord: string, facts: Fact[] = ['presenting']) =>
      resolveChord(SHELL, k(chord), ctx('present', facts))?.action.id;
    expect(at('→')).toBe('present.next');
    expect(at('Space')).toBe('present.next');
    expect(at('←')).toBe('present.prev');
    expect(at('⇧Space')).toBe('present.prev');
  });

  test('with the Timeline open, space in Present still steps (the timeline is hidden there)', () => {
    // The shell lowers `timelineVisible` while presenting (use-action-keys), so focus stays 'chrome'.
    expect(
      resolveChord(SHELL, k('Space'), ctx('present', ['presenting']))?.action.id.startsWith(
        'present.'
      )
    ).toBe(true);
  });

  test('no other mode answers them', () => {
    for (const mode of ['edit', 'preview', 'viewing'] as const)
      for (const chord of ['→', '←', 'Space', '⇧Space']) {
        const id = resolveChord(SHELL, k(chord), ctx(mode))?.action.id ?? '';
        expect(`${mode} ${chord} ${id.startsWith('present.')}`).toBe(`${mode} ${chord} false`);
      }
  });

  test('typing in a field leaves them alone', () => {
    const typing = { ...ctx('present', ['presenting']), focus: 'text' as const };
    expect(resolveChord(SHELL, k('Space'), typing)).toBeNull();
    expect(resolveChord(SHELL, k('→'), typing)).toBeNull();
  });

  test('the registry stays unambiguous with them in', () => {
    expect(
      findAmbiguities(ACTIONS).map((a) => `${a.chord} ${a.layer}: ${a.ids.join(' | ')}`)
    ).toEqual([]);
  });
});

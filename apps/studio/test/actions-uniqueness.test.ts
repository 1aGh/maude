// V2-2.4 — invariant 1 (V2-1.3 contract §5.11): per layer, at most one live binding per chord and
// press for every context; plus the resolver's C26 semantics the invariant relies on.
import { describe, expect, test } from 'bun:test';

import { ACTIONS } from '../actions/index.ts';
import { k } from '../actions/keys.ts';
import { holds, indexKeys, isEnabled, isVisible, resolveChord } from '../actions/resolve.ts';
import type { ActionDef, Fact, KeyCtx } from '../actions/types.ts';
import { LAYERS } from '../actions/types.ts';
import { findAmbiguities } from '../actions/uniqueness.ts';

const ctx = (o: Partial<Omit<KeyCtx, 'facts'>> & { facts?: Fact[] } = {}): KeyCtx => ({
  role: o.role ?? 'owner',
  shell: o.shell ?? 'browser',
  mode: o.mode ?? 'edit',
  focus: o.focus ?? 'chrome',
  selection: o.selection ?? 'none',
  facts: new Set<Fact>(o.facts ?? []),
});

const act = (id: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  label: id,
  kind: 'command',
  exec: 'shell',
  ...extra,
});

test('LAYERS order is C26 (timeline › selection › tools › global)', () =>
  expect([...LAYERS]).toEqual(['timeline', 'selection', 'tools', 'global']));

test('the registry has no same-layer ambiguity in any context', () => {
  const found = findAmbiguities(ACTIONS);
  const lines = found.map((a) => `${a.chord} ${a.press} @${a.layer}: ${a.ids.join(' | ')}`);
  expect(lines).toEqual([]);
});

describe('the uniqueness check is not vacuous (planted faults)', () => {
  test('two global bindings on one chord with overlapping predicates', () => {
    const planted = [
      act('a.one', { keys: [{ chord: 'T', layer: 'global', when: { focus: ['chrome'] } }] }),
      act('a.two', { keys: [{ chord: 'T', layer: 'global', when: { facts: ['canvasOpen'] } }] }),
    ];
    const found = findAmbiguities(planted);
    expect(found.map((a) => `${a.chord} @${a.layer}: ${a.ids.join(' | ')}`)).toEqual([
      'T @global: a.one | a.two',
    ]);
    expect(found[0].example.focus).toBe('chrome');
    expect(found[0].example.facts.has('canvasOpen')).toBe(true);
  });
  test('disjoint predicates are fine', () => {
    const ok = [
      act('a.one', { keys: [{ chord: 'T', layer: 'global', when: { focus: ['chrome'] } }] }),
      act('a.two', { keys: [{ chord: 'T', layer: 'global', when: { focus: ['canvas'] } }] }),
      act('a.three', { keys: [{ chord: 'T', layer: 'tools', when: { focus: ['chrome'] } }] }),
    ];
    expect(findAmbiguities(ok)).toEqual([]);
  });
  test('a collision behind a fact only one subset turns on is still found', () => {
    const planted = [
      act('a.one', {
        keys: [{ chord: '⌫', layer: 'selection', when: { facts: ['rangeFocused'] } }],
      }),
      act('a.two', {
        visible: { minRole: 'edit' },
        keys: [{ chord: '⌫', layer: 'selection', when: { notFacts: ['selectFocused'] } }],
      }),
    ];
    expect(findAmbiguities(planted).map((a) => a.ids.join(' | '))).toEqual(['a.one | a.two']);
  });
  test('tap and hold never compete', () => {
    const ok = [
      act('a.tap', { keys: [{ chord: 'Space', layer: 'tools' }] }),
      act('a.hold', { keys: [{ chord: 'Space', layer: 'tools', hold: true }] }),
    ];
    expect(findAmbiguities(ok)).toEqual([]);
  });
});

describe('resolveChord — C26 semantics', () => {
  const A: ActionDef[] = [
    act('g.palette', { keys: [{ chord: k('⌘K'), layer: 'global', inText: true }] }),
    act('g.tree', { keys: [{ chord: 'T', layer: 'global' }] }),
    act('t.text', { keys: [{ chord: 'T', layer: 'tools', when: { focus: ['canvas'] } }] }),
    act('tl.undo', { keys: [{ chord: k('⌘Z'), layer: 'timeline' }] }),
    act('g.undo', { keys: [{ chord: k('⌘Z'), layer: 'global' }] }),
    act('s.del', {
      enabled: { facts: ['canUndo'] },
      keys: [{ chord: '⌫', layer: 'selection', when: { selection: ['artboard'] } }],
    }),
    act('g.del', { keys: [{ chord: '⌫', layer: 'global' }] }),
    act('m.esc', { keys: [{ chord: 'esc', layer: 'global', inModal: true }] }),
    act('v.hidden', { visible: { minRole: 'edit' }, keys: [{ chord: 'N', layer: 'global' }] }),
    act('h.hand', { keys: [{ chord: 'Space', layer: 'tools', hold: true }] }),
  ];
  const idx = indexKeys(A);
  const R = (c: string, x: KeyCtx, press: 'tap' | 'hold' = 'tap') =>
    resolveChord(idx, k(c), x, press)?.action.id ?? null;

  test('a focused text field swallows non-opted keys and keeps ⌘K', () => {
    expect(R('T', ctx({ focus: 'text' }))).toBeNull();
    expect(R('⌘Z', ctx({ focus: 'text' }))).toBeNull(); // TEXT_RESERVED: native undo wins
    expect(R('⌘K', ctx({ focus: 'text' }))).toBe('g.palette');
  });
  test('the higher layer wins', () => {
    expect(R('T', ctx({ focus: 'canvas' }))).toBe('t.text');
    expect(R('T', ctx({ focus: 'chrome' }))).toBe('g.tree');
  });
  test('timeline bindings need timeline focus', () => {
    expect(R('⌘Z', ctx({ focus: 'timeline' }))).toBe('tl.undo');
    expect(R('⌘Z', ctx({ focus: 'chrome' }))).toBe('g.undo');
  });
  test('a disabled winner still wins (the caller swallows the key)', () => {
    const r = resolveChord(idx, '⌫', ctx({ selection: 'artboard' }));
    expect(r?.action.id).toBe('s.del');
    expect(r ? isEnabled(r.action, ctx({ selection: 'artboard' })) : null).toBe(false);
  });
  test('modal focus admits only inModal bindings', () => {
    expect(R('T', ctx({ focus: 'modal' }))).toBeNull();
    expect(R('esc', ctx({ focus: 'modal' }))).toBe('m.esc');
  });
  test('visibility gates the binding (rule 12: hidden is not bound either)', () => {
    expect(R('N', ctx({ role: 'comment' }))).toBeNull();
    expect(R('N', ctx({ role: 'edit' }))).toBe('v.hidden');
  });
  test('hold resolves separately from tap', () => {
    expect(R('Space', ctx({ focus: 'canvas' }))).toBeNull();
    expect(R('Space', ctx({ focus: 'canvas' }), 'hold')).toBe('h.hand');
  });
  test('unbound chord → null', () => expect(R('⌘J', ctx())).toBeNull());
});

describe('holds()', () => {
  test('every field is an AND; any is an OR', () => {
    const c = ctx({ role: 'edit', shell: 'desktop', focus: 'canvas', facts: ['native'] });
    expect(holds({ minRole: 'edit', shell: ['desktop'], facts: ['native'] }, c)).toBe(true);
    expect(holds({ minRole: 'owner' }, c)).toBe(false);
    expect(holds({ notShell: ['desktop'] }, c)).toBe(false);
    expect(holds({ notFacts: ['native'] }, c)).toBe(false);
    expect(holds({ any: [{ focus: ['text'] }, { facts: ['native'] }] }, c)).toBe(true);
    expect(holds({ any: [{ focus: ['text'] }, { shell: ['cloud'] }] }, c)).toBe(false);
    expect(isVisible(act('x', { visible: { shell: ['cloud'] } }), c)).toBe(false);
  });
});

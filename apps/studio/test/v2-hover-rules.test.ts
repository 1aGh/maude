// S2.5 — the hover format (S2-hover-format.md): a closed vocabulary, one rule set, an attribute that is design and
// therefore outlives every exporter's strip of the canvas-only namespace.
import { describe, expect, test } from 'bun:test';
import {
  HOVER_ATTR,
  HOVER_PRESETS,
  HOVER_RULES,
  hoverCssForSource,
  hoverLabel,
  hoverOf,
  hoverWrite,
} from '../edit-ops/hover-rules.ts';
import { stripCanvasOnly } from '../element-ids.ts';

describe('vocabulary', () => {
  test('is closed: five presets, in the contract order', () => {
    expect(HOVER_PRESETS).toEqual([
      'lift-resting',
      'lift-floating',
      'lift-sheet',
      'darken',
      'underline',
    ]);
  });

  test('the words are the canvas’s (ed-inspector: "Lift to Floating")', () => {
    expect(HOVER_PRESETS.map(hoverLabel)).toEqual([
      'Lift to Resting',
      'Lift to Floating',
      'Lift to Sheet',
      'Darken',
      'Underline',
    ]);
    expect(hoverLabel(null)).toBe('None');
  });

  test('the attribute is outside the canvas-only namespace (it is design, it must export)', () => {
    expect(HOVER_ATTR).toBe('data-hover');
    expect(HOVER_ATTR.startsWith('data-cd-')).toBe(false);
  });
});

describe('reader and writer', () => {
  test('hoverOf reads the selection payload’s attrs', () => {
    expect(hoverOf({ 'data-hover': 'lift-floating' })).toEqual({
      preset: 'lift-floating',
      known: true,
    });
    expect(hoverOf({})).toEqual({ preset: null, known: true });
    expect(hoverOf(undefined)).toEqual({ preset: null, known: true });
  });

  test('a value outside the vocabulary is kept and reported unknown, never normalised', () => {
    expect(hoverOf({ 'data-hover': 'wiggle' })).toEqual({ preset: 'wiggle', known: false });
  });

  test('hoverWrite is the edit-attr payload; None resets', () => {
    expect(hoverWrite('darken')).toEqual({ attr: 'data-hover', value: 'darken' });
    expect(hoverWrite(null)).toEqual({ attr: 'data-hover', reset: true });
  });

  test('hoverWrite refuses a value outside the vocabulary', () => {
    expect(() => hoverWrite('box-shadow: none')).toThrow();
  });
});

describe('the rule set', () => {
  test('has a :hover rule for every preset and nothing for an unknown value', () => {
    for (const p of HOVER_PRESETS) expect(HOVER_RULES).toContain(`[data-hover="${p}"]:hover`);
    expect(HOVER_RULES).not.toContain('wiggle');
  });

  test('wins over the inline box-shadow Effects writes (important), and respects reduced motion', () => {
    for (const line of HOVER_RULES.split('\n').filter((l) => l.includes(':hover'))) {
      expect(line).toContain('!important');
    }
    expect(HOVER_RULES).toContain('prefers-reduced-motion: reduce');
  });

  test('the lift reads the system’s step with a fallback, and writes no colour literal', () => {
    expect(HOVER_RULES).toContain('var(--shadow-floating,');
    expect(HOVER_RULES).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

const SRC = `export default () => (
  <div data-cd-id="a">
    <button data-cd-id="b" data-cd-link="#pricing" data-hover="lift-floating">Book a call</button>
    <a data-cd-id="c" data-hover="underline">More</a>
    <button data-cd-id="d" data-hover="lift-floating">Again</button>
  </div>
);`;

describe('exports', () => {
  test('data-hover survives stripCanvasOnly while data-cd-* goes', () => {
    const out = stripCanvasOnly(SRC, 'x.tsx');
    expect(out).toContain('data-hover="lift-floating"');
    expect(out).toContain('data-hover="underline"');
    expect(out).not.toContain('data-cd-');
  });

  test('hoverCssForSource writes :hover CSS for the presets a file uses, once each', () => {
    const css = hoverCssForSource(SRC);
    expect(css).toContain('[data-hover="lift-floating"]:hover');
    expect(css).toContain('[data-hover="underline"]:hover');
    expect(css).not.toContain('[data-hover="darken"]:hover');
    expect(css.match(/\[data-hover="lift-floating"\]:hover/g)?.length).toBe(1);
    expect(css).toContain('prefers-reduced-motion');
  });

  test('a source with no hover emits nothing', () => {
    expect(hoverCssForSource('export default () => <div data-cd-id="a" />;')).toBe('');
  });

  test('an unknown value emits no rule', () => {
    expect(hoverCssForSource('<i data-hover="wiggle" />')).toBe('');
  });
});

// V2-3.4 (old T9) — `/_config.profile`: which account profile this server runs as. The env is
// set by the desktop shell per tab; `/_config` reaches the browser (and a cell's members), so
// the id is validated and the label sanitized here.

import { describe, expect, test } from 'bun:test';

import { PROFILE_LABEL_MAX, resolveProfile, sanitizeProfileLabel } from '../shell/profile.ts';

const quiet = () => {};

describe('resolveProfile', () => {
  test('absent env is the default profile, with no label', () => {
    expect(resolveProfile({}, quiet)).toEqual({ id: 'default' });
    expect(resolveProfile({ MAUDE_PROFILE_ID: '' }, quiet)).toEqual({ id: 'default' });
  });

  test('a valid id and label pass through', () => {
    expect(
      resolveProfile({ MAUDE_PROFILE_ID: 'work-2', MAUDE_PROFILE_LABEL: 'Work' }, quiet)
    ).toEqual({ id: 'work-2', label: 'Work' });
    expect(resolveProfile({ MAUDE_PROFILE_ID: 'a'.repeat(32) }, quiet).id).toBe('a'.repeat(32));
  });

  test('an id outside [a-z0-9-]{1,32} becomes default, drops its label, and warns once', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    for (const bad of ['Work', '../x', 'a'.repeat(33), 'a b', 'é', 'a_b']) {
      expect(resolveProfile({ MAUDE_PROFILE_ID: bad, MAUDE_PROFILE_LABEL: 'L' }, warn)).toEqual({
        id: 'default',
      });
    }
    resolveProfile({ MAUDE_PROFILE_ID: 'a_b' }, warn); // the same bad value again: no new warning
    expect(warnings.length).toBe(6);
    // the refused value is never echoed into the log
    expect(warnings.join('\n')).not.toContain('../x');
  });
});

describe('sanitizeProfileLabel', () => {
  test('strips control and bidi-override characters', () => {
    expect(sanitizeProfileLabel('Wo\u0000rk\u001b[31m\u007f')).toBe('Work[31m');
    expect(sanitizeProfileLabel('‮evil‬ ⁦x⁩')).toBe('evil x');
    expect(sanitizeProfileLabel('a\nb\tc')).toBe('abc');
  });

  test('caps at 64 characters (code points, not UTF-16 units)', () => {
    expect(sanitizeProfileLabel('x'.repeat(200))?.length).toBe(PROFILE_LABEL_MAX);
    const emoji = '😀'.repeat(70);
    expect(Array.from(sanitizeProfileLabel(emoji) ?? '').length).toBe(PROFILE_LABEL_MAX);
  });

  test('empty or only-control is no label', () => {
    expect(sanitizeProfileLabel(undefined)).toBeUndefined();
    expect(sanitizeProfileLabel('   ')).toBeUndefined();
    expect(sanitizeProfileLabel('\u0001\u0002')).toBeUndefined();
  });
});

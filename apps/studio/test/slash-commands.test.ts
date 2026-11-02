// Unit tests for the pure command model behind the ACP composer autocomplete +
// inline pill (client/panels/slash-commands.js). No DOM — importable directly.

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildCommandModel,
  filterCommands,
  groupOf,
  matchLeadingCommand,
  normalizeName,
  STATIC_COMMANDS,
} from '../client/panels/slash-commands.js';

describe('normalizeName', () => {
  test('strips a leading slash, lowercases, trims', () => {
    expect(normalizeName('/design:Edit')).toBe('design:edit');
    expect(normalizeName('  FLOW:Plan  ')).toBe('flow:plan');
    expect(normalizeName('design:edit')).toBe('design:edit');
  });
  test('is empty-safe', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null as unknown as string)).toBe('');
    expect(normalizeName(undefined as unknown as string)).toBe('');
  });
});

describe('groupOf', () => {
  test('extracts the plugin prefix', () => {
    expect(groupOf('design:edit')).toBe('design');
    expect(groupOf('flow:bug-fix')).toBe('flow');
    expect(groupOf('bare')).toBe('other');
  });
});

describe('matchLeadingCommand', () => {
  test('typing mode: leading slash token with no space', () => {
    expect(matchLeadingCommand('/')).toEqual({ token: '', full: null, typing: true });
    expect(matchLeadingCommand('/desi')).toEqual({ token: 'desi', full: null, typing: true });
    expect(matchLeadingCommand('/design:edit')).toEqual({
      token: 'design:edit',
      full: null,
      typing: true,
    });
    // Leading whitespace is tolerated (trimmed).
    expect(matchLeadingCommand('  /design')).toEqual({
      token: 'design',
      full: null,
      typing: true,
    });
  });
  test('highlight mode: command followed by a space', () => {
    expect(matchLeadingCommand('/design:edit make it bolder')).toEqual({
      token: 'design:edit',
      full: '/design:edit',
      typing: false,
    });
    expect(matchLeadingCommand('/flow:quick ')).toEqual({
      token: 'flow:quick',
      full: '/flow:quick',
      typing: false,
    });
  });
  test('non-command text returns null', () => {
    expect(matchLeadingCommand('make the button bigger')).toBeNull();
    expect(matchLeadingCommand('email me at a/b')).toBeNull(); // mid-string slash is not a command
    expect(matchLeadingCommand('')).toBeNull();
  });
});

describe('buildCommandModel', () => {
  test('cold (no live list) → static keys are the optimistic exists-set', () => {
    const { all, existsSet } = buildCommandModel(STATIC_COMMANDS, []);
    expect(all.length).toBe(STATIC_COMMANDS.length);
    expect(existsSet.has('design:edit')).toBe(true);
    expect(existsSet.has('design:new')).toBe(true);
    // every static command is present + flagged not-live
    expect(all.every((c) => c.live === false)).toBe(true);
  });

  test('warm (live list) → live names are the strict authority, and demote unknowns', () => {
    const live = [
      { name: 'design:edit', description: 'live desc' },
      { name: '/design:new', description: '' }, // slash + separator variance tolerated
      { name: 'user:custom', description: 'a user command' },
    ];
    const { all, existsSet } = buildCommandModel(STATIC_COMMANDS, live);
    // exists-set is strictly the live set
    expect(existsSet.has('design:edit')).toBe(true);
    expect(existsSet.has('design:new')).toBe(true);
    expect(existsSet.has('user:custom')).toBe(true);
    // a shipped static command NOT in the live set is no longer "exists"
    expect(existsSet.has('design:critic')).toBe(false);
    // live-only command is added to the union
    expect(all.find((c) => c.name === 'user:custom')?.live).toBe(true);
    // static command present in live is marked live
    expect(all.find((c) => c.name === 'design:edit')?.live).toBe(true);
  });
});

describe('filterCommands', () => {
  test('empty token returns the capped list', () => {
    const { all } = buildCommandModel(STATIC_COMMANDS, []);
    expect(filterCommands(all, '', 5).length).toBe(5);
  });
  test('prefix matches rank before substring matches', () => {
    const { all } = buildCommandModel(STATIC_COMMANDS, []);
    const res = filterCommands(all, 'design:', 20);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((c) => c.name.startsWith('design:'))).toBe(true);
  });
  test('matches on description substring too', () => {
    const { all } = buildCommandModel(STATIC_COMMANDS, []);
    const res = filterCommands(all, 'critic', 20);
    expect(res.some((c) => c.name === 'design:critic')).toBe(true);
  });
});

// S12.2 — the list is generated from plugins/design/commands/*.md; a command added there shows
// up in the AI chat panel's autocomplete without a hand edit.
describe('STATIC_COMMANDS covers every design command', () => {
  const dir = join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'commands');
  const verbs = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));

  test('there are design commands to cover', () => {
    expect(verbs.length).toBeGreaterThanOrEqual(24);
  });
  test('every commands/*.md has a design:<verb> entry', () => {
    const have = new Set(STATIC_COMMANDS.map((c) => c.name));
    const missing = verbs.filter((v) => !have.has(`design:${v}`));
    expect(missing).toEqual([]);
  });
  test('and nothing else is listed', () => {
    const want = new Set(verbs.map((v) => `design:${v}`));
    expect(STATIC_COMMANDS.filter((c) => !want.has(c.name)).map((c) => c.name)).toEqual([]);
  });
});

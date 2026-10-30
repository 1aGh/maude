// S6.3 — the skill text that briefs the agent on a first draft names the order the canvases promise
// (02 ob-sig-draw: colour, picture, words; every artboard exists in the first second).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'skills', 'design', 'SKILL.md'),
  'utf8'
);
const section = (() => {
  const at = SKILL.indexOf('## A first draft from Home');
  if (at < 0) return '';
  const rest = SKILL.slice(at + 3);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
})();

describe('S6.3 SKILL.md § A first draft from Home', () => {
  test('the section exists', () => {
    expect(section.length).toBeGreaterThan(200);
  });

  test('it names the order: every artboard empty with kind and size, then big before small, words last', () => {
    const lower = section.toLowerCase();
    const a = lower.indexOf('every artboard empty');
    const b = lower.indexOf('big before small');
    const c = lower.indexOf('words last');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(lower).toContain('kind');
    expect(lower).toContain('size');
  });

  test('it keeps the element ids and names the undo', () => {
    expect(section).toContain('data-cd-id');
    expect(section).toContain('⌘Z');
  });
});

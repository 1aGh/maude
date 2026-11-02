// P5 (R14) — a version made by Maude's own process is credited to "Maude", not to "MM · maude-migration".
import { describe, expect, test } from 'bun:test';
import { actorWords } from '../client/v2/history/rows.ts';

describe('who a version is credited to', () => {
  test('internal process names read as Maude', () => {
    for (const n of ['maude-migration', 'maude-migrate', 'Maude Migration', 'maude-format-bot'])
      expect(actorWords(n), n).toBe('Maude');
  });
  test('people keep their names; nothing becomes Someone only when it is empty', () => {
    expect(actorWords('Tereza Nováková')).toBe('Tereza Nováková');
    expect(actorWords('maudette')).toBe('maudette');
    expect(actorWords(undefined)).toBe('Someone');
    expect(actorWords('  ')).toBe('Someone');
  });
});

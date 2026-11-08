// generateSpend in prefs.json — the per-Mac spend limits for paid media generation: bounded on write,
// merged key by key (one limit changed leaves the others), kept through a rewrite.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readSpendSettings } from '../generation/spend.ts';
import { readUiPrefs, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';

let dir: string;
let saved: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-prefs-spend-'));
  saved = process.env.MAUDE_UI_PREFS_PATH;
  process.env.MAUDE_UI_PREFS_PATH = join(dir, 'prefs.json');
});
afterEach(() => {
  if (saved === undefined) delete process.env.MAUDE_UI_PREFS_PATH;
  else process.env.MAUDE_UI_PREFS_PATH = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe('prefs generateSpend', () => {
  test('a patch inside the bounds is accepted, outside it is refused', () => {
    const good = validateUiPrefsPatch({ generateSpend: { perRun: 5, perDay: 20, confirmOver: 2 } });
    expect(good.ok && good.patch.generateSpend).toEqual({ perRun: 5, perDay: 20, confirmOver: 2 });
    for (const bad of [
      { perRun: 101 },
      { perRun: 0 },
      { perDay: 501 },
      { confirmOver: 51 },
      { confirmOver: -0.5 },
      { perRun: '5' },
      { perRun: null },
      { extra: 1 },
    ]) {
      const r = validateUiPrefsPatch({ generateSpend: bad });
      expect(r.ok).toBe(false);
    }
    expect(validateUiPrefsPatch({ generateSpend: 5 }).ok).toBe(false);
  });

  test('one limit changed leaves the others; a rewrite keeps them', () => {
    writeUiPrefs({ generateSpend: { perRun: 4 } });
    writeUiPrefs({ generateSpend: { perDay: 30 } });
    writeUiPrefs({ theme: 'light' });
    expect(readUiPrefs().generateSpend).toEqual({ perRun: 4, perDay: 30 });
    expect(readSpendSettings(readUiPrefs().generateSpend)).toEqual({
      perRun: 4,
      perDay: 30,
      confirmOver: 1,
    });
    expect(JSON.parse(readFileSync(join(dir, 'prefs.json'), 'utf8')).generateSpend).toEqual({
      perRun: 4,
      perDay: 30,
    });
  });
});

// S11.19 (06 · ad-why): there is NO sticky "Advanced mode". Advanced is a fold inside each panel, remembered
// per panel (client/v2/fold), plus one-shot "Open all" / "Close all". So no registry id, label or alias, no
// Settings row or section, no fold id, and no per-Mac pref may be called "advanced mode" (or advancedMode,
// advanced-mode, advanced_mode).
//
// The pattern is the brief's /advanced.?mode/i with one guard: "mode" must end the word. Without it the
// S5.12 row `chat.advanced.model` (the chat's Model line, not a mode) would be a false alarm.
import { describe, expect, test } from 'bun:test';

import { ACTIONS } from '../actions/index.ts';
import { FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { ACTION_KEYWORDS } from '../client/v2/search/search-keywords.js';
import { ADVANCED_PREF_DEFAULTS } from '../client/v2/settings/advanced-prefs.js';
import { SECTIONS, SETTINGS_ROWS } from '../client/v2/settings/settings-model.js';
import { UI_PREFS_DEFAULTS } from '../ui-prefs.ts';

const ADVANCED_MODE = /advanced.?mode(?![a-z])/i;
const hits = (strings: Array<[string, unknown]>) =>
  strings
    .filter(([, s]) => typeof s === 'string' && ADVANCED_MODE.test(s))
    .map(([w, s]) => `${w}: ${s}`);

describe('the pattern', () => {
  test('catches every spelling of the switch the canvas rules out', () => {
    for (const s of [
      'Advanced mode',
      'advanced-mode',
      'advancedMode',
      'advanced_mode',
      'view.advanced.mode',
    ])
      expect(ADVANCED_MODE.test(s)).toBe(true);
  });
  test('lets the AI chat Model line through (a model, not a mode)', () => {
    for (const s of ['chat.advanced.model', 'Advanced model', 'advanced-model.js'])
      expect(ADVANCED_MODE.test(s)).toBe(false);
  });
});

describe('06 ad-why: Advanced is a fold per panel, not a mode', () => {
  test('no registry id, label or alias matches', () => {
    const all: Array<[string, unknown]> = [];
    for (const a of ACTIONS) {
      all.push([`action ${a.id} id`, a.id], [`action ${a.id} label`, a.label]);
      for (const alias of a.aliases ?? []) all.push([`action ${a.id} alias`, alias]);
    }
    expect(all.length).toBeGreaterThan(500);
    expect(hits(all)).toEqual([]);
  });

  test('no Settings row, section or pref matches', () => {
    const all: Array<[string, unknown]> = [];
    for (const r of SETTINGS_ROWS) {
      for (const [k, v] of Object.entries(r)) all.push([`settings row ${r.testid}.${k}`, v]);
    }
    for (const s of SECTIONS)
      all.push([`section ${s.id}`, s.id], [`section ${s.id} label`, s.label]);
    for (const k of Object.keys(ADVANCED_PREF_DEFAULTS)) all.push(['advanced pref', k]);
    for (const k of Object.keys(UI_PREFS_DEFAULTS)) all.push(['ui pref', k]);
    expect(SETTINGS_ROWS.length).toBeGreaterThan(20);
    expect(hits(all)).toEqual([]);
  });

  test('no fold id matches, and the folds are per panel (more than one)', () => {
    expect(FOLD_PANELS.length).toBeGreaterThan(5);
    expect(hits(FOLD_PANELS.map((id: string) => ['fold', id]))).toEqual([]);
  });

  test('the only "advanced mode" words left are ⌘K search aliases, and they lead to the one-shot', () => {
    const aliased = Object.entries(ACTION_KEYWORDS as Record<string, string[]>).filter(
      ([, words]) => words.some((w) => ADVANCED_MODE.test(w))
    );
    for (const [id] of aliased) {
      expect(id).toBe('view.advanced-open-all');
      expect(ACTIONS.find((a) => a.id === id)?.kind).toBe('command');
    }
  });

  test('Open all and Close all are commands, not a switch', () => {
    for (const id of ['view.advanced-open-all', 'view.advanced-close-all']) {
      const a = ACTIONS.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a?.kind).toBe('command');
    }
  });
});

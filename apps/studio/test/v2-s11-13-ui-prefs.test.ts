// S11.13 — the three Advanced prefs go through the same whitelist as every other prefs.json field:
// exact shape in, anything else refused with a message, nothing dropped silently.
import { describe, expect, test } from 'bun:test';

import { validateUiPrefsPatch } from '../ui-prefs.ts';

describe('/_api/ui-prefs accepts the Advanced prefs', () => {
  test('ownPluginCopy and experimentalTeams are booleans', () => {
    expect(validateUiPrefsPatch({ ownPluginCopy: true, experimentalTeams: false })).toEqual({
      ok: true,
      patch: { ownPluginCopy: true, experimentalTeams: false },
    });
    for (const k of ['ownPluginCopy', 'experimentalTeams']) {
      for (const bad of ['yes', 1, null, {}]) {
        const r = validateUiPrefsPatch({ [k]: bad });
        expect(r.ok, `${k}=${String(bad)}`).toBe(false);
        if (!r.ok) expect(r.error).toBe(`${k} must be a boolean`);
      }
    }
  });

  test('reportLogs is ask | always | never', () => {
    for (const v of ['ask', 'always', 'never'])
      expect(validateUiPrefsPatch({ reportLogs: v })).toEqual({
        ok: true,
        patch: { reportLogs: v },
      });
    const r = validateUiPrefsPatch({ reportLogs: 'sometimes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('reportLogs must be ask|always|never');
  });
});

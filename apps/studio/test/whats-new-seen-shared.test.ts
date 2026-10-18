// S6.6 / Q11 — What's New "seen" lives in ui-prefs (one per Mac), so Home and every project tab
// agree. localStorage was per port origin: each tab had its own marker. The old key is migrated
// once (fill-if-absent), a first-ever run still acknowledges silently, and the stored mark only
// moves forward, so a stale tab cannot bring back what Home already showed.

import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSeen, SEEN_PREF } from '../client/whats-new-seen.js';
import { readUiPrefs, validateUiPrefsPatch, writeUiPrefs } from '../ui-prefs.ts';
import { homeFetch, homeReq } from './_home-fixtures.ts';

beforeEach(() => {
  process.env.MAUDE_UI_PREFS_PATH = join(
    mkdtempSync(join(tmpdir(), 'maude-wn-seen-')),
    'prefs.json'
  );
});

describe('resolveSeen (the client rule both surfaces use)', () => {
  test('the stored mark wins and nothing is written', () => {
    expect(resolveSeen({ stored: '2.0.0', legacy: '1.9.0', current: '2.1.0' })).toEqual({
      seen: '2.0.0',
      write: null,
    });
  });
  test('no stored mark: the old per-origin key is migrated once', () => {
    expect(resolveSeen({ stored: undefined, legacy: '1.9.0', current: '2.1.0' })).toEqual({
      seen: '1.9.0',
      write: '1.9.0',
    });
  });
  test('neither: a first-ever run acknowledges the current version silently', () => {
    expect(resolveSeen({ stored: null, legacy: null, current: '2.1.0' })).toEqual({
      seen: '2.1.0',
      write: '2.1.0',
    });
  });
  test('junk in either place is not a mark', () => {
    expect(resolveSeen({ stored: 'x', legacy: '{"a":1}', current: '2.1.0' })).toEqual({
      seen: '2.1.0',
      write: '2.1.0',
    });
  });
  test('the pref key is whatsNewSeen', () => {
    expect(SEEN_PREF).toBe('whatsNewSeen');
  });
});

describe('ui-prefs carries the mark', () => {
  test('the /_api/ui-prefs whitelist accepts a version and refuses anything else', () => {
    expect(validateUiPrefsPatch({ whatsNewSeen: '1.9.1' })).toEqual({
      ok: true,
      patch: { whatsNewSeen: '1.9.1' },
    });
    expect(validateUiPrefsPatch({ whatsNewSeen: '2.0.0-rc.3' }).ok).toBe(true);
    for (const bad of ['', 'dev', 7, null, '1.2', `1.2.3-${'x'.repeat(80)}`, '1.2.3\n'])
      expect([bad, validateUiPrefsPatch({ whatsNewSeen: bad }).ok]).toEqual([bad, false]);
  });

  test('the mark only moves forward', () => {
    writeUiPrefs({ whatsNewSeen: '2.0.0' });
    writeUiPrefs({ whatsNewSeen: '1.9.0' });
    expect(readUiPrefs().whatsNewSeen).toBe('2.0.0');
    writeUiPrefs({ whatsNewSeen: '2.0.1' });
    expect(readUiPrefs().whatsNewSeen).toBe('2.0.1');
  });

  test('a write of another field keeps the mark (the lossless prefs file)', () => {
    writeUiPrefs({ whatsNewSeen: '2.0.0' });
    writeUiPrefs({ theme: 'light' });
    expect(readUiPrefs().whatsNewSeen).toBe('2.0.0');
  });
});

describe('Home and a project tab share one seen version', () => {
  test('what a tab stores, Home reads; what Home acknowledges, a tab reads', async () => {
    const f = homeFetch();
    // a project tab migrates its old key through /_api/ui-prefs (same writer the route uses)
    writeUiPrefs({ whatsNewSeen: '1.9.0' });
    const g = await f(homeReq('/_home/whats-new'));
    expect(g.status).toBe(200);
    const body = (await g.json()) as { seen: string; version: string; entries: unknown[] };
    expect(body.seen).toBe('1.9.0');
    expect(typeof body.version).toBe('string');
    expect(Array.isArray(body.entries)).toBe(true);

    // Home marks everything seen
    const p = await f(
      homeReq('/_home/whats-new', { method: 'POST', body: JSON.stringify({ seen: '2.0.0' }) })
    );
    expect(p.status).toBe(200);
    expect(await p.json()).toEqual({ ok: true, seen: '2.0.0' });
    // …and the tab's GET /_api/ui-prefs (readUiPrefs) answers the same
    expect(readUiPrefs().whatsNewSeen).toBe('2.0.0');
    expect(
      JSON.parse(readFileSync(process.env.MAUDE_UI_PREFS_PATH as string, 'utf8')).whatsNewSeen
    ).toBe('2.0.0');

    // a stale tab cannot take it back
    writeUiPrefs({ whatsNewSeen: '1.9.0' });
    expect(((await (await f(homeReq('/_home/whats-new'))).json()) as { seen: string }).seen).toBe(
      '2.0.0'
    );
  });

  test('no mark stored yet → Home answers seen: null (it never invents one)', async () => {
    const r = await homeFetch()(homeReq('/_home/whats-new'));
    expect(((await r.json()) as { seen: unknown }).seen).toBeNull();
  });

  test('a bad seen value is refused', async () => {
    const f = homeFetch();
    for (const seen of ['dev', 1, null, 'x'.repeat(100)]) {
      const r = await f(
        homeReq('/_home/whats-new', { method: 'POST', body: JSON.stringify({ seen }) })
      );
      expect([seen, r.status]).toEqual([seen, 400]);
    }
    expect(readUiPrefs().whatsNewSeen).toBeUndefined();
  });
});

// P8 C8 (misc: 01 create flow, 04 modes, 05 empty states) — pure pins for the round-8 fixes.
import { describe, expect, test } from 'bun:test';
import { deriveSuggestions } from '../client/v2/ai/suggest-why.js';

describe('01 cf-render-error — the AI repair is a chip in the AI panel', () => {
  test('a broken canvas offers one chip, "Ask AI to fix it", carrying the composer text', () => {
    const s = deriveSuggestions({ repair: "Pricing can't be drawn right now. Fix it." });
    expect(s?.context).toBe('repair');
    expect(s?.chips.map((c) => c.label)).toEqual(['Ask AI to fix it']);
    expect(s?.chips[0]?.prompt).toBe("Pricing can't be drawn right now. Fix it.");
  });
  test('it wins over the other contexts and over the Suggestions switch (it is the card other half)', () => {
    const s = deriveSuggestions({ enabled: false, openComments: 3, repair: 'Fix it.' });
    expect(s?.context).toBe('repair');
  });
  test('no repair: nothing changes', () => {
    expect(deriveSuggestions({ repair: null })).toBeNull();
    expect(deriveSuggestions({ openComments: 2 })?.context).toBe('comments');
  });
});

// ── 05 es-home-local — the first-run card is for the first launch only (per-Mac flag in Home's own state) ──
import { createHomeFetch } from '../home/routes.ts';
import { freshIndexDir, homeDeps, homeReq } from './_home-fixtures.ts';

describe('05 es-home-local — /_home/first-run', () => {
  test('false on a fresh Mac, true once marked, and the recent searches survive the write', async () => {
    freshIndexDir();
    const deps = homeDeps();
    const f = createHomeFetch(deps);
    const get = async () => (await f(homeReq('/_home/first-run'))).json();
    expect(await get()).toEqual({ seen: false });
    const saved = await f(
      homeReq('/_home/recent-searches', {
        method: 'POST',
        body: JSON.stringify({ q: 'plakat', results: 2 }),
      })
    );
    expect(saved.status).toBe(200);
    const r = await f(homeReq('/_home/first-run', { method: 'POST', body: '{}' }));
    expect(r.status).toBe(200);
    expect(await get()).toEqual({ seen: true });
    const again = (await (await f(homeReq('/_home/recent-searches'))).json()) as {
      recentSearches: Array<{ q: string }>;
    };
    expect(again.recentSearches.map((x) => x.q)).toEqual(['plakat']);
    // a later recent-search write keeps the flag
    await f(
      homeReq('/_home/recent-searches', { method: 'POST', body: JSON.stringify({ q: 'cenik' }) })
    );
    expect(await get()).toEqual({ seen: true });
  });
});

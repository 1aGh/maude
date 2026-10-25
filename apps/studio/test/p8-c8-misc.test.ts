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

// ── 04 md-draw — the AI chat opened in Preview's fold shows alone (Canvases stay folded) ──
import { panelOpenDecision } from '../client/v2/shell/panel-layout.js';

describe('04 md-draw — panelOpenDecision aiInFold', () => {
  const none = { l: null, r: null, ai: false };
  const dec = (a: Parameters<typeof panelOpenDecision>[0]) => panelOpenDecision(a);
  test('the chat opened DURING the fold shows by itself and does not unfold the rest', () => {
    const d = dec({ prev: none, next: { ...none, ai: true }, userHidden: false, folded: true });
    expect(d.aiInFold).toBe(true);
    expect(d.show).toBe(false);
  });
  test('a chat carried in from Edit stays folded; it is kept while open and ends with the fold or the chat', () => {
    const open = { ...none, ai: true };
    expect(dec({ prev: open, next: open, userHidden: false, folded: true }).aiInFold).toBe(false);
    expect(
      dec({ prev: open, next: open, userHidden: false, folded: true, aiInFold: true }).aiInFold
    ).toBe(true);
    expect(
      dec({ prev: open, next: none, userHidden: false, folded: true, aiInFold: true }).aiInFold
    ).toBe(false);
    expect(
      dec({ prev: open, next: open, userHidden: false, folded: false, aiInFold: true }).aiInFold
    ).toBe(false);
    expect(
      dec({ prev: none, next: open, userHidden: true, folded: false, aiInFold: true }).aiInFold
    ).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('04 md-draw — the spark does not unfold both panels', () => {
  const corner = readFileSync(
    join(import.meta.dir, '../client/v2/shell/corner-icons.jsx'),
    'utf8'
  );
  test('under Preview fold alone the AI corner icon does not call onShow', () => {
    expect(corner).toContain('if (hidden && !folded) onShow();');
  });
});

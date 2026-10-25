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

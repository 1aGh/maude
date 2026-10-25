// P8 stage C round 8 (p8-c8-ai) — 03 ai-question: after an answer that changed nothing the strip offers the way
// on from the answer (make the change · check the others), not "Same on the other artboards / Try a variation".
import { describe, expect, test } from 'bun:test';
import { deriveSuggestions } from '../client/v2/ai/suggest-why.js';
import { isAnswered, setAnswered } from '../client/v2/ai/result-shown.js';

describe('an answered question', () => {
  const ask = { lastAsk: { text: 'Is the A4 poster readable from three metres?' } };
  test('the strip follows the answer: the change, then the check; no "why" line', () => {
    const s = deriveSuggestions({ ...ask, answered: true });
    expect(s?.context).toBe('answered');
    expect(s?.chips.map((c: { label: string }) => c.label)).toEqual([
      'Make that change',
      'Check the other artboards too',
    ]);
    expect(s?.why).toBe('');
  });
  test('a change keeps the last-ask strip; the other contexts still win', () => {
    expect(deriveSuggestions(ask)?.context).toBe('last-ask');
    expect(deriveSuggestions({ ...ask, answered: true, openComments: 2 })?.context).toBe(
      'comments'
    );
  });
  test('a failed ask is not an answer', () => {
    expect(deriveSuggestions({ ...ask, answered: true, lastFailed: true })).toBeNull();
  });
  test('the flag is per chat', () => {
    setAnswered('c1', true);
    expect(isAnswered('c1')).toBe(true);
    expect(isAnswered('c2')).toBe(false);
    setAnswered('c1', false);
    expect(isAnswered('c1')).toBe(false);
  });
});

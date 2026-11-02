// V2-8.5 c7 (01 cf-ai-drafting) — a run that holds a page, its heading, its text and its button prints ONE tag per
// artboard, not four piled over the words being written. The holds themselves (outlines, server refusal) stay.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type AiHoldRow, aiHoldKey, aiHoldTagCarriers } from '../editing/hold-rings.tsx';

const hold = (artboard: string, element: string, occurrence = 0): AiHoldRow => ({
  artboard,
  element,
  occurrence,
  tag: 'AI is working',
  mine: true,
});

describe('aiHoldTagCarriers', () => {
  test('the first hold of an artboard carries the tag, the rest are outline only', () => {
    const holds = [hold('desktop', 'page'), hold('desktop', 'h1'), hold('desktop', 'cta')];
    expect([...aiHoldTagCarriers(holds)]).toEqual([aiHoldKey(holds[0] as AiHoldRow)]);
  });

  test('each artboard has its own tag', () => {
    const holds = [hold('desktop', 'page'), hold('tablet', 'page'), hold('desktop', 'h1')];
    const tagged = aiHoldTagCarriers(holds);
    expect(tagged.size).toBe(2);
    expect(tagged.has(aiHoldKey(holds[1] as AiHoldRow))).toBe(true);
    expect(tagged.has(aiHoldKey(holds[2] as AiHoldRow))).toBe(false);
  });

  test('a single hold keeps its tag (14 ed-edge-ai: "AI is drawing the footer")', () => {
    expect(aiHoldTagCarriers([hold('post', 'footer')]).size).toBe(1);
  });
});

describe('the layer', () => {
  test('a quiet hold hides its tag and keeps its outline', () => {
    const src = readFileSync(new URL('../editing/hold-rings.tsx', import.meta.url), 'utf8');
    expect(src).toContain('ed-ai-hold--quiet');
    expect(src).toContain('.ed-ai-hold--quiet .ed-hold-tag { display: none; }');
  });
});

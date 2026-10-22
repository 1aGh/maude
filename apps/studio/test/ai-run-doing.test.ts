// P8-C6 (03 `ai-working`): the working line says what AI is DOING ("AI is making it greener"), not "AI is working".
// `RunRecord.doing` existed since V2-1.15 and nothing ever set it. It is derived from the person's own ask (their
// first verb), studio-local: `publicRun` never carries it, and the canvas ring tag stays the fixed phrase.

import { describe, expect, test } from 'bun:test';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { publicRun } from '../ai/run-lifecycle.ts';
import { doingOf } from '../ai/run-doing.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { workingText } from '../client/v2/ai/run-model.js';

describe('doingOf — the present-tense line from the ask', () => {
  test.each([
    ['Make it greener', 'making it greener'],
    ['make the background greener.', 'making the background greener'],
    ['Please translate the poster to English', 'translating the poster to English'],
    ['Can you resize Post to 1080 x 1350?', 'resizing Post to 1080 x 1350'],
    [
      'Replace the photos on the team artboards\nand keep the logo',
      'replacing the photos on the team artboards',
    ],
    ['Make it greener. Then the badge.', 'making it greener'],
  ])('%j → %j', (ask, doing) => {
    expect(doingOf(ask)).toBe(doing);
  });

  test.each([
    ['Tell me about the greens'],
    ['What is on the story?'],
    ['Udělej to zelenější'],
    ['   '],
    [''],
  ])('%j says nothing (the line stays "AI is working")', (ask) => {
    expect(doingOf(ask)).toBe('');
  });

  test('long asks are cut at a word, never mid-word', () => {
    const d = doingOf(
      `Make ${'the headline and the date line and the badge and the button '.repeat(5)}greener`
    );
    expect(d.length).toBeLessThanOrEqual(60);
    expect(d.startsWith('making the headline')).toBe(true);
    expect(d.endsWith('…')).toBe(true);
    expect(d).not.toMatch(/\s…$/);
  });
});

describe('the registry carries it on your run, never on the public one', () => {
  test('ask → doing on the view; the line reads "AI is making it greener"', async () => {
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
      turns: { send: () => {} },
    });
    const run = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Make it greener',
      prompt: 'Make it greener',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    const mine = reg.view().mine.find((r) => r.runId === run.runId);
    expect(mine?.doing).toBe('making it greener');
    expect(workingText(mine)).toBe('AI is making it greener');
    expect(publicRun(reg.get(run.runId) as never)).not.toHaveProperty('doing');
    expect(JSON.stringify(publicRun(reg.get(run.runId) as never))).not.toContain('making');
  });

  test('a hook run with only a label (no prompt) still gets a line from the label', async () => {
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
      turns: { send: () => {} },
    });
    const run = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      label: 'Translate it to English',
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
    expect(reg.get(run.runId)?.doing).toBe('translating it to English');
  });
});

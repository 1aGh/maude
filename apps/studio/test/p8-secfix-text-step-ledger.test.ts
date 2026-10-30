// p8-secfix-studio item 3 (V2-8.9 final delta D6): the ⌘Z text-step ledger keeps
// the full text of every slot a step changed. Capped only by step count (500), a
// board can be 4 MiB, so the worst case was ~2 GiB held in memory. The ledger is
// now capped by total bytes too; the oldest steps go first, and an evicted step
// falls back to the kernel's rule exactly like one past the step-count cap.

import { describe, expect, test } from 'bun:test';

import {
  createTextStepLedger,
  MAX_TEXT_STEP_BYTES,
  MAX_TEXT_STEPS,
  type TextStep,
} from '../annotations/text-steps.ts';

const step = (text: string, contested: string[] = []): TextStep => ({
  slug: 'b',
  slots: new Map([['k', text]]),
  contested,
});

describe('text-step ledger — capped by bytes as well as steps', () => {
  test('the default byte cap evicts the oldest board-sized steps', () => {
    const ledger = createTextStepLedger();
    const big = 4 * 1024 * 1024; // one board's worth of text in a slot
    const n = Math.ceil(MAX_TEXT_STEP_BYTES / big) + 4;
    expect(n).toBeLessThan(MAX_TEXT_STEPS); // the step-count cap alone keeps them all
    for (let i = 0; i < n; i++) ledger.note(`a${i}`, step(String(i % 10).repeat(big)));
    expect(ledger.get('a0')).toBeUndefined();
    expect(ledger.get(`a${n - 1}`)).toBeDefined();
    expect(ledger.bytes()).toBeLessThanOrEqual(MAX_TEXT_STEP_BYTES);
  });

  test('a small byte cap evicts in age order; re-noting a step moves it to the newest', () => {
    const ledger = createTextStepLedger(MAX_TEXT_STEPS, 300);
    ledger.note('a', step('x'.repeat(50)));
    ledger.note('b', step('y'.repeat(50)));
    ledger.note('a', step('z'.repeat(50))); // a is now newest, b oldest
    ledger.note('c', step('w'.repeat(50)));
    expect(ledger.get('b')).toBeUndefined();
    expect(ledger.get('a')?.slots.get('k')).toBe('z'.repeat(50));
    expect(ledger.get('c')).toBeDefined();
  });

  test('a single step over the cap is still kept as the newest (bounded by one board)', () => {
    const ledger = createTextStepLedger(MAX_TEXT_STEPS, 100);
    ledger.note('old', step('o'));
    ledger.note('huge', step('h'.repeat(500)));
    expect(ledger.get('old')).toBeUndefined();
    expect(ledger.get('huge')).toBeDefined();
  });

  test('an evicted step answers no conflict — the kernel keeps its rule', () => {
    const ledger = createTextStepLedger(MAX_TEXT_STEPS, 100);
    ledger.note('a', step('mine', ['k']));
    ledger.note('b', step('n'.repeat(200)));
    expect(ledger.conflict(['a'], () => new Map([['k', 'theirs']]))).toBe(false);
  });
});

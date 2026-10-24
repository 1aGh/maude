// P8 bug sweep B2 — "the AI Connect sheet clips its text mid-line and crops the composer". Three CSS
// causes, measured in the 460 px AI island (Chromium 1600×1000): the sheet's bare <p>s carried the
// browser's 16/12/11 px margins (~78 px), the slot was `flex: none` capped at 60% so it pushed the
// composer (`flex` unset, 226 px with the quick-reply chips) past the island's edge, and Connect /
// Cancel scrolled out of the slot. A layout is not unit-testable without a browser; this pins the rules
// the live check (Playwright, island 524–984, Connect inside the slot, composer inside the island) rests on.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = (rel: string) => readFileSync(join(import.meta.dir, '..', 'client', rel), 'utf8');
/** The declaration block of the first rule whose selector list contains `sel` exactly. */
const rule = (src: string, sel: string): string => {
  const re = new RegExp(
    `(?:^|[\\n,}])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:,[^{]*)?\\{([^}]*)\\}`
  );
  const m = re.exec(src);
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1] ?? '';
};

describe('Connect sheet fits the AI island', () => {
  const needs = css('v2/ai/needs-you.css');
  const chat = css('styles/6-acp-chat.css');

  test('the slot yields to the composer instead of pushing it out', () => {
    const slot = rule(needs, '.ai-nc-slot');
    expect(slot).toMatch(/flex:\s*0 1 auto/);
    expect(slot).not.toMatch(/max-height:\s*60%/);
    expect(slot).toMatch(/overflow-y:\s*auto/);
  });

  test('the composer never shrinks', () => {
    expect(rule(chat, '.chat-composer')).toMatch(/flex:\s*none/);
  });

  test("the sheet's paragraphs carry no browser margin", () => {
    expect(needs).toMatch(/\.ai-conn-t,\s*\.ai-conn-b p,\s*\.ai-conn-fine\s*\{\s*margin:\s*0;/);
  });

  test('quick-reply chips and the feed padding give way while the sheet is open', () => {
    // P8 C2 (03 ai-not-ready): the sheet floats over the dimmed island, which hides the strip itself
    expect(needs).toMatch(
      /\.ai-island:has\(\.ai-conn-sheet--inline\) \.ai-suggest\s*\{\s*display:\s*none;/
    );
    expect(needs).toMatch(
      /\.chat-thread:has\(\.ai-conn-sheet\) \.chat-feed\s*\{\s*padding-block:\s*0;/
    );
  });
});

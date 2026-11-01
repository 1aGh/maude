// V2-8.7 final matrix at 08b35c8db: in the dark theme the AI chat's slash menu drew the /design: command names in
// --accent, which fails WCAG AA as text (color-contrast serious, native-ai-slash). Accent as TEXT is --accent-text.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '..', 'client/v2/ai/chat.css'), 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`\n  ${sel} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

describe('the slash menu names are readable ink', () => {
  test('.chat-cmd-name is --accent-text, never bare --accent', () => {
    const r = rule('.chat-cmd-name');
    expect(r).toContain('color: var(--accent-text)');
    expect(r).not.toMatch(/color:\s*var\(--accent\)/);
  });
});

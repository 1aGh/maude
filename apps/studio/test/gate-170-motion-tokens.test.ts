// #170 R29 (the part that is a plain rule): motion runs on the shell's tokens, so reduced motion reaches it.
//   · the shell toasts (sonner) ran their own 400 ms transform / opacity / height; they now use --dur-panel and
//     draw no height transition
//   · a hand-rolled 120 ms in the DS review cards is the --dur-flip token; the comment card / pin's hover
//     transitions (a frame with no shell tokens) collapse under prefers-reduced-motion
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('motion tokens', () => {
  test('toasts: sonner’s 400 ms and its height transition are overridden by the panel token', () => {
    const css = read('notifications.tsx');
    const rule = css.match(/\.maude-notifications \[data-sonner-toast\] \{\s*transition:([^}]*)\}/);
    expect(rule).not.toBeNull();
    const t = rule?.[1] ?? '';
    expect(t).toContain('transform var(--dur-panel');
    expect(t).toContain('opacity var(--dur-panel');
    expect(t).not.toMatch(/height|400ms/);
  });

  test('DS review cards use the flip token, not a bare 120ms', () => {
    expect(read('client/v2/ds/review.css')).not.toMatch(/transition:\s*all 120ms/);
  });

  test('the comment card and pin collapse their transitions under reduced motion', () => {
    const css = read('client/comments-overlay.css');
    const at = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at)).toMatch(/\.cm-thread \*[^}]*transition-duration:\s*1ms/s);
  });
});

// P8 round 8 (06 Advanced): the CSS the shots depend on, pinned where a computed-style test would need a browser.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const V2 = join(import.meta.dir, '../client/v2');
const css = (rel: string) => readFileSync(join(V2, rel), 'utf8');

describe('06 ad-diag ③: a menu row that carries a value keeps its label whole', () => {
  test('the label does not shrink to an ellipsis beside a status value ("Project folder", not "Project fo…")', () => {
    const src = css('diagnostics/diagnostics.css');
    const rule = /\.sh-pm-row:has\(\.sh-pm-status\) \.sh-pm-lab\s*\{([^}]*)\}/.exec(src);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/flex:\s*0 0 auto/);
    expect(rule?.[1]).toMatch(/overflow:\s*visible/);
  });
});

describe('06 ad-edge-syntax: the last-good boards are dashed outlines behind the card', () => {
  test('the ghost layer is non-interactive and the card sits above it', () => {
    const src = css('code/code.css');
    expect(/\.v2-err-ghosts\s*\{[^}]*pointer-events:\s*none/.test(src)).toBe(true);
    expect(/\.v2-err-ghost\s*\{[^}]*stroke-dasharray/.test(src)).toBe(true);
    expect(/\.v2-err\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/.test(src)).toBe(true);
  });
});

describe('06 ad-settings: Reset is one wrapping row of buttons', () => {
  test('.v2s-acts wraps, and the engine model box is the board’s quiet box', () => {
    const src = css('settings/settings.css');
    expect(/\.v2s-acts\s*\{[^}]*flex-wrap:\s*wrap/.test(src)).toBe(true);
    expect(/\.v2s-model\s*\{[^}]*border-radius:\s*var\(--radius-md\)/.test(src)).toBe(true);
  });
});

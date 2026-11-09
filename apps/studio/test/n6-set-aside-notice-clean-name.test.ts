// 2.1.1 N6 — the first-link "set aside" notice names a canvas whose file name can come from the server.
// Bidi overrides, other format characters and control characters never reach the sentence (they would
// reorder or hide the words around the name); the cleanup is the folder-name one from held deletes.
import { describe, expect, test } from 'bun:test';

import { setAsideNotice } from '../sync/accepted-cold-start.ts';

// spelled by code point so the source itself carries no invisible characters
const RLO = String.fromCharCode(0x202e);
const PDF = String.fromCharCode(0x202c);
const ZWSP = String.fromCharCode(0x200b);

describe('setAsideNotice › the canvas name is cleaned', () => {
  test('bidi, zero-width and control characters are stripped', () => {
    const rel = `ui/Pri${RLO}cing${ZWSP}\u0007\nPlan.tsx`;
    const text = setAsideNotice(rel, 'ui-pricing', ['meta']);
    expect(text).toBe(
      'PricingPlan: the project’s layout replaced this Mac’s. This Mac’s copy is kept in _history/ui-pricing/sync-recovery/.'
    );
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  test('a name of nothing but format characters falls back to the path', () => {
    const text = setAsideNotice(`ui/${RLO}${PDF}.tsx`, 'ui-x', ['comments']);
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(text.startsWith('ui/.tsx: ')).toBe(true);
  });
});

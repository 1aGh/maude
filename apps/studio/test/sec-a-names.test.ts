// sec-a L3 (wave-A defender) — a canvas or folder name may not start with `_`: that is the runtime-state
// mark (DDR-115 — `_state/`, `_history/` … never sync), so such a canvas would stay on this Mac. Refused
// in CONTRACT words, server and client alike, with the name minus the `_` offered.

import { describe, expect, test } from 'bun:test';
import { validateCanvasName, validateFolderName } from '../canvas-create.ts';
import { checkRename } from '../client/v2/canvases/rename-model.js';

describe('sec-a L3 — no leading _ in a canvas or folder name', () => {
  test('the server refuses it and offers the name without the _', () => {
    for (const v of [validateCanvasName('_state'), validateFolderName('__history')]) {
      expect(v.ok).toBe(false);
    }
    const v = validateCanvasName('_Pricing');
    expect(v.error).toBe('Names can’t start with _. Try “Pricing”.');
    expect(v.suggestion).toBe('Pricing');
    expect(validateCanvasName('_').error).toBe('Names can’t start with _. Try another name.');
    // a _ inside a name is fine
    expect(validateCanvasName('Pricing_v2').ok).toBe(true);
  });

  test('the client rename says the same words', () => {
    const r = checkRename({ draft: '_Pricing', current: 'Pricing old' });
    expect(r).toEqual({
      kind: 'error',
      error: 'Names can’t start with _. Try “Pricing”.',
      suggestion: 'Pricing',
    });
  });
});

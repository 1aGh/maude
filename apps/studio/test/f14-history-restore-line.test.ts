// F14 (2.0.4, #166) — Version history's restore toasts the server's line when the restore is refused
// because this Mac has a change the project has not taken yet (routes/history.ts `unsettled`), never
// the generic "Couldn't restore that version." and never a native dialog.
import { describe, expect, test } from 'bun:test';

import { restoreVersion } from '../client/v2/history/use-versions.js';

const ROW = { ref: 'r3', madeAt: Date.UTC(2026, 9, 5, 16, 40), named: null };

describe('F14 — Version history says why a restore was refused', () => {
  for (const [reason, line] of [
    ['unsaved-change', 'This canvas has a change on this Mac that isn’t saved. Compare it first.'],
    ['still-saving', 'This canvas is still saving. Try again in a moment.'],
  ] as const) {
    test(`409 ${reason}: the toast is the server's line, not ok, no Retry`, async () => {
      const toasts: unknown[][] = [];
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ ok: false, reason, line }), {
          status: 409,
        })) as unknown as typeof fetch;
      const r = await restoreVersion({
        path: 'ui/a.tsx',
        row: ROW,
        artboard: 'hero',
        toast: (...a: unknown[]) => toasts.push(a),
        fetchImpl,
      } as never);
      expect(r).toEqual({ ok: false, reason });
      expect(toasts).toEqual([[line, false]]);
    });
  }
});

// P8 bug sweep B2 — the AI panel's Advanced fold read "Connecting…" in a fresh chat for as long as nothing was
// sent (and for good when Claude is not connected): there is no session until the first message.
import { describe, expect, test } from 'bun:test';

import { capsConnecting } from '../client/v2/ai/Advanced.jsx';

describe('"Connecting…" in the AI fold', () => {
  test('a session that exists but has no roster yet is connecting', () => {
    expect(capsConnecting(true, 'sess-1')).toBe(true);
  });
  test('a fresh chat (no session yet) or an unknown one is not', () => {
    expect(capsConnecting(true, null)).toBe(false);
    expect(capsConnecting(true, undefined)).toBe(false);
  });
  test('a roster that arrived is never "connecting"', () => {
    expect(capsConnecting(false, 'sess-1')).toBe(false);
  });
});

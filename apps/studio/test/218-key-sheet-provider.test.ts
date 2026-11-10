// #218 (sibling) — Assets › Generate with no key opens "Connect a Google key?", then waits for the key
// and quotes again on the provider the sheet named. That id was 'google', which no registered provider
// has (the Google adapter is 'gemini'): the quote route answered no-provider forever, so a Gemini key
// added in Settings was never "seen" by the waiting prompt. The fake studio in
// p8-ia-edges-google-key.test.tsx echoed 'google' back, so it never noticed. This pins the id against
// the real registry.

import { expect, test } from 'bun:test';
import { SHEET_PROVIDER } from '../client/v2/assets/generate-ask.jsx';
import { providersForModality } from '../generation/registry.ts';

test('the key sheet names a provider the studio has, and one that makes images', () => {
  const ids = providersForModality('image').map((d) => d.id);
  expect(ids).toContain(SHEET_PROVIDER);
});

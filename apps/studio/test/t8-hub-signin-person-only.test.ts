// 2.1.1 T8 — starting a team-server sign-in, checking its address, and saving a team-server credential
// are the person's acts (the page's session), never the header key every helper and verb sends — the
// same as the Maude Cloud sign-in. The sign-in's return hop needs no key, so the start must need a person.
import { describe, expect, test } from 'bun:test';
import { isPersonOnlyRoute } from '../shell/api-key.ts';

describe('person-only team-server sign-in', () => {
  test('start, check and hub/link are person-only POSTs', () => {
    expect(isPersonOnlyRoute('POST', '/_api/hub-signin/start')).toBe(true);
    expect(isPersonOnlyRoute('POST', '/_api/hub-signin/check')).toBe(true);
    expect(isPersonOnlyRoute('POST', '/_api/hub/link')).toBe(true);
    // parity with the Maude Cloud sign-in
    expect(isPersonOnlyRoute('POST', '/_api/cloud/signin/start')).toBe(true);
  });

  test('the return hop and reads are not, and neighbours are not swept in', () => {
    expect(isPersonOnlyRoute('GET', '/_api/hub-signin/return')).toBe(false);
    expect(isPersonOnlyRoute('GET', '/_api/hub/link')).toBe(false);
    expect(isPersonOnlyRoute('POST', '/_api/hub/linked')).toBe(false);
    expect(isPersonOnlyRoute('POST', '/_api/hub-signin/started')).toBe(false);
  });
});

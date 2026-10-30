// S10.18c: the card's "Used by 3 projects" comes from the hub's head (members only), through `check` and the
// review — never invented, never written to head.json (which syncs to peers). Fake hub only.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup } from './_ds-engine-fixture.ts';
import { fakeHub, LIB, linked, V2 } from './_ds-library-hub.ts';

afterAll(cleanup);

describe('ds library: used by N projects', () => {
  test('check and the review carry usedBy when the hub says it, null when it does not', async () => {
    const hub = fakeHub();
    const L = await linked({ hub });
    expect((await L.lib.check(LIB, { force: true })).usedBy).toBeNull();
    hub.usedBy = 3;
    hub.head = V2.id;
    const c = await L.lib.check(LIB, { force: true });
    expect(c.usedBy).toBe(3);
    expect(c.waiting).toBe(true);
    // the throttled answer repeats what the hub last said instead of going quiet
    expect((await L.lib.check(LIB)).usedBy).toBe(3);
    expect((await L.lib.review(LIB)).usedBy).toBe(3);
    hub.usedBy = null;
    expect((await L.lib.review(LIB)).usedBy).toBeNull();
  });

  test('a count is display data in memory — it never reaches head.json', async () => {
    const hub = fakeHub();
    const L = await linked({ hub });
    hub.usedBy = 7;
    hub.head = V2.id;
    await L.lib.check(LIB, { force: true });
    const text = readFileSync(path.join(L.gatorAbs, 'revisions', 'head.json'), 'utf8');
    expect(text).not.toContain('usedBy');
  });
});

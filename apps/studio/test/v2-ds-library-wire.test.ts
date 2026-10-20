// S10.18c — the team-library card against the REAL routes, the REAL engine and a fake hub: what the client reads is
// what `routes/ds.ts` + `routes/ds-library.ts` serve, what Check / Update / Unlink send is what they accept, and the
// words for each refusal are the person's. Never a real hub (test/_ds-library-hub.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import {
  checkLibrary,
  linkLibrary,
  loadLibraryReview,
  loadLinked,
  relinkLibrary,
  takeLibraryUpdate,
  unlinkLibrary,
} from '../client/v2/ds/library-host.jsx';
import {
  bannerModel,
  cardModel,
  changeCount,
  isWaiting,
  LIBRARY_WORDS,
} from '../client/v2/ds/library-model.js';
import { createDsLibrary, type DsLibrary, memoryGrantStore } from '../ds/library.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup } from './_ds-engine-fixture.ts';
import {
  fakeHub,
  GRANT,
  LIB,
  type Linking,
  linked,
  linkingProject,
  URL_,
  V2,
} from './_ds-library-hub.ts';

afterAll(cleanup);

const claims: Record<string, AccessClaim> = {
  owner: { v: 1, role: 'owner' },
  view: { v: 1, role: 'observer' },
};

/** `fetch` served by the real route table; `lib` is this Mac's library (its grants decide who may ask the hub). */
function wire(L: Linking, who: keyof typeof claims = 'owner', lib: DsLibrary = L.lib) {
  const specs = createDsRoutes({
    engine: () => L.p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
    library: () => lib,
  });
  return (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const pathname = url.split('?')[0];
    const spec = specs.find((s) => s.method === method && s.path === pathname);
    if (!spec) throw new Error(`no ${method} ${pathname}`);
    return spec.handle(
      new Request(`http://localhost${url}`, {
        method,
        ...(init?.body ? { body: init.body, headers: { 'content-type': 'application/json' } } : {}),
      })
    );
  }) as unknown as typeof fetch;
}

const headOf = (L: Linking) => JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string);

/** The library moves to V2 (3 projects use it) and this Mac asks. */
async function moved(L: Linking, f: typeof fetch) {
  L.hub.head = V2.id;
  L.hub.usedBy = 3;
  return checkLibrary(LIB, f, true);
}

describe('the card, through the routes', () => {
  test('a linked system reads as a row; up to date says so; nothing is invented', async () => {
    const L = await linked();
    const f = wire(L);
    const rows = await loadLinked(f);
    expect(rows.map((r) => r.ds)).toEqual([LIB]);
    expect(rows[0].library.hub).toBe('https://alligators.cloud.test');
    expect(isWaiting(rows[0])).toBe(false);
    const c = cardModel({ row: rows[0], check: { usedBy: null } });
    expect(c.line).toBe('Up to date');
    expect(c.usedBy).toBeNull(); // the hub told no count: no line
    expect(c.canUpdate).toBe(false);
    expect(await loadLinked(wire(L, 'owner', undefined))).toHaveLength(1);
  });

  test('a moved library: "Used by 3 projects", "N updates waiting", the review lists the changes', async () => {
    const L = await linked();
    const f = wire(L);
    expect(await moved(L, f)).toEqual({ ok: true, usedBy: 3 });
    const [row] = await loadLinked(f);
    expect(isWaiting(row)).toBe(true);
    const r = await loadLibraryReview(LIB, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(changeCount(r.review)).toBe(2); // --accent, and the components moved too
    const card = cardModel({ row, check: { usedBy: 3 }, review: r.review, access: 'yes' });
    expect(card.usedBy).toBe('Used by 3 projects');
    expect(card.line).toBe('2 updates waiting');
    expect(card.canUpdate).toBe(true);
    expect(card.kind).toBe('Team library · alligators.cloud.test');
    expect(bannerModel(row)).toMatchObject({
      title: 'Linked from alligators.cloud.test.',
      sub: LIBRARY_WORDS.bannerSub,
      action: 'Open in alligators.cloud.test',
    });
  });

  test('Update posts exactly what the review showed; unticked canvases stay; one action', async () => {
    const L = await linked();
    const f = wire(L);
    await moved(L, f);
    const r = await loadLibraryReview(LIB, f);
    if (!r.ok) throw new Error('review');
    const rows = r.review.canvases.map((c: { path: string }) => ({
      path: c.path,
      locked: false,
      ticked: c.path !== 'ui/Landing.tsx',
    }));
    const done = await takeLibraryUpdate({ ds: LIB, review: r.review }, rows, f);
    expect(done).toEqual({ ok: true, updated: 1, leftOut: 1 });
    expect(headOf(L).head).toBe(V2.id);
    expect(L.p.meta('ui/Landing.tsx').dsRev).toBeTruthy(); // left out at the old head
    const [row] = await loadLinked(f);
    expect(isWaiting(row)).toBe(false);
  });

  test('a library that moved again since the review is refused in words; nothing is written', async () => {
    const L = await linked();
    const f = wire(L);
    await moved(L, f);
    const r = await loadLibraryReview(LIB, f);
    if (!r.ok) throw new Error('review');
    const stale = { ...r.review, expectHead: 'f'.repeat(64) };
    const done = await takeLibraryUpdate({ ds: LIB, review: stale }, [], f);
    expect(done).toMatchObject({
      ok: false,
      code: 'ds-head-moved',
      message: LIBRARY_WORDS.headMoved,
    });
    expect(headOf(L).head).not.toBe(V2.id);
  });

  test('Can view reads the card and is refused every library action, in words', async () => {
    const L = await linked();
    const f = wire(L, 'view');
    expect(await checkLibrary(LIB, f, true)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await loadLibraryReview(LIB, f)).toMatchObject({
      ok: false,
      message: LIBRARY_WORDS.forbidden,
    });
    expect(await unlinkLibrary(LIB, f)).toMatchObject({
      ok: false,
      message: LIBRARY_WORDS.forbidden,
    });
    expect(await linkLibrary(URL_, GRANT, f)).toMatchObject({
      ok: false,
      message: LIBRARY_WORDS.forbidden,
    });
    expect((await loadLinked(f)).map((r) => r.ds)).toEqual([LIB]); // the state read is not a library action
    expect(headOf(L).library).toBeTruthy();
  });

  test('an offline hub is a quiet failure the card can word', async () => {
    const L = await linked();
    const f = wire(L);
    L.hub.status = 503;
    const c = await checkLibrary(LIB, f, true);
    expect(c).toMatchObject({ ok: false, code: 'ds-library-unreachable', noGrant: false });
    const [row] = await loadLinked(f);
    const card = cardModel({ row, error: LIBRARY_WORDS.offline });
    expect(card.error).toBe(LIBRARY_WORDS.offline);
    expect(card.line).toBe('Up to date'); // nothing is claimed that the hub did not say
  });

  test('a peer without this Mac’s grant can look; the card says who can update, never an address', async () => {
    const L = await linked();
    const peerLib = createDsLibrary(L.p.engine, {
      fetchImpl: L.hub.fetch,
      grants: memoryGrantStore(),
      now: () => L.clock.t,
    });
    const f = wire(L, 'owner', peerLib);
    const hubCalls = L.hub.calls.length;
    const c = await checkLibrary(LIB, f, true);
    expect(c).toMatchObject({ ok: false, code: 'ds-library-no-grant', noGrant: true });
    expect(L.hub.calls.length).toBe(hubCalls); // nothing was asked, no credential went anywhere
    const [row] = await loadLinked(f);
    const card = cardModel({ row, access: 'no' });
    expect(card.noGrantLine).toBe('Only Michal can update this library from their Mac.');
    expect(card.canUpdate).toBe(false);
    // an address is display data nobody should see on the card
    const shy = cardModel({
      row: {
        ...row,
        library: { ...row.library, linkedBy: { kind: 'person', name: 'michal@studyfi.com' } },
      },
      access: 'no',
    });
    expect(shy.noGrantLine).toBe(
      'Only the person who linked it can update this library from their Mac.'
    );
    expect(shy.noGrantLine).not.toContain('@');
    const r = await loadLibraryReview(LIB, f);
    expect(r).toMatchObject({ ok: false, code: 'ds-library-no-grant' });
  });

  test('Unlink makes the copy an own system; the card is gone and the files stay', async () => {
    const L = await linked();
    const f = wire(L);
    expect(await unlinkLibrary(LIB, f)).toEqual({ ok: true });
    expect(await loadLinked(f)).toEqual([]);
    expect(headOf(L).library).toBeNull();
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).toBeTruthy();
    expect(await unlinkLibrary(LIB, f)).toMatchObject({ ok: false });
  });

  test('Link takes the link and the key; a hub that cannot share libraries is refused in words', async () => {
    const L = await linkingProject({
      hub: fakeHub({ capabilities: ['ledger'] }),
    });
    const f = wire(L);
    expect(await linkLibrary(URL_, GRANT, f)).toMatchObject({
      ok: false,
      message: LIBRARY_WORDS.unsupported,
    });
    expect(await loadLinked(f)).toEqual([]);
    const ok = await linkingProject();
    expect(await linkLibrary(URL_, GRANT, wire(ok))).toEqual({ ok: true, system: LIB });
    expect((await loadLinked(wire(ok))).map((r) => r.ds)).toEqual([LIB]);
  });

  test('A3: a record linked on another Mac answers relink; the card names the host; Link again makes it this Mac’s', async () => {
    const L = await linked();
    const grants = memoryGrantStore();
    grants.set('https://alligators.cloud.test', 'p_gator', LIB, GRANT);
    const other = createDsLibrary(L.p.engine, {
      fetchImpl: L.hub.fetch,
      grants,
      now: () => L.clock.t,
    });
    const f = wire(L, 'owner', other);
    const before = L.hub.calls.length;
    const c = await checkLibrary(LIB, f, true);
    expect(c).toMatchObject({ ok: false, code: 'ds-library-relink', relink: true, noGrant: false });
    expect(L.hub.calls.length).toBe(before);
    const [row] = await loadLinked(f);
    const card = cardModel({ row, access: 'relink' });
    expect(card).toMatchObject({ relink: true, canUpdate: false, noGrantLine: null });
    expect(card.relinkLine).toContain('alligators.cloud.test');
    expect(card.relinkLine).toContain(`${LIB} from p_gator`);
    // gate-b-sec2 finding 2: one click is refused; the library's own link pasted again links it
    expect(await relinkLibrary(LIB, f)).toMatchObject({ ok: false, code: 'ds-library-relink' });
    expect(await checkLibrary(LIB, f, true)).toMatchObject({
      ok: false,
      code: 'ds-library-relink',
    });
    expect(L.hub.calls.length).toBe(before);
    expect(await relinkLibrary(LIB, f, { url: URL_ })).toEqual({ ok: true });
    expect(await checkLibrary(LIB, f, true)).toMatchObject({ ok: true });
    expect(L.hub.calls.length).toBeGreaterThan(before);
  });

  test('A5: in a cell every library action but Unlink is refused not-on-mac, and no hub is asked', async () => {
    const L = await linked();
    const f = wire(L);
    const before = L.hub.calls.length;
    const was = process.env.MAUDE_WORKSPACE_MODE;
    process.env.MAUDE_WORKSPACE_MODE = '1';
    try {
      expect(await checkLibrary(LIB, f, true)).toMatchObject({ ok: false, code: 'not-on-mac' });
      expect(await loadLibraryReview(LIB, f)).toMatchObject({
        ok: false,
        message: LIBRARY_WORDS.notOnMac,
      });
      expect(await linkLibrary(URL_, GRANT, f)).toMatchObject({ ok: false, code: 'not-on-mac' });
      expect(await relinkLibrary(LIB, f)).toMatchObject({ ok: false, code: 'not-on-mac' });
      expect(L.hub.calls.length).toBe(before);
      expect(await unlinkLibrary(LIB, f)).toEqual({ ok: true });
    } finally {
      if (was === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
      else process.env.MAUDE_WORKSPACE_MODE = was;
    }
  });
});

// S10.18b (V2-1.6 §5.14): linking a team library copies its revision in BY ID after verifying it; an invalid
// upstream revision is never written; an older hub (no `ds-library`) fails closed; update brings the changes,
// then this project's own review (unticked = left out at the old head) as ONE action; ⌘Z takes it back.
// The hub is a fake (test/_ds-library-hub.ts) — never a real one.
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DsLibraryError, parseLibraryUrl } from '../ds/library.ts';
import { buildRevision, verifyRevision } from '../ds/revision.ts';
import { registerDsUndoHook } from '../ds/undo-hook.ts';
import { cleanup, PERSON } from './_ds-engine-fixture.ts';
import {
  fakeHub,
  GATOR_COMP,
  GRANT,
  gatorCss,
  HUB,
  LIB,
  linked,
  linkingProject,
  nothingLinked,
  rev,
  URL_,
  V1,
  V2,
} from './_ds-library-hub.ts';

afterAll(cleanup);
let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { code?: string; status?: number };
    return e && typeof e.code === 'string' ? { code: e.code, status: e.status } : String(err);
  }
};

describe('ds library: link', () => {
  test('copies the head revision by id, materialises, records the library, keeps the grant off head.json', async () => {
    const L = await linkingProject();
    const r = await L.lib.link({ url: URL_, grant: GRANT, by: PERSON });
    expect(r).toMatchObject({ action: 'link', rev: V1.id, system: LIB, path: `system/${LIB}` });
    // the same id, byte-identical, and it verifies
    const copied = L.p.read(`system/${LIB}/revisions/${V1.id}.json`) as string;
    expect(copied).toBe(V1.bytes);
    expect(verifyRevision(V1.id, copied).ok).toBe(true);
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).toBe(gatorCss('#0a7d3b', '#3fbf6f'));
    expect(L.p.read(`system/${LIB}/preview/_components.css`)).toBe(GATOR_COMP);
    expect(L.p.read(`system/${LIB}/revisions/${V1.id}.tokens.css`)).toBe(
      gatorCss('#0a7d3b', '#3fbf6f')
    );
    // our Design system canvas, never upstream bytes
    expect(L.p.read(`system/${LIB}/design-system.tsx`)).toContain('@maude/ds/board');
    const headText = L.p.read(`system/${LIB}/revisions/head.json`) as string;
    const head = JSON.parse(headText);
    expect([head.head, head.base]).toEqual([V1.id, V1.id]);
    expect(head.library).toMatchObject({
      hub: HUB,
      project: 'p_gator',
      system: LIB,
      upstreamHead: V1.id,
    });
    expect(head.log[0]).toMatchObject({ action: 'library', rev: V1.id, by: PERSON });
    expect(headText).not.toContain(GRANT);
    expect(L.grants.get(HUB, 'p_gator', LIB)).toBe(GRANT);
    expect(L.p.engine.systems().map((s) => s.name)).toContain(LIB);
    // every hub request carried the bearer to the hub's own origin and followed no redirect
    for (const c of L.hub.calls.filter((x) => !x.url.endsWith('/health'))) {
      expect(c.auth).toBe(`Bearer ${GRANT}`);
      expect(c.redirect).toBe('error');
      expect(new URL(c.url).origin).toBe(HUB);
    }
  });

  test('an older hub without the ds-library capability fails closed: nothing asked, nothing written', async () => {
    for (const capabilities of [null, ['ledger']]) {
      const L = await linkingProject({ hub: fakeHub({ capabilities }) });
      expect(await code(L.lib.link({ url: URL_, grant: GRANT, by: PERSON }))).toEqual({
        code: 'ds-library-unsupported',
        status: 409,
      });
      expect(nothingLinked(L)).toBe(true);
      expect(L.hub.calls.map((c) => new URL(c.url).pathname)).toEqual(['/health']);
      expect(L.grants.get(HUB, 'p_gator', LIB)).toBeNull();
    }
  });

  const planted: [string, (h: ReturnType<typeof fakeHub>) => void, string][] = [
    [
      'bytes that do not match their id',
      (h) => h.revisions.set(V1.id, V1.bytes.replace('#0a7d3b', '#ff0000')),
      'ds-library-invalid',
    ],
    [
      'a valid revision carrying a file it may not (a canvas)',
      (h) => {
        const evil = rev({
          'colors_and_type.css': gatorCss('#000', '#fff'),
          'design-system.tsx': 'fetch("https://evil.test")',
        });
        h.revisions.set(evil.id, evil.bytes);
        h.head = evil.id;
      },
      'ds-library-invalid',
    ],
    [
      'a valid revision reaching into revisions/',
      (h) => {
        const evil = rev({
          'colors_and_type.css': gatorCss('#000', '#fff'),
          'revisions/head.json': '{}',
        });
        h.revisions.set(evil.id, evil.bytes);
        h.head = evil.id;
      },
      'ds-library-invalid',
    ],
    [
      "another system's revision",
      (h) => {
        const other = buildRevision('acme', { 'colors_and_type.css': gatorCss('#000', '#fff') });
        h.revisions.set(other.id, other.bytes);
        h.head = other.id;
      },
      'ds-library-invalid',
    ],
    [
      'more than 2 MiB',
      (h) => h.revisions.set(V1.id, `{"x":"${'a'.repeat(2 * 1024 * 1024 + 10)}"}`),
      'ds-library-too-large',
    ],
    ['a head that is not one', (h) => (h.head = 'not-an-id' as string), 'ds-library-invalid'],
  ];
  for (const [what, plant, want] of planted)
    test(`an invalid upstream revision is never written: ${what}`, async () => {
      const hub = fakeHub();
      plant(hub);
      const L = await linkingProject({ hub });
      expect(
        (await code(L.lib.link({ url: URL_, grant: GRANT, by: PERSON })))?.valueOf()
      ).toMatchObject({ code: want });
      expect(nothingLinked(L)).toBe(true);
      expect(L.grants.get(HUB, 'p_gator', LIB)).toBeNull();
    });

  test('a redirect is refused, never followed', async () => {
    const L = await linkingProject();
    L.hub.capabilities = ['ds-library'];
    const real = L.hub.fetch;
    L.hub.fetch = (async (u: RequestInfo | URL, init?: RequestInit) =>
      String(u).endsWith('/health')
        ? real(u, init)
        : new Response('', {
            status: 302,
            headers: { location: 'https://evil.test' },
          })) as typeof fetch;
    const L2 = await linkingProject({ hub: L.hub });
    expect(await code(L2.lib.link({ url: URL_, grant: GRANT, by: PERSON }))).toMatchObject({
      code: 'ds-library-unreachable',
    });
    expect(nothingLinked(L2)).toBe(true);
  });

  test('a symlinked system folder is refused; nothing escapes', async () => {
    const L = await linkingProject();
    const outside = path.join(tmpdir(), `maude-lib-outside-${process.pid}-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, L.gatorAbs);
    expect(await code(L.lib.link({ url: URL_, grant: GRANT, by: PERSON }))).toMatchObject({
      code: 'ds-library-invalid',
    });
    expect(existsSync(path.join(outside, 'colors_and_type.css'))).toBe(false);
    expect(String(L.p.read('config.json'))).not.toContain(`"${LIB}"`);
  });

  test('the link URL: https only (http on loopback), no user info, query or #part', () => {
    expect(parseLibraryUrl(URL_)).toEqual({ hub: HUB, project: 'p_gator', system: LIB });
    expect(parseLibraryUrl(`${URL_}/head`).system).toBe(LIB);
    expect(parseLibraryUrl('http://localhost:4400/api/projects/local/v1/ds/gator').hub).toBe(
      'http://localhost:4400'
    );
    for (const bad of [
      'http://alligators.cloud.test/api/projects/p/v1/ds/gator',
      'https://user:pw@alligators.cloud.test/api/projects/p/v1/ds/gator',
      `${URL_}?grant=x`,
      `${URL_}#x`,
      'https://alligators.cloud.test/api/projects/p/v1/ds/../../etc',
      'https://alligators.cloud.test/api/projects/p/v1/ds/Bad_Name',
      'file:///etc/passwd',
    ])
      expect(() => parseLibraryUrl(bad)).toThrow(DsLibraryError);
  });
});

describe('ds library: check, update, unlink', () => {
  test('check moves upstreamHead when the hub moved; throttled to 30 min unless forced', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    const before = L.hub.calls.length;
    const quiet = await L.lib.check(LIB);
    expect(quiet.checked).toBe(false); // linked a moment ago
    expect(L.hub.calls.length).toBe(before);
    L.clock.t += 31 * 60 * 1000;
    const r = await L.lib.check(LIB);
    expect(r).toMatchObject({ checked: true, waiting: true });
    expect(
      JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string).library.upstreamHead
    ).toBe(V2.id);
    // the working files did not move: never auto-applied
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).toBe(gatorCss('#0a7d3b', '#3fbf6f'));
  });

  test('update: the review lists the changes and this project’s canvases; apply is ONE action; ⌘Z takes it back', async () => {
    const L = await linked();
    off = registerDsUndoHook(L.p.engine);
    L.hub.head = V2.id;
    const review = await L.lib.review(LIB);
    expect(review).toMatchObject({
      system: LIB,
      expectHead: V1.id,
      upstream: V2.id,
      components: true,
    });
    expect(review.changes.map((c) => c.css)).toEqual(['--accent']);
    expect(review.by).toEqual({ kind: 'peer', name: 'Tereza' }); // a bidi override is display data, dropped
    expect(review.canvases.map((c) => [c.path, c.ticked])).toEqual([
      ['ui/Home.tsx', true],
      ['ui/Landing.tsx', true],
    ]);
    const r = await L.lib.update(LIB, {
      expectHead: V1.id,
      upstream: V2.id,
      canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
      by: PERSON,
    });
    expect(r).toMatchObject({ action: 'library', rev: V2.id, updated: 1, leftOut: 1 });
    expect(r.actionId).toBeTruthy();
    expect(L.p.meta('ui/Landing.tsx').dsRev).toBe(V1.id);
    expect(L.p.meta('ui/Home.tsx').dsRev).toBeUndefined();
    expect(L.p.read(`system/${LIB}/revisions/${V2.id}.json`)).toBe(V2.bytes);
    expect(L.p.read(`system/${LIB}/preview/_components.css`)).toContain('6px');
    const head = JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string);
    expect([head.head, head.base, head.library.upstreamHead]).toEqual([V2.id, V2.id, V2.id]);
    expect(head.log[0]).toMatchObject({ action: 'library', parent: V1.id, actionId: r.actionId });
    // ⌘Z: the canvas follows again, the pointers and the working files go back to V1
    const u = await L.p.undo({ actionId: r.actionId });
    expect(u.status).toBe(200);
    expect(L.p.meta('ui/Landing.tsx').dsRev).toBeUndefined();
    const after = JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string);
    expect([after.head, after.base]).toEqual([V1.id, V1.id]);
    expect(L.p.read(`system/${LIB}/preview/_components.css`)).toBe(GATOR_COMP);
    // the library still has V2: "1 update waiting" comes back
    expect(after.library.upstreamHead).toBe(V2.id);
  });

  test('update refuses when the library moved since the review, or the head did; nothing is written', async () => {
    const L = await linked();
    L.hub.head = V2.id;
    const V3 = rev({ 'colors_and_type.css': gatorCss('#111111', '#eeeeee') });
    L.hub.revisions.set(V3.id, V3.bytes);
    await L.lib.review(LIB);
    L.hub.head = V3.id;
    expect(
      await code(L.lib.update(LIB, { expectHead: V1.id, upstream: V2.id, by: PERSON }))
    ).toMatchObject({
      code: 'ds-library-moved',
    });
    expect(
      await code(L.lib.update(LIB, { expectHead: 'f'.repeat(64), upstream: V3.id, by: PERSON }))
    ).toMatchObject({
      code: 'ds-head-moved',
    });
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).toBe(gatorCss('#0a7d3b', '#3fbf6f'));
    expect(existsSync(path.join(L.gatorAbs, 'revisions', `${V3.id}.json`))).toBe(false);
  });

  test('an invalid update revision is never written; the head stays', async () => {
    const L = await linked();
    const evil = rev({ 'colors_and_type.css': gatorCss('#000', '#fff'), 'preview/x.tsx': 'boom' });
    L.hub.revisions.set(evil.id, evil.bytes);
    L.hub.head = evil.id;
    expect(
      await code(L.lib.update(LIB, { expectHead: V1.id, upstream: evil.id, by: PERSON }))
    ).toMatchObject({
      code: 'ds-library-invalid',
    });
    expect(existsSync(path.join(L.gatorAbs, 'revisions', `${evil.id}.json`))).toBe(false);
    expect(existsSync(path.join(L.gatorAbs, 'preview', 'x.tsx'))).toBe(false);
    expect(JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string).head).toBe(V1.id);
  });

  test('a peer that rewrites library.hub gets no request made and no credential sent', async () => {
    const L = await linked();
    const head = JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string);
    head.library.hub = 'https://evil.test';
    L.p.write(`system/${LIB}/revisions/head.json`, `${JSON.stringify(head, null, 2)}\n`);
    const before = L.hub.calls.length;
    expect(await code(L.lib.check(LIB, { force: true }))).toMatchObject({
      code: 'ds-library-no-grant',
    });
    expect(L.hub.calls.length).toBe(before);
  });

  test('unlink: the copy becomes an ordinary local system; revisions and the working files stay', async () => {
    const L = await linked();
    const r = await L.lib.unlink(LIB, { by: PERSON });
    expect(r).toMatchObject({ action: 'unlink', rev: V1.id });
    const head = JSON.parse(L.p.read(`system/${LIB}/revisions/head.json`) as string);
    expect(head.library).toBeNull();
    expect(L.p.read(`system/${LIB}/revisions/${V1.id}.json`)).toBe(V1.bytes);
    expect(L.grants.get(HUB, 'p_gator', LIB)).toBeNull();
    expect(await code(L.lib.check(LIB, { force: true }))).toMatchObject({
      code: 'ds-library-not-linked',
    });
  });
});

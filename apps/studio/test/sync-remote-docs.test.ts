// The gap between what a project HOLDS and what this machine carries.
//
// Regression cover for the reported "Open in Maude does nothing": the desktop
// synced 72/72 and was accurate about the wrong set — three canvases lived only
// on the hub and no local counter could ever show it.

import { describe, expect, test } from 'bun:test';
import { canvasSlugFromRel } from '../canvas-slug.ts';

import {
  describeRemoteDiff,
  diffRemoteDocs,
  fetchRemoteListing,
  pullTargets,
  slugFromDocName,
  stateDocumentGone,
  tombstonedSlugs,
} from '../sync/remote-docs.ts';

const okFetch = (documents: unknown) =>
  (async () =>
    new Response(JSON.stringify({ documents }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('fetchRemoteListing', () => {
  test('reads the hub listing', async () => {
    const listing = await fetchRemoteListing(
      'https://hub.example',
      't',
      okFetch([{ name: 'ui-welcome', bytes: 2931 }])
    );
    expect(listing?.documents).toEqual([{ name: 'ui-welcome', bytes: 2931 }]);
  });

  test('carries the token as a bearer, and strips a trailing slash', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const spy = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenAuth = String((init.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify({ documents: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchRemoteListing('https://hub.example/', 'tok123', spy);
    expect(seenUrl).toBe('https://hub.example/api/documents');
    expect(seenAuth).toBe('Bearer tok123');
  });

  test('an unreachable or old hub yields null, never a throw', async () => {
    // Load-bearing: sync must proceed when the listing cannot be had. A hub
    // without the route (404) must not degrade into a failed sync.
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchRemoteListing('https://h', 't', boom)).toBeNull();

    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchRemoteListing('https://h', 't', notFound)).toBeNull();

    const junk = (async () =>
      new Response(JSON.stringify({ documents: 'not-an-array' }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchRemoteListing('https://h', 't', junk)).toBeNull();
  });

  test('reads the tombstones a peer needs to stop resurrecting a delete', async () => {
    const withStones = (async () =>
      new Response(
        JSON.stringify({ documents: [], tombstones: [{ name: 'ui-gone', deletedAt: 42 }] }),
        { status: 200 }
      )) as unknown as typeof fetch;
    const listing = await fetchRemoteListing('https://h', 't', withStones);
    expect(listing?.tombstones).toEqual([{ name: 'ui-gone', deletedAt: 42 }]);
  });

  test('a hub with no tombstone route reports no deletions, not a failure', async () => {
    // "This hub cannot say" and "nothing was deleted" must behave identically:
    // change nothing on disk. Anything else would make an old hub delete work.
    const listing = await fetchRemoteListing(
      'https://h',
      't',
      okFetch([{ name: 'ui-welcome', bytes: 1 }])
    );
    expect(listing?.tombstones).toEqual([]);
    expect(listing?.documents).toHaveLength(1);
  });

  test('a junk tombstone field is read as no deletions', async () => {
    const hostile = (async () =>
      new Response(JSON.stringify({ documents: [], tombstones: 'everything' }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect((await fetchRemoteListing('https://h', 't', hostile))?.tombstones).toEqual([]);
  });
});

describe('tombstonedSlugs', () => {
  test('names only the slugs this peer actually holds', () => {
    const slugs = tombstonedSlugs(
      [
        { name: 'ui-gone', deletedAt: 1 },
        { name: 'ui-never-had-it', deletedAt: 2 },
      ],
      ['ui-gone', 'ui-welcome']
    );
    expect(slugs).toEqual(['ui-gone']);
  });

  test('refuses a name that could place a file outside the design root', () => {
    // The one hub-supplied signal whose effect is to REMOVE work, so it runs
    // through the same gate a pull does.
    expect(
      tombstonedSlugs(
        [
          { name: '../../etc/passwd', deletedAt: 1 },
          { name: 'ui/../../x', deletedAt: 1 },
          { name: 'ui-real.tsx', deletedAt: 1 },
        ],
        ['passwd', 'x', 'ui-real', 'ui-real.tsx']
      )
    ).toEqual([]);
  });

  test('deduplicates a hub naming the same canvas flat and namespaced', () => {
    expect(
      tombstonedSlugs(
        [
          { name: 'ui-gone', deletedAt: 1 },
          { name: 'ws/acme/main/ui-gone', deletedAt: 2 },
        ],
        ['ui-gone']
      )
    ).toEqual(['ui-gone']);
  });
});

describe('stateDocumentGone', () => {
  test('DELETEs the document, percent-encoding the name', async () => {
    let seenUrl = '';
    let seenMethod = '';
    const spy = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenMethod = String(init.method);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await stateDocumentGone('https://hub.example/', 't', 'ws/acme/main/ui-x', {
      fetchImpl: spy,
    });
    expect(ok).toBe(true);
    expect(seenMethod).toBe('DELETE');
    expect(seenUrl).toBe('https://hub.example/api/documents/ws%2Facme%2Fmain%2Fui-x');
  });

  test('POSTs to revive, so a re-created name is not eaten by its gravestone', async () => {
    let seenMethod = '';
    const spy = (async (_url: string, init: RequestInit) => {
      seenMethod = String(init.method);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await stateDocumentGone('https://h', 't', 'ui-x', { revive: true, fetchImpl: spy });
    expect(seenMethod).toBe('POST');
  });

  test('an old or unreachable hub is false, never a throw', async () => {
    // The local delete already happened; a failed call costs the propagation.
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await stateDocumentGone('https://h', 't', 'ui-x', { fetchImpl: boom })).toBe(false);
    const gone = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await stateDocumentGone('https://h', 't', 'ui-x', { fetchImpl: gone })).toBe(false);
  });
});

describe('diffRemoteDocs', () => {
  test('names the canvases this machine can never receive', () => {
    // The reported case, in miniature.
    const diff = diffRemoteDocs(
      ['ui-home', 'ui-about'],
      [
        { name: 'ui-home', bytes: 1 },
        { name: 'ui-about', bytes: 1 },
        { name: 'ui-welcome', bytes: 2931 },
      ]
    );
    expect(diff.shared).toEqual(['ui-about', 'ui-home']);
    expect(diff.hubOnly.map((d) => d.name)).toEqual(['ui-welcome']);
    expect(diff.localOnly).toEqual([]);
    expect(diff.reachable).toBe(true);
  });

  test('a canvas created here but not yet pushed is localOnly, not a gap', () => {
    const diff = diffRemoteDocs(['ui-new'], []);
    expect(diff.localOnly).toEqual(['ui-new']);
    expect(diff.hubOnly).toEqual([]);
  });

  test('an unreachable hub reports NOT reachable rather than a false gap', () => {
    // Reporting every local canvas as "hub-only missing" would be worse than
    // saying nothing — it would invent an alarm out of a network blip.
    const diff = diffRemoteDocs(['ui-home'], null);
    expect(diff.reachable).toBe(false);
    expect(diff.hubOnly).toEqual([]);
  });

  test('compares WIRE names — a namespaced hub vs flat local is a real mismatch', () => {
    // If a caller passed raw slugs against a namespaced hub, everything would
    // look missing on both sides. The diff reports exactly that rather than
    // papering over it, because it IS the doc-identity bug (DDR-192 §5).
    const diff = diffRemoteDocs(['ui-home'], [{ name: 'ws/acme/main/ui-home', bytes: 1 }]);
    expect(diff.shared).toEqual([]);
    expect(diff.hubOnly.map((d) => d.name)).toEqual(['ws/acme/main/ui-home']);
    expect(diff.localOnly).toEqual(['ui-home']);
  });
});

describe('describeRemoteDiff', () => {
  test('says what is missing, with names', () => {
    const msg = describeRemoteDiff(
      diffRemoteDocs(
        [],
        [
          { name: 'ui-welcome', bytes: 1 },
          { name: 'ui-how_to_use_maude', bytes: 1 },
        ]
      )
    );
    expect(msg).toContain('2 canvases');
    expect(msg).toContain('ui-welcome');
  });

  test('stays quiet when there is nothing to report', () => {
    expect(describeRemoteDiff(diffRemoteDocs(['a'], [{ name: 'a', bytes: 1 }]))).toBeNull();
    expect(describeRemoteDiff(diffRemoteDocs(['a'], null))).toBeNull();
  });
});

describe('pulling hub-only documents down', () => {
  const join = (...p: string[]) => p.join('/');
  const resolve = (p: string) => p.replace(/\/\.\//g, '/');

  test('maps a flat and a namespaced doc name to the same slug', () => {
    expect(slugFromDocName('ui-welcome')).toBe('ui-welcome');
    expect(slugFromDocName('ws/acme/main/ui-welcome')).toBe('ui-welcome');
  });

  test('lands hub-only canvases where the tree can SEE them', () => {
    // Flat, because a slug cannot be un-flattened — but inside the canvas group
    // the slug came from, not at the design root. The tree and `scanCanvases`
    // enumerate `canvasGroups`, so the old design-root target produced a file
    // nobody could see and that never synced onward.
    const targets = pullTargets(
      [
        { name: 'ui-welcome', bytes: 1 },
        { name: 'ws/acme/main/ui-home', bytes: 1 },
      ],
      '/p/.design',
      join,
      resolve,
      '/'
    );
    expect(targets.map((t) => t.bodyAbs)).toEqual([
      '/p/.design/ui/welcome.tsx',
      '/p/.design/ui/home.tsx',
    ]);
    // …and each still slugs back to the document it came from. `ui/ui-welcome.tsx`
    // would be visible AND a different document.
    expect(canvasSlugFromRel('ui/welcome.tsx', '.design')).toBe('ui-welcome');
    // The wire name is kept — the provider must open the document the HUB has,
    // not a name re-derived from the local path.
    expect(targets[1].docName).toBe('ws/acme/main/ui-home');
    // No path arrived, so nothing was believed.
    expect(targets.every((t) => t.fromPath === false)).toBe(true);
  });

  test('uses the path a document carries, once it is known', () => {
    // The listing cannot supply this — it carries names and byte counts only.
    // The runtime re-resolves per document after that document has synced;
    // `pathFor` is that hop, made testable.
    const targets = pullTargets(
      [{ name: 'ws/acme/main/ui-2026-social-summer-camp', bytes: 1 }],
      '/p/.design',
      join,
      resolve,
      '/',
      {
        designRel: '.design',
        canvasGroups: [{ path: 'system' }, { path: 'ui' }],
        pathFor: () => 'ui/2026/social/summer-camp.tsx',
      }
    );
    expect(targets[0].bodyAbs).toBe('/p/.design/ui/2026/social/summer-camp.tsx');
    expect(targets[0].fromPath).toBe(true);
  });

  test('a refused path ends the pull and says why', () => {
    const refusals: string[] = [];
    const targets = pullTargets(
      [{ name: 'ui-welcome', bytes: 1 }],
      '/p/.design',
      join,
      resolve,
      '/',
      {
        designRel: '.design',
        canvasGroups: [{ path: 'ui' }],
        // A perfectly well-formed path that simply is not this document's —
        // the case rule 7 exists for.
        pathFor: () => 'ui/somebody-elses-canvas.tsx',
        onRefused: (slug, reason) => refusals.push(`${slug}: ${reason}`),
      }
    );
    expect(targets).toEqual([]);
    expect(refusals.length).toBe(1);
  });

  test('a document NAME can never write outside the design root', () => {
    // Hub-controlled input, last point before a create. Dots are refused
    // outright, so traversal cannot even form a candidate path.
    const evil = [
      { name: '../../etc/passwd', bytes: 1 },
      { name: '..', bytes: 1 },
      { name: 'ui/../../escape', bytes: 1 },
      { name: 'a b', bytes: 1 },
      { name: '', bytes: 1 },
      { name: 'x'.repeat(500), bytes: 1 },
    ];
    expect(pullTargets(evil, '/p/.design', join, resolve, '/')).toEqual([]);
  });
});

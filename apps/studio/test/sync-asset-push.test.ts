// DDR-217 + the 2026-08-11 addendum — the desktop→cell asset push, both
// classes. Properties under test: the sweep finds top-level content-addressed
// assets AND nested DS/brand assets under system/*/assets/; each routes to the
// right hub endpoint (bucket `/assets/` vs checkout `/_asset-file/`); non-asset
// files (.photo.json) and junk are filtered; the sweep is HEAD-first; the
// credential is read at call time; a failure is reported, never thrown.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isPushableAssetRel,
  listPushableAssets,
  OLDER_HUB_DEPTH_REASON,
  pushAssets,
  putTimeoutMs,
} from '../sync/asset-push.ts';

function scratchDesignRoot(): string {
  return mkdtempSync(join(tmpdir(), 'asset-push-'));
}

describe('listPushableAssets — classifier membership over the whole design root', () => {
  test('finds top-level content-addressed AND nested DS/brand assets', () => {
    const designRoot = scratchDesignRoot();
    // Class 1 — top-level content-addressed uploads (+ a .photo.json sidecar).
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/a1b2c3d4.png'), 'x');
    writeFileSync(join(designRoot, 'assets/a1b2c3d4.photo.json'), '{}'); // metadata, not an asset
    // Class 2 — DS/brand assets under system/<ds>/assets/ (the ones that stayed grey).
    mkdirSync(join(designRoot, 'system/alligators/assets/logos'), { recursive: true });
    mkdirSync(join(designRoot, 'system/alligators/assets/fonts'), { recursive: true });
    mkdirSync(join(designRoot, 'system/alligators/assets/photos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/alligators/assets/logos/horizontal-green.svg'), 'x');
    writeFileSync(join(designRoot, 'system/alligators/assets/fonts/Gators-Bold.woff2'), 'x');
    writeFileSync(join(designRoot, 'system/alligators/assets/photos/P1020428.JPG'), 'x'); // uppercase ext
    // Not under any assets/ dir → never swept.
    mkdirSync(join(designRoot, 'system/alligators/preview'), { recursive: true });
    writeFileSync(join(designRoot, 'system/alligators/preview/logo.tsx'), 'x');
    // Runtime state is skipped.
    mkdirSync(join(designRoot, '_history/assets'), { recursive: true });
    writeFileSync(join(designRoot, '_history/assets/old.png'), 'x');

    // `syncFiles: false` is now stated rather than assumed: the flag defaults
    // ON from Increment 4, so a test that meant "the narrow media sweep" has
    // to say so. What it pins is unchanged.
    expect(listPushableAssets(designRoot, { syncFiles: false })).toEqual([
      'assets/a1b2c3d4.png',
      'system/alligators/assets/fonts/Gators-Bold.woff2',
      'system/alligators/assets/logos/horizontal-green.svg',
      'system/alligators/assets/photos/P1020428.JPG',
    ]);

    // With the plane on, the photo sidecar travels too — it is the
    // non-destructive edit state for that image, and an image whose edits stay
    // behind arrives looking wrong rather than arriving late.
    expect(listPushableAssets(designRoot, { syncFiles: true })).toContain(
      'assets/a1b2c3d4.photo.json'
    );
  });

  test('non-asset extensions and dotfiles are filtered; missing root is []', () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/notes.txt'), 'x');
    writeFileSync(join(designRoot, 'assets/data.json'), 'x');
    writeFileSync(join(designRoot, 'assets/.hidden'), 'x');
    expect(listPushableAssets(designRoot)).toEqual([]);
    expect(listPushableAssets(join(designRoot, 'nope'))).toEqual([]);
  });

  test('a deep pack is found (fix/205); past the 32-segment cap it is skipped', () => {
    const designRoot = scratchDesignRoot();
    // assets/a/b/c/d/e/f/g/x.png = 9 segments — over the OLD cap, found now.
    mkdirSync(join(designRoot, 'assets/a/b/c/d/e/f/g'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/a/b/c/d/e/f/g/x.png'), 'x');
    // 33 segments → skipped.
    const tooDeep = `assets/${'d/'.repeat(31)}`;
    mkdirSync(join(designRoot, tooDeep), { recursive: true });
    writeFileSync(join(designRoot, `${tooDeep}x.png`), 'x');
    expect(listPushableAssets(designRoot)).toEqual(['assets/a/b/c/d/e/f/g/x.png']);
  });

  test('the file-plane widening: the RCA miss-list goes up, canvas lanes stay home', () => {
    // feature-sync-file-plane — the sweep now carries what the fresh-link RCA
    // named laneless: token stylesheets, docs, shared modules, underscore
    // FILES. A canvas body and its named sidecars stay the CRDT lanes'.
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'system/ds/preview'), { recursive: true });
    writeFileSync(join(designRoot, 'config.json'), '{}');
    writeFileSync(join(designRoot, 'system/ds/brand.css'), 'x');
    writeFileSync(join(designRoot, 'system/ds/README.md'), 'x');
    writeFileSync(join(designRoot, 'system/ds/preview/_brand-css.ts'), 'x');
    writeFileSync(join(designRoot, 'system/ds/preview/_layout.css'), 'x');
    writeFileSync(join(designRoot, 'system/ds/preview/specimen.tsx'), 'x');
    writeFileSync(join(designRoot, 'system/ds/preview/specimen.css'), 'x'); // sibling css lane
    writeFileSync(join(designRoot, 'system/ds/preview/specimen.meta.json'), '{}');
    expect(listPushableAssets(designRoot, { syncFiles: true })).toEqual([
      'system/ds/README.md',
      'system/ds/brand.css',
      'system/ds/preview/_brand-css.ts',
      'system/ds/preview/_layout.css',
    ]);
    // Explicitly OFF ⇒ the pre-Sync-v2 reach, byte-for-byte: none of these are
    // binary media under an assets/ dir, so none of them move. This is the
    // documented per-project rollback, so it keeps its own test.
    expect(listPushableAssets(designRoot, { syncFiles: false })).toEqual([]);
  });

  test('declared canvasGroups decide what a canvas body IS', () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'mocks'), { recursive: true });
    mkdirSync(join(designRoot, 'lib'), { recursive: true });
    writeFileSync(join(designRoot, 'mocks/screen.tsx'), 'x');
    writeFileSync(join(designRoot, 'lib/helpers.tsx'), 'x');
    const groups = [{ path: 'mocks' }];
    // `mocks/screen.tsx` is a canvas here; `lib/helpers.tsx` a shared module.
    expect(listPushableAssets(designRoot, { canvasGroups: groups, syncFiles: true })).toEqual([
      'lib/helpers.tsx',
    ]);
    // …and both the groups and the flag reach the walk through config.json —
    // the out-of-process worker's path.
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({ canvasGroups: groups, linkedHub: { url: 'http://h', syncFiles: true } })
    );
    expect(listPushableAssets(designRoot)).toEqual(['lib/helpers.tsx']);
  });
});

describe('pushAssets — routes each class to the right hub endpoint', () => {
  test('top-level → /assets/, DS → /_asset-file/, HEAD-first, live token', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/aaaaaaaa.png'), 'top-level');
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/mark.svg'), 'brand-bytes');

    const calls: Array<{ method: string; url: string; auth: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, url, auth: String(headers.authorization) });
      if (method === 'HEAD') return new Response(null, { status: 404 }); // nothing there yet
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://alligators.cloud.maude.sh/',
      token: () => 'mau_tok',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
    });

    expect(r.failed).toEqual([]);
    expect(r.pushed.sort()).toEqual(['assets/aaaaaaaa.png', 'system/ds/assets/logos/mark.svg']);
    // Top-level → bucket route; DS → checkout route.
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.url);
    expect(puts).toContain('https://alligators.cloud.maude.sh/assets/aaaaaaaa.png');
    expect(puts).toContain(
      'https://alligators.cloud.maude.sh/_asset-file/system/ds/assets/logos/mark.svg'
    );
    expect(calls.every((c) => c.auth === 'Bearer mau_tok')).toBe(true);
  });

  test('skips what the cloud already holds (HEAD 200)', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/there.svg'), 'x');
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: init?.method === 'HEAD' ? 200 : 500 })) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
    });
    expect(r.skipped).toBe(1);
    expect(r.pushed).toEqual([]);
  });

  test('a refused upload is reported, not thrown', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/x.svg'), 'x');
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: init?.method === 'HEAD' ? 404 : 413 })) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
    });
    expect(r.pushed).toEqual([]);
    expect(r.failed).toEqual([{ key: 'system/ds/assets/logos/x.svg', reason: 'HTTP 413' }]);
  });

  test('no assets dir → zero network calls', async () => {
    const designRoot = scratchDesignRoot();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
    });
    expect(calls).toBe(0);
    expect(r).toEqual({ pushed: [], skipped: 0, failed: [] });
  });
});

describe('pushAssets — 429 pacing, 5xx retry, honest failure reasons (RCA 2026-08-11)', () => {
  /** One asset, and a fetch that answers HEAD 404 (nothing on the cloud yet). */
  function oneAsset(): string {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/one.png'), 'bytes');
    return designRoot;
  }

  test('a 429 with Retry-After is waited out once, then the asset lands', async () => {
    const designRoot = oneAsset();
    const slept: number[] = [];
    let puts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      puts += 1;
      return puts === 1
        ? new Response('{"error":"rate limit exceeded"}', {
            status: 429,
            headers: { 'retry-after': '30' },
          })
        : new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(r.pushed).toEqual(['assets/one.png']);
    expect(r.failed).toEqual([]);
    expect(slept).toEqual([30_000]); // the hub's own number, not a guess
    expect(puts).toBe(2);
  });

  test('an absent Retry-After falls back to the 60 s window; a huge one is clamped', async () => {
    for (const [header, expected] of [
      [null, 60_000],
      ['9999', 60_000],
      ['bogus', 60_000],
    ] as const) {
      const designRoot = oneAsset();
      const slept: number[] = [];
      let puts = 0;
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
        if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
        if (init?.method === 'HEAD') return new Response(null, { status: 404 });
        puts += 1;
        return puts === 1
          ? new Response(null, { status: 429, headers: header ? { 'retry-after': header } : {} })
          : new Response(null, { status: 200 });
      }) as typeof fetch;
      const r = await pushAssets({
        designRoot,
        hubUrl: 'https://x.example',
        token: () => 't',
        fetchImpl,
        log: { log: () => {}, warn: () => {} },
        sleep: async (ms) => {
          slept.push(ms);
        },
      });
      expect(slept).toEqual([expected]);
      expect(r.pushed).toEqual(['assets/one.png']);
    }
  });

  test('a second 429 fails the asset and the sweep keeps going', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/a-limited.png'), 'x');
    writeFileSync(join(designRoot, 'assets/b-fine.png'), 'x');
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      return String(input).includes('a-limited')
        ? new Response('{"error":"rate limit exceeded"}', {
            status: 429,
            headers: { 'retry-after': '1' },
          })
        : new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(r.pushed).toEqual(['assets/b-fine.png']);
    expect(r.failed).toEqual([
      { key: 'assets/a-limited.png', reason: 'HTTP 429 — {"error":"rate limit exceeded"}' },
    ]);
  });

  test('a 5xx gets one immediate retry — no wait, no whole new boot', async () => {
    const designRoot = oneAsset();
    const slept: number[] = [];
    let puts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      puts += 1;
      return new Response(null, { status: puts === 1 ? 503 : 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(r.pushed).toEqual(['assets/one.png']);
    expect(puts).toBe(2);
    expect(slept).toEqual([]);
  });

  test('a 4xx that is not 429 is final — one attempt, reported as-is', async () => {
    const designRoot = oneAsset();
    let puts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      puts += 1;
      return new Response(null, { status: 413 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(puts).toBe(1);
    expect(r.failed).toEqual([{ key: 'assets/one.png', reason: 'HTTP 413' }]);
  });

  test('the failure reason carries the body — a Cloudflare page is not our 429', async () => {
    const designRoot = oneAsset();
    const page = `<html>\n  <head><title>503 Service Unavailable</title></head>\n  <body>error 1016 — origin DNS error, and a great deal more text than we keep</body>\n</html>`;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      return new Response(page, { status: 503 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    const reason = r.failed[0].reason;
    expect(reason.startsWith('HTTP 503 — <html> <head><title>503 Service Unavailable')).toBe(true);
    expect(reason.includes('\n')).toBe(false); // collapsed, never multi-line in the panel
    expect(reason.length).toBeLessThanOrEqual('HTTP 503 — '.length + 80);
  });

  test('every PUT carries an explicit Content-Length (the .mov chunked-503 probe)', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/sized.png'), 'twelve bytes');
    const lengths: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      const sent = (init?.headers ?? {}) as Record<string, string>;
      lengths.push(String(sent['content-length']));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
    });
    expect(lengths).toEqual([String('twelve bytes'.length)]);
  });

  test('the per-sweep backoff budget is finite — a 429 wall stops costing time', async () => {
    // 10 assets, every one 429 with a 60 s Retry-After: the 5-minute sweep
    // budget buys 5 paced retries, the rest fail fast for the next boot.
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    for (let i = 0; i < 10; i++) writeFileSync(join(designRoot, `assets/a${i}.png`), 'x');
    const slept: number[] = [];
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 429, headers: { 'retry-after': '60' } })) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(r.failed).toHaveLength(10);
    expect(slept).toEqual([60_000, 60_000, 60_000, 60_000, 60_000]);
  });
});

describe('pushAssets — one batch probe replaces N per-file probes (RCA 2026-08-11 part 2)', () => {
  function twoAssets(): string {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/there.png'), 'x');
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/missing.svg'), '<svg/>');
    return designRoot;
  }

  test('the probe answers once; present files are skipped without any HEAD', async () => {
    const designRoot = twoAssets();
    const calls: string[] = [];
    let probedPaths: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${new URL(String(input)).pathname}`);
      if (String(input).endsWith('/_asset-probe')) {
        probedPaths = JSON.parse(String(init?.body)).paths;
        return new Response(JSON.stringify({ present: ['assets/there.png'] }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(r.skipped).toBe(1);
    expect(r.pushed).toEqual(['system/ds/assets/logos/missing.svg']);
    expect(probedPaths.sort()).toEqual(['assets/there.png', 'system/ds/assets/logos/missing.svg']);
    // One probe, one upload — and NOT a single HEAD.
    expect(calls).toEqual([
      'POST /_asset-probe',
      // The width question (fix/205) — only asked when something is left to send.
      'GET /api/file-limits',
      'PUT /_asset-file/system/ds/assets/logos/missing.svg',
    ]);
  });

  test('a hub that does not know the probe falls back to per-file HEAD', async () => {
    // Old-hub interop: 404 means "ask the old way", never "it holds nothing" —
    // reading it as an empty set would re-upload everything against every hub
    // older than this change.
    const designRoot = twoAssets();
    const methods: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (method === 'HEAD') {
        return new Response(null, { status: String(input).includes('there.png') ? 200 : 404 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(methods.filter((m) => m === 'HEAD')).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.pushed).toEqual(['system/ds/assets/logos/missing.svg']);
  });

  test('a 405 on the per-file probe means "cannot answer", never "absent"', async () => {
    // The bug in one line: a cell turns our HEAD into a GET and answers 405.
    // Treating that as a refusal would strand the file; treating it as "absent"
    // is right — upload it — but it must not be reported as a failure.
    const designRoot = twoAssets();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(r.failed).toEqual([]);
    expect(r.pushed.sort()).toEqual(['assets/there.png', 'system/ds/assets/logos/missing.svg']);
  });

  test('a hostile probe answer cannot make the sweep skip a file it never named', async () => {
    const designRoot = twoAssets();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/_asset-probe')) {
        return new Response(
          JSON.stringify({ present: ['../../etc/passwd', 42, 'assets/never-asked.png'] }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(r.skipped).toBe(0);
    expect(r.pushed.sort()).toEqual(['assets/there.png', 'system/ds/assets/logos/missing.svg']);
  });

  test('a probe that hangs or errors degrades to the per-file path', async () => {
    const designRoot = twoAssets();
    let heads = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) throw new Error('connection reset');
      if (init?.method === 'HEAD') {
        heads += 1;
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(heads).toBe(2);
    expect(r.pushed).toHaveLength(2);
  });
});

describe('pushAssets — a refused upload must not wedge the sweep (2026-08-11, second pass)', () => {
  test('every PUT closes its connection — the keep-alive desync that killed the sidecar', async () => {
    // A peer that refuses a PUT before reading the body leaves unread bytes in
    // the socket; the next request over that pooled connection never gets an
    // answer. Measured: `connection: close` on the retry alone does NOT help —
    // it must be on the request that may be refused. Pin it.
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/one.png'), 'x');
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(null, { status: 503 }); // refused → the retry re-sends
    }) as typeof fetch;
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(seen).toHaveLength(2); // first attempt + the 5xx retry
    expect(seen.every((h) => h.connection === 'close')).toBe(true);
  });

  test('a request that never answers is abandoned, named, and the sweep goes on', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/a-hangs.png'), 'x');
    writeFileSync(join(designRoot, 'assets/b-fine.png'), 'x');
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/_asset-probe')) return new Response(null, { status: 404 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (!String(input).includes('a-hangs')) return new Response(null, { status: 200 });
      // Wedged: answers only when the caller's own budget aborts it.
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
      });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
      timeoutFor: () => 25,
    });
    expect(r.failed).toEqual([
      { key: 'assets/a-hangs.png', reason: 'timed out — the hub stopped answering' },
    ]);
    expect(r.pushed).toEqual(['assets/b-fine.png']);
  });

  test('a hub that refuses the PROBE never gets the body streamed at it', async () => {
    // The deployed cloud door answers 401 for a route it does not have yet —
    // once per DS asset. Uploading anyway is pure waste on every boot.
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'system/ds/assets/logos'), { recursive: true });
    writeFileSync(join(designRoot, 'system/ds/assets/logos/mark.svg'), '<svg/>');
    const methods: string[] = [];
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return new Response('{"error":"sign in to open this project"}', { status: 401 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      sleep: async () => {},
    });
    expect(methods.filter((m) => m === 'PUT')).toEqual([]); // no body streamed at it
    expect(methods).toContain('HEAD');
    expect(r.failed).toEqual([
      {
        key: 'system/ds/assets/logos/mark.svg',
        reason: 'HTTP 401 — {"error":"sign in to open this project"}',
      },
    ]);
  });

  test('the upload budget has a floor, scales with bytes, and is capped', () => {
    expect(putTimeoutMs(0)).toBe(60_000);
    expect(putTimeoutMs(30 * 1024 * 1024)).toBeGreaterThan(5 * 60_000); // the 29.7 MB .mov
    expect(putTimeoutMs(10 * 1024 * 1024 * 1024)).toBe(10 * 60_000);
  });
});

describe('pushAssets — incremental progress (feature-sync-progress-modal)', () => {
  test('emits a first, per-failure and final progress; the final has finished:true', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/ok.png'), 'x');
    writeFileSync(join(designRoot, 'assets/skipme.png'), 'x');
    writeFileSync(join(designRoot, 'assets/zz-bad.png'), 'x');
    // HEAD: only skipme.png is already there. PUT: zz-bad.png fails.
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD')
        return new Response(null, { status: url.includes('skipme') ? 200 : 404 });
      return new Response(null, { status: url.includes('zz-bad') ? 500 : 200 });
    }) as typeof fetch;
    const emits: import('../sync/asset-push.ts').AssetPushProgress[] = [];
    let t = 0;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      onProgress: (p) => emits.push(p),
      now: () => (t += 1), // 1ms apart — inside the throttle window
    });
    expect(r.pushed).toEqual(['assets/ok.png']);
    // First emit fires before anything settles (total known, push visible).
    expect(emits[0]).toMatchObject({ total: 3, done: 0, finished: false });
    // The failure force-emits through the throttle.
    expect(emits.some((p) => p.failedCount === 1 && !p.finished)).toBe(true);
    // Final emit always fires, with the full tally and no active file.
    const last = emits[emits.length - 1];
    expect(last).toEqual({
      total: 3,
      done: 3,
      pushed: 1,
      skipped: 1,
      failedCount: 1,
      failures: [{ key: 'assets/zz-bad.png', reason: 'HTTP 500' }],
      active: null,
      finished: true,
    });
  });

  test('mid-flight emits are throttled; a slow clock lets them through', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(designRoot, `assets/a${i}.png`), 'x');
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: init?.method === 'HEAD' ? 404 : 200 })) as typeof fetch;
    // Fast clock: everything inside 200ms → first + final only.
    const fast: number[] = [];
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      onProgress: (p) => fast.push(p.done),
      now: () => 1,
    });
    expect(fast).toHaveLength(2);
    // Slow clock: 300ms between files → every per-file emit passes.
    let t = 0;
    const slow: number[] = [];
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      onProgress: (p) => slow.push(p.done),
      now: () => (t += 300),
    });
    expect(slow.length).toBeGreaterThanOrEqual(6);
  });

  test('no assets → no progress emits at all (no empty section in the panel)', async () => {
    const designRoot = scratchDesignRoot();
    const emits: unknown[] = [];
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch,
      log: { log: () => {}, warn: () => {} },
      onProgress: (p) => emits.push(p),
    });
    expect(emits).toEqual([]);
  });

  test('a throwing progress listener never breaks the push', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/ok.png'), 'x');
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: init?.method === 'HEAD' ? 404 : 200 })) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      onProgress: () => {
        throw new Error('boom');
      },
    });
    expect(r.pushed).toEqual(['assets/ok.png']);
  });
});

// An asset that appears AFTER boot has to go up now, not next launch.
//
// The sweep fired from exactly one place — `start()` — so a picture pasted into
// an annotation reached the cloud only on the next boot or Resync, while the
// annotation itself synced through the doc in milliseconds. The other side
// rendered an `<image>` pointing at bytes nobody had sent: a permanent empty
// frame that reads as a broken path. `isPushableAssetRel` is what decides an
// `fs:any` event is worth a sweep, so it has to agree with the walk that
// actually collects them.
describe('isPushableAssetRel — the on-change trigger', () => {
  test('it agrees with listPushableAssets on a real tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'pushable-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'system/ds/assets/logos'), { recursive: true });
    mkdirSync(join(root, '_history/ui-home/assets'), { recursive: true });
    mkdirSync(join(root, 'ui'), { recursive: true });
    writeFileSync(join(root, 'assets/5f809613.png'), 'x'); // the reported case
    writeFileSync(join(root, 'system/ds/assets/logos/mark.svg'), 'x');
    writeFileSync(join(root, '_history/ui-home/assets/shot.png'), 'x');
    writeFileSync(join(root, 'ui/Home.tsx'), 'x');
    writeFileSync(join(root, 'assets/notes.txt'), 'x');

    const walked = new Set(listPushableAssets(root));
    for (const rel of [
      'assets/5f809613.png',
      'system/ds/assets/logos/mark.svg',
      '_history/ui-home/assets/shot.png',
      'ui/Home.tsx',
      'assets/notes.txt',
    ]) {
      expect(isPushableAssetRel(rel)).toBe(walked.has(rel));
    }
  });

  test('the pasted-annotation image is what fires it', () => {
    expect(isPushableAssetRel('assets/5f809613.png')).toBe(true);
    expect(isPushableAssetRel('assets/9fb5bab5.jpg')).toBe(true);
  });

  test('runtime state and non-assets never fire a sweep', () => {
    for (const rel of [
      '_history/ui-home/assets/shot.png',
      '_comments/assets/pasted.png',
      'ui/Home.tsx',
      'config.json',
      'system/ds/preview/logo.tsx',
      'assets/notes.txt',
      'assets',
      '',
    ]) {
      expect(isPushableAssetRel(rel)).toBe(false);
    }
  });

  test('a windows-shaped path is normalized, not refused', () => {
    expect(isPushableAssetRel('system\\ds\\assets\\logos\\mark.svg')).toBe(true);
  });
});

// The WIRING, pinned at source (the sync-panel-surface precedent).
//
// `isPushableAssetRel` above is exercised directly; what a unit test cannot
// reach here is that the runtime actually CALLS it from the fs watcher, which
// is the half that was missing. A behavioural test needs a live runtime plus a
// 1.5 s debounce and destabilises `sync-runtime.test.ts`'s shared fixtures, so
// the invariant is pinned where it is cheap and unambiguous instead.
describe('the runtime schedules the legacy push on change, not only at boot', () => {
  const SYNC = readFileSync(join(import.meta.dir, '..', 'sync', 'index.ts'), 'utf8');

  test('the fs watcher decides with isPushableAssetRel and schedules a pass', () => {
    // The predicate gets the project's OWN canvas groups — with the default
    // set a custom-group project's shared module would answer canvas-owned
    // and silently never schedule the pass that uploads it.
    expect(SYNC).toContain('if (isPushableAssetRel(rel, ctx.cfg.canvasGroups)) {');
    expect(SYNC).toContain('scheduleLegacyPush(linkedHub.url);');
  });

  test('bursts coalesce, and a change DURING a pass is not lost', () => {
    // Dragging six images on is six events; each pass costs a probe over the
    // wire. And a file written while a pass runs was not in that pass's list.
    expect(SYNC).toMatch(/ASSET_SWEEP_DEBOUNCE_MS = [\d_]+/);
    expect(SYNC).toContain('legacyPushAgain');
  });

  test('the lane is decided once by the capability probe, and a journal hub never sees the legacy client', () => {
    // Sync v2 Increment 5 — the burn-down's one invariant: exactly ONE push
    // lane per boot. A journal hub gets the plane; only a journal-less hub
    // (or an unreachable/opted-out probe) gets the legacy client.
    expect(SYNC).toContain('decidePushLane(filePlane === null);');
    expect(SYNC).toMatch(
      /if \(stopped \|\| cellPairing \|\| legacyLane !== true\) return; \/\/ the cell never pushes/
    );
    expect(SYNC).toContain(
      'if (legacyLane === false) return; // the plane owns pushes on this hub'
    );
  });

  test('stop() clears the pending pass and cancels a running one', () => {
    expect(SYNC).toContain('if (legacyPushTimer !== null) clearTimeout(legacyPushTimer);');
    expect(SYNC).toContain('legacyPushCancel = true;');
  });
});

describe('pushAssets — the cancel hook (the Sync panel button, legacy window)', () => {
  test('cancelled() abandons the rest of the pass', async () => {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets/aaaaaaaa.png'), 'a');
    writeFileSync(join(designRoot, 'assets/bbbbbbbb.png'), 'b');
    writeFileSync(join(designRoot, 'assets/cccccccc.png'), 'c');

    let puts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') puts += 1;
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const out = await pushAssets({
      designRoot,
      hubUrl: 'https://hub.example.com',
      token: () => 't',
      fetchImpl,
      log: { log: () => {}, warn: () => {} },
      // Cancel after the first upload settles.
      cancelled: () => puts >= 1,
    });
    expect(puts).toBe(1);
    // The rest of the set was neither pushed nor reported failed — it is the
    // next pass's work, exactly like a budget wall.
    expect(out.pushed.length + out.failed.length + out.skipped).toBeLessThan(3);
  });
});

describe('the syncFiles default — Increment 4 flipped it ON', () => {
  // The flip is one boolean in two places (`sync/index.ts` and here), and a
  // drift between them means the sweep and the plane disagree about which
  // files exist — the jurisdiction overlap Sync v2 exists to end. So the
  // default is asserted, not assumed.
  const designRoot = () => {
    const root = scratchDesignRoot();
    mkdirSync(join(root, 'system/ds'), { recursive: true });
    writeFileSync(join(root, 'system/ds/brand.css'), 'x');
    return root;
  };

  test('absent config ⇒ the plane is on', () => {
    expect(listPushableAssets(designRoot())).toEqual(['system/ds/brand.css']);
  });

  test('`linkedHub.syncFiles: false` is the per-project rollback and still works', () => {
    expect(listPushableAssets(designRoot(), { syncFiles: false })).toEqual([]);
  });
});

// fix/205-sync-assets — the studyfi first sync: 5,534 assets went up one at a
// time, one hung PUT stalled the lane for its whole 60 s+ budget and was never
// tried again that boot, and the panel said "5463 moving" for a set the hub
// already held almost all of.
describe('pushAssets — a few at once, a timeout gets a second go, moving is the real work', () => {
  function manyAssets(n: number): string {
    const designRoot = scratchDesignRoot();
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    for (let i = 0; i < n; i++)
      writeFileSync(join(designRoot, `assets/${String(i).padStart(8, '0')}.png`), 'x');
    return designRoot;
  }
  const quiet = { log: () => {}, warn: () => {} };

  test('10 PUTs of 100 ms finish in about 300 ms, not about 1 s', async () => {
    const designRoot = manyAssets(10);
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (String(input).endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 100));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const t0 = performance.now();
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    const ms = performance.now() - t0;
    expect(r.pushed).toHaveLength(10);
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(4);
    expect(ms).toBeLessThan(600);
  });

  test('a hub that advertises a low read rate gets one upload at a time', async () => {
    const designRoot = manyAssets(4);
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (String(input).endsWith('/api/file-limits'))
        return new Response(JSON.stringify({ readsPerMinute: 60 }), { status: 200 });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    expect(r.pushed).toHaveLength(4);
    expect(peak).toBe(1);
  });

  test('a hub-supplied rate can only slow us down, never widen past 4', async () => {
    const designRoot = manyAssets(12);
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (String(input).endsWith('/api/file-limits'))
        return new Response(JSON.stringify({ readsPerMinute: 1e9 }), { status: 200 });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    expect(peak).toBe(4);
  });

  test('a 429 narrows the rest of the sweep to one upload at a time', async () => {
    const designRoot = manyAssets(12);
    let inFlight = 0;
    let peakAfter429 = 0;
    let saw429 = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (url.endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (url.endsWith('00000000.png') && !saw429) {
        saw429 = true;
        return new Response(null, { status: 429, headers: { 'retry-after': '1' } });
      }
      inFlight += 1;
      // The three already in flight when the 429 lands may finish; nothing new starts beside them.
      await new Promise((r) => setTimeout(r, 10));
      if (saw429 && url > 'https://x.example/assets/00000004.png')
        peakAfter429 = Math.max(peakAfter429, inFlight);
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    expect(r.pushed).toHaveLength(12);
    expect(peakAfter429).toBe(1);
  });

  test('a first PUT that times out is tried once more at the end of the sweep', async () => {
    const designRoot = manyAssets(3);
    const attempts = new Map<string, number>();
    const order: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (url.endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      order.push(`${new URL(url).pathname}#${n}`);
      if (url.endsWith('00000000.png') && n === 1)
        return new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
        });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
      timeoutFor: () => 25,
    });
    expect(r.failed).toEqual([]);
    expect(r.pushed.sort()).toEqual([
      'assets/00000000.png',
      'assets/00000001.png',
      'assets/00000002.png',
    ]);
    // Exactly one second go, and only after the rest of the sweep.
    expect(attempts.get('https://x.example/assets/00000000.png')).toBe(2);
    expect(order[order.length - 1]).toBe('/assets/00000000.png#2');
  });

  test('a file that times out twice is reported once, as timed out', async () => {
    const designRoot = manyAssets(1);
    let puts = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (url.endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      puts += 1;
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal?.reason));
      });
    }) as typeof fetch;
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      sleep: async () => {},
      timeoutFor: () => 20,
    });
    expect(puts).toBe(2);
    expect(r.failed).toEqual([
      { key: 'assets/00000000.png', reason: 'timed out — the hub stopped answering' },
    ]);
  });

  test('5,534 assets with 5,460 already on the hub: at most 74 moving from the first emit', async () => {
    const total = 5534;
    const designRoot = manyAssets(total);
    const all = listPushableAssets(designRoot);
    const present = all.slice(0, 5460);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present }), { status: 200 });
      if (url.endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const emits: import('../sync/asset-push.ts').AssetPushProgress[] = [];
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl,
      log: quiet,
      onProgress: (p) => emits.push(p),
      sleep: async () => {},
    });
    expect(r.skipped).toBe(5460);
    expect(r.pushed).toHaveLength(74);
    expect(emits[0]?.total).toBe(total);
    for (const e of emits) expect(e.total - e.done).toBeLessThanOrEqual(74);
  }, 30_000); // 5,534 files on disk — the walk, not the push, is the slow part
});

describe('pushAssets — deep and spaced paths (fix/205-sync-assets)', () => {
  const quiet = { log: () => {}, warn: () => {} };
  function packTree(): string {
    const designRoot = scratchDesignRoot();
    for (const rel of [
      'assets/aaaaaaaa.png',
      'assets/kenney/space-kit/Models/GLTF format/Textures/colormap.png',
      'assets/a/b/c/d/e/f.png',
      'system/ds/assets/pack/Models/GLTF format/Textures/variants/colormap.png',
    ]) {
      mkdirSync(join(designRoot, rel, '..'), { recursive: true });
      writeFileSync(join(designRoot, rel), 'x');
    }
    return designRoot;
  }
  function wire() {
    const puts: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/_asset-probe'))
        return new Response(JSON.stringify({ present: [] }), { status: 200 });
      if (url.endsWith('/api/file-limits')) return new Response(null, { status: 404 });
      if (init?.method === 'PUT') puts.push(new URL(url).pathname);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    return { puts, fetchImpl };
  }

  test('a top-level path the bucket cannot key goes to the checkout route', async () => {
    const designRoot = packTree();
    const w = wire();
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl: w.fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    expect(r.failed).toEqual([]);
    expect(w.puts.sort()).toEqual([
      '/_asset-file/assets/a/b/c/d/e/f.png',
      '/_asset-file/assets/kenney/space-kit/Models/GLTF%20format/Textures/colormap.png',
      '/_asset-file/system/ds/assets/pack/Models/GLTF%20format/Textures/variants/colormap.png',
      '/assets/aaaaaaaa.png',
    ]);
  });

  test('a hub that cannot take deep paths is not sent them — each is named, with the reason', async () => {
    const designRoot = packTree();
    const w = wire();
    const r = await pushAssets({
      designRoot,
      hubUrl: 'https://x.example',
      token: () => 't',
      fetchImpl: w.fetchImpl,
      log: quiet,
      sleep: async () => {},
      hubTakesDeepPaths: false,
    });
    expect(w.puts).not.toContain(
      '/_asset-file/system/ds/assets/pack/Models/GLTF%20format/Textures/variants/colormap.png'
    );
    expect(r.failed).toEqual([
      {
        key: 'system/ds/assets/pack/Models/GLTF format/Textures/variants/colormap.png',
        reason: OLDER_HUB_DEPTH_REASON,
      },
    ]);
    expect(r.pushed).toHaveLength(3);
  });
});

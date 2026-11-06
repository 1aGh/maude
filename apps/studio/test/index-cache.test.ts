// #207 — the project tree answers from the last build (index-cache.ts).
//
// StudyFi's `/_index-data` rebuilt the whole index on every request (13 s on Michal's desktop) and
// threw it away after any write anywhere in the tree, the runtime folders included. These pin:
// a hit does not build again, a change makes exactly one rebuild that concurrent requests share,
// the previous run's copy answers the first request at once (marked stale) and never a `fresh` one,
// and which file events can leave the cache standing.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type CanvasIndexPart,
  createIndexCache,
  isRootRuntimeRel,
  readCanvasIndexSeed,
  writeCanvasIndexSeed,
} from '../index-cache.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createIndexCache', () => {
  test('a hit does not build again', async () => {
    let builds = 0;
    const cache = createIndexCache({ build: async () => ++builds });
    expect((await cache.get()).value).toBe(1);
    expect((await cache.get()).value).toBe(1);
    expect((await cache.get({ fresh: true })).value).toBe(1);
    expect(builds).toBe(1);
  });

  test('concurrent requests share ONE build', async () => {
    let builds = 0;
    const gate = deferred<void>();
    const cache = createIndexCache({
      build: async () => {
        builds++;
        await gate.promise;
        return builds;
      },
    });
    const all = Promise.all([cache.get(), cache.get(), cache.get({ fresh: true }), cache.get()]);
    await Bun.sleep(5);
    expect(cache.stats().running).toBe(true);
    gate.resolve();
    const got = await all;
    expect(got.map((g) => g.value)).toEqual([1, 1, 1, 1]);
    expect(builds).toBe(1);
  });

  test('a change makes the next request rebuild once; requests during it join it', async () => {
    let builds = 0;
    let gate = deferred<void>();
    const cache = createIndexCache({
      build: async () => {
        builds++;
        await gate.promise;
        return builds;
      },
    });
    gate.resolve();
    expect((await cache.get()).value).toBe(1);
    cache.invalidate();
    gate = deferred<void>();
    const a = cache.get();
    const b = cache.get();
    await Bun.sleep(5);
    gate.resolve();
    expect((await a).value).toBe(2);
    expect((await b).value).toBe(2);
    expect(builds).toBe(2);
    expect((await cache.get()).stale).toBe(false);
  });

  test('a change during a build is chased: the answer is from after it', async () => {
    let builds = 0;
    const cache = createIndexCache({
      build: async () => {
        builds++;
        if (builds === 1) cache.invalidate(); // the tree moved while the first build read it
        return builds;
      },
    });
    expect((await cache.get()).value).toBe(2);
  });

  test("the previous run's copy answers the first request at once, marked stale; fresh waits", async () => {
    const gate = deferred<void>();
    let builds = 0;
    const cache = createIndexCache({
      build: async () => {
        builds++;
        await gate.promise;
        return 'built';
      },
      seed: () => 'seed',
    });
    expect(await cache.get()).toEqual({ value: 'seed', stale: true });
    expect(cache.stats().running).toBe(true); // the real build started behind it
    const fresh = cache.get({ fresh: true });
    expect(await cache.get()).toEqual({ value: 'seed', stale: true }); // still building
    gate.resolve();
    expect(await fresh).toEqual({ value: 'built', stale: false });
    expect(await cache.get()).toEqual({ value: 'built', stale: false });
    expect(builds).toBe(1);
  });

  test('a build that fails reaches the waiting caller; the next request builds again', async () => {
    let builds = 0;
    const cache = createIndexCache({
      build: async () => {
        builds++;
        if (builds === 1) throw new Error('disk gone');
        return 'ok';
      },
    });
    await expect(cache.get()).rejects.toThrow('disk gone');
    expect((await cache.get()).value).toBe('ok');
  });
});

describe('isRootRuntimeRel — the events that leave the tree standing', () => {
  test('anything under a root runtime name', () => {
    for (const rel of [
      '_canvas-state/ui-a.view.json',
      '_locator.json',
      '_export-jobs/j1.json',
      '_cache',
      '_state\\conflicts\\x.json',
    ])
      expect(isRootRuntimeRel(rel)).toBe(true);
  });
  test('every tree path, a `_` file deeper down included', () => {
    for (const rel of [
      'ui/a.tsx',
      'ui/a.meta.json',
      'config.json',
      'system/ds/_revs/r1.json',
      'ui/_helpers.ts',
      'README.md',
    ])
      expect(isRootRuntimeRel(rel)).toBe(false);
  });
});

describe('the disk copy', () => {
  const part: CanvasIndexPart = {
    groups: [
      {
        label: 'Canvases',
        paths: ['.design/ui/a.tsx'],
        fullPath: '.design/ui',
        stripPrefix: '.design/ui/',
        kind: 'canvas',
        dirs: ['.design/ui'],
      },
    ],
    canvasDesignSystems: { '.design/ui/a.tsx': 'ds' },
    canvasKinds: {},
  };

  test('round-trips under the same config, 0600', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'idx-seed-'));
    const file = path.join(dir, 'p', 'tree.json');
    writeCanvasIndexSeed(file, part, 'k1');
    expect(readCanvasIndexSeed(file, 'k1')).toEqual(part);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test('another config, another version or a wrong shape is not served', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'idx-seed-'));
    const file = path.join(dir, 'tree.json');
    writeCanvasIndexSeed(file, part, 'k1');
    expect(readCanvasIndexSeed(file, 'k2')).toBeNull();
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...doc, v: 99 }));
    expect(readCanvasIndexSeed(file, 'k1')).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ ...doc, part: { ...part, groups: [{ label: 'x', paths: [1] }] } })
    );
    expect(readCanvasIndexSeed(file, 'k1')).toBeNull();
    writeFileSync(file, 'not json');
    expect(readCanvasIndexSeed(file, 'k1')).toBeNull();
    expect(readCanvasIndexSeed(path.join(dir, 'missing.json'), 'k1')).toBeNull();
  });
});

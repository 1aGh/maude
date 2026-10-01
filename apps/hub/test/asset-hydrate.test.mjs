// Bucket → checkout hydration — the direction that did not exist.
//
// THE INCIDENT THIS PINS. A cell's checkout is ephemeral: the platform migrates
// instances whenever it likes, and `rehydrate.mjs` restores the working set from
// the newest BACKUP GENERATION — so every asset that reached the bucket after
// that generation is simply absent on the next wake. `sweepAssets` mirrors
// checkout → bucket and there was no reverse, so those bytes existed in exactly
// one place the cell could not read. The studio serves the checkout, so canvas
// photographs became grey boxes.
//
// Measured on Brno Alligators (2026-08-13): 53–58 of ~95 bucket-class assets
// 404 in the checkout and 200 in the bucket, immediately after a rollout, three
// times in one afternoon. The only repair anyone had was re-uploading ~388 MB
// from a laptop — a client fixing a server's disk, for bytes the server had.
//
// The two properties that make this safe to run on every boot are asserted
// hardest: it never overwrites, and a hostile key never becomes a path.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  assetNameFromKey,
  createHydrateBudget,
  fileRelFromKey,
  hydrateAssets,
  hydrateFiles,
  missingFromCheckout,
  transientFailures,
} from '../src/asset-lane.mjs';

const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'hub-hydrate-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const silent = () => ({ log: () => {}, warn: () => {}, error: () => {} });

/** A bucket: keys → bytes, behind the two deps hydrateAssets injects. */
function bucket(objects) {
  const store = new Map(Object.entries(objects));
  const gets = [];
  return {
    gets,
    deps: {
      listObjects: async (_c, prefix) =>
        [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 1 })),
      getObject: async (_c, key) => {
        gets.push(key);
        const v = store.get(key);
        return v === undefined ? null : Buffer.from(v);
      },
    },
  };
}

describe('missingFromCheckout (pure)', () => {
  it('is the set difference, deduped and sorted', () => {
    assert.deepEqual(
      missingFromCheckout(['bbbbbbbb.png', 'aaaaaaaa.png', 'bbbbbbbb.png'], new Set()),
      ['aaaaaaaa.png', 'bbbbbbbb.png']
    );
  });

  it('a file already on disk is not missing', () => {
    assert.deepEqual(
      missingFromCheckout(['aaaaaaaa.png', 'bbbbbbbb.png'], new Set(['aaaaaaaa.png'])),
      ['bbbbbbbb.png']
    );
  });

  it('what the proxy will not serve is never written to disk either', () => {
    // Same `servable()` gate the upload sweep asks. A key the proxy would 404
    // is not worth materialising, and the two rules having one home is the
    // reason the upload side stopped carrying its own regex.
    for (const bad of ['../escape.png', '/abs.png', 'back\\slash.png', 'a'.repeat(400)]) {
      assert.deepEqual(missingFromCheckout([bad], new Set()), [], bad);
    }
  });
});

describe('assetNameFromKey', () => {
  it('strips the scope a tenant asked for', () => {
    assert.equal(assetNameFromKey('t-abc/assets/x.png', 't-abc'), 'x.png');
    assert.equal(assetNameFromKey('assets/x.png', ''), 'x.png');
    assert.equal(assetNameFromKey('assets/graphics/camo.png', ''), 'graphics/camo.png');
  });

  it('refuses a key from outside the scope rather than trimming it', () => {
    // "close enough" is how one tenant's media lands in another's checkout.
    assert.equal(assetNameFromKey('t-other/assets/x.png', 't-abc'), null);
    assert.equal(assetNameFromKey('assets/x.png', 't-abc'), null);
    assert.equal(assetNameFromKey('t-abcd/assets/x.png', 't-abc'), null);
  });
});

describe('hydrateAssets', () => {
  it('restores what the bucket has and the checkout lost', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const b = bucket({
      'assets/aaaaaaaa.png': 'photo-one',
      'assets/bbbbbbbb.png': 'photo-two',
    });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['aaaaaaaa.png', 'bbbbbbbb.png']);
    assert.equal(readFileSync(join(dir, 'assets', 'aaaaaaaa.png'), 'utf8'), 'photo-one');
    assert.equal(readFileSync(join(dir, 'assets', 'bbbbbbbb.png'), 'utf8'), 'photo-two');
  });

  it('NEVER overwrites a file the checkout already has', async () => {
    // The bucket is a backup of this checkout, not an authority over it. A
    // path-addressed name (`graphics/camo-bg.png`) can legitimately be NEWER on
    // disk — a local edit not swept up yet — and overwriting is how that edit
    // is lost. Filling gaps is the whole job.
    const dir = tmp();
    mkdirSync(join(dir, 'assets', 'graphics'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'graphics', 'camo.png'), 'LOCAL-AND-NEWER');
    const b = bucket({ 'assets/graphics/camo.png': 'stale-copy' });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, []);
    assert.equal(r.present, 1);
    assert.deepEqual(b.gets, [], 'it does not even pay to download what it will not write');
    assert.equal(
      readFileSync(join(dir, 'assets', 'graphics', 'camo.png'), 'utf8'),
      'LOCAL-AND-NEWER'
    );
  });

  it('creates the assets directory tree it needs', async () => {
    const dir = tmp(); // no `assets/` at all — the post-migration cold case
    const b = bucket({ 'assets/fonts/Gators-Bold.woff2': 'font-bytes' });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['fonts/Gators-Bold.woff2']);
    assert.equal(
      readFileSync(join(dir, 'assets', 'fonts', 'Gators-Bold.woff2'), 'utf8'),
      'font-bytes'
    );
  });

  it('a hostile key never becomes a path outside the assets directory', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const b = bucket({
      'assets/../../../etc/passwd': 'pwned',
      'assets/../escape.png': 'pwned',
      'assets/ok.png': 'fine',
    });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['ok.png']);
    assert.equal(existsSync(join(dir, 'escape.png')), false);
    assert.equal(existsSync(join(tmpdir(), '..', 'etc', 'passwd-maude-test')), false);
  });

  it('a SYMLINK under assets/ is not a way out of it', async () => {
    // Lexical containment is not containment. `resolve()` never follows a link
    // and `mkdirSync(recursive:true)` happily traverses one that already
    // exists — and the checkout is a clone of a repository the TENANT controls,
    // so a committed symlink here is a write-outside primitive inside the cell.
    // The sibling receiver (`sync/remote-docs.ts`) injects a realpath for
    // exactly this; the first version of this function did not.
    const dir = tmp();
    const outside = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    symlinkSync(outside, join(dir, 'assets', 'escape'));
    const b = bucket({
      'assets/escape/pwned.png': 'should never land',
      'assets/ok.png': 'fine',
    });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['ok.png']);
    assert.equal(existsSync(join(outside, 'pwned.png')), false);
    assert.match(r.failed.find((f) => f.key === 'escape/pwned.png')?.reason ?? '', /symlink/);
  });

  it('only reads its own tenant scope', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const b = bucket({
      't-mine/assets/mine.png': 'mine',
      't-other/assets/theirs.png': 'theirs',
    });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: 't-mine',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['mine.png']);
    assert.equal(existsSync(join(dir, 'assets', 'theirs.png')), false);
  });

  it('a failed download does not abort the restore', async () => {
    // A cell that refuses to boot because one GET 502'd is worse than a cell
    // with one missing image, and the next boot retries for free.
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: {
        listObjects: async () => [{ key: 'assets/aaaaaaaa.png' }, { key: 'assets/bbbbbbbb.png' }],
        getObject: async (_c, key) => {
          if (key.includes('aaaa')) throw new Error('502');
          return Buffer.from('two');
        },
      },
    });
    assert.deepEqual(r.restored, ['bbbbbbbb.png']);
    assert.equal(r.failed.length, 1);
  });

  it('an unreachable bucket is reported, never thrown', async () => {
    const dir = tmp();
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: {
        listObjects: async () => {
          throw new Error('network');
        },
      },
    });
    assert.deepEqual(r.restored, []);
    assert.equal(r.listed, 0);
  });

  it('no storage configured is a clean no-op', async () => {
    const r = await hydrateAssets({ designRoot: tmp(), s3: null, log: silent() });
    assert.deepEqual(r.restored, []);
  });

  it('leaves no temp file behind on success', async () => {
    // Temp + rename, so a crash mid-restore cannot leave a truncated image that
    // every later reader treats as a real asset.
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const b = bucket({ 'assets/aaaaaaaa.png': 'bytes' });
    await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    const { readdirSync } = await import('node:fs');
    assert.deepEqual(readdirSync(join(dir, 'assets')), ['aaaaaaaa.png']);
  });

  it('a listing that vanishes between LIST and GET is a reported miss, not a crash', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'assets'), { recursive: true });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: {
        listObjects: async () => [{ key: 'assets/aaaaaaaa.png' }],
        getObject: async () => null,
      },
    });
    assert.deepEqual(r.restored, []);
    assert.equal(r.failed[0].reason, 'not found in the bucket');
  });
});

describe('hydrateFiles — the files/ prefix, the restore half of the write-behind (Increment 5)', () => {
  it('restores an absent plane file, journals it, and never overwrites', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'system/ds'), { recursive: true });
    writeFileSync(join(dir, 'system/ds/existing.css'), 'LOCAL EDIT');
    const written = [];
    const r = await hydrateFiles({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: {
        listObjects: async () => [
          { key: 'files/system/ds/brand.css' },
          { key: 'files/system/ds/existing.css' },
        ],
        getObject: async (_c, key) => Buffer.from(`bucket:${key}`),
      },
      onWritten: (info) => written.push(info.path),
    });
    assert.deepEqual(r.restored, ['system/ds/brand.css']);
    assert.equal(r.present, 1);
    assert.equal(
      readFileSync(join(dir, 'system/ds/brand.css'), 'utf8'),
      'bucket:files/system/ds/brand.css'
    );
    // The local edit survives — the bucket is a shadow, never an authority.
    assert.equal(readFileSync(join(dir, 'system/ds/existing.css'), 'utf8'), 'LOCAL EDIT');
    assert.deepEqual(written, ['system/ds/brand.css']);
  });

  it('a listed key the write door would refuse never becomes a path', async () => {
    // The listing is remote input (DDR-054). Admission is the SAME call the
    // door makes — classifier + symlink containment — so runtime state, canvas
    // lanes and traversal shapes are refused identically.
    const dir = tmp();
    const r = await hydrateFiles({
      designRoot: dir,
      s3: { bucket: 'x' },
      prefix: '',
      log: silent(),
      deps: {
        listObjects: async () => [
          { key: 'files/_history/x.png' },
          { key: 'files/config.json' },
          { key: 'files/../escape.css' },
          { key: 'other-prefix/system/ds/brand.css' },
        ],
        getObject: async () => Buffer.from('x'),
      },
    });
    assert.deepEqual(r.restored, []);
    assert.equal(existsSync(join(dir, '_history/x.png')), false);
    assert.equal(existsSync(join(dir, 'config.json')), false);
  });

  it('fileRelFromKey refuses a foreign scope rather than trimming it', () => {
    assert.equal(fileRelFromKey('files/system/ds/a.css'), 'system/ds/a.css');
    assert.equal(fileRelFromKey('t1/files/system/ds/a.css', 't1'), 'system/ds/a.css');
    assert.equal(fileRelFromKey('t2/files/system/ds/a.css', 't1'), null);
    assert.equal(fileRelFromKey('system/ds/a.css'), null);
  });
});

// Cell materializer Phase 0 (Task 3). Brno Alligators, 2026-10-01: ~7.8 GB
// synced onto an 8 GB cell disk. "Restore everything missing" drove boot into
// ENOSPC, the process died, and the next cold start began the same download.
describe('hydrate budget — the boot restore stops before the disk does', () => {
  /** A streaming bucket: keys → bytes, through `getObjectToFile` only. */
  function streamingBucket(objects) {
    const order = [];
    return {
      order,
      deps: {
        listObjects: async (_c, prefix) =>
          Object.entries(objects)
            .filter(([k]) => k.startsWith(prefix))
            .map(([key, v]) => ({ key, size: Buffer.byteLength(v) })),
        getObjectToFile: async (_c, key, abs) => {
          order.push(key);
          if (!(key in objects)) return null;
          writeFileSync(abs, objects[key]);
          return Buffer.byteLength(objects[key]);
        },
      },
    };
  }
  const report =
    (free = 1e12, total = 2e12, floor = 0) =>
    async () => ({ totalBytes: total, freeBytes: free, floorBytes: floor, pressure: free < floor });

  it('restores code and companion text BEFORE inert media, whatever the key order', async () => {
    const dir = tmp();
    const b = streamingBucket({
      'files/system/ds/assets/a-photo.jpg': 'JPG',
      'files/system/ds/brand.css': '.a{}',
      'files/system/ds/_brand-css.ts': 'export {}',
    });
    const r = await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(b.order, [
      'files/system/ds/_brand-css.ts',
      'files/system/ds/brand.css',
      'files/system/ds/assets/a-photo.jpg',
    ]);
    assert.equal(r.restored.length, 3);
    assert.equal(r.skippedForBudget, 0);
  });

  it('a spent byte budget leaves inert media in the bucket — and counts it', async () => {
    const dir = tmp();
    const b = streamingBucket({
      'files/system/ds/_brand-css.ts': 'export {}', // 9 bytes
      'files/system/ds/brand.css': '.a{}', // 4 bytes
      'files/system/ds/assets/big.jpg': 'X'.repeat(100),
    });
    const budget = await createHydrateBudget({
      designRoot: dir,
      env: { MAUDE_HYDRATE_BUDGET_BYTES: '50' },
      deps: { diskReport: report() },
    });
    const r = await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
      budget,
    });
    assert.deepEqual(r.restored, ['system/ds/_brand-css.ts', 'system/ds/brand.css']);
    assert.equal(r.skippedForBudget, 1);
    assert.equal(existsSync(join(dir, 'system/ds/assets/big.jpg')), false);
    assert.ok(!b.order.includes('files/system/ds/assets/big.jpg'), 'never even downloaded');
  });

  it('the free-space floor stops it too, and ONE budget spans both hydrators', async () => {
    const dir = tmp();
    let free = 9_000;
    const budget = await createHydrateBudget({
      designRoot: dir,
      env: {},
      deps: { diskReport: async () => report(free, 10_000, 500)() },
    });
    assert.equal(budget.bytes, 5_000, 'default: half the disk');
    const files = streamingBucket({ 'files/system/ds/brand.css': '.a{}' });
    await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: files.deps,
      budget,
    });
    free = 900; // above the 500 floor — but inside the headroom above it
    const assets = streamingBucket({ 'assets/aaaaaaaa.png': 'PNG' });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: assets.deps,
      budget,
    });
    assert.equal(budget.spent(), 4);
    assert.deepEqual(r.restored, []);
    assert.equal(r.skippedForBudget, 1);
    assert.deepEqual(assets.order, []);
  });

  it('hydrateAssets STREAMS — getObjectToFile, never a whole-object buffer', async () => {
    const dir = tmp();
    const b = streamingBucket({ 'assets/aaaaaaaa.png': 'PNG' });
    const r = await hydrateAssets({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['aaaaaaaa.png']);
    assert.deepEqual(b.order, ['assets/aaaaaaaa.png']);
    assert.equal(readFileSync(join(dir, 'assets/aaaaaaaa.png'), 'utf8'), 'PNG');
  });

  it('`classes` restricts the restore (Phase 1 restores only what builds)', async () => {
    const dir = tmp();
    const b = streamingBucket({
      'files/system/ds/brand.css': '.a{}',
      'files/system/ds/assets/p.jpg': 'JPG',
    });
    const r = await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
      classes: ['code-module', 'companion-text'],
    });
    assert.deepEqual(r.restored, ['system/ds/brand.css']);
    assert.equal(r.skippedForBudget, 0, 'a class filter is not a budget skip');
  });

  it('stops ABOVE the floor — a floor-stopped boot must not shut the write doors', async () => {
    // Attacker review #1: an `admit` that refused only once free < floor
    // ended every floor-stopped hydrate exactly where the doors refuse, with
    // nothing on the cell to reopen them. The hydrate keeps one more floor's
    // worth of headroom, read fresh before every download.
    const dir = tmp();
    const budget = await createHydrateBudget({
      designRoot: dir,
      env: {},
      deps: { diskReport: report(2_600, 1_000_000, 1_000) },
    });
    assert.equal(budget.bytes, 600, 'clamped to the free space above floor + headroom');
    assert.equal(await budget.admit(500), 'ok'); // 2 100 left ≥ 2 000
    assert.equal(await budget.admit(601), 'budget');
  });

  it('half the TOTAL disk is clamped to what is actually free', async () => {
    const budget = await createHydrateBudget({
      designRoot: tmp(),
      env: { MAUDE_HYDRATE_BUDGET_BYTES: '1000000' },
      deps: { diskReport: report(5_000, 10_000, 1_000) },
    });
    assert.equal(budget.bytes, 3_000);
  });

  it('a refused key is a PERMANENT failure — it never marks a boot partial', async () => {
    // Defender W4: one key refused on every boot would otherwise switch the
    // lost-file pass off forever.
    const dir = tmp();
    const b = streamingBucket({
      'files/_history/x.png': 'X', // runtime state: refused by admission
      'files/system/ds/brand.css': '.a{}',
    });
    const r = await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.equal(r.failed.length, 1);
    assert.equal(transientFailures(r), 0);
    const flaky = await hydrateFiles({
      designRoot: tmp(),
      s3: {},
      prefix: '',
      log: silent(),
      deps: {
        listObjects: b.deps.listObjects,
        getObjectToFile: async () => {
          throw new Error('S3 GET failed: 503');
        },
      },
    });
    assert.equal(transientFailures(flaky), 1);
  });

  it('a symlink planted at the temp name is unlinked, never written through', async () => {
    // Defender W1 (predates Phase 0): containment is judged on the target,
    // and the checkout is a tenant-controlled clone that can carry a link at
    // `<name>.hydrating-<pid>`.
    const dir = tmp();
    const outside = tmp();
    mkdirSync(join(dir, 'system/ds'), { recursive: true });
    const victim = join(outside, 'victim.txt');
    writeFileSync(victim, 'ORIGINAL');
    symlinkSync(victim, join(dir, `system/ds/brand.css.hydrating-${process.pid}`));
    const b = streamingBucket({ 'files/system/ds/brand.css': '.a{}' });
    const r = await hydrateFiles({
      designRoot: dir,
      s3: {},
      prefix: '',
      log: silent(),
      deps: b.deps,
    });
    assert.deepEqual(r.restored, ['system/ds/brand.css']);
    assert.equal(readFileSync(victim, 'utf8'), 'ORIGINAL');
  });
});

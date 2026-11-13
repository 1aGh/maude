// The post-deploy gate, against a stubbed responder.
//
// The `cells` lane of 1aGh/maude-deploy (deploy.yml) runs this loop against a live tenant cell after a release
// tag deploys, and until it existed "green" meant "an image was pushed and a
// Worker was deployed" — both true on the release that put a six-day-old hub
// layer into production. The properties below are the ones that make green
// mean "the fleet answers on the released version":
//
//   - a cell reporting the released version AND the bytes this run built passes
//   - a stale VERSION fails even when the hash is perfect (the v0.57.0 shape:
//     a self-consistent wrong image)
//   - a stale HASH fails even when the version is right (same tag, other bytes)
//   - silence is patience, not failure — the first request after a roll pays a
//     cold start the release guide measures in minutes
//   - and it eventually gives up, saying what it last saw

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'verify-fleet-release.sh');

const VERSION = '0.58.0';
const CLIENT = 'abc123def456';

/**
 * A `/health` payload, in the shape the server ACTUALLY emits.
 *
 * `client` is a SIBLING of `studio`, not a child of it. The first cut of this
 * fixture nested it, the script read `.studio.client…` to match, and both
 * agreed with each other and with nothing else — the gate could only ever time
 * out, and it shipped green. Recorded here from a live cell
 * (`alligators.cloud.maude.sh/health`, v0.58.0) rather than written from
 * memory, and pinned at the producer by `apps/hub/test/health.test.mjs`.
 */
const health = (over = {}) => ({
  ok: true,
  version: VERSION,
  releaseVersion: VERSION,
  studio: { ok: true, state: 'ready', port: 4399, restarts: 0, lastExit: null },
  client: { ok: true, artifacts: { 'dist/client.bundle.js': CLIENT } },
  ...over,
});

/**
 * Serve a scripted sequence of responses, one per request.
 *
 * `null` means "do not answer" (a cold-starting cell); the last entry repeats
 * so a test can say "and it stays that way".
 */
async function withResponder(sequence, fn) {
  let n = 0;
  const seen = [];
  const server = createServer((_req, res) => {
    const next = sequence[Math.min(n, sequence.length - 1)];
    n += 1;
    seen.push(next);
    if (next === null) {
      res.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(next));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/health`;
  try {
    return await fn(url, () => seen.length);
  } finally {
    server.close();
  }
}

/** Run the gate with a fast poll cadence — the timing is not what is under test. */
function runGate(url, { version = `v${VERSION}`, client = CLIENT, attempts = 4 } = {}) {
  return execFileAsync('bash', [SCRIPT, url, version, client], {
    env: {
      ...process.env,
      FLEET_VERIFY_ATTEMPTS: String(attempts),
      FLEET_VERIFY_SLEEP: '0',
      FLEET_VERIFY_TIMEOUT: '5',
    },
  });
}

test('a cell on the released version, serving this run’s bytes, passes', async () => {
  await withResponder([health()], async (url) => {
    const { stdout } = await runGate(url);
    assert.match(stdout, /the fleet is running 0\.58\.0/);
  });
});

test('the leading v on a git tag is not a mismatch', async () => {
  // The tag is `v0.58.0`; /health reports `0.58.0`. Comparing them raw is an
  // off-by-one-character way to fail every release.
  await withResponder([health()], async (url) => {
    await runGate(url, { version: 'v0.58.0' });
  });
});

test('a STALE VERSION fails even when every hash matches', async () => {
  // The v0.57.0 shape. The stale layer sealed its own bundles, so the manifest
  // was self-consistent — only the version says the layer is a release behind.
  await withResponder([health({ releaseVersion: '0.57.0' })], async (url) => {
    const err = await runGate(url).then(
      () => null,
      (e) => e
    );
    assert.ok(err, 'the gate passed a cell running the PREVIOUS release');
    assert.match(err.stdout, /releaseVersion=0\.57\.0/);
    assert.match(err.stdout, /never came up/);
  });
});

test('a STALE HASH fails even when the version is right', async () => {
  // Same tag, different bytes — what bundle-identity.mjs was written about.
  await withResponder(
    [
      health({
        client: { ok: true, artifacts: { 'dist/client.bundle.js': 'ffffffffffff' } },
      }),
    ],
    async (url) => {
      const err = await runGate(url).then(
        () => null,
        (e) => e
      );
      assert.ok(err, 'the gate passed a cell serving bytes this run never built');
      assert.match(err.stdout, /client=ffffffffffff/);
    }
  );
});

test('an image too old to report the version reads as absent, not as a match', async () => {
  const { releaseVersion: _omitted, ...noVersion } = health();
  await withResponder([noVersion], async (url) => {
    const err = await runGate(url).then(
      () => null,
      (e) => e
    );
    assert.ok(err);
    assert.match(err.stdout, /releaseVersion=absent/);
  });
});

test('silence is a cold start, and the gate keeps waiting through it', async () => {
  // Rehydrate-from-R2 is minutes on a GB-scale project. A gate that gave up on
  // the first empty response would fail every release it was meant to verify.
  await withResponder([null, null, health()], async (url, count) => {
    const { stdout } = await runGate(url, { attempts: 6 });
    assert.match(stdout, /no response \(cold start\?\)/);
    assert.match(stdout, /the fleet is running/);
    assert.ok(count() >= 3, 'the gate stopped polling before the cell woke up');
  });
});

test('giving up says what it last saw', async () => {
  await withResponder([health({ releaseVersion: '0.1.0' })], async (url) => {
    const err = await runGate(url, { attempts: 2 }).then(
      () => null,
      (e) => e
    );
    assert.ok(err);
    // The whole point: the operator must not have to go hand-probe production
    // to find out what the fleet actually answered.
    assert.match(err.stdout, /Last \/health: .*"releaseVersion":"0\.1\.0"/);
    assert.match(err.stdout, /derived from the wrong layer/);
  });
});

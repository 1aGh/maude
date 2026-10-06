import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  addHub,
  getHub,
  hubsConfigPath,
  loadHubsConfig,
  normalizeUrl,
  removeHub,
  saveHubsConfig,
  setHubCodeModules,
  setHubUnlimitedDeletes,
} from './hubs-config.mjs';

function withTmpConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hubs-cfg-'));
  const path = join(dir, 'hubs.json');
  const prior = process.env.HUBS_CONFIG_PATH;
  process.env.HUBS_CONFIG_PATH = path;
  try {
    return fn(path);
  } finally {
    // `env.X = undefined` sets the STRING "undefined", so the override leaked
    // out of the harness and every later `addHub` in the same process wrote a
    // file literally named `undefined` into the repo root. `delete` is the
    // only way to actually unset it.
    if (prior === undefined) delete process.env.HUBS_CONFIG_PATH;
    else process.env.HUBS_CONFIG_PATH = prior;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hubsConfigPath honors HUBS_CONFIG_PATH override', () => {
  withTmpConfig((path) => {
    assert.equal(hubsConfigPath(), path);
  });
});

test('loadHubsConfig returns empty when file missing', () => {
  withTmpConfig(() => {
    assert.deepEqual(loadHubsConfig(), { hubs: {} });
  });
});

test('saveHubsConfig writes file at 0600 with parent dir creation', () => {
  withTmpConfig((path) => {
    saveHubsConfig({ hubs: { 'https://h.example': { token: 'mau_x', linkedAt: 1 } } });
    assert.ok(existsSync(path));
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(parsed.hubs['https://h.example'].token, 'mau_x');
  });
});

test('addHub upserts the same URL', () => {
  withTmpConfig(() => {
    addHub('https://h.example', 'mau_first');
    addHub('https://h.example', 'mau_second');
    const { hubs } = loadHubsConfig();
    assert.equal(Object.keys(hubs).length, 1);
    assert.equal(hubs['https://h.example'].token, 'mau_second');
  });
});

test('removeHub returns false when entry absent, true when removed', () => {
  withTmpConfig(() => {
    assert.equal(removeHub('https://nope.example'), false);
    addHub('https://h.example', 'mau_x');
    assert.equal(removeHub('https://h.example'), true);
    assert.equal(getHub('https://h.example'), null);
  });
});

test('getHub returns the record when present', () => {
  withTmpConfig(() => {
    addHub('https://h.example', 'mau_x');
    const rec = getHub('https://h.example');
    assert.ok(rec);
    assert.equal(rec.token, 'mau_x');
    assert.equal(typeof rec.linkedAt, 'number');
  });
});

test('normalizeUrl lowercases scheme + host, strips trailing slash', () => {
  assert.equal(normalizeUrl('HTTPS://Foo.Example.com/'), 'https://foo.example.com');
  assert.equal(normalizeUrl('http://localhost:1234'), 'http://localhost:1234');
  assert.equal(normalizeUrl('https://foo.example.com/path'), 'https://foo.example.com/path');
});

test('normalizeUrl throws on bad input', () => {
  assert.throws(() => normalizeUrl(''), /url must be a non-empty string/);
  assert.throws(() => normalizeUrl('not a url'), /invalid url/);
});

test('addHub keys URLs case-insensitively (same hub after host normalization)', () => {
  withTmpConfig(() => {
    addHub('https://HUB.example.com', 'mau_first');
    addHub('https://hub.example.com/', 'mau_second');
    const { hubs } = loadHubsConfig();
    assert.equal(Object.keys(hubs).length, 1);
    assert.equal(hubs['https://hub.example.com'].token, 'mau_second');
  });
});

// Cloud Phase 25 C2 — the studio writes `role` into this shared file, and a
// CLI relink used to replace the record wholesale and drop it. Not an access
// hole (the cell refuses the write regardless), but it would silently show a
// viewer the editing UI again, which is exactly what the flag exists to stop.
test('a relink preserves the vouched role, and still clears per-machine attestations', () => {
  withTmpConfig(() => {
    addHub('https://p.cloud.maude.sh', 'mau_first', { adoptedAt: 111 });
    // The studio stamps the role after a workspace sign-in.
    const cfg = loadHubsConfig();
    cfg.hubs['https://p.cloud.maude.sh'].role = 'viewer';
    saveHubsConfig(cfg);

    const after = addHub('https://p.cloud.maude.sh', 'mau_second');
    assert.equal(after.token, 'mau_second');
    assert.equal(after.role, 'viewer', 'the role survives a relink');
    assert.equal(after.adoptedAt, undefined, 'a per-machine attestation does not');
  });
});

// The code-module consent — the finding was that `codeModulesAllowed` was
// declared, read by the receiver, and set by NOTHING. So the gate could never
// open and `code-module` had no transport at all in hub-owned mode: an owner
// could push one through the door and no peer would ever accept it, which is
// the same "delivered nowhere" shape the file plane was built to fix.
//
// Through `withTmpConfig` like every other test here — the config is a real
// file on a real path, so a test that skips the harness reads whatever the
// previous one left behind.

test('the consent records, and survives a token re-save', () => {
  withTmpConfig(() => {
    const url = 'https://consent.example.test';
    addHub(url, 'tok-1');
    assert.equal(getHub(url).codeModulesAllowed, undefined, 'absent means no');

    setHubCodeModules(url, true);
    assert.equal(getHub(url).codeModulesAllowed, true);

    // A silent token renewal must not revoke a decision the person made.
    addHub(url, 'tok-2');
    assert.equal(getHub(url).codeModulesAllowed, true);
    assert.equal(getHub(url).token, 'tok-2');
  });
});

test('the consent is false for anything that is not an explicit yes', () => {
  withTmpConfig(() => {
    const url = 'https://consent-strict.example.test';
    addHub(url, 't');
    setHubCodeModules(url, 'yes');
    assert.equal(getHub(url).codeModulesAllowed, false);
  });
});

test('setting consent on an unlinked hub does nothing', () => {
  withTmpConfig(() => {
    assert.equal(setHubCodeModules('https://nobody.example.test', true), false);
  });
});

// ── expiresAt across a relink (2026-09-03) ──────────────────────────────────
//
// The observed loss: a record written by workspace sign-in carried
// `expiresAt`, and `maude design link … --adopt` replaced it with one that did
// not. A record with no expiry means `scheduleRenewal()` (sync/index.ts) arms
// no timer at all, so the credential dies mid-session with nothing having
// tried to renew it — which, combined with the file plane having no 401
// handling of its own, is a long seed dying silently.

test('addHub carries expiresAt when the token is unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hubs-exp-'));
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  try {
    // What a workspace sign-in writes.
    const cfg = {
      hubs: {
        'https://h.test': { token: 'tok-a', linkedAt: 1, role: 'member', expiresAt: 1788476063819 },
      },
    };
    saveHubsConfig(cfg);

    const relinked = addHub('https://h.test', 'tok-a', { adoptedAt: 2 });
    assert.equal(relinked.expiresAt, 1788476063819, 'the same token keeps its expiry');
    assert.equal(relinked.role, 'member');
    assert.equal(relinked.adoptedAt, 2);
  } finally {
    delete process.env.HUBS_CONFIG_PATH;
  }
});

test('addHub DROPS expiresAt when the token changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hubs-exp2-'));
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  try {
    saveHubsConfig({
      hubs: { 'https://h.test': { token: 'tok-a', linkedAt: 1, expiresAt: 1788476063819 } },
    });
    // A stale expiry against a NEW token is worse than none: it would arm the
    // renewal timer at the wrong instant and spend a no-progress slot.
    const relinked = addHub('https://h.test', 'tok-b');
    assert.equal(relinked.expiresAt, undefined);
  } finally {
    delete process.env.HUBS_CONFIG_PATH;
  }
});

test('addHub on a fresh record is unchanged — no expiry invented', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-hubs-exp3-'));
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  try {
    const fresh = addHub('https://h.test', 'tok-a');
    assert.equal(fresh.expiresAt, undefined);
    assert.equal(fresh.token, 'tok-a');
  } finally {
    delete process.env.HUBS_CONFIG_PATH;
  }
});

test('the bulk-deletes consent records, and survives a token re-save', () => {
  withTmpConfig(() => {
    addHub('https://hub.example.com', 'tok-1');
    assert.equal(getHub('https://hub.example.com').unlimitedDeletes, undefined);
    assert.equal(setHubUnlimitedDeletes('https://hub.example.com', true), true);
    addHub('https://hub.example.com', 'tok-2');
    assert.equal(getHub('https://hub.example.com').unlimitedDeletes, true);
    setHubUnlimitedDeletes('https://hub.example.com', 'yes');
    assert.equal(getHub('https://hub.example.com').unlimitedDeletes, false);
    assert.equal(setHubUnlimitedDeletes('https://nope.example.com', true), false);
  });
});

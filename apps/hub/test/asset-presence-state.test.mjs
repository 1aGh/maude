// S8.19 — the asset-presence state rule (contract S8-S9-asset-presence.md §5.3),
// as a table over the pure store. The route and the probe feed are covered by
// asset-presence-acl / asset-probe-held.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  createAssetPresence,
  MAX_PRESENCE_DEVICES,
  PRESENCE_EXPIRY_MS,
  presenceAccountOf,
} from '../src/asset-presence.mjs';

const DAY = 24 * 60 * 60 * 1000;

function rig() {
  let t = 1_000_000;
  const store = createAssetPresence({ now: () => t, setTimer: () => 0, clearTimer: () => {} });
  const dev = (key, email) => ({
    key,
    name: email.split('@')[0],
    kind: null,
    account: presenceAccountOf(email),
  });
  const jonas = dev('jonas-mac', 'jonas@x.test');
  const jonasMini = dev('jonas-mini', 'jonas@x.test');
  const tereza = dev('tereza-mac', 'tereza@x.test');
  const ask = (rel, who = tereza, { inScope = true, hasBytes = false } = {}) =>
    store.stateFor({ rel, inScope, hasBytes, asker: who });
  return {
    store,
    jonas,
    jonasMini,
    tereza,
    ask,
    tick: (ms = 1) => {
      t += ms;
    },
  };
}

describe('§5.3 state rule', () => {
  test('out of scope is unknown, and records nothing', () => {
    const r = rig();
    r.store.recordProbe({ device: r.jonas, rels: ['assets/a.png'] });
    assert.deepEqual(r.ask('assets/a.png', r.tereza, { inScope: false }), { state: 'unknown' });
    assert.deepEqual(r.ask('assets/never.png', r.tereza, { inScope: false }), { state: 'unknown' });
    assert.deepEqual(r.store.snapshot().firstAskedAt, {});
  });

  test('bytes on the hub are here', () => {
    const r = rig();
    assert.deepEqual(r.ask('assets/a.png', r.tereza, { hasBytes: true }), { state: 'here' });
  });

  test('another device holds it → waiting{who}, name only, self by account', () => {
    const r = rig();
    r.store.recordProbe({ device: r.jonas, rels: ['assets/a.png'] });
    const s = r.ask('assets/a.png');
    assert.deepEqual(s, { state: 'waiting', who: { name: 'jonas', kind: null, self: false } });
    assert.equal(JSON.stringify(s).includes('@'), false, 'no e-mail in an answer');
    // Jonas's other Mac asking: "Waiting for your other Mac".
    assert.equal(r.ask('assets/a.png', r.jonasMini).who.self, true);
  });

  test('the asking device holding it does not make it waiting on itself', () => {
    const r = rig();
    r.store.recordProbe({
      device: r.jonas,
      rels: ['assets/a.png'],
      sweep: { id: 's1', final: true },
    });
    r.tick();
    // Jonas asks about his own file (bytes not on the hub) → no other holder.
    const s = r.ask('assets/a.png', r.jonas);
    assert.equal(s.who, undefined);
  });

  test('no device ever swept → waiting (a v1-only team stays conservative)', () => {
    const r = rig();
    assert.deepEqual(r.ask('assets/a.png'), { state: 'waiting' });
    r.store.recordProbe({ device: r.jonas, rels: [] }); // seen, but no finished sweep
    r.tick();
    assert.deepEqual(r.ask('assets/a.png'), { state: 'waiting' });
  });

  test('missing only after every recent device swept after the reference appeared', () => {
    const r = rig();
    r.store.recordProbe({ device: r.jonas, rels: [], sweep: { id: 's0', final: true } });
    r.tick();
    // Swept BEFORE the first query: still waiting.
    assert.deepEqual(r.ask('assets/a.png'), { state: 'waiting' });
    r.tick();
    r.store.recordProbe({ device: r.tereza, rels: [], sweep: { id: 't1', final: true } });
    r.tick();
    // Jonas has not swept since — waiting.
    assert.deepEqual(r.ask('assets/a.png'), { state: 'waiting' });
    r.tick();
    r.store.recordProbe({ device: r.jonas, rels: [], sweep: { id: 's1', final: true } });
    r.tick();
    assert.deepEqual(r.ask('assets/a.png'), { state: 'missing' });
  });

  test('waiting → missing when the holder sweeps without the file (final prunes)', () => {
    const r = rig();
    r.store.recordProbe({
      device: r.jonas,
      rels: ['assets/a.png', 'assets/b.png'],
      sweep: { id: 's1', final: true },
    });
    r.tick();
    assert.equal(r.ask('assets/a.png').state, 'waiting');
    r.tick();
    // Next sweep, two batches: only b.png reported; the final batch prunes a.png.
    r.store.recordProbe({ device: r.jonas, rels: ['assets/b.png'], sweep: { id: 's2' } });
    r.store.recordProbe({ device: r.jonas, rels: [], sweep: { id: 's2', final: true } });
    r.tick();
    assert.equal(r.ask('assets/a.png').state, 'missing');
    assert.equal(r.ask('assets/b.png').who.name, 'jonas', 'an earlier batch of the run is kept');
  });

  test('a batch without `final` never prunes', () => {
    const r = rig();
    r.store.recordProbe({
      device: r.jonas,
      rels: ['assets/a.png'],
      sweep: { id: 's1', final: true },
    });
    r.store.recordProbe({ device: r.jonas, rels: [], sweep: { id: 's2' } });
    r.tick();
    assert.equal(r.ask('assets/a.png').state, 'waiting');
  });

  test('30-day expiry: a holder gone for a month stops keeping a file waiting', () => {
    const r = rig();
    r.store.recordProbe({
      device: r.jonas,
      rels: ['assets/a.png'],
      sweep: { id: 's1', final: true },
    });
    r.tick();
    assert.equal(r.ask('assets/a.png').state, 'waiting');
    r.tick(PRESENCE_EXPIRY_MS + DAY);
    r.store.recordProbe({ device: r.tereza, rels: [], sweep: { id: 't1', final: true } });
    r.tick();
    assert.equal(r.ask('assets/a.png').state, 'missing');
    assert.equal(r.store.snapshot().devices['jonas-mac'], undefined);
  });

  test('bytes landing clear the first-asked clock', () => {
    const r = rig();
    r.ask('assets/a.png');
    assert.ok(r.store.snapshot().firstAskedAt['assets/a.png']);
    r.ask('assets/a.png', r.tereza, { hasBytes: true });
    assert.equal(r.store.snapshot().firstAskedAt['assets/a.png'], undefined);
  });

  test('the device cap evicts the least recently seen device', () => {
    const r = rig();
    for (let i = 0; i < MAX_PRESENCE_DEVICES + 1; i++) {
      r.store.recordProbe({
        device: { key: `d${i}`, name: `n${i}`, kind: null, account: `a${i}` },
        rels: [],
      });
      r.tick();
    }
    const devices = Object.keys(r.store.snapshot().devices);
    assert.equal(devices.length, MAX_PRESENCE_DEVICES);
    assert.equal(devices.includes('d0'), false);
  });
});

describe('persistence', () => {
  test('flush writes <dataDir>/asset-presence.json and a new store reads it back', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-presence-'));
    try {
      const a = createAssetPresence({ dataDir });
      a.recordProbe({
        device: { key: 'jonas-mac', name: 'jonas', kind: null, account: 'x' },
        rels: ['assets/a.png'],
      });
      a.flush();
      const b = createAssetPresence({ dataDir });
      assert.ok(b.snapshot().holders['assets/a.png']['jonas-mac']);
      assert.equal(
        b.stateFor({
          rel: 'assets/a.png',
          inScope: true,
          hasBytes: false,
          asker: { key: 'other', account: 'y' },
        }).who.name,
        'jonas'
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

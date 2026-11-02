// p8-ia-edges item 3 (Michal 2026-10-29, ia-edges): a team server with no media checkout cannot store pictures and
// videos. The upload pass learns it from the first refused PUT, says so ONCE in plain words, and stops asking:
// no retry per poll tick, no retry per file change. It asks again only when the server's state changes
// (version, capabilities, project format — which is what a reconnect to a server that gained a checkout reports).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pushAssets } from '../sync/asset-push.ts';
import {
  createMediaGate,
  MEDIA_STAYS_LINE,
  MEDIA_STAYS_NEXT,
  readServerSignature,
} from '../sync/media-gate.ts';

const HUB = 'https://team.example';

function twoAssets(): string {
  const root = mkdtempSync(join(tmpdir(), 'media-gate-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets/aaaa1111.png'), 'x');
  writeFileSync(join(root, 'assets/bbbb2222.png'), 'y');
  return root;
}

/** A fake team server: `/health` states its caps; PUT /assets is 405 unless it has a checkout. */
function fakeServer(state: { checkout: boolean; version: string; caps: string[] }) {
  const calls = { put: 0, health: 0 };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      calls.health += 1;
      return new Response(JSON.stringify({ version: state.version, capabilities: state.caps }));
    }
    if (url.endsWith('/_asset-probe')) return new Response(null, { status: 404 });
    if (init?.method === 'HEAD') return new Response(null, { status: 404 });
    calls.put += 1;
    return state.checkout
      ? new Response(null, { status: 200 })
      : new Response('this hub does not accept file writes', { status: 405 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('pushAssets — a hub without a checkout (405 on the PUT)', () => {
  test('stops at the first refused PUT, reports refused, and counts no failure', async () => {
    const designRoot = twoAssets();
    const s = fakeServer({ checkout: false, version: '1.0.0', caps: ['annotations-v2'] });
    const emits: Array<Record<string, unknown>> = [];
    const r = await pushAssets({
      designRoot,
      hubUrl: HUB,
      token: () => 't',
      fetchImpl: s.fetchImpl,
      log: { log: () => {}, warn: () => {} },
      onProgress: (p) => emits.push(p as unknown as Record<string, unknown>),
      sleep: async () => {},
    });
    expect(s.calls.put).toBe(1); // the second file is not even tried
    expect(r.refused).toBe('no-checkout');
    expect(r.failed).toEqual([]);
    const last = emits[emits.length - 1];
    expect(last).toMatchObject({ finished: true, failedCount: 0, refused: 'no-checkout' });
  });
});

describe('media gate — shows once, retries stop, a changed server reopens', () => {
  function rig(state: { checkout: boolean; version: string; caps: string[] }) {
    const s = fakeServer(state);
    const notices: Array<string | null> = [];
    const gate = createMediaGate({
      probe: () => readServerSignature(HUB, s.fetchImpl),
      onNotice: (n) => notices.push(n),
    });
    /** One upload pass, the way the sync runtime runs it: only while the gate is open. */
    const pass = async () => {
      if (!gate.allowed()) return false;
      const r = await pushAssets({
        designRoot: root,
        hubUrl: HUB,
        token: () => 't',
        fetchImpl: s.fetchImpl,
        log: { log: () => {}, warn: () => {} },
        sleep: async () => {},
      });
      await gate.noteResult(r);
      return true;
    };
    const root = twoAssets();
    return { s, gate, notices, pass };
  }

  test('no checkout: the message shows once and no further upload is attempted over many poll ticks', async () => {
    const state = { checkout: false, version: '1.0.0', caps: ['annotations-v2'] };
    const { s, gate, notices, pass } = rig(state);
    expect(await pass()).toBe(true);
    expect(notices).toEqual(['no-checkout']);
    expect(gate.allowed()).toBe(false);
    const putsAfterFirst = s.calls.put;
    // 12 poll ticks (20 s each) and 12 file-change triggers: the server did not change
    for (let i = 0; i < 12; i++) {
      expect(await gate.tick()).toBe(false);
      expect(await pass()).toBe(false);
    }
    expect(s.calls.put).toBe(putsAfterFirst);
    expect(notices).toEqual(['no-checkout']); // once, not once per tick
  });

  test('the server gains a checkout (capabilities change): uploads resume and the message clears', async () => {
    const state = { checkout: false, version: '1.0.0', caps: ['annotations-v2'] };
    const { s, gate, notices, pass } = rig(state);
    await pass();
    expect(gate.allowed()).toBe(false);
    state.checkout = true;
    state.caps = ['ledger', 'annotations-v2'];
    expect(await gate.tick()).toBe(true); // reopened
    expect(gate.allowed()).toBe(true);
    expect(notices).toEqual(['no-checkout', null]);
    const before = s.calls.put;
    expect(await pass()).toBe(true);
    expect(s.calls.put).toBe(before + 2); // both pictures go up
    expect(gate.allowed()).toBe(true);
  });

  test('a new server version also asks again; still refused ⇒ stops again, message once more', async () => {
    const state = { checkout: false, version: '1.0.0', caps: ['annotations-v2'] };
    const { s, gate, notices, pass } = rig(state);
    await pass();
    state.version = '1.0.1';
    expect(await gate.tick()).toBe(true);
    await pass(); // still no checkout
    expect(gate.allowed()).toBe(false);
    expect(s.calls.put).toBe(2); // one attempt per state, not a loop
    expect(notices).toEqual(['no-checkout', null, 'no-checkout']);
    for (let i = 0; i < 6; i++) await gate.tick();
    expect(s.calls.put).toBe(2);
  });

  test('an unreachable server changes nothing (no signature ⇒ stay stopped)', async () => {
    const state = { checkout: false, version: '1.0.0', caps: ['annotations-v2'] };
    const { gate, pass } = rig(state);
    await pass();
    const down = createMediaGate({ probe: async () => null, onNotice: () => {} });
    await down.noteResult({ pushed: [], skipped: 0, failed: [], refused: 'no-checkout' });
    expect(down.allowed()).toBe(false);
    expect(await down.tick()).toBe(false);
    expect(gate.allowed()).toBe(false);
  });

  test('a pass that was not refused leaves the gate open', async () => {
    const state = { checkout: true, version: '1.0.0', caps: [] };
    const { gate, notices, pass } = rig(state);
    expect(await pass()).toBe(true);
    expect(gate.allowed()).toBe(true);
    expect(notices).toEqual([]);
  });
});

describe('the words', () => {
  test('the message and the next step are the ones Michal ruled', () => {
    expect(MEDIA_STAYS_LINE).toBe(
      "This team server can't store media, so pictures and videos stay on this Mac."
    );
    expect(MEDIA_STAYS_NEXT).toBe(
      'Ask whoever runs the server to turn on file storage for this project. Maude checks again when the server changes.'
    );
  });
});

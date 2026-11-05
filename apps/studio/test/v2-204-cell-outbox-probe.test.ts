// 2.0.4 task J — the outbox drain failed on EVERY pass in a cell:
//   [studio] [outbox] drain pass failed: e.probe().then is not a function
//
// The cloud build (`build.ts --cloud`, the cell and self-hosted hub image) replaces `acp/probe.ts` with an
// inert stub (`cloud-build.ts`, DDR-209 D1): every export is a proxy whose call returns the proxy again, and
// which is deliberately NOT thenable. http.ts wires `probeAcpAvailabilityAuthed` into the `ai-connected`
// gate's fact (`acp/connected-fact.ts`), whose `ensure()` called `deps.probe().then(…)` — so in a cell
// `read()` threw synchronously, `outboxGates()` threw, and every drain pass died before sending anything:
// share invites, asks to edit and cloud exports queued there were never sent.
//
// These tests build the stub the way the cloud build does (`stubSource` over the real `acp/probe.ts`) and
// wire it exactly as http.ts does.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnectedFact } from '../acp/connected-fact.ts';
import type * as RealProbe from '../acp/probe.ts';
import { stubSource } from '../cloud-build.ts';
import { createOutbox, type GateFacts, type IntentRecord, type Sender } from '../outbox/index.ts';
import { invite, prompt } from './_outbox-harness.ts';

const dirs: string[] = [];
const stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** `acp/probe.ts` as a cloud binary carries it. */
async function cloudProbeModule(): Promise<typeof RealProbe> {
  const dir = mkdtempSync(path.join(tmpdir(), 'cloud-probe-'));
  dirs.push(dir);
  const real = readFileSync(path.join(import.meta.dir, '..', 'acp', 'probe.ts'), 'utf8');
  const file = path.join(dir, 'probe.ts');
  writeFileSync(file, stubSource(real));
  return (await import(file)) as typeof RealProbe;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** The outbox + gate wiring http.ts builds, over a given probe pair. */
function wire(
  probe: Pick<typeof RealProbe, 'probeAcpAvailabilityAuthed' | 'probeAcpAvailability'>
) {
  const root = mkdtempSync(path.join(tmpdir(), 'outbox-cell-'));
  dirs.push(root);
  const warnings: string[] = [];
  const sent: IntentRecord[] = [];
  const sender: Sender = async (r) => {
    sent.push(r);
    return { ok: true, ref: `ref-${r.id}` };
  };
  let outbox: ReturnType<typeof createOutbox>;
  const fact = createConnectedFact({
    probe: probe.probeAcpAvailabilityAuthed,
    sync: () => probe.probeAcpAvailability().available,
    onOpen: () => void outbox.drain.wake().catch(() => null),
  });
  const gates = (): GateFacts => ({
    online: true,
    hubReachable: true,
    signedIn: true,
    aiConnected: fact.read(),
    aiReady: true,
    allowanceResetsAt: null,
  });
  outbox = createOutbox({
    designRoot: root,
    senders: { 'share.invite': sender, 'ai.prompt': sender },
    gates,
    target: () => ({ projectId: 'p1', projectName: 'StudyFi', role: 'owner' }),
    contentPending: () => [],
    log: {
      warn: (m: string) => {
        warnings.push(m);
      },
    },
  });
  outbox.store.load();
  stops.push(() => outbox.drain.stop());
  return { outbox, fact, gates, sent, warnings };
}

describe('outbox drain in a cell (cloud build: acp/probe.ts is the inert stub)', () => {
  test('a drain pass runs, sends a queued invite, and never hits "drain pass failed"', async () => {
    const w = wire(await cloudProbeModule());
    expect(() => w.gates()).not.toThrow();
    const r = w.outbox.enqueue(invite('ana@studyfi.com'));
    expect(r.ok).toBe(true);
    await w.outbox.drain.wake();
    await settle();
    expect(w.warnings.filter((m) => m.includes('drain pass failed'))).toEqual([]);
    expect(w.sent.map((s) => s.kind)).toEqual(['share.invite']);
  });

  test('the ai-connected fact reads "not connected" — claude never runs in a cell', async () => {
    const w = wire(await cloudProbeModule());
    // the sync fallback (the stub's `.available` is the truthy inert proxy) must not read as connected
    expect(w.fact.read()).toBe(false);
    expect(await w.fact.ensure()).toBe(false);
    expect(w.fact.read()).toBe(false);
    // so an AI prompt queued here is KEPT, not sent and not dropped
    w.outbox.enqueue(prompt('c1', 'three covers'));
    await w.outbox.drain.wake();
    await settle();
    expect(w.sent).toEqual([]);
    expect(w.warnings.filter((m) => m.includes('drain pass failed'))).toEqual([]);
    expect(w.outbox.store.list().map((x) => x.kind)).toEqual(['ai.prompt']);
  });
});

describe('connected fact never throws, whatever the probe returns', () => {
  const sync = () => false;
  test('a probe that returns a non-promise', async () => {
    const fact = createConnectedFact({
      probe: (() => ({ available: true })) as unknown as () => Promise<{ available: boolean }>,
      sync,
    });
    expect(() => fact.read()).not.toThrow();
    expect(await fact.ensure()).toBe(true);
  });
  test('a probe that returns undefined', async () => {
    const fact = createConnectedFact({
      probe: (() => undefined) as unknown as () => Promise<{ available: boolean }>,
      sync,
    });
    expect(() => fact.read()).not.toThrow();
    expect(await fact.ensure()).toBe(false);
  });
  test('a probe that throws synchronously', async () => {
    const fact = createConnectedFact({
      probe: () => {
        throw new Error('boom');
      },
      sync,
    });
    expect(() => fact.read()).not.toThrow();
    expect(await fact.ensure()).toBe(false);
  });
  test('desktop: a real async probe still opens the gate and wakes the drain', async () => {
    let opened = 0;
    let answer = false;
    const fact = createConnectedFact({
      probe: async () => ({ available: answer }),
      sync,
      onOpen: () => {
        opened++;
      },
      closedTtlMs: 0,
    });
    expect(await fact.ensure()).toBe(false);
    answer = true;
    expect(await fact.ensure()).toBe(true);
    expect(opened).toBe(1);
  });
});

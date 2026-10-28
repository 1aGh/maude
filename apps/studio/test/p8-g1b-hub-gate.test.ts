// P8 test round G1b (01 cf-offline-create) — a chat prompt of a hub-linked project waits while the hub is
// unreachable: "Queued — sends when this Mac is online." (V2-1.14 §5.4 `hub` gate, CONTRACT §7).
//
// Red first: http.ts hard-coded `hubReachable: true` and the ask queue bound every prompt to
// `{ hub: null }`, so with the Share cluster saying "Offline — kept on this Mac" the prompt skipped the
// outbox and went straight to the AI. The queued card the board draws was unreachable.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAskQueue } from '../acp/ask-queue.ts';
import { createOutbox, type GateFacts } from '../outbox/index.ts';
import { createHubReachability } from '../outbox/hub-reachability.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HUB = 'http://127.0.0.1:47001';

function rig(linked: string | null) {
  const designRoot = mkdtempSync(join(tmpdir(), 'p8-hub-gate-'));
  dirs.push(designRoot);
  let woke = 0;
  const hub = createHubReachability({ linkedHub: () => linked, onReachable: () => woke++ });
  const gates = (): GateFacts => ({
    online: true,
    hubReachable: hub.reachable(),
    signedIn: true,
    aiConnected: true,
    aiReady: true,
    allowanceResetsAt: null,
  });
  const outbox = createOutbox({
    designRoot,
    senders: {},
    gates,
    target: () => ({ projectId: null, projectName: 'Team project', role: 'owner' }),
  });
  const queue = createAskQueue({
    outbox,
    gates,
    project: () => hub.project(),
    runs: () => null as never,
  });
  return { hub, queue, woke: () => woke };
}

describe('the hub gate (V2-1.14 §5.4)', () => {
  test('hub offline → the prompt is queued with the offline words; back → it may go', () => {
    const r = rig(HUB);
    expect(r.queue.maybeQueue({ chatId: 'c1', text: 'Three reel covers', scope: null })).toBeNull();

    r.hub.note({ state: 'connecting' }); // the grace window: still Syncing…, nothing waits
    expect(r.hub.reachable()).toBe(true);

    r.hub.note({ state: 'offline', queuedOps: 1 });
    expect(r.hub.reachable()).toBe(false);
    const q = r.queue.maybeQueue({ chatId: 'c2', text: 'Three reel covers', scope: null });
    expect(q && 'gates' in q ? q.gates : null).toEqual(['hub']);
    expect(q && 'words' in q ? q.words : null).toBe('Queued — sends when this Mac is online.');
    expect(r.hub.project()).toEqual({ id: null, hub: HUB });

    expect(r.woke()).toBe(0);
    r.hub.note({ state: 'online' });
    expect(r.hub.reachable()).toBe(true);
    expect(r.woke()).toBe(1); // the drain's gate event
    r.hub.note({ state: 'online' });
    expect(r.woke()).toBe(1); // once per return, not per payload
  });

  test('offline-long closes it too; malformed payloads change nothing', () => {
    const r = rig(HUB);
    r.hub.note({ state: 'offline-long' });
    expect(r.hub.reachable()).toBe(false);
    r.hub.note(null);
    r.hub.note({ state: 42 });
    expect(r.hub.reachable()).toBe(false);
  });

  test('a local project has no hub gate, whatever the payloads say', () => {
    const r = rig(null);
    r.hub.note({ state: 'offline' });
    expect(r.hub.reachable()).toBe(true);
    expect(r.hub.project()).toEqual({ id: null, hub: null });
    expect(r.queue.maybeQueue({ chatId: 'c1', text: 'x', scope: null })).toBeNull();
  });

  test('http.ts wires it: the gate facts and the ask queue read the hub reachability', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const gates = src.slice(src.indexOf('const outboxGates = ()'), src.indexOf('const outboxGates = ()') + 400);
    expect(gates).toContain('hubReachable: hubReach.reachable()');
    expect(gates).not.toContain('hubReachable: true');
    const ask = src.slice(src.indexOf('const askQueue = createAskQueue({'), src.indexOf('const askQueue = createAskQueue({') + 300);
    expect(ask).toContain('project: () => hubReach.project()');
    expect(src).toContain("ctx.bus.on('sync:status', (p: unknown) => hubReach.note(p))");
  });
});

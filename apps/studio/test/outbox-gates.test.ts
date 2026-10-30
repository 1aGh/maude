// V2-1.14 §5.4 / §5.8 — gates hold WITHOUT counting attempts and open on
// their event; 401 closes `signed-in`; 429 `Retry-After` is honoured.

import { afterEach, describe, expect, test } from 'bun:test';

import { closedGates, gateWords, wordsFor } from '../outbox/index.ts';
import {
  cloudExport,
  type Harness,
  handoff,
  harness,
  invite,
  OPEN,
  prompt,
  put,
} from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

describe('outbox gates', () => {
  test('which gates apply to which kind', () => {
    const local = { project: { id: null, hub: null }, watermark: null };
    const linked = { project: { id: 'p1', hub: 'https://hub' }, watermark: null };
    const off = {
      ...OPEN,
      online: false,
      hubReachable: false,
      signedIn: false,
      aiConnected: false,
      aiReady: false,
      allowanceResetsAt: 2,
    };
    expect(closedGates({ kind: 'ai.prompt', ...local }, off, [], 1)).toEqual([
      'online',
      'ai-connected',
      'ai-ready',
      'ai-allowance',
    ]);
    expect(closedGates({ kind: 'ai.prompt', ...linked }, off, [], 1)).toEqual([
      'online',
      'hub',
      'ai-connected',
      'ai-ready',
      'ai-allowance',
    ]);
    expect(closedGates({ kind: 'share.invite', ...linked }, off, [], 1)).toEqual([
      'online',
      'hub',
      'signed-in',
    ]);
    expect(closedGates({ kind: 'export.cloud', ...local }, off, [], 1)).toEqual([
      'online',
      'signed-in',
    ]);
    expect(closedGates({ kind: 'export.handoff', ...linked, watermark: 5 }, OPEN, [5], 1)).toEqual([
      'after',
    ]);
  });

  test('the words per gate are the drawn ones', () => {
    expect(gateWords(['online'], 'ai.prompt')?.text).toBe(
      'Queued — sends when this Mac is online.'
    );
    expect(gateWords(['hub'], 'share.invite')?.text).toBe('Invites send when this Mac is online.');
    expect(gateWords(['online'], 'export.cloud')?.text).toBe(
      'Waits for a connection, then starts by itself.'
    );
    expect(gateWords(['online'], 'export.handoff')?.text).toBe(
      'Queued — starts when this Mac is online'
    );
    expect(gateWords(['signed-in'], 'share.invite')).toEqual({
      key: 'gate.signed-in',
      text: 'Sign in to send it.',
      actions: ['Sign in'],
    });
    expect(gateWords(['ai-ready'], 'ai.prompt')).toMatchObject({ presentation: 'field' });
    expect(gateWords(['ai-allowance'], 'ai.prompt', '18:40')?.text).toBe(
      "AI's allowance is used up until 18:40. Your prompt is kept and sends then."
    );
    expect(gateWords(['after'], 'ai.prompt')).toBe(null); // the content lane speaks
  });

  test('a closed gate is not an attempt: no send, no backoff, attempts stay 0', async () => {
    h = harness();
    h.gates.online = false;
    const r = put(h, prompt('c1', 'offline ask'));
    for (let i = 0; i < 5; i++) await h.outbox.drain.wake();
    const now = h.outbox.store.get(r.id)!;
    expect(now).toMatchObject({
      state: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      gates: ['online'],
    });
    expect(wordsFor(now)?.text).toBe('Queued — sends when this Mac is online.');
    expect(h.sent).toEqual([]);
  });

  test('each gate opens on its event (a wake), in turn', async () => {
    h = harness();
    Object.assign(h.gates, { online: false, aiConnected: false, aiReady: false });
    const r = put(h, prompt('c1', 'ask'));
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)?.gates).toEqual(['online', 'ai-connected', 'ai-ready']);
    h.gates.online = true;
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)?.gates).toEqual(['ai-connected', 'ai-ready']);
    h.gates.aiConnected = true;
    await h.outbox.drain.wake();
    expect(wordsFor(h.outbox.store.get(r.id)!)?.key).toBe('gate.ai-ready');
    h.gates.aiReady = true;
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)).toMatchObject({ state: 'done', attempts: 1 });
  });

  test('401 closes `signed-in`; signing in sends it', async () => {
    h = harness();
    const r = put(h, invite('tereza@studio.cz'));
    h.answers['share.invite'] = [{ ok: false, status: 401 }];
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)).toMatchObject({ state: 'queued', gates: ['signed-in'] });
    h.gates.signedIn = false; // the shell learns the session is gone
    await h.clock.advance(5_000);
    expect(h.sent).toHaveLength(1);
    h.gates.signedIn = true;
    await h.outbox.drain.wake();
    expect(h.sent).toHaveLength(2);
    expect(h.outbox.store.get(r.id)?.state).toBe('done');
  });

  test('429 honours Retry-After; 5xx backs off 1.5 s doubling with jitter', async () => {
    h = harness();
    const e = put(h, cloudExport({ format: 'mp4' }));
    h.answers['export.cloud'] = [{ ok: false, status: 429, retryAfterMs: 10_000 }];
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(e.id)?.nextAttemptAt).toBe(h.clock.t + 10_000);
    await h.clock.advance(9_000);
    expect(h.sent).toHaveLength(1);
    await h.clock.advance(1_000);
    expect(h.sent).toHaveLength(2);

    const x = put(h, handoff('ui-home', 'shadcn'));
    h.answers['export.handoff'] = [
      { ok: false, status: 502 },
      { ok: false, status: 503 },
    ];
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(x.id)?.nextAttemptAt).toBe(h.clock.t + 1500); // attempt 1, rand 0.5
    await h.clock.advance(1500);
    expect(h.outbox.store.get(x.id)?.nextAttemptAt).toBe(h.clock.t + 3000); // attempt 2
    await h.clock.advance(3000);
    expect(h.outbox.store.get(x.id)?.state).toBe('done');
  });

  test('a network failure is transient, never final', async () => {
    h = harness();
    const r = put(h, prompt('c1', 'x'));
    h.answers['ai.prompt'] = [{ ok: false, network: true }];
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)?.state).toBe('queued');
    await h.clock.advance(1500);
    expect(h.outbox.store.get(r.id)?.state).toBe('done');
  });
});

// V2-1.14 §5.7 — expiry per kind, with a fake clock. The content lane never
// expires (it is not in this store at all).

import { afterEach, describe, expect, test } from 'bun:test';

import { EXPIRY_MS, wordsFor } from '../outbox/index.ts';
import {
  ask,
  cloudExport,
  type Harness,
  handoff,
  harness,
  invite,
  prompt,
  put,
} from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

const DAY = 24 * 3600 * 1000;

describe('outbox expiry', () => {
  test.each([
    ['ai.prompt', 7 * DAY],
    ['share.invite', 14 * DAY],
    ['share.ask-to-edit', 7 * DAY],
    ['export.cloud', DAY],
    ['export.handoff', DAY],
  ])('%s expires after its window', (kind, ms) => {
    expect(EXPIRY_MS[kind as keyof typeof EXPIRY_MS]).toBe(ms);
  });

  test('each kind drops `expired` at its own time and shows its own line', async () => {
    h = harness();
    h.gates.online = false; // nothing can go
    const p = put(h, prompt('c1', 'stale ask'));
    const i = put(h, invite('tereza@studio.cz'));
    const a = put(h, ask());
    const e = put(h, cloudExport({ format: 'mp4' }));
    const x = put(h, handoff('ui-home', 'shadcn'));
    await h.outbox.drain.wake();

    await h.clock.advance(DAY + 10); // exports go first — the drain's own timer fired
    expect([e, x].map((r) => h.outbox.store.get(r.id)?.outcome?.code)).toEqual([
      'expired',
      'expired',
    ]);
    expect(h.outbox.store.get(p.id)?.state).toBe('queued');
    const ew = wordsFor(h.outbox.store.get(e.id)!);
    expect(ew).toEqual({
      key: 'outbox.expired.export.cloud',
      text: 'Not exported — it waited a day.',
      actions: ['Export again'],
    });

    await h.clock.advance(6 * DAY); // day 7
    expect([p, a].map((r) => h.outbox.store.get(r.id)?.outcome?.code)).toEqual([
      'expired',
      'expired',
    ]);
    expect(wordsFor(h.outbox.store.get(p.id)!)?.text).toBe(
      'Not sent — it waited a week. Your prompt is still here.'
    );
    expect(h.outbox.store.get(i.id)?.state).toBe('queued');

    await h.clock.advance(7 * DAY); // day 14
    expect(h.outbox.store.get(i.id)?.outcome?.code).toBe('expired');
    expect(wordsFor(h.outbox.store.get(i.id)!)).toEqual({
      key: 'outbox.expired.share.invite',
      text: 'Invite to tereza@… not sent — it waited 14 days.',
      actions: ['Invite again'],
    });
    expect(h.sent).toEqual([]); // an expired intent is never sent
  });

  test('ai.prompt behind a late allowance reset waits until resetsAt + 1 h', async () => {
    h = harness();
    const resetsAt = h.clock.t + 9 * DAY; // a weekly allowance that resets on day 9
    h.gates.allowanceResetsAt = resetsAt;
    const p = put(h, prompt('c1', 'when the allowance is back', { allowanceResetsAt: resetsAt }));
    expect(p.expiresAt).toBe(resetsAt + 3600 * 1000);
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(p.id)?.gates).toEqual(['ai-allowance']);
    await h.clock.advance(8 * DAY); // past the plain 7 days — still kept
    expect(h.outbox.store.get(p.id)?.state).toBe('queued');
    await h.clock.advance(DAY); // the reset: the drain's timer opens the gate by itself
    expect(h.sent.map((s) => s.id)).toEqual([p.id]);
  });

  test('the allowance learned AFTER enqueue extends the expiry too', async () => {
    h = harness();
    const p = put(h, prompt('c1', 'ask'));
    h.gates.allowanceResetsAt = h.clock.t + 10 * DAY;
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(p.id)?.expiresAt).toBe(h.gates.allowanceResetsAt + 3600 * 1000);
  });
});

// V2-1.14 §5.6 — dedupe: the record id is the idempotency key end to end;
// semantic repeats collapse at enqueue.

import { afterEach, describe, expect, test } from 'bun:test';

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

describe('outbox dedupe', () => {
  test('the double "Try again": same chat + same text within 2 s → one record', async () => {
    h = harness();
    const a = h.outbox.store.enqueue(prompt('c1', 'Make it bolder'));
    await h.clock.advance(1500);
    const b = h.outbox.store.enqueue(prompt('c1', 'Make it bolder'));
    expect(a.ok && b.ok && b.record.id === a.record.id && b.deduped).toBe('same');
    await h.clock.advance(2500); // outside the window: a real second ask
    const c = h.outbox.store.enqueue(prompt('c1', 'Make it bolder'));
    expect(c.ok && c.deduped).toBe(false);
    // another chat is never a repeat
    const d = h.outbox.store.enqueue(prompt('c2', 'Make it bolder'));
    expect(d.ok && d.deduped).toBe(false);
    expect(h.outbox.store.list()).toHaveLength(3);
  });

  test('a re-invite replaces the queued one (role + message) and keeps its place and id', async () => {
    h = harness();
    const first = put(h, invite('Tereza@Studio.cz', 'view'));
    const other = put(h, invite('jan@studio.cz', 'edit'));
    await h.clock.advance(60_000);
    const again = h.outbox.store.enqueue(invite('tereza@studio.cz', 'edit'));
    expect(again.ok && again.deduped).toBe('replaced');
    const list = h.outbox.store.list();
    expect(list.map((r) => r.id)).toEqual([first.id, other.id]); // place kept
    expect(list[0]?.payload).toMatchObject({ role: 'edit' });
    expect(list[0]?.createdAt).toBe(first.createdAt);
  });

  test('a scope differs → two invites', () => {
    h = harness();
    put(h, invite('tereza@studio.cz'));
    const scoped = invite('tereza@studio.cz');
    (scoped.payload as { scope: unknown }).scope = { canvas: 'ui-pricing' };
    const r = h.outbox.store.enqueue(scoped);
    expect(r.ok && r.deduped).toBe(false);
  });

  test('"Export again" twice offline = one row; a different sheet is another', () => {
    h = harness();
    const a = put(h, cloudExport({ format: 'mp4', fps: 30, range: [0, 10] }));
    const b = h.outbox.store.enqueue(cloudExport({ range: [0, 10], fps: 30, format: 'mp4' })); // key order differs
    expect(b.ok && b.record.id).toBe(a.id);
    const c = h.outbox.store.enqueue(cloudExport({ format: 'mp4', fps: 60, range: [0, 10] }));
    expect(c.ok && c.deduped).toBe(false);
  });

  test('Ask to edit: one per scope; handoff: the latest wins for (canvas, target)', () => {
    h = harness();
    const a = put(h, ask());
    const a2 = h.outbox.store.enqueue(ask());
    expect(a2.ok && a2.record.id).toBe(a.id);
    const x = put(h, handoff('ui-home', 'shadcn'));
    const x2 = h.outbox.store.enqueue(
      handoff('ui-home', 'shadcn', { label: 'Hand off Home (v2)' })
    );
    expect(x2.ok && x2.deduped).toBe('replaced');
    expect(h.outbox.store.get(x.id)?.label).toBe('Hand off Home (v2)');
  });

  test('a record already in flight is never folded into (it keeps its bytes)', () => {
    h = harness();
    const a = put(h, cloudExport({ format: 'mp4' }));
    h.outbox.store.update(a.id, { state: 'sending' });
    const b = h.outbox.store.enqueue(cloudExport({ format: 'mp4' }));
    expect(b.ok && b.record.id !== a.id).toBe(true);
  });

  test('a crash mid-send replays the same id — the target sees one idempotency key', async () => {
    h = harness();
    const r = put(h, invite('tereza@studio.cz'));
    h.outbox.store.update(r.id, { state: 'sending', attempts: 1 });
    const fresh = h.reopen();
    h.answers['share.invite'] = [{ ok: true, already: true, ref: 'inv_1' }]; // the target already had it
    await fresh.drain.wake();
    expect(h.sent.map((s) => s.id)).toEqual([r.id]);
    expect(fresh.store.get(r.id)).toMatchObject({
      state: 'done',
      outcome: { code: 'already', row: 'G16' },
    });
  });
});

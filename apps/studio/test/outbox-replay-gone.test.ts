// V2-1.14 §5.9 — replay against a gone target: every INTENT row of G1–G26 →
// the expected state / outcome / words key / what is kept. Checked before
// sending (studio facts) and again on the target's answer.
//
// The CONTENT rows (G1, G4, G8, G10, G11, G13, G18, G19) are decided by the
// kernel and the projection's recovery slots; here they are pinned as table
// data (words, recovery). G18 is proven end to end by
// transaction-client-project-binding.test.ts; the rest need the fixture hub
// (Node 24, run alone) — see the V2-2.16 hand-back.

import { afterEach, describe, expect, test } from 'bun:test';

import { REPLAY_TABLE, rowWords, type TargetFacts, wordsFor } from '../outbox/index.ts';
import { cloudExport, type Harness, harness, invite, prompt, put } from './_outbox-harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

/** Enqueue, set the facts that changed while it was queued, wake once. */
async function replay(input: Parameters<typeof put>[1], facts: Partial<TargetFacts>) {
  const r = put(h, input);
  h.factsFor.set(r.id, facts);
  await h.outbox.drain.wake();
  return h.outbox.store.get(r.id)!;
}

describe('replay table — data', () => {
  test('G1–G26, each once, each with what is kept', () => {
    expect(REPLAY_TABLE.map((r) => r.id)).toEqual(
      Array.from({ length: 26 }, (_, i) => `G${i + 1}`)
    );
    for (const row of REPLAY_TABLE)
      if ('state' in row.result && row.result.state !== 'done') expect(row.kept).not.toBe(null);
  });

  test('the content rows carry their drawn words', () => {
    expect(rowWords('G1', 'content', { canvas: 'Pricing', n: 3 })?.text).toBe(
      'Pricing was moved to the trash while this Mac was offline. Your 3 changes are kept with it.'
    );
    expect(rowWords('G8', 'content', { project: 'Alligators brand', n: 3 })).toEqual({
      key: 'outbox.G8',
      text: "You were removed from Alligators brand while this Mac was offline. 3 changes couldn't go up — they're kept on this Mac.",
      actions: ['Show in Finder'],
    });
    expect(rowWords('G10', 'content', { who: 'Tereza', n: 3 })?.text).toContain(
      'Tereza changed you to Can comment'
    );
    expect(rowWords('G19', 'content')?.text).toBe(
      'This project now uses Maude 2. Update Maude to edit it.'
    );
  });
});

describe('replay table — intents, checked before sending', () => {
  test('G2: a prompt scoped to a trashed canvas → dropped, the prompt stays in the chat', async () => {
    h = harness();
    const r = await replay(prompt('c1', 'polish it'), {
      canvas: { state: 'trashed', name: 'Pricing' },
    });
    expect(r).toMatchObject({ state: 'dropped', outcome: { code: 'target-trashed', row: 'G2' } });
    expect(wordsFor(r, { canvas: 'Pricing' })).toEqual({
      key: 'outbox.G2',
      text: 'Not sent — Pricing is in the trash.',
      actions: ['Restore Pricing'],
    });
    expect(h.sent).toEqual([]);
    expect(r.payload).toMatchObject({ text: 'polish it' }); // kept
  });

  test('G3: an invite to a trashed canvas, and its export', async () => {
    h = harness();
    const inv = invite('tereza@studio.cz');
    (inv.payload as { scope: unknown }).scope = { canvas: 'ui-pricing' };
    const a = await replay(
      { ...inv, target: { canvas: 'ui-pricing' } },
      { canvas: { state: 'trashed', name: 'Pricing' } }
    );
    expect(wordsFor(a, { canvas: 'Pricing' })?.text).toBe(
      'Invite to Pricing not sent — Pricing is in the trash.'
    );
    const b = await replay(cloudExport({ format: 'mp4' }), {
      canvas: { state: 'trashed', name: 'Pricing' },
    });
    expect(b.outcome).toMatchObject({ code: 'target-trashed', row: 'G3' });
    expect(wordsFor(b, { canvas: 'Pricing' })?.text).toBe(
      "Pricing is in the trash, so its export didn't start."
    );
  });

  test('G5: a prompt on a trashed artboard', async () => {
    h = harness();
    const r = await replay(
      prompt('c1', 'x', { target: { chatId: 'c1', canvas: 'ui-reel', artboards: ['post'] } }),
      {
        artboards: { post: { state: 'trashed', name: 'Post 1:1' } },
      }
    );
    expect(r.outcome?.row).toBe('G5');
    expect(wordsFor(r, { artboard: 'Post 1:1' })?.actions).toEqual(['Restore Post 1:1']);
  });

  test('G6: the picked element is gone → needs you, never decided for you; Send re-opens it', async () => {
    h = harness();
    const r = await replay(
      prompt('c1', 'fix the footer', {
        target: {
          chatId: 'c1',
          canvas: 'ui-reel',
          artboards: ['post'],
          elements: [{ canvas: 'ui-reel', artboard: 'post', element: 'footer' }],
        },
      }),
      {
        missingElements: [{ element: 'footer', name: 'Footer', artboard: 'post' }],
        artboards: { post: { state: 'present', name: 'Post 1:1' } },
      }
    );
    expect(r).toMatchObject({ state: 'needs-you', outcome: { code: 'target-removed', row: 'G6' } });
    expect(wordsFor(r, { element: 'Footer', artboard: 'Post 1:1' })?.text).toBe(
      'The Footer you picked is gone. Send it for the whole Post 1:1?'
    );
    // a later wake does not decide it
    await h.outbox.drain.wake();
    expect(h.sent).toEqual([]);
    // "Send": the surface revises the scope to the whole artboard and retries
    h.factsFor.delete(r.id);
    const re = h.outbox.store.retry(r.id, {
      target: { chatId: 'c1', canvas: 'ui-reel', artboards: ['post'] },
    });
    expect(re.ok).toBe(true);
    await h.outbox.drain.wake();
    expect(h.outbox.store.get(r.id)?.state).toBe('done');
  });

  test('G7: a moved or renamed canvas is not gone (target.canvas is the entry)', async () => {
    h = harness();
    const r = await replay(prompt('c1', 'x'), {
      canvas: { state: 'present', name: 'Pricing (renamed)' },
    });
    expect(r.state).toBe('done');
  });

  test('G9: removed from the project → every intent dropped; rows kept 7 days', async () => {
    h = harness();
    const r = await replay(invite('a@b.cz'), { role: null });
    expect(r).toMatchObject({ state: 'dropped', outcome: { code: 'access-removed', row: 'G9' } });
    expect(wordsFor(r, { project: 'Alligators brand' })?.text).toBe(
      "Not sent — you're no longer in Alligators brand."
    );
  });

  test('G12: Can comment / Can view → no AI', async () => {
    h = harness();
    const c = await replay(prompt('c1', 'x'), { role: 'comment' });
    expect(c.outcome).toMatchObject({ code: 'access-reduced', row: 'G12' });
    expect(wordsFor(c, { project: 'Alligators brand' })).toEqual({
      key: 'outbox.G12',
      text: 'Not sent — you can comment on Alligators brand, not edit it.',
      actions: ['Ask to edit'],
    });
    const v = await replay(prompt('c2', 'y'), { role: 'view' });
    expect(v.outcome?.code).toBe('access-reduced');
  });

  test('G14: Can view gets no cloud export; G15: only owners invite', async () => {
    h = harness();
    const e = await replay(cloudExport({ f: 1 }), { role: 'view' });
    expect(e.outcome?.row).toBe('G14');
    const i = await replay(invite('a@b.cz'), { role: 'edit' });
    expect(i.outcome?.row).toBe('G15');
    expect(wordsFor(i, { project: 'Alligators brand' })?.text).toBe(
      'Invite not sent — only owners can invite to Alligators brand.'
    );
  });

  test('G17: the project changed (relink, unlink, moved to local) → dropped, never sent to the new one', async () => {
    h = harness();
    const r = await replay(prompt('c1', 'x'), { projectId: 'p-other' });
    expect(r).toMatchObject({ state: 'dropped', outcome: { code: 'project-changed', row: 'G17' } });
    expect(h.sent).toEqual([]);
  });

  test('G20 / G21: format raised or plan lapsed → PAUSED (needs-you), resumes by itself', async () => {
    h = harness();
    const f = await replay(invite('a@b.cz'), { formatGated: true });
    expect(f).toMatchObject({ state: 'needs-you', outcome: { code: 'format', row: 'G20' } });
    expect(wordsFor(f)?.text).toBe('This project now uses Maude 2. Update Maude to edit it.');
    const p = await replay(cloudExport({ f: 2 }), { planLapsed: true });
    expect(p).toMatchObject({ state: 'needs-you', outcome: { code: 'plan', row: 'G21' } });
    expect(wordsFor(p)?.actions).toEqual(['Choose a plan']);
    await h.outbox.drain.wake();
    expect(h.sent).toEqual([]); // still paused
    h.factsFor.delete(f.id); // Maude was updated
    h.factsFor.delete(p.id); // a plan was chosen
    await h.outbox.drain.wake();
    expect(h.sent.map((s) => s.id).sort()).toEqual([f.id, p.id].sort());
  });

  test('G22: the chat moved to the trash → its queued prompt is cancelled', async () => {
    h = harness();
    const r = await replay(prompt('c1', 'x'), {
      chat: { state: 'trashed', title: 'Three reel covers' },
    });
    expect(r).toMatchObject({ state: 'dropped', outcome: { code: 'cancelled', row: 'G22' } });
    expect(rowWords('G22', 'ai.prompt', { chat: 'Three reel covers' })?.text).toBe(
      'Move "Three reel covers" to the trash? Its queued prompt won\'t send.'
    );
  });

  test('G23: AI disconnected is a gate, not a failure', async () => {
    h = harness();
    h.gates.aiConnected = false;
    const r = await replay(prompt('c1', 'x'), {});
    expect(r).toMatchObject({ state: 'queued', gates: ['ai-connected'] });
  });
});

describe('replay table — intents, on the target answer', () => {
  test('G16: the invitee is already a member → done: already', async () => {
    h = harness();
    h.answers['share.invite'] = [{ ok: false, status: 409, code: 'already-member' }];
    const r = await replay(invite('tereza@studio.cz'), {});
    expect(r).toMatchObject({ state: 'done', outcome: { code: 'already', row: 'G16' } });
    expect(wordsFor(r, { invitee: 'Tereza', project: 'Alligators brand' })?.text).toBe(
      'Tereza is already in Alligators brand.'
    );
  });

  test('G25: the Save-to folder is missing → done, saved to Downloads', async () => {
    h = harness();
    h.answers['export.cloud'] = [{ ok: true, ref: 'job_1', savedToDownloads: true }];
    const r = await replay(cloudExport({ f: 3 }), {});
    expect(r).toMatchObject({ state: 'done', outcome: { code: 'sent', row: 'G25', ref: 'job_1' } });
    expect(wordsFor(r)?.text).toBe('Saved to Downloads — the folder was missing.');
  });

  test('G26: any other final code → dropped: refused (its code in ref), Retry re-opens it ONCE', async () => {
    h = harness();
    h.answers['export.cloud'] = [{ ok: false, status: 422, code: 'spec-invalid' }];
    const r = await replay(cloudExport({ f: 4 }), {});
    expect(r).toMatchObject({
      state: 'dropped',
      outcome: { code: 'refused', ref: 'spec-invalid', row: 'G26' },
    });
    expect(wordsFor(r)).toEqual({
      key: 'outbox.G26',
      text: "Couldn't send Reel · MP4.",
      actions: ['Retry Reel · MP4'],
    });
    await h.outbox.drain.wake();
    expect(h.sent).toHaveLength(1); // never retried by itself (C20)
    expect(h.outbox.store.retry(r.id).ok).toBe(true);
    await h.outbox.drain.wake();
    expect(h.sent).toHaveLength(2);
    expect(h.outbox.store.retry(r.id)).toEqual({ ok: false, code: 'not-retryable' }); // done now
  });

  test('a target that sends its own words is quoted', async () => {
    h = harness();
    h.answers['share.invite'] = [
      {
        ok: false,
        status: 400,
        code: 'domain-blocked',
        message: 'Invites to that address are turned off for this team.',
      },
    ];
    const r = await replay(invite('x@blocked.cz'), {});
    expect(r.outcome?.ref).toBe('domain-blocked');
  });

  test('426 / code `format` on the answer → paused G20, not dropped', async () => {
    h = harness();
    h.answers['share.invite'] = [{ ok: false, status: 426, code: 'format' }];
    const r = await replay(invite('a@b.cz'), {});
    expect(r).toMatchObject({ state: 'needs-you', outcome: { code: 'format' } });
  });
});

// S9.24 — the object conflicts this Mac lost are recorded on this Mac (`_state/conflicts/<slug>.json`)
// from BOTH producers: the lane proposal's own answer, and the transaction client's onResult — the
// only one that sees an outbox replay after a restart (nobody awaits that proposal any more).
// Both directions: whichever Mac proposes second gets the card, never the first one.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAcceptedLink } from '../sync/accepted-link.ts';
import {
  clearConflict,
  conflictFile,
  listConflicts,
  readConflicts,
  recordConflicts,
  recordFromResult,
} from '../sync/conflict-record.ts';
import type { TransactionClient } from '../sync/transaction-client.ts';

const quiet = { log() {}, warn() {}, error() {} };
const HUB = 'https://hub.test';
const dirs: string[] = [];
const links: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const l of links.splice(0)) l.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function root(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'maude-conflict-record-'));
  dirs.push(d);
  return d;
}

const sticky = (text: string) => ({
  id: 's1',
  type: 'sticky',
  index: 'a0',
  x: 630,
  y: 460,
  w: 190,
  h: 120,
  text,
});
const YOURS = 'Číslo na zádech větší — 30 cm';
const JONAS = 'Číslo 25 cm — jinak se nad něj nevejde sponzor';
const held = (mine: string, theirs: string) => [
  { id: 's1', type: 'sticky', fields: ['text'], mine: sticky(mine), theirs: sticky(theirs) },
];

describe('conflict-record — the file', () => {
  test('an id recorded again replaces the older entry; clear drops it and the file with the last', () => {
    const r = root();
    recordConflicts(r, 'ui-a', held(YOURS, JONAS), { actionId: 'act_1', now: 1 });
    recordConflicts(r, 'ui-a', held(`${YOURS}!`, JONAS), { actionId: 'act_2', now: 2 });
    const list = readConflicts(r, 'ui-a');
    expect(list.map((e) => [e.id, e.actionId, (e.mine as { text: string }).text])).toEqual([
      ['s1', 'act_2', `${YOURS}!`],
    ]);
    expect(listConflicts(r).map((x) => x.slug)).toEqual(['ui-a']);
    expect(clearConflict(r, 'ui-a', 's1')).toBe(true);
    expect(existsSync(conflictFile(r, 'ui-a') as string)).toBe(false);
    expect(clearConflict(r, 'ui-a', 's1')).toBe(false);
  });

  test('a slug that is not a plain file name is never a path', () => {
    const r = root();
    for (const bad of ['../x', 'a/b', '.hidden', '']) {
      expect(conflictFile(r, bad)).toBeNull();
      recordConflicts(r, bad, held(YOURS, JONAS));
    }
    expect(listConflicts(r)).toEqual([]);
  });

  test('onResult form: merged[] names the doc (namespaced or flat); a rejected answer records nothing', () => {
    const r = root();
    recordFromResult(r, {
      status: 'rejected',
      merged: [{ doc: 'ui-a', lane: 'annotations', conflicts: held(YOURS, JONAS) }],
    });
    expect(listConflicts(r)).toEqual([]);
    recordFromResult(r, {
      status: 'accepted',
      actionId: 'act_9',
      merged: [
        {
          doc: 'ws/w1/main/ui-b',
          lane: 'annotations',
          merged: true,
          conflicts: held(YOURS, JONAS),
        },
        { doc: 'ui-c', lane: 'html', merged: true },
        { doc: '../../etc', lane: 'annotations', conflicts: held(YOURS, JONAS) },
      ],
    });
    expect(listConflicts(r).map((x) => [x.slug, x.conflicts[0]?.actionId])).toEqual([
      ['ui-b', 'act_9'],
    ]);
  });
});

/** A hub that holds the sticky at THEIR version for every stale annotations proposal. */
function holdingHub(theirs: string) {
  let online = true;
  let revision = 4;
  const posts: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (!online) throw new TypeError('fetch failed');
    const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
    if (route === 'bootstrap')
      return Response.json({
        projectId: 'p1',
        mode: 'transactions',
        epoch: 1,
        revision,
        docs: [],
        dirs: [],
      });
    if (route.startsWith('transactions/')) return Response.json({}, { status: 404 });
    const p = JSON.parse(String(init?.body));
    posts.push(p);
    const merged = (p.action.operations as Array<Record<string, unknown>>)
      .filter((o) => o.op === 'lane.replace' && o.lane === 'annotations' && o.objects === 'hold')
      .map((o) => {
        const mine = JSON.parse(String(o.content)).elements?.[0] ?? sticky('');
        return {
          doc: o.doc,
          lane: 'annotations',
          merged: true,
          conflicts: [{ id: 's1', type: 'sticky', fields: ['text'], mine, theirs: sticky(theirs) }],
        };
      });
    revision++;
    return Response.json({
      protocol: 1,
      status: 'accepted',
      transactionId: p.transactionId,
      revision,
      actionId: `act_${revision}`,
      ...(merged.length ? { merged } : {}),
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, posts, setOnline: (v: boolean) => (online = v) };
}

const board = (text: string) => JSON.stringify({ v: 2, elements: [sticky(text)] });

function link(designRoot: string, fetchImpl: typeof fetch) {
  const l = createAcceptedLink({
    hubUrl: HUB,
    token: () => 't',
    designRoot,
    docNameFor: (slug) => slug,
    fetchImpl,
    retryMs: 2,
    log: quiet,
  });
  links.push(l);
  return l;
}

describe('both producers, both directions', () => {
  for (const [who, mine, theirs] of [
    ['you lose to Jonas', YOURS, JONAS],
    ['Jonas loses to you', JONAS, YOURS],
  ] as const) {
    test(`${who}: the proposal's answer records the card`, async () => {
      const r = root();
      // injected client: only the lane proposal's answer can record (no onResult wrapper runs)
      const client = {
        newTransactionId: () => 'tx_live',
        bootstrap: async () => ({ mode: 'transactions' }),
        propose: async () => ({
          protocol: 1,
          status: 'accepted',
          transactionId: 'tx_live',
          actionId: 'act_live',
          merged: [
            { doc: 'ui-a', lane: 'annotations', merged: true, conflicts: held(mine, theirs) },
          ],
        }),
        read: async () => ({}),
        stop() {},
      } as unknown as TransactionClient;
      const l = createAcceptedLink({
        hubUrl: HUB,
        token: () => 't',
        designRoot: r,
        docNameFor: (s) => s,
        client,
        log: quiet,
      });
      links.push(l);
      const out = await l.laneLink('ui-a').propose({
        lane: 'annotations',
        content: board(mine),
        baseContent: board('Číslo na zádech?'),
        transactionId: 'tx_live',
      } as never);
      expect(out.objectConflicts?.map((c) => c.id)).toEqual(['s1']);
      const rec = readConflicts(r, 'ui-a');
      expect(rec.map((e) => [e.id, e.actionId])).toEqual([['s1', 'act_live']]);
      expect((rec[0]?.mine as { text?: string } | undefined)?.text).toBe(mine);
      expect((rec[0]?.theirs as { text?: string } | undefined)?.text).toBe(theirs);
    });

    test(`${who}: an outbox replay after a restart still records the card (onResult)`, async () => {
      const r = root();
      const hub = holdingHub(theirs);
      hub.setOnline(false);
      const first = link(r, hub.fetchImpl);
      // offline: the proposal waits in the durable outbox; this run never sees its answer
      first
        .laneLink('ui-a')
        .propose({
          lane: 'annotations',
          content: board(mine),
          baseContent: board('Číslo na zádech?'),
          transactionId: first.newTransactionId?.() ?? 'tx_offline',
        } as never)
        .catch(() => {}); // stopping the client ends this run's wait ('stopped')
      await new Promise((res) => setTimeout(res, 30));
      first.stop();
      links.splice(links.indexOf(first), 1);
      expect(readConflicts(r, 'ui-a')).toEqual([]);

      hub.setOnline(true);
      const again = link(r, hub.fetchImpl);
      await again.client.drainOutbox();
      expect(hub.posts.length).toBe(1);
      const rec = readConflicts(r, 'ui-a');
      expect(rec.map((e) => [e.id, e.fields])).toEqual([['s1', ['text']]]);
      expect((rec[0]?.mine as { text?: string } | undefined)?.text).toBe(mine);
      expect((rec[0]?.theirs as { text?: string } | undefined)?.text).toBe(theirs);
      expect(rec[0]?.actionId).toMatch(/^act_/);
      // the record is this Mac's runtime state
      expect(readFileSync(conflictFile(r, 'ui-a') as string, 'utf8')).toContain('"v":1');
      expect(path.relative(r, conflictFile(r, 'ui-a') as string)).toBe(
        path.join('_state', 'conflicts', 'ui-a.json')
      );
    });
  }
});

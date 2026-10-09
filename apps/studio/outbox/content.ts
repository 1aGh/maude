// The content lane, seen from the outbox — V2-1.14 §5.1, §5.10, fix 5.12c.
//
// The content lane IS the DDR-241 proposal chain (sync/transaction-client.ts):
// `<designRoot>/_state/outbox/<createdAt>-<transactionId>.json`, one file per
// change without a final answer. Everything here is DERIVED from those files —
// nothing new is persisted, and the proposal bytes are never touched.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OUTBOX_REL = path.join('_state', 'outbox');
const NAME_RE = /^(\d+)-(tx_[A-Za-z0-9]+)\.json$/;

/** createdAt of every content entry still waiting for a final answer — the
 *  `after` gate's input (O4). Read from the names alone: cheap per wake. */
export function contentPending(designRoot: string): number[] {
  let names: string[] = [];
  try {
    names = readdirSync(path.join(designRoot, OUTBOX_REL));
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const n of names) {
    const m = n.match(NAME_RE);
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

/** The watermark an intent enqueued NOW waits for: the newest pending
 *  content entry, or null when nothing is pending (nothing to wait for). */
export function contentWatermark(designRoot: string): number | null {
  const p = contentPending(designRoot);
  return p.length ? (p[p.length - 1] as number) : null;
}

export interface ContentView {
  pending: number;
  oldestAt: number | null;
  /** accepted this session (the transaction client's stats), when known */
  sent: number;
  byDoc: Record<string, { count: number; oldestAt: number; lanes: string[] }>;
  /** comment ids not yet accepted */
  comments: string[];
}

interface EntryLike {
  createdAt?: number;
  action?: { operations?: Array<Record<string, unknown>> };
}

/**
 * `GET /_api/outbox` `content` — the per-document pending view (5.12c) that
 * feeds "Queued" on a comment pin and "not sent" on a canvas row.
 *
 * `acceptedComments(doc)` = the ids the accepted comments lane already holds
 * (from the replica); a comment in a pending entry that is not there yet is
 * "not yet accepted". Absent ⇒ every comment id in a pending entry counts.
 */
export function contentView(
  designRoot: string,
  opts: { sent?: number; acceptedComments?: (doc: string) => ReadonlySet<string> | null } = {}
): ContentView {
  const dir = path.join(designRoot, OUTBOX_REL);
  let names: string[] = [];
  try {
    names = readdirSync(dir)
      .filter((n) => NAME_RE.test(n))
      .sort();
  } catch {
    names = [];
  }
  const byDoc: ContentView['byDoc'] = {};
  const comments = new Set<string>();
  let oldestAt: number | null = null;
  for (const n of names) {
    const createdAt = Number(n.match(NAME_RE)?.[1]);
    oldestAt = oldestAt === null ? createdAt : Math.min(oldestAt, createdAt);
    let entry: EntryLike | null = null;
    try {
      entry = JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as EntryLike;
    } catch {
      continue;
    }
    for (const op of entry?.action?.operations ?? []) {
      const doc = typeof op.doc === 'string' ? op.doc : null;
      if (!doc) continue;
      const lane =
        typeof op.lane === 'string' ? op.lane : typeof op.op === 'string' ? op.op : 'unknown';
      const row = byDoc[doc] ?? { count: 0, oldestAt: createdAt, lanes: [] };
      row.count += 1;
      row.oldestAt = Math.min(row.oldestAt, createdAt);
      if (!row.lanes.includes(lane)) row.lanes.push(lane);
      byDoc[doc] = row;
      if (op.lane === 'comments' && typeof op.content === 'string') {
        const accepted = opts.acceptedComments?.(doc) ?? null;
        for (const id of commentIds(op.content)) if (!accepted?.has(id)) comments.add(id);
      }
    }
  }
  return {
    pending: names.length,
    oldestAt,
    sent: opts.sent ?? 0,
    byDoc,
    comments: [...comments].sort(),
  };
}

/** Comment and reply ids in a comments-lane value — the `_comments/<slug>.json`
 *  shape (`api.ts` `Comment[]`, replies in `thread[]`). */
export function commentIds(content: string): string[] {
  try {
    const list = JSON.parse(content) as unknown;
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    const idOf = (x: unknown) =>
      x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string'
        ? (x as { id: string }).id
        : null;
    for (const c of list) {
      const id = idOf(c);
      if (id) out.push(id);
      const thread = (c as { thread?: unknown } | null)?.thread;
      for (const r of Array.isArray(thread) ? thread : []) {
        const rid = idOf(r);
        if (rid) out.push(rid);
      }
    }
    return out;
  } catch {
    return [];
  }
}

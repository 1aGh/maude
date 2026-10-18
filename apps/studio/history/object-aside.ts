// Version history · "this sticky" — the kept-aside versions of ONE annotation element (S9.24, V2-1.9
// decision 9; 10 · co-conflict's Version history island).
//
// The reader HOOK S1.16's object history (history/object-history.ts, not in this base yet) calls for
// its aside rows. An aside lives as an `@aside` effect (`op: 'aside.annotations'`) whose `afterHash`
// is a whole board. It is written by TWO kinds of action, and both must be read:
//   • `history.aside` — its own action (kind `aside`: a DS pick, a first-sight keep), and
//   • an ordinary EDIT the kernel accepted with an object conflict held (S9.24): the loser's board is
//     kept aside in the SAME action, so the action's kind is `edit` — a reader that keys on
//     `kind === 'aside'` would never list the version the conflict card says "stays here".
// Pure over its inputs: actions (accepted-link `history()` rows) and a blob reader (`blobs/<hash>`).

import { parseBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { HistoryAction } from '../sync/accepted-link.ts';

export interface AsideVersion {
  actionId: string;
  revision: number;
  /** The proposer — the person whose version this is ("Your version, not kept"). */
  actor: string;
  committedAt: number;
  /** The action's own kind (`edit` for a held conflict, `aside` for history.aside). */
  kind: string;
  /** The element as that kept-aside board had it. */
  element: AnnotationElement;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** The aside effects of the annotations lane that may hold `elementId`, newest action first. */
export function asideEffects(
  actions: readonly HistoryAction[],
  doc?: string | null
): Array<{ action: HistoryAction; hash: string }> {
  const out: Array<{ action: HistoryAction; hash: string }> = [];
  for (const a of [...actions].sort((x, y) => y.revision - x.revision)) {
    for (const e of a.effects ?? []) {
      if (e.lane !== '@aside' || e.op !== 'aside.annotations') continue;
      if (doc && e.doc && e.doc !== doc) continue;
      if (typeof e.afterHash === 'string' && HASH_RE.test(e.afterHash))
        out.push({ action: a, hash: e.afterHash });
    }
  }
  return out;
}

/**
 * Every kept-aside version of one element, newest first. An aside board that does not hold the
 * element (another sticky's race) is not a row; the same body twice in a row is one.
 */
export async function asideVersionsOf(
  actions: readonly HistoryAction[],
  elementId: string,
  readBlob: (hash: string) => Promise<string | null>,
  o: { doc?: string | null; limit?: number } = {}
): Promise<AsideVersion[]> {
  const rows: AsideVersion[] = [];
  let last = '';
  for (const { action, hash } of asideEffects(actions, o.doc)) {
    if (rows.length >= (o.limit ?? 50)) break;
    let body: string | null = null;
    try {
      body = await readBlob(hash);
    } catch {
      body = null;
    }
    if (!body) continue;
    const el = parseBoard(body).elements.find((e) => e.id === elementId);
    if (!el) continue;
    const key = JSON.stringify(el);
    if (key === last) continue;
    last = key;
    rows.push({
      actionId: action.actionId,
      revision: action.revision,
      actor: action.actor,
      committedAt: action.committedAt,
      kind: action.kind,
      element: el,
    });
  }
  return rows;
}

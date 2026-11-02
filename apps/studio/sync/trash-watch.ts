// The shared Trash, as a linked studio follows it — S1.7b.
//
// On a desktop linked to a hub (and a cell's own studio) nothing on this
// machine runs the kernel's `applyAccepted`, so two things the local home gets
// for free have to be READ from the project's log:
//
//   1. LIVE REFRESH — someone else deleted a canvas, trashed an artboard,
//      restored or cleared out: this Mac's Trash view must refetch
//      (`trash:changed`, history/trash.ts `bumpTrashSeq`).
//   2. CLEAR-OUT CLEANUP — the owner cleared items out: this machine's own
//      parked copies of exactly those canvases go (sync/trash-clear-copies.ts).
//      The `trash.clear` action carries the facts (the kernel stamps
//      `origin.cleared = [{ entry, artboard, rev }]`, one `@trash` effect per
//      item with its `doc` and `beforePath`), so another Mac that was off when
//      the owner cleared catches up on its next pass.
//
// Both run off the revision the bootstrap already reports, after each remote
// pass: nothing is read while the project is quiet, one history page when it
// moved. Every read is the session's own (the hub L4/L18-filters it).

import { bumpTrashSeq } from '../history/trash.ts';
import type { AcceptedLink, HistoryAction } from './accepted-link.ts';
import { type ParkedCanvas, removeClearedCopies } from './trash-clear-copies.ts';

/** Actions that change what the Trash lists, whoever made them. */
export function changesTrash(a: Pick<HistoryAction, 'kind' | 'effects'>): boolean {
  if (a.kind === 'trash' || a.kind === 'restore' || a.kind === 'trash.clear') return true;
  for (const e of a.effects ?? []) {
    if (e.lane !== '@manifest') continue;
    if (e.op === 'delete') return true;
    // ⌘Z of a delete revives the canvas: it leaves the Trash.
    if (e.op === 'create' && (a.kind === 'undo' || a.kind === 'redo')) return true;
  }
  return false;
}

/** The canvas items a `trash.clear` action cleared: `{ doc, path, rev }`. */
export function clearedCanvases(
  a: Pick<HistoryAction, 'kind' | 'origin' | 'effects'>
): { entry: string; doc: string; path: string; rev: number }[] {
  if (a.kind !== 'trash.clear') return [];
  const raw = (a.origin as { cleared?: unknown } | null | undefined)?.cleared;
  if (!Array.isArray(raw)) return [];
  const effects = (a.effects ?? []).filter((e) => e.lane === '@trash');
  const out: { entry: string; doc: string; path: string; rev: number }[] = [];
  raw.forEach((c, i) => {
    const item = c as { entry?: unknown; artboard?: unknown; rev?: unknown };
    if (typeof item?.entry !== 'string' || item.artboard !== '' || typeof item.rev !== 'number')
      return;
    // The kernel writes one `@trash` effect per item, in order; a hub that
    // names the entry on its effects is matched by it.
    const e = effects.find((x) => x.entry === item.entry) ?? effects[i];
    if (!e?.doc || !e.beforePath) return;
    out.push({ entry: item.entry, doc: e.doc, path: e.beforePath, rev: item.rev });
  });
  return out;
}

type WatchLink = Pick<AcceptedLink, 'history' | 'trash' | 'trashOps'> & {
  client: Pick<AcceptedLink['client'], 'read'>;
};

export function createTrashWatch(o: {
  link: WatchLink;
  designRoot: string;
  designRel: string;
  emit?: (event: string, payload: unknown) => void;
  log?: (line: string) => void;
}) {
  /** The newest revision already scanned for changes; null until the first pass. */
  let seen: number | null = null;
  /** The newest `trash.clear` revision whose copies were cleaned up here. */
  let cleanedThrough = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const bodyAt = async (doc: string, rev: number): Promise<string> => {
    const r = (await o.link.client.read('lane', {
      doc,
      lane: 'html',
      rev: Math.max(rev - 1, 0),
    })) as {
      body?: unknown;
    };
    return typeof r?.body === 'string' ? r.body : '';
  };

  /** Clean up after every `trash.clear` newer than the last one handled here. */
  async function cleanup(): Promise<string[]> {
    if (!o.link.trashOps()) return [];
    const { history } = await o.link.history({ limit: 20, kind: 'trash.clear' });
    // An older hub ignores `kind`: re-check every row.
    const clears = history
      .filter((a) => a.kind === 'trash.clear' && a.revision > cleanedThrough)
      .sort((x, y) => x.revision - y.revision);
    if (!clears.length) return [];
    const cleared: ParkedCanvas[] = [];
    for (const a of clears)
      for (const c of clearedCanvases(a))
        cleared.push({ path: c.path, body: await bodyAt(c.doc, c.rev) });
    let remaining: ParkedCanvas[] = [];
    const paths = new Set(cleared.map((c) => c.path));
    if (paths.size) {
      const listing = await o.link.trash();
      remaining = await Promise.all(
        (listing.canvases ?? [])
          .filter((c) => paths.has(c.path))
          .map(async (c) => ({ path: c.path, body: await bodyAt(c.doc, c.rev) }))
      );
    }
    const removed = removeClearedCopies({
      designRoot: o.designRoot,
      designRel: o.designRel,
      cleared,
      remaining,
      ...(o.log ? { log: o.log } : {}),
    });
    cleanedThrough = Math.max(cleanedThrough, ...clears.map((a) => a.revision));
    return removed;
  }

  /**
   * The project is at `revision` (the bootstrap a remote pass just read).
   * The first call only catches up on clear-outs (nothing to refresh yet).
   */
  function noteRevision(revision: number): Promise<void> {
    return serial(async () => {
      if (!Number.isFinite(revision)) return;
      if (seen === null) {
        seen = revision;
        await cleanup().catch(() => []);
        return;
      }
      if (revision <= seen) return;
      const since = seen;
      const { history } = await o.link.history({ limit: 50 });
      const fresh = history.filter((a) => a.revision > since);
      // More moved than one page shows: refresh anyway, never miss one.
      const truncated = fresh.length >= 50 && !history.some((a) => a.revision <= since);
      seen = revision;
      if (truncated || fresh.some(changesTrash)) bumpTrashSeq(o.emit);
      if (truncated || fresh.some((a) => a.kind === 'trash.clear')) await cleanup();
    }).catch(() => {});
  }

  return {
    noteRevision,
    /** Run the clear-out cleanup now (after this studio's own clear-out). */
    cleanup: () => serial(cleanup).catch(() => [] as string[]),
  };
}

export type TrashWatch = ReturnType<typeof createTrashWatch>;

// sync/held-deletes.ts — the person's answer to "Deleted on this Mac, held" (issue #207, 7b).
//
// A batch of local deletes larger than sync removes from the project unasked waits in Sync details
// (`delete-held` rows, file-plane.ts). Two answers:
//
//   Delete on the hub too — one confirmed batch. Within the hub door's own window budget (the
//     member one, or the owner's higher one) the plane sends them through the door on its next
//     passes, each a CAS on the hash this Mac last saw. Past it, the project OWNER's confirmed purge
//     (`POST /api/file-purge`: a dry run, then a confirmation bound to that exact set, paced
//     batches — apps/hub/src/owner-purge.mjs). Anyone else gets an honest no: only the owner can
//     delete this many at once.
//   Keep on the hub — the rows become `hub-only`: no delete is proposed, the same bytes are never
//     downloaded again. Recorded in this Mac's file ledger (per-machine runtime state), never in the
//     project config: the choice is about this Mac's copy, and teammates keep syncing the files.
//
// Which path to TRY comes from this Mac's stored role and its own record of deletes sent; the hub
// decides the rest (a member's door 429, an owner check on the purge). Nothing here is a hub claim.

import { inHeldFolder } from './file-plane.ts';

/** The hub door's delete window — apps/hub/src/journal.mjs `DELETE_BUDGET_PER_WINDOW`. */
export const DOOR_DELETES_MEMBER = 25;
/** The owner's own window — journal.mjs `OWNER_DELETE_BUDGET_PER_WINDOW`. */
export const DOOR_DELETES_OWNER = 200;
/** The most paths one purge names — owner-purge.mjs `MAX_PURGE_FILES`. */
export const PURGE_MAX_FILES = 20_000;

export const NOT_OWNER_DETAIL =
  'Only the project owner can delete this many at once — ask them, or keep them on the hub.';

export interface HeldDeletePlane {
  heldDeletes(): { count: number; paths: string[]; folders: { folder: string; count: number }[] };
  answerHeldDeletes(how: 'send' | 'purging' | 'keep', folder: string | null): string[];
  endPurge(rels: readonly string[]): void;
}

export interface HeldDeletesDeps {
  plane: () => HeldDeletePlane | null;
  /** Deletes this Mac sent inside the door's window (the ledger's outbound budget). */
  sentInWindow: () => number;
  /** This Mac's stored role on the hub is owner (it only decides which path to TRY). */
  isOwner: () => boolean;
  hubUrl: string;
  token: () => string | null;
  fetchImpl?: typeof fetch;
  /** Start a pass now (the answer applies without waiting for the next tick). */
  runPass: () => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  log?: Pick<Console, 'log' | 'warn'>;
}

export interface HeldDeletesView {
  count: number;
  folders: { folder: string; count: number }[];
  /** An owner purge in progress (or the last one's failure). */
  purge: { total: number; done: number; running: boolean; error?: string } | null;
}

export type HeldDeleteAnswer =
  | { ok: true; how: 'door' | 'purge' | 'keep'; count: number }
  | {
      ok: false;
      reason: 'nothing-held' | 'not-owner' | 'busy' | 'not-linked';
      detail: string;
    };

export interface HeldDeletesControl {
  view(): HeldDeletesView;
  answer(answer: 'delete' | 'keep', folder: string | null): Promise<HeldDeleteAnswer>;
  /** Test seam: the running purge, if any. */
  idle(): Promise<void>;
}

const thousands = (n: number) => n.toLocaleString('en-US');

export function createHeldDeletes(deps: HeldDeletesDeps): HeldDeletesControl {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? console;
  const base = deps.hubUrl.replace(/\/+$/, '');
  let purge: HeldDeletesView['purge'] = null;
  let job: Promise<void> | null = null;

  async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetchImpl(`${base}/api/file-purge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.token() ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* a non-JSON answer reads as a failure below */
    }
    return { status: res.status, json };
  }

  /** One purge set: the dry run, then paced confirms until the hub says done. */
  async function purgeSet(paths: string[], state: NonNullable<HeldDeletesView['purge']>) {
    const dry = await post({ paths, dryRun: true });
    if (dry.status === 403) throw new Error(NOT_OWNER_DETAIL);
    if (dry.status !== 200 || dry.json.ok !== true) {
      throw new Error('The hub did not take the deletion. Nothing more was deleted. Try again.');
    }
    const confirm = typeof dry.json.confirm === 'string' ? dry.json.confirm : null;
    // Every one is gone on the hub already: nothing to confirm.
    if (!confirm) return;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const r = await post({ paths, confirm });
      const wait = Number(r.json.retryAfterMs);
      const pause = Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60_000) : 1000;
      if (r.status === 429 || r.status === 503) {
        if (r.status === 503) state.done += Number(r.json.purged) || 0;
        await sleep(pause);
        continue;
      }
      if (r.status === 409) {
        throw new Error(
          'Some of these files changed on the hub since. Nothing more was deleted. Try again to delete the rest.'
        );
      }
      if (r.status === 403) throw new Error(NOT_OWNER_DETAIL);
      if (r.status !== 200 || r.json.ok !== true) {
        throw new Error('The hub stopped the deletion. Nothing more was deleted. Try again.');
      }
      state.done += Number(r.json.purged) || 0;
      if (r.json.done === true) return;
      await sleep(pause);
    }
  }

  async function runPurge(rels: string[]) {
    const state = { total: rels.length, done: 0, running: true } as NonNullable<
      HeldDeletesView['purge']
    >;
    purge = state;
    try {
      for (let i = 0; i < rels.length; i += PURGE_MAX_FILES) {
        await purgeSet(rels.slice(i, i + PURGE_MAX_FILES), state);
      }
      log.log?.(`[sync/files] deleted ${state.done} held files on the hub (owner purge).`);
      purge = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      log.warn?.(`[sync/files] the held deletes stopped: ${state.error}`);
    } finally {
      state.running = false;
      // The hub's tombstones arrive on this pass and the rows leave; anything it did not delete is
      // held again, still waiting for an answer.
      try {
        await deps.runPass();
      } catch {
        /* the next tick reads them */
      }
      deps.plane()?.endPurge(rels);
    }
  }

  return {
    view() {
      const held = deps.plane()?.heldDeletes() ?? { count: 0, folders: [] };
      return {
        count: held.count,
        folders: held.folders,
        purge: purge ? { ...purge } : null,
      };
    },
    async answer(answer, folder) {
      const plane = deps.plane();
      if (!plane) {
        return {
          ok: false,
          reason: 'not-linked',
          detail: 'This project isn’t syncing with a hub right now.',
        };
      }
      if (answer === 'keep') {
        const kept = plane.answerHeldDeletes('keep', folder);
        if (kept.length === 0) return nothingHeld();
        void Promise.resolve(deps.runPass()).catch(() => {});
        return { ok: true, how: 'keep', count: kept.length };
      }
      if (job) {
        return {
          ok: false,
          reason: 'busy',
          detail: 'The hub is still deleting the last batch. Try again when it is done.',
        };
      }
      const n = plane.heldDeletes().paths.filter((r) => inHeldFolder(r, folder)).length;
      if (n === 0) return nothingHeld();
      const owner = deps.isOwner();
      const room = (owner ? DOOR_DELETES_OWNER : DOOR_DELETES_MEMBER) - deps.sentInWindow();
      if (n <= room) {
        const sent = plane.answerHeldDeletes('send', folder);
        void Promise.resolve(deps.runPass()).catch(() => {});
        return { ok: true, how: 'door', count: sent.length };
      }
      if (!owner) return { ok: false, reason: 'not-owner', detail: NOT_OWNER_DETAIL };
      const rels = plane.answerHeldDeletes('purging', folder);
      job = runPurge(rels).finally(() => {
        job = null;
      });
      return { ok: true, how: 'purge', count: rels.length };
    },
    async idle() {
      await job;
    },
  };
}

function nothingHeld(): HeldDeleteAnswer {
  return { ok: false, reason: 'nothing-held', detail: 'Nothing here is waiting to be deleted.' };
}

/** Sync details' sentence for the held row (CONTRACT §4: what happened · what is safe · the verbs). */
export function heldDeleteDetail(count: number, folders: { folder: string; count: number }[]) {
  const where =
    folders.length === 1
      ? ` in ${folders[0]?.folder || 'the project folder'}`
      : folders.length > 1
        ? ` in ${thousands(folders.length)} folders`
        : '';
  const files = count === 1 ? '1 file' : `${thousands(count)} files`;
  return `${files} deleted on this Mac${where} — more than sync deletes on the hub without asking. They are still on the hub. Delete them on the hub too, or keep them there.`;
}

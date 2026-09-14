// The cell child's file-event wiring — Sync v2 Increment 2/3 (DDR-226 §4/§6).
//
// The doorbell, both buttons, assembled once at boot:
//
//   resolveCellCtl      → do we have a loopback hub and a token? (workspace mode)
//   createCtlProvider   → hold the read-only `maude.files` channel open
//   createCtlHealer     → hub → child: poke ⇒ read the journal ⇒ emit the
//                         `fs:any` the container's watcher owed us
//   createCellWriteNudge → child → hub: we wrote ⇒ name the paths ⇒ the hub
//                         re-reads its own disk and journals them
//
// The two directions are deliberately symmetric and deliberately unequal in
// what they carry: the hub's frame carries a head and no path (DDR-054 — a path
// would be a path the hub chose), and the child's carries paths and no content
// (the hub re-stats and re-hashes for itself). Neither end can make the other
// believe something about bytes it did not look at.
//
// Downstream of the heal, everything is machinery that already exists:
// `fs:any` → `createHmrBroadcaster` → `canvas-hmr {mode:'asset'|'css'|'module'}`
// → the iframe repoints a broken `<img>` (DDR-224) or swaps a stylesheet. No new
// UI path, no new reload semantics.
//
// GATED ON WORKSPACE MODE, NOT ON CELL PAIRING — the whole point. Pairing is a
// one-tenant pilot allowlist; the watcher gap is on every cell. See the header
// of `ctl-provider.ts` for why the pairing preconditions do not apply to a
// read-only stateless channel.
//
// Locally this never starts: outside a container `fs.watch` fires and a second
// event source would double-reload every canvas on every edit, exactly the
// reason `createContainerWriteBridge` carries the same gate.

import type { Context } from '../context.ts';
import { createCellWriteNudge } from './cell-write-nudge.ts';
import { createCtlHealer } from './ctl-heal.ts';
import { createCtlProvider, resolveCellCtl } from './ctl-provider.ts';

export interface CellFileEvents {
  stop(): void;
  /** Pokes received on the channel. */
  received(): number;
  /** Paths announced onward as `fs:any`. */
  healed(): number;
  /** Nudge requests the hub accepted. */
  nudged(): number;
  /** Paths named in those requests. */
  nudgedPaths(): number;
}

/**
 * Start the hub→child file-event bridge. Returns null when this process is not
 * a cell studio child (which is every desktop, and every local dev server).
 *
 * Never throws: the studio must start whether or not it has a doorbell.
 */
export function startCellFileEvents(
  ctx: Context,
  env: Record<string, string | undefined> = process.env
): CellFileEvents | null {
  const target = resolveCellCtl(env);
  if (!target) return null;

  const nudge = createCellWriteNudge({
    hubUrl: target.url,
    token: target.token,
  });

  const healer = createCtlHealer({
    hubUrl: target.url,
    token: target.token,
    // The one side effect: announce a path onto the bus. Nothing here writes a
    // file, and nothing here trusts the hub's row beyond its shape — the
    // canvas layer re-reads the real disk to decide what to do about it.
    //
    // The mute is what stops us telling the hub a fact it just told us. It is
    // not a loop guard — `recordWrite` is a no-op on identical bytes, so the
    // echo would die on its own — it is simply not paying for the round trip.
    emit: (rel) => {
      nudge.mute(rel);
      ctx.bus.emit('fs:any', rel);
    },
  });

  // Baseline the heal cursor from the hub's head BEFORE the first poke — see
  // `anchor`. Fire-and-forget: the studio must start whether or not the hub
  // answers, and an unanchored healer still works the way it always did.
  void healer.anchor();

  const provider = createCtlProvider({
    url: target.url,
    token: target.token,
    onPoke: (head) => healer.onPoke(head),
    // The paired cell runtime does not open a second control provider. Route
    // metadata invalidation to its bounded discovery queue, not the journal.
    onDocuments: () => ctx.bus.emit('sync:documents-changed'),
  });

  // Every write this process makes surfaces here, because both synthetic-event
  // sources (`createContainerWriteBridge` off `activity:suppress`, and
  // `announceWrite` off the projector) converge on `fs:any`. See the module
  // header for why that is the complete set and why incompleteness would only
  // cost latency.
  const offFsAny = ctx.bus.on('fs:any', (rel: string) => nudge.note(rel));

  console.log(
    '[sync/ctl] file-event channel attached to this cell’s own hub — hub-process writes heal open canvases without a reload, and writes made here reach the journal at once instead of on the walk-import belt.'
  );

  return {
    stop() {
      offFsAny();
      provider.stop();
      healer.stop();
      nudge.stop();
    },
    received: () => provider.received(),
    healed: () => healer.healed(),
    nudged: () => nudge.sent(),
    nudgedPaths: () => nudge.named(),
  };
}

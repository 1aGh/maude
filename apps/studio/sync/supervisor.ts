// Sync supervisor — one owner of the live sync runtime, so linking a project
// can START SYNCING instead of asking a person to restart the app.
//
// Why this exists: `createSyncRuntime` captures `cfg.linkedHub` once, and
// `reloadConfig` deliberately refuses to hot-swap it (a config.json is
// committed and travels with the repo — a poisoned one must never re-point the
// sync socket, DDR-149). That rule is about the FILE WATCHER, and it was being
// paid for by the person: after pressing Connect in the cloud panel the whole
// product did nothing visible and the UI said "restart the studio server to
// start syncing" — a sentence with no button behind it, and no meaning at all
// inside the desktop app, where there is no server the person can see.
//
// The supervisor separates the two paths that were conflated:
//
//   • a linkedHub arriving from DISK        → still boot-pinned, still refused;
//   • a linkedHub the person JUST AUTHORIZED in trusted app chrome, whose hub
//     credential this process itself stored one line earlier → adopted in
//     memory and applied by a real stop() + start() cycle.
//
// The second path never reads the value back off disk: `restart()` takes the
// LinkedHub object the attach lane just wrote, so nothing that happens to
// `.design/config.json` in between can steer the socket.

import { adoptLinkedHub, type Context, type LinkedHub } from '../context.ts';
import { resolveCellPairing } from './cell-pairing.ts';
import { getHubToken } from './hubs-config.ts';
import {
  type CreateSyncRuntimeOptions,
  checkUrlScheme,
  createSyncRuntime,
  type SyncRuntime,
} from './index.ts';
import { hubHost } from './link-consent.ts';

/**
 * What happened when the runtime was (re)started — the honest answer the cloud
 * panel repeats back to the person. `syncing:false` is never silent: `reason`
 * is what to say, and the caller renders it verbatim rather than guessing.
 */
export interface SyncStartOutcome {
  syncing: boolean;
  /** Canvases the runtime actually took ownership of. */
  canvases: number;
  /** Machine-readable cause when `syncing` is false. */
  reason?:
    | 'unlinked'
    | 'unconfirmed'
    | 'no-credential'
    | 'insecure-url'
    | 'refused'
    | 'nothing-syncable'
    | 'error';
  /** One sentence a person can act on. Present whenever `syncing` is false. */
  detail?: string;
}

export interface SyncSupervisor {
  /** Boot the runtime from the config as loaded. Safe when unlinked. */
  start(): Promise<SyncStartOutcome>;
  /**
   * Adopt a just-authorized link and cycle the runtime. `linkedHub` is passed
   * BY VALUE from the attach lane on purpose — never re-read from disk.
   * `null` is the detach lane: clear the in-memory link (the config write on
   * disk is invisible to a cfg captured at boot) and cycle back to solo.
   * `undefined` keeps whatever the config already holds.
   */
  restart(linkedHub?: LinkedHub | null): Promise<SyncStartOutcome>;
  /**
   * Is a start/restart/stop cycle in flight?
   *
   * NOT a lock — `serialize()` below already guarantees ordering, and a caller
   * must never re-implement that. This exists so the Resync button can be
   * REFUSED EARLY (409) instead of quietly queued: a person pressing twice
   * wants to know the first press is still working, not to buy a second full
   * re-link of every canvas.
   */
  busy(): boolean;
  stop(): Promise<void>;
  /** The live runtime, or null in solo mode. Test/inspection surface. */
  current(): SyncRuntime | null;
}

/**
 * Why did `createSyncRuntime` decline? It logs its refusals and returns null,
 * which is right for a boot path and useless for a dialog. Re-derive the cause
 * from the same inputs so the panel can say something true. Kept in this order
 * deliberately — it mirrors the guard order in createSyncRuntime.
 */
function diagnose(ctx: Context): { reason: SyncStartOutcome['reason']; detail: string } {
  // Cell pairing supplies its own hub URL + credential from the environment, so
  // "no linkedHub on disk" is not the diagnosis there — reporting "not linked to
  // a workspace" for a cell that IS paired would send an operator looking for a
  // config field that has nothing to do with it. Both pairing outcomes (refused
  // to resolve, or resolved but the runtime still declined) return here — a
  // successfully-resolved pairing always carries a non-empty `url`
  // (`resolveCellPairing` refuses an empty one), so there is no "unlinked"
  // state to fall through to on this path, unlike the plain linkedHub case below.
  const { pairing, detail: pairingRefusal } = resolveCellPairing();
  if (pairingRefusal) {
    return { reason: 'refused', detail: pairingRefusal };
  }
  if (pairing) {
    return {
      reason: 'refused',
      detail: 'Cell pairing is on but syncing did not start — see the server log for why.',
    };
  }
  const linked = ctx.cfg.linkedHub;
  if (!linked && ctx.unconfirmedHub) {
    // gate-b-sec4 — the folder names a hub this Mac never linked: solo until Connect.
    return {
      reason: 'unconfirmed',
      detail: `This project says it syncs with ${hubHost(ctx.unconfirmedHub.url)}. Connect?`,
    };
  }
  if (!linked) {
    return { reason: 'unlinked', detail: 'This project is not linked to a workspace.' };
  }
  const scheme = checkUrlScheme(linked.url);
  if (scheme) {
    return { reason: 'insecure-url', detail: scheme };
  }
  if (!getHubToken(linked.url)) {
    return {
      reason: 'no-credential',
      detail: 'No sign-in for this workspace is stored on this machine yet.',
    };
  }
  return {
    reason: 'refused',
    detail: 'Syncing is switched off in this environment — see the server log for why.',
  };
}

export function createSyncSupervisor(
  ctx: Context,
  opts: CreateSyncRuntimeOptions = {},
  factory: (c: Context, o: CreateSyncRuntimeOptions) => SyncRuntime | null = createSyncRuntime
): SyncSupervisor {
  let runtime: SyncRuntime | null = null;
  // Two Connects pressed in quick succession must not interleave a stop() with
  // another cycle's start() — the second would attach providers the first is
  // still tearing down. One chain, in order.
  let chain: Promise<unknown> = Promise.resolve();

  async function boot(): Promise<SyncStartOutcome> {
    runtime = factory(ctx, opts);
    if (!runtime) return { syncing: false, canvases: 0, ...diagnose(ctx) };
    try {
      await runtime.start();
    } catch (err) {
      // Same posture as the boot path: a failed sync start never takes the
      // server (or the attach response) down with it — solo mode continues.
      console.error('[sync] start failed — continuing in solo mode:', err);
      return {
        syncing: false,
        canvases: 0,
        reason: 'error',
        detail: `Syncing could not start: ${(err as Error).message}`,
      };
    }
    const canvases = runtime.size();
    if (canvases === 0) {
      // Linked and authenticated, but nothing on disk qualifies. The runtime
      // already wrote the full reason into `_sync.json` (9.1-D); reuse it
      // rather than inventing a second explanation that can drift from it.
      const status = runtime.status() as { reason?: string } | null;
      return {
        syncing: false,
        canvases: 0,
        reason: 'nothing-syncable',
        detail: status?.reason ?? 'No canvases in this project are syncable yet.',
      };
    }
    return { syncing: true, canvases };
  }

  let inFlight = 0;

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    inFlight++;
    const next = chain.then(work, work);
    // Keep the chain alive even when a link fails — the NEXT attach must still
    // be able to run. (A rejected chain would poison every later restart.)
    chain = next.catch(() => {});
    // Settled either way — a cycle that threw is still a cycle that ended, and
    // leaking `inFlight` would leave Resync refusing forever.
    const settle = (): void => {
      inFlight--;
    };
    next.then(settle, settle);
    return next;
  }

  return {
    start: () => serialize(boot),
    busy: () => inFlight > 0,
    restart: (linkedHub) =>
      serialize(async () => {
        try {
          await runtime?.stop();
        } catch (err) {
          console.error('[sync] stop before restart failed:', err);
        }
        runtime = null;
        if (linkedHub) adoptLinkedHub(ctx, linkedHub);
        else if (linkedHub === null) {
          delete ctx.cfg.linkedHub;
          delete ctx.unconfirmedHub;
        }
        return boot();
      }),
    stop: () =>
      serialize(async () => {
        await runtime?.stop();
        runtime = null;
      }),
    current: () => runtime,
  };
}

// The file-plane control channel, receiver side — Sync v2 Increment 2
// (DDR-226 §4).
//
// ── The bug, and why the fix has to live OUTSIDE the pairing gate ───────────
//
// A hub-process write (a desktop asset PUT, a bucket→checkout refill) lands in
// the checkout via tmp+rename. In a container, recursive `fs.watch` does not
// fire for that — verified live in this repo, three separate times, and the
// reason `announceWrite` exists for projection writes. So the studio child
// never learns, no `fs:any` is synthesized, no `canvas-hmr {mode:'asset'}` heal
// goes out, and an open cloud tab keeps its broken-image glyph until somebody
// reloads by hand. Bytes delivered; nothing visible.
//
// The obvious place to receive the hub's poke is the child's EXISTING loopback
// Hocuspocus provider. That provider only exists under cell pairing, and
// pairing is a one-tenant pilot allowlist (`CELL_LIVE_PAIRING`) — a breaker
// caught the claim "the child hears it on its existing provider" as false
// fleet-wide. So the control attach is its OWN thing, gated only on what it
// actually needs:
//
//   workspace mode + a loopback hub URL + a token.
//
// All three are already injected into every cell's studio child (the hub mints
// the loopback token whenever it supervises a child at all). Pairing's five
// preconditions govern SHARED-DOC CONTENT — two writers over one working tree,
// one committer, one Y.Doc per canvas. None of them is about a read-only
// stateless channel that carries `{t:'files', head}` and cannot write anything.
// Applying them here would buy no safety and would leave the bug alive on every
// cell but one.
//
// ── What this channel is allowed to do ─────────────────────────────────────
//
// Receive a number. That is the whole vocabulary. `head` is a HINT — the
// receiver re-reads `GET /api/journal` (authenticated, scope-filtered,
// fail-closed) or simply re-runs its existing missing-only pull, and believes
// THAT. A lost poke costs latency and never correctness, because the 20 s
// reconciler poll is still underneath it. That is why this file has no
// retry-until-delivered machinery and no ordering guarantees: it is a doorbell,
// not a delivery.

import { parsePoke } from './poke.ts';

/** The reserved control document. Must match the hub's `files-ctl.mjs`. */
export const FILES_CTL_DOC = 'maude.files';

export interface CellCtlTarget {
  url: string;
  token: string;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
}

/**
 * Resolve the cell child's control target from the environment.
 *
 * Deliberately NOT `resolveCellPairing`: this needs three facts, not eight, and
 * conflating them is what would keep the watcher-gap bug alive on every
 * unpaired cell. The loopback assertion is kept verbatim from the pairing
 * resolver, because "a cell talks to ITSELF or to nothing" (DDR-209) is about
 * egress and applies to every socket the child opens, control or not.
 */
export function resolveCellCtl(
  env: Record<string, string | undefined> = process.env
): CellCtlTarget | null {
  if (env.MAUDE_WORKSPACE_MODE !== '1') return null;
  // The one opt-out, and it is a CONFIG-shaped kill switch rather than a
  // feature flag: `linkedHub.fileEvents:false` is the documented rollback, and
  // this env var is its cell-side twin for the operator runbook.
  if (env.MAUDE_FILE_EVENTS === '0') return null;
  const url = (env.MAUDE_LOOPBACK_SYNC_URL ?? '').trim();
  const token = (env.MAUDE_LOOPBACK_SYNC_TOKEN ?? '').trim();
  if (!url || !token) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isLoopbackHost(parsed.hostname)) return null;
  return { url, token };
}

/** The minimal provider surface this needs — injectable, so tests need no WS. */
export interface CtlProviderLike {
  on(event: 'stateless', cb: (data: { payload: string }) => void): void;
  on(event: 'status', cb: (data: { status?: string }) => void): void;
  destroy(): void;
}

export interface CtlProviderOptions {
  url: string;
  token: string;
  /** Fired with the hub's head on every well-formed poke. */
  onPoke: (head: number) => void;
  /** Optional fast document-list invalidation; older consumers use onPoke. */
  onDocuments?: () => void;
  documentName?: string;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  /** Injected in tests; production builds one from `@hocuspocus/provider`. */
  connect?: (args: {
    wsUrl: string;
    token: string;
    documentName: string;
  }) => CtlProviderLike | Promise<CtlProviderLike>;
}

export interface CtlProvider {
  stop(): void;
  connected(): boolean;
  /** Well-formed pokes received — the honesty counter's receiver half. */
  received(): number;
  /** Frames that arrived and were refused. Non-zero means someone is lying. */
  malformed(): number;
}

/** `http(s)://host` → `ws(s)://host` — the same mapping the sync runtime uses. */
export function toWsUrl(url: string): string {
  return url
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:')
    .replace(/\/+$/, '');
}

/**
 * Attach the control channel.
 *
 * Never throws: a control channel that cannot open is a latency regression to
 * exactly today's behaviour, and taking a studio server down over a doorbell
 * would be a far worse trade.
 */
export function createCtlProvider(opts: CtlProviderOptions): CtlProvider {
  const log = opts.log ?? console;
  const documentName = opts.documentName ?? FILES_CTL_DOC;
  let provider: CtlProviderLike | null = null;
  let status: string = 'connecting';
  let received = 0;
  let malformed = 0;

  const connect =
    opts.connect ??
    (async ({ wsUrl, token, documentName: name }) => {
      // Loaded lazily and defensively: the provider package is a runtime dep of
      // the studio, and a failure to load it must degrade to "no control
      // channel", never to "the studio did not start". Dynamic `import` rather
      // than `require` — this is an ES module, exactly like the sync runtime's
      // own provider factory.
      // biome-ignore lint/suspicious/noExplicitAny: provider runtime is typed at the call site.
      const mod: any = await import('@hocuspocus/provider');
      // Its OWN socket, not the sync runtime's multiplexed one: in a cell the
      // sync runtime frequently does not exist at all (unpaired), which is the
      // whole point of this file.
      return new mod.HocuspocusProvider({ url: wsUrl, name, token }) as CtlProviderLike;
    });

  const wire = (p: CtlProviderLike): void => {
    p.on('status', (data: { status?: string }) => {
      if (typeof data?.status !== 'string') return;
      const reconnect = data.status === 'connected' && status !== 'connected';
      status = data.status;
      if (reconnect && !stopped) {
        try {
          opts.onDocuments?.();
        } catch (error) {
          log.error?.(`[sync/ctl] discovery handler threw: ${(error as Error).message}`);
        }
      }
    });
    p.on('stateless', (data: { payload: string }) => {
      if (stopped) return;
      const poke = parsePoke(data?.payload);
      if (poke === null) {
        malformed += 1;
        // One line, not a flood: a hub sending garbage on this channel is
        // worth seeing exactly once, and the counter carries the rest.
        if (malformed === 1) {
          log.warn?.(
            '[sync/ctl] refused a malformed control frame — the channel carries {t:"files", head} and nothing else.'
          );
        }
        return;
      }
      received += 1;
      try {
        if (poke.documents && opts.onDocuments) opts.onDocuments();
        else opts.onPoke(poke.head);
      } catch (err) {
        log.error?.(`[sync/ctl] poke handler threw: ${(err as Error).message}`);
      }
    });
  };

  // Attach without making every caller await: a doorbell that is one tick late
  // is a doorbell. `stopped` covers the race where the caller tears the runtime
  // down while the module is still resolving.
  let stopped = false;
  void (async () => {
    try {
      const p = await connect({ wsUrl: toWsUrl(opts.url), token: opts.token, documentName });
      if (stopped) {
        p.destroy();
        return;
      }
      provider = p;
      wire(p);
    } catch (err) {
      log.warn?.(
        `[sync/ctl] control channel unavailable (${(err as Error).message}) — falling back to the reconciler poll.`
      );
      provider = null;
    }
  })();

  return {
    stop() {
      stopped = true;
      try {
        provider?.destroy();
      } catch {
        /* best-effort */
      }
      provider = null;
    },
    connected: () => status === 'connected',
    received: () => received,
    malformed: () => malformed,
  };
}

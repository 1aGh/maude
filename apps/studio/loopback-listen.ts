// V2-3.6 NEW-1 — hold BOTH loopback families on a studio port.
//
// A project window loads, and the native shell trusts, `http://localhost:<port>`.
// WebKit (and Bun's own fetch) resolve `localhost` to `::1` FIRST, so a listener
// bound to 127.0.0.1 only leaves `[::1]:<port>` free for any same-user process:
// `python3 -m http.server --bind ::1 <port>` would answer the next reload, tab
// wake or crash recovery, on the origin the shell treats as the project.
//
// So every studio listener a window or iframe reaches BY NAME (`localhost`) —
// main, canvas, capture — binds `127.0.0.1:<port>` AND `[::1]:<port>`, two
// `Bun.serve` instances built by the SAME factory (same routes, fetch, websocket
// handler; the studio uses no Bun pub/sub, so two instances lose nothing). A
// taken `[::1]:<port>` is a hard failure — the port is not ours — reported as
// EADDRINUSE so the main server's port walk moves on, and a port-0 listener
// re-rolls. Never `hostname: '::'`: that is every interface, not loopback.
//
// The one tolerated absence: a host with NO IPv6 loopback at all (some
// containers). Nobody can bind `::1` there either, so there is nothing to squat.
// Bun reports every bind failure as EADDRINUSE, so absence is told apart from
// "taken" by probing `[::1]:0` — if even an OS-assigned port fails, the family
// does not exist.
//
// The Home server is NOT here: its window navigates and trusts `127.0.0.1`
// (home.rs, W2), so it never resolves a name.

export const V4_LOOPBACK = '127.0.0.1';
export const V6_LOOPBACK = '::1';

export interface StoppableServer {
  readonly port: number | undefined;
  stop(closeActiveConnections?: boolean): unknown;
}

export type Bind<S extends StoppableServer> = (hostname: string, port: number) => S;

function inUse(message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = 'EADDRINUSE';
  return err;
}

let v6Present: boolean | null = null;

/** Does this host have an IPv6 loopback at all? Probed once per process. */
export function hasV6Loopback(probe: () => boolean = probeV6): boolean {
  if (v6Present === null) v6Present = probe();
  return v6Present;
}

function probeV6(): boolean {
  try {
    const s = Bun.serve({ hostname: V6_LOOPBACK, port: 0, fetch: () => new Response(null) });
    s.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget the cached probe. */
export function resetV6ProbeForTests(): void {
  v6Present = null;
}

/**
 * Bind `127.0.0.1:<port>` and `[::1]:<same port>` through one factory. Returns
 * the IPv4 server; its `stop()` stops the IPv6 twin too, so callers keep using
 * one handle. `port` 0 = OS-assigned (re-rolled up to `rerolls` times when the
 * assigned port's `::1` twin is taken).
 */
export function listenLoopback<S extends StoppableServer>(
  bind: Bind<S>,
  port: number,
  { rerolls = 8, v6 = hasV6Loopback }: { rerolls?: number; v6?: () => boolean } = {}
): S {
  const attempts = port === 0 ? rerolls + 1 : 1;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const primary = bind(V4_LOOPBACK, port);
    const bound = primary.port as number;
    let twin: S | null = null;
    try {
      twin = bind(V6_LOOPBACK, bound);
    } catch {
      if (!v6()) return primary; // no IPv6 loopback on this host: nothing to squat
      primary.stop(true);
      last = inUse(
        `[::1]:${bound} is held by another process — refusing to serve localhost:${bound} on IPv4 only (V2-3.6 NEW-1)`
      );
      continue;
    }
    const stopPrimary = primary.stop.bind(primary);
    const pair = twin;
    Object.defineProperty(primary, 'stop', {
      configurable: true,
      value: (close?: boolean) => {
        pair.stop(close);
        return stopPrimary(close);
      },
    });
    Object.defineProperty(primary, 'v6Twin', { configurable: true, value: pair });
    return primary;
  }
  throw last;
}

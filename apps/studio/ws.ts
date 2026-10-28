// Bun.serve native WebSocket handlers — replaces server.mjs's hand-rolled
// RFC-6455 upgrade. Per-connection state lives on ws.data (Bun's typed slot).

import type { ServerWebSocket, WebSocketHandler } from 'bun';

import { canvasOfSlug, type WsVisibility } from './access/filters.ts';
import { toDesignRel } from './access/request.ts';
import { type Access, accessWiderThan } from './access/scope.ts';
import type { Acp } from './acp/index.ts';
import type { Activity } from './activity.ts';
import type { Api } from './api.ts';
import { canvasSlugFromRel } from './canvas-slug.ts';
import type { Collab, RoomConn } from './collab/index.ts';
import type { Context } from './context.ts';
import { createRenderOkSignal } from './history/render-ok-signal.ts';
import { createContainerWriteBridge, createHmrBroadcaster } from './hmr-broadcast.ts';
import type { InspectRegistry } from './inspect.ts';
import { startCellFileEvents } from './sync/cell-file-events.ts';
import { isRuntimeStateRel } from './sync/file-membership.ts';
import { isWorkspaceMode } from './workspace-mode.ts';

/**
 * Per-connection state. `kind` discriminates between the legacy JSON
 * inspector channel (`/_ws`) and the Phase 8 binary collab channel
 * (`/_ws/collab/:slug`). server.ts sets this at upgrade time.
 */
export type WsData =
  | {
      id: string;
      remote: string;
      kind: 'inspector';
      /** Cloud Phase 27 — the role this socket was opened under, stamped at
       *  upgrade time from the proxy's injected header. `true` outside a cell
       *  only when the linked hub vouched `viewer`.
       *
       *  It has to live on the SOCKET, not be re-read per message: a role is
       *  per session, and a handshake is the one moment the session is
       *  unambiguous. */
      readOnly: boolean;
      /** WHOSE socket this is — Cloud Phase 27 D3. Same reasoning as `readOnly`
       *  one line up, for the other thing a cell has more than one of. `''` on
       *  a desktop, which is what makes every broadcast below reach everybody
       *  exactly as it always did. */
      session: string;
      /** WHO opened this socket, as the proxy vouched it — Cloud Phase 27.
       *  `''` on a desktop, where the project's git identity is the person. */
      user?: string;
      /** S9.11 (V2-1.16 L12) — WHAT this socket may hear: the upgrade request's access,
       *  stamped by server.ts. Absent = the identity (a hand-built test socket). */
      access?: Access;
      /** S9.15c — no comment write either (a paused project): `comments-add` is refused
       *  with the patch/delete pair. Stamped by server.ts from the proxy's projection. */
      lanesClosed?: boolean;
    }
  | {
      id: string;
      remote: string;
      kind: 'collab';
      slug: string;
      /** Which origin upgraded this socket — 'canvas' marks the untrusted
       *  canvas iframe origin, whose sync frames go through the DDR-122
       *  origin gate in collab/room.ts. Set at upgrade time in server.ts. */
      realm: 'main' | 'canvas';
      /** Cloud collab lane (RCA issue-cloud-live-collaboration-dead) — the
       *  role this socket was opened under, stamped at upgrade time from the
       *  proxy's injected header (fail-closed in a cell, always false on a
       *  loopback desktop). A read-only collab socket receives everything and
       *  publishes awareness (presence is the point), but its sync writes are
       *  gated to the comment lane in collab/room.ts — the WS mirror of the
       *  role matrix's `viewer.comment === true`. */
      readOnly?: boolean;
      /** S9.11 (L11) — the upgrade request's access (`summon` is stripped without it). */
      access?: Access;
      /** S3.7c — a presentation follower's socket: receive-only in the room (collab/room.ts). */
      follow?: boolean;
      /** S9.15c — read-only with no writable lane, comments included (collab/room.ts). */
      lanesClosed?: boolean;
    }
  | {
      // T2 (9.1-A) — HMR-only socket for the segregated canvas origin. Receives
      // ONLY `canvas-hmr` broadcasts; never the privileged inspector feed
      // (comments / ai-activity / git-lifecycle / sync:status / selection) and
      // ignores all inbound messages. Hub-pushed canvas code on the canvas
      // origin can open this, but it leaks nothing and mutates nothing.
      id: string;
      remote: string;
      kind: 'canvas-hmr';
      /** S9.11 (L12) — the render token's access, stamped at the upgrade. */
      access?: Access;
    }
  | {
      // Phase 31 (DDR-123) — ACP chat bridge socket. Main origin ONLY,
      // loopback-guarded at upgrade (server.ts); NEVER opened from the canvas
      // origin. Carries the JSON chat protocol (prompt / cancel ↔ update /
      // turn-end), bridged to the user's own `claude` via createAcp.
      id: string;
      remote: string;
      kind: 'acp';
    };

/**
 * Match the collab URL pattern and return the slug, or `null` if the path
 * isn't a collab endpoint. Exported so server.ts owns the routing decision.
 *
 * Slug grammar matches `api.fileSlug` output: `[a-z0-9_-]+`. URL-encoded chars
 * are rejected here — the legacy inspector path stays the catch-all.
 */
export function parseCollabSlug(pathname: string): string | null {
  const m = pathname.match(/^\/_ws\/collab\/([a-z0-9_-]+)$/i);
  return m ? (m[1] ?? null) : null;
}

/**
 * DDR-047 — collab WS upgrades MUST come from a loopback host. The header
 * carries `<host>:<port>` (or `<host>` if default-port); strip the port and
 * compare against the loopback aliases. Anything else returns false → server.ts
 * answers 403.
 */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  // Strip port. `[::1]:4399` keeps the `::1` bracketed; handle both shapes.
  let h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    if (close === -1) return false;
    h = h.slice(1, close);
  } else {
    const colon = h.lastIndexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
  }
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

/** Port component of a `host[:port]` / `[::1]:port` string ('' if default-port). */
function hostPort(host: string): string {
  const h = host.trim();
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    return close !== -1 ? h.slice(close + 1).replace(/^:/, '') : '';
  }
  const colon = h.lastIndexOf(':');
  return colon !== -1 ? h.slice(colon + 1) : '';
}

/**
 * CSWSH gate for the privileged ACP WebSocket. Loopback-Host is NOT enough: a
 * WS handshake bypasses the same-origin policy, so a cross-origin drive-by page
 * (`http://evil.com`, or the user's own `http://localhost:3000` dev server) can
 * open `ws://localhost:<port>/_ws/acp` — and the bridge spawns the user's
 * `claude` + drives file edits. A browser ALWAYS sends `Origin` on a cross-doc
 * WS connect; a non-browser client (CLI / tests) omits it. Allow when Origin is
 * absent, or when it is a loopback host on the SAME port as the request — which
 * is exactly what the native panel and a same-origin `maude design serve` tab
 * send (both navigate to `http://localhost:<serverport>`). Reject everything
 * else. Mirrors the `sameOriginWrite` (http.ts) discipline for the WS upgrade.
 */
export function isSameOriginWs(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser (CLI / tests) — browsers send Origin on WS
  let originHost: string;
  try {
    originHost = new URL(origin).host; // host[:port]; `Origin: null` → throws → reject
  } catch {
    return false;
  }
  const reqHost = req.headers.get('host');
  if (!isLoopbackHost(originHost) || !isLoopbackHost(reqHost)) return false;
  return hostPort(originHost) === hostPort(reqHost ?? '');
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface Ws {
  handler: WebSocketHandler<WsData>;
  broadcast(payload: unknown): void;
  clientCount(): number;
  /** V2-2.4b — the shells `maude design open` can reach (see `ui-open` below). */
  shellCount(): number;
  /**
   * S9.12b (V2-1.16 U6) — close every inspector / collab / canvas-HMR socket whose stamped
   * access is wider than `current` (the clients reconnect at the new access). Returns how many.
   */
  closeWiderThan(current: Access): number;
}

/** P8 G2 (b) — the conn's role on this canvas for the room's stamp; no access → no role. */
function roleOfConn(access: Access | undefined, canvas: string | null): Pick<RoomConn, 'role'> {
  const role = access?.roleFor(canvas) ?? null;
  return role ? { role } : {};
}

/** The close a socket gets when the access it was opened under is no longer the session's. */
export const ACCESS_CHANGED_CLOSE = Object.freeze({ code: 4403, reason: 'access-changed' });

export function createWs(
  ctx: Context,
  api: Api,
  /** Cloud Phase 27 D3 — one inspector per member, not one per process. Every
   *  read/write below resolves through the socket's own session key, so a
   *  desktop (key `''`) keeps hitting the single instance it always had. */
  inspects: InspectRegistry,
  collab: Collab,
  activity: Activity,
  acp: Acp,
  /** S9.11 (V2-1.16 L12) — the canvas-only frame filter; absent = every frame to everyone. */
  scope?: WsVisibility
): Ws {
  const clients = new Set<ServerWebSocket<WsData>>();
  // S6.12 — the canvas said it drew fine (relayed by the shell): the server decides what that is worth.
  const noteRenderOk = createRenderOkSignal({
    designRoot: ctx.paths.designRoot,
    designRel: ctx.paths.designRel,
  });
  // S9.12b (U6) — every socket that carries a stamped access, whichever set it joins below.
  const stamped = new Set<ServerWebSocket<WsData>>();

  /**
   * S9.11 — `frame` as THIS socket may receive it (`msg` is its JSON): the same string for
   * a project session (U7), the filtered frame for a canvas-only one, or null (not sent).
   */
  function scoped(
    ws: ServerWebSocket<WsData>,
    frame: unknown,
    msg: string,
    addressed = false
  ): string | null {
    if (!scope || scope.seerFor(ws) === null) return msg;
    const obj = typeof frame === 'string' ? safeParse(frame) : frame;
    if (!obj || typeof obj !== 'object') return null;
    const out = scope.frameFor(ws, obj as Record<string, unknown>, { addressed });
    return out === null ? null : out === obj ? msg : JSON.stringify(out);
  }

  function send(ws: ServerWebSocket<WsData>, payload: unknown) {
    try {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    } catch {
      /* dead socket — close handler will clean up */
    }
  }

  // Privileged inspector feed — comments, selection, ai-activity, git-lifecycle,
  // sync:status, fs:*. ONLY the same-origin inspector clients (the shell) get it.
  function broadcast(payload: unknown, session?: string) {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.data.kind !== 'inspector') continue;
      // D3 — an event ABOUT one member goes only to that member. `session` is
      // set by the emitter (inspect.ts stamps its own key); everything else —
      // fs changes, comments, git lifecycle, sync status — is about the
      // PROJECT and reaches everyone, which is why the audience is opt-in
      // rather than the default.
      if (session && ws.data.session !== session) continue;
      const out = scoped(ws, payload, msg, !!session);
      if (out !== null) send(ws, out);
    }
  }

  // HMR feed — `canvas-hmr` reload signals. Safe to deliver to the segregated
  // canvas origin, so both inspector (shell) AND canvas-hmr (canvas iframe)
  // sockets receive it. T2 (9.1-A).
  function broadcastHmr(payload: unknown) {
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.data.kind !== 'inspector' && ws.data.kind !== 'canvas-hmr') continue;
      const out = scoped(ws, payload, msg);
      if (out !== null) send(ws, out);
    }
  }

  // Wire bus -> WS broadcasts. inspect.ts emits 'selected' / 'active' after every
  // state write; fs-watch.ts emits 'fs:*' on every save.
  ctx.bus.on('selected', (sel, meta) =>
    broadcast({ type: 'selected', selected: sel }, meta?.session)
  );
  ctx.bus.on('active', (file, meta) => broadcast({ type: 'active', file }, meta?.session));
  // V2-2.8 S7 (follow-up) — runtime state (the DDR-115 classifier) never rides
  // these socket pushes: in a cell `_active.<session>.json` and
  // `_canvas-state/<session>/…` named every member's session key — and when
  // they were active — to every other member. The shell acts on none of them
  // (client/hmr.mjs reloads canvases and reacts to a canvas `.meta.json`);
  // server-side bus subscribers still see every event.
  const fsPush = (type: string) => (file: string) => {
    if (typeof file === 'string' && isRuntimeStateRel(file)) return;
    broadcast({ type, file });
  };
  ctx.bus.on('fs:html', fsPush('fs:html'));
  ctx.bus.on('fs:css', fsPush('fs:css'));
  ctx.bus.on('fs:json', fsPush('fs:json'));
  ctx.bus.on('comments', ({ file, comments }: { file: string; comments: unknown[] }) =>
    broadcast({ type: 'comments', file, comments })
  );
  // Phase 8 Task 4 — AI activity banner. `entry` is null on clear / explicit
  // end / heartbeat-grace expiry; non-null carries { file, author, …timestamps }.
  ctx.bus.on('ai-activity', ({ file, entry }: { file: string; entry: unknown }) =>
    broadcast({ type: 'ai-activity', file, entry })
  );
  // Phase 8 Task 7 — git lifecycle. `.git/HEAD` watcher emits this AFTER
  // registry.flushAll() so any in-flight Y.Doc state is already on disk by
  // the time the client renders the reload prompt. Inspector clients +
  // canvas iframes both subscribe.
  ctx.bus.on('git-lifecycle', (payload: unknown) => broadcast({ type: 'git-lifecycle', payload }));

  // Phase 9 Task 8 — hub-down offline mode. The linked-mode sync runtime emits
  // 'sync:status' on every connection-state change (online / connecting /
  // offline / offline-long, queued-op count, conflict notices). Browser tabs
  // render the offline/synced/escalation banner from this. Solo mode never
  // emits, so this is a no-op for unlinked projects.
  ctx.bus.on('sync:status', (payload: unknown) => broadcast({ type: 'sync:status', payload }));

  // Phase 27 Task 5 (E2) — live dirty-state. git/watch.ts recomputes gitStatus on
  // a versionable file change (trailing-debounced) and emits 'git-status'. Only
  // the same-origin inspector clients (the shell) get it — it carries the changed-
  // file list, so it stays off the untrusted canvas-origin feed like the other
  // privileged broadcasts. Drives the Changes-panel count + tree M/A/D badges.
  ctx.bus.on('git-status', (payload: unknown) => broadcast({ type: 'git-status', payload }));

  // Phase 30 — live canvas-list refresh. api.createCanvas / deleteCanvas emit
  // this; inspector clients (the shell) re-read the branch-scoped tree via
  // /_index-data. Loopback-only (same dev-server) — cross-machine peers get a
  // new canvas through git "Get latest", not this event.
  ctx.bus.on('canvas-list-update', (payload: unknown) =>
    broadcast({ type: 'canvas-list-update', payload })
  );
  // S1.7b — the shared Trash changed (here, or on another Mac: sync/trash-watch.ts). `{ seq }`
  // only, never an item — the view re-reads `GET /_api/trash`, which is L18-filtered per session.
  // S9.11's frame classes: project-level, but it names nothing, so canvas-only sockets may get it.
  // S9.21b (V2-1.7 §5.6) — the hub's access notices, deduped and rebuilt key by key in
  // sync/access-notices.ts. Inspector (shell) sockets only — never the canvas iframe's socket.
  // `access` carries no canvas and no text (a canvas-only session hears its own ending);
  // `access-request` names a person and a canvas, for the owner's toast: project class.
  // Desktop-shaped shells only (session ''): in a cell one studio serves several members over a
  // link that is the cell's own, so a notice it heard is about nobody here (a cell's members hear
  // the hub through their own sessions).
  const toDesktopShell = (payload: Record<string, unknown>) => {
    const msg = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.data.kind !== 'inspector' || ws.data.session !== '') continue;
      const out = scoped(ws, payload, msg);
      if (out !== null) send(ws, out);
    }
  };
  ctx.bus.on('access:notice', (frame: { type?: unknown } & Record<string, unknown>) => {
    if (frame?.type === 'maude.access')
      toDesktopShell({
        type: 'access',
        change: frame.change,
        ...(frame.reason ? { reason: frame.reason } : {}),
        // P8 G1a — a narrowing's who + role now (already cleaned by sync/access-notices.ts)
        ...(frame.by ? { by: frame.by } : {}),
        ...(frame.role ? { role: frame.role } : {}),
      });
    else if (frame?.type === 'maude.access-request')
      toDesktopShell({
        type: 'access-request',
        id: frame.id,
        from: frame.from,
        ...(frame.canvas ? { canvas: frame.canvas } : {}),
        at: frame.at,
      });
  });
  // p8-e2e-rolefix (2) — hubs.json changed (a re-exchange, a raise or a drop): desktop shells re-read
  // /_config so Viewing / editing follows the new claim. No claim data rides along.
  ctx.bus.on('access:changed', () => toDesktopShell({ type: 'access-changed' }));
  ctx.bus.on('trash:changed', (p: { seq?: unknown }) =>
    broadcast({ type: 'trash:changed', payload: { seq: typeof p?.seq === 'number' ? p.seq : 0 } })
  );

  // Config hot-reload (server.ts fs:json subscriber) — the shell refetches
  // /_config so cfg-derived state (designSystems, tokensCssRel, canvasGroups)
  // matches the reloaded server config. Inspector clients only.
  ctx.bus.on('config-updated', () => broadcast({ type: 'config-updated' }));
  // V2-2.17 — the project index changed: `seq` + the canvases it touched (contract V2-1.17 §5.3).
  ctx.bus.on('index-changed', (e: { seq: number; rels: string[] }) =>
    broadcast({ type: 'index-changed', seq: e.seq, rels: e.rels })
  );
  // V2-2.17 — a picture landed (contract V2-1.17 §5.3): `{type:'thumb-ready', key}` only, never bytes.
  ctx.bus.on('thumb-ready', (e: { key: string }) => broadcast({ type: 'thumb-ready', key: e.key }));
  // S5.3 — the AI run registry changed (V2-1.15 §5.4): `{type:'ai:runs', seq}` only — the shell
  // re-reads `GET /_api/ai/runs`. Shell (inspector) sockets only, never the canvas origin.
  ctx.bus.on('ai:runs', (e: { seq: number }) => broadcast({ type: 'ai:runs', seq: e.seq }));
  // S5.5 — an accepted action (V2-1.5 §5.3 `project:action`): the shell's ⌘Z projection and
  // Made by AI read it. Shell (inspector) sockets only, never the canvas origin.
  ctx.bus.on('project:action', (action: unknown) => broadcast({ type: 'project:action', action }));

  // Phase 31 (DDR-123) — `/design:chat` → `maude design chat-open` → POST
  // /_api/acp/focus emits this; the shell (app.jsx, native-only) opens the
  // Assistant panel. Inspector clients only — same-origin shell, like the rest.
  ctx.bus.on('acp-focus', () => broadcast({ type: 'acp-focus' }));

  // V2-2.4b (contract V2-1.11 §5.3) — `maude design open` → POST /_api/ui/open (routes/agent.ts)
  // emits this; the shell (client/ui-open.js) opens the canvas and runs the registry actions.
  // Only a desktop-shaped shell (session '') is a target: in a cell every socket belongs to one
  // member and a local CLI call names none of them, so `open` answers "no window" there.
  const isOpenTarget = (ws: ServerWebSocket<WsData>) =>
    ws.data.kind === 'inspector' && ws.data.session === '';
  ctx.bus.on('ui-open', (open: unknown) => {
    const msg = JSON.stringify({ type: 'ui-open', open });
    for (const ws of clients) {
      if (!isOpenTarget(ws)) continue;
      const out = scoped(ws, { type: 'ui-open', open }, msg);
      if (out !== null) send(ws, out);
    }
  });

  // feature-background-export-notification-center — export job queue state
  // changes (queued → running → progress ticks → done/failed). Full-snapshot
  // payload per change, mirroring git-status/sync:status above. Inspector
  // clients only — same privileged-data class as the rest of this feed.
  // V2-2.8 S5 — scoped to the job's owner (exporters/jobs.ts stamps
  // `meta.session`); a desktop job carries none and reaches every socket.
  ctx.bus.on('export:job', (job: unknown, meta) =>
    broadcast({ type: 'export:job', payload: job }, meta?.session)
  );

  // feature-ai-media-generation (DDR-16x) — generation job queue state changes
  // (queued → running → done/failed). Same privileged-data class + snapshot
  // shape as export:job; the notification center reuses the export-center chrome.
  ctx.bus.on('generate:job', (job: unknown) => broadcast({ type: 'generate:job', payload: job }));

  // HMR broadcaster — turns fs:any change events into `canvas-hmr` messages.
  // The iframe-side client (in _shell.html) decides reload strategy from `mode`.
  // Uses broadcastHmr so the segregated canvas origin's HMR-only sockets get it.
  createHmrBroadcaster(ctx, (msg) => broadcastHmr(msg));

  // In a cell the container's recursive fs.watch misses our atomic tmp+rename
  // writes, so the broadcaster above never sees an edit and a peer's canvas
  // iframe stays stale until a manual reload (inspector-edits-live-render RCA).
  // Synthesise the fs:any the watcher owes us from each write's activity:suppress
  // arm. Workspace-mode only — locally fs.watch fires and this would double-load.
  if (isWorkspaceMode()) {
    createContainerWriteBridge(ctx);
    // Sync v2 Increment 2/3 (DDR-226 §4) — the OTHER half of the same gap, and
    // now both ways across it. The bridge above covers writes THIS process
    // makes; a desktop asset PUT or a bucket→checkout refill happens in the HUB
    // process, and nothing crossed that boundary.
    //
    //   hub → child   the hub pokes over the reserved `maude.files` channel and
    //                 this turns the poke into the `fs:any` the watcher owed us
    //   child → hub   the same `fs:any` (from the bridge above) is named to the
    //                 hub, which journals it at once instead of finding it on
    //                 the 15-minute walk-import belt
    //
    // Without the second direction the two sync directions have wildly
    // different latency — seconds one way, up to a quarter of an hour the other
    // — which is indistinguishable from "cloud → desktop is broken".
    //
    // Deliberately NOT gated on cell pairing — that is a one-tenant pilot and
    // the gap is fleet-wide. See sync/ctl-provider.ts.
    startCellFileEvents(ctx);
  }

  // Phase 13 / DDR-029 — canvas activity overlay. activity.ts emits
  // `activity:change` per file as edits land + go idle. The overlay renders
  // INSIDE the canvas iframe, which (with the default origin split, DDR-054)
  // holds a `canvas-hmr` socket — so this MUST use broadcastHmr, not broadcast,
  // to reach it. The payload is just a canvas path + status (no secrets); it's
  // the same exposure class the iframe already gets from `canvas-hmr` file paths.
  ctx.bus.on('activity:change', (payload) => broadcastHmr({ type: 'activity', ...payload }));

  // Bind a connection to its room. Stored per-socket so close() can find the
  // right room to disconnect from. Multiplexed via ws.data.id.
  const collabConns = new Map<string, { roomSlug: string; conn: RoomConn }>();

  // S9.21b (decision v2-lead-trashed-while-open-stops-writes) — a canvas moved to the trash while a tab
  // has it open takes no writes: routes/trash.ts's write stop names the stopped canvases after every
  // read of the Trash, and every collab socket on one of them turns read-only with no writable lane
  // (comments included) until it is restored. Presence still flows.
  let trashStopped: ReadonlySet<string> = new Set();
  ctx.bus.on('trash:write-stop', (p: { stems?: unknown }) => {
    const stems = Array.isArray(p?.stems) ? p.stems : [];
    trashStopped = new Set(
      stems
        .filter((s): s is string => typeof s === 'string' && s !== '')
        .map((s) => canvasSlugFromRel(`${s}.tsx`, ctx.paths.designRel))
    );
  });

  function bindCollab(
    ws: ServerWebSocket<WsData>,
    slug: string,
    realm: 'main' | 'canvas',
    readOnly: boolean
  ): RoomConn {
    const access = ws.data.kind === 'collab' ? ws.data.access : undefined;
    const follow = ws.data.kind === 'collab' && ws.data.follow === true;
    // gate-b-c4i — a socket whose access cannot COMMENT on this canvas writes no lane: Can view
    // (`observer`, access/roles.ts) holds read, session and request only, and a read-only conn
    // alone keeps the comments lane writable (collab/room.ts — the Can comment path). Both
    // listeners stamp `access`; a hand-built test socket without one keeps the old rule.
    const mayComment =
      access === undefined ||
      access.can('comment', canvasOfSlug(access, slug, ctx.paths.designRel));
    const lanesClosed = ws.data.kind === 'collab' && (ws.data.lanesClosed === true || !mayComment);
    const conn: RoomConn = {
      id: ws.data.id,
      realm,
      // S9.15c — a lanes-closed conn is read-only too (presence strip, gated path).
      // S9.21b — read per frame, so a canvas trashed under an open socket stops at once.
      get readOnly() {
        return readOnly || lanesClosed || trashStopped.has(slug);
      },
      get lanesClosed() {
        return lanesClosed || trashStopped.has(slug);
      },
      ...(follow ? { follow: true } : {}),
      // S9.11 (V2-1.7 §5.5) — `summon` only from a socket whose access holds it on this canvas
      ...(access
        ? { summon: access.can('summon', scope?.canvasOfSlug(access, slug) ?? null) }
        : {}),
      // P8 G2 (b) — the role word peers see ("· Can edit"), stamped by the room (collab/room.ts)
      ...roleOfConn(access, access ? canvasOfSlug(access, slug, ctx.paths.designRel) : null),
      send(payload: Uint8Array) {
        try {
          // Bun's ws.send accepts Uint8Array directly as binary.
          ws.send(payload);
        } catch {
          /* close handler will clean up */
        }
      },
    };
    collabConns.set(ws.data.id, { roomSlug: slug, conn });
    return conn;
  }

  const handler: WebSocketHandler<WsData> = {
    async open(ws) {
      if (ws.data.kind !== 'acp') stamped.add(ws);
      if (ws.data.kind === 'collab') {
        const room = collab.registry.get(ws.data.slug);
        const conn = bindCollab(
          ws,
          ws.data.slug,
          ws.data.realm ?? 'main',
          ws.data.readOnly === true
        );
        await room.connect(conn);
        return;
      }
      if (ws.data.kind === 'canvas-hmr') {
        // HMR-only: join the broadcast set but get NO inspector snapshot.
        clients.add(ws);
        return;
      }
      if (ws.data.kind === 'acp') {
        acp.onOpen(ws);
        return;
      }
      clients.add(ws);
      // Snapshot carries the inspector state AND the activity map so a client
      // opening mid-edit seeds its overlay state (Phase 13). Inspector-origin
      // sockets only — `canvas-hmr` sockets get no snapshot by design and rely
      // on live `activity` broadcasts.
      const snapshot = {
        type: 'snapshot',
        state: inspects.for(ws.data.kind === 'inspector' ? ws.data.session : '').state,
        activity: activity.state,
      };
      const out = scoped(ws, snapshot, JSON.stringify(snapshot));
      if (out !== null) send(ws, out);
    },
    async close(ws) {
      stamped.delete(ws);
      if (ws.data.kind === 'acp') {
        acp.onClose(ws);
        return;
      }
      if (ws.data.kind === 'collab') {
        const binding = collabConns.get(ws.data.id);
        if (binding) {
          collabConns.delete(ws.data.id);
          const room = collab.registry.get(binding.roomSlug);
          room.disconnect(binding.conn);
          if (room.size() === 0) {
            // Drop the room when the last peer leaves so memory doesn't grow
            // unbounded across canvases over a long session.
            await collab.registry.drop(binding.roomSlug);
          }
        }
        return;
      }
      clients.delete(ws);
    },
    async message(ws, raw) {
      // HMR-only canvas-origin socket: never accepts inbound messages (the
      // canvas iframe only listens for canvas-hmr; it never sends).
      if (ws.data.kind === 'canvas-hmr') return;
      if (ws.data.kind === 'acp') {
        acp.onMessage(ws, raw);
        return;
      }
      if (ws.data.kind === 'collab') {
        const binding = collabConns.get(ws.data.id);
        if (!binding) return;
        // y-websocket frames are always binary. Coerce whatever Bun handed us.
        const bytes =
          typeof raw === 'string'
            ? new TextEncoder().encode(raw)
            : raw instanceof Uint8Array
              ? raw
              : new Uint8Array(raw as ArrayBufferLike);
        const room = collab.registry.get(binding.roomSlug);
        room.receive(binding.conn, bytes);
        return;
      }

      // Inspector channel — legacy JSON message protocol.
      // biome-ignore lint/suspicious/noExplicitAny: JSON.parse result; narrowed by runtime discriminator checks below.
      let msg: any;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        // Cloud Phase 27 — THE ROLE REACHES THE SOCKET TOO.
        //
        // The HTTP gate (http.ts `readOnlyRefusal`) does not see WebSocket
        // frames, and comment creation is WS-driven — so without this a
        // read-only session reached `comments-delete` and `comments-patch` over
        // a socket while every equivalent HTTP write was refused. Found by
        // reading what this channel actually accepts, after a live cell showed
        // the HTTP `/_comments` route is GET-only.
        //
        // `comments-add` is deliberately NOT here: comment is the one write a
        // viewer holds (role matrix, `viewer.comment === true`). Patch and
        // delete are not — they change or remove somebody else's note.
        //
        // S9.15c — a paused project (`lanesClosed`) holds no comment write at all,
        // `comments-add` included (its HTTP comment writes answer 402 plan at the proxy).
        const COMMENT_FRAMES = new Set(['comments-add', 'comments-patch', 'comments-delete']);
        const lanesClosedSocket = ws.data.kind === 'inspector' && ws.data.lanesClosed === true;
        if (lanesClosedSocket && COMMENT_FRAMES.has(msg.type)) {
          send(ws, {
            type: 'refused',
            reason: 'plan',
            message: 'Editing is paused for this project — that change was not applied.',
          });
          return;
        }
        const readOnlySocket = ws.data.kind === 'inspector' && ws.data.readOnly === true;
        const MUTATES_OTHERS = new Set(['comments-patch', 'comments-delete']);
        if (readOnlySocket && MUTATES_OTHERS.has(msg.type)) {
          send(ws, {
            type: 'refused',
            reason: 'read-only',
            message: 'Your role in this project is viewer — that change was not applied.',
          });
          return;
        }
        // S9.11 (L10/L12) — a canvas-only socket names only canvases it sees: asking for (or
        // commenting on) another canvas is answered as if it did not exist — nothing at all.
        // gate-b-c4k — judged on the file each frame ACTS on: `comments-request` reads `msg.file`,
        // `comments-add` writes `msg.payload.file` (the handler and the comment check below), so a
        // top-level `file` naming a visible canvas cannot vouch for the payload's.
        if (
          scope &&
          (msg.type === 'comments-request' || msg.type === 'comments-add') &&
          !scope.visibleTo(ws, {
            file: msg.type === 'comments-add' ? msg.payload?.file : msg.file,
          })
        )
          return;
        // gate-b-c4i — `comments-add` needs the `comment` capability on the canvas it names: a
        // Can view socket (`observer`) is read-only AND may not comment (access/roles.ts). After
        // the scope check, so a canvas the socket does not see stays answered with nothing.
        if (ws.data.kind === 'inspector' && ws.data.access && msg.type === 'comments-add') {
          const file = typeof msg.payload?.file === 'string' ? msg.payload.file : '';
          const canvas = toDesignRel(file, ctx.paths.designRel);
          if (!ws.data.access.can('comment', canvas)) {
            send(ws, {
              type: 'refused',
              reason: 'read-only',
              message: 'Your access here is view-only — that comment was not added.',
            });
            return;
          }
        }
        const inspect = inspects.for(ws.data.kind === 'inspector' ? ws.data.session : '');
        if (msg.type === 'active' && typeof msg.file === 'string') inspect.setActive(msg.file);
        else if (msg.type === 'tabs' && Array.isArray(msg.tabs)) inspect.setOpenTabs(msg.tabs);
        else if (msg.type === 'select' && msg.selection) inspect.setSelected(msg.selection);
        else if (msg.type === 'clear-select') inspect.setSelected(null);
        // A person is at the studio (pointer/keyboard, throttled client-side).
        // Feeds the desktop park (`sync/park.ts`): presence keeps the cloud
        // link up and wakes a parked one. Carries nothing; acts on nothing.
        else if (msg.type === 'presence') ctx.bus.emit('ui:active');
        // S6.12 (C5) — "this canvas drew without an error": the source it hashes is read from disk here, so
        // a frame can only name a canvas, never a hash. Not for a read-only or paused session (it writes
        // `_state/render-ok.json`), nor for a canvas the socket does not see.
        else if (msg.type === 'render-ok' && typeof msg.file === 'string') {
          if (
            !readOnlySocket &&
            !lanesClosedSocket &&
            (!scope || scope.visibleTo(ws, { file: msg.file }))
          )
            noteRenderOk(msg.file);
        } else if (msg.type === 'comments-add' && msg.payload) {
          // In a cell the author is the vouched member, never a claim in the
          // frame and never the cell's own git identity (the machine).
          const vouched = ws.data.kind === 'inspector' ? ws.data.user : '';
          await api.commentsAdd(vouched ? { ...msg.payload, author: vouched } : msg.payload);
        } else if (msg.type === 'comments-patch' && msg.id)
          await api.commentsPatch(msg.id, msg.patch || {});
        else if (msg.type === 'comments-delete' && msg.id) await api.commentsDelete(msg.id);
        else if (msg.type === 'comments-request' && typeof msg.file === 'string') {
          const comments = await api.loadCommentsForFile(msg.file);
          send(ws, { type: 'comments', file: msg.file, comments });
        }
      } catch (err) {
        console.error('[ws] message handler threw:', err);
      }
    },
  };

  return {
    handler,
    broadcast,
    clientCount: () => clients.size,
    shellCount: () => [...clients].filter(isOpenTarget).length,
    closeWiderThan(current: Access): number {
      let n = 0;
      for (const ws of [...stamped]) {
        const was = ws.data.kind === 'acp' ? undefined : ws.data.access;
        if (!was || !accessWiderThan(was, current)) continue;
        stamped.delete(ws);
        try {
          ws.close(ACCESS_CHANGED_CLOSE.code, ACCESS_CHANGED_CLOSE.reason);
        } catch {
          /* already closing */
        }
        n += 1;
      }
      return n;
    },
  };
}

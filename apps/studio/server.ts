#!/usr/bin/env bun
// Dev-server entry. Bun.serve + native WebSocket + per-platform standalone
// binary distribution (DDR-009, DDR-013, DDR-015).
//
// Process layout:
//   createContext()  -> repo root, config, paths, pub/sub bus
//   createApi(ctx)   -> comments / canvas-state / index / system data
//   createInspect()  -> active-canvas tracking + HTML injection
//   createWs()       -> Bun.serve native WS handler
//   createHttp()     -> route table + fall-through fetch
//   createFsWatch()  -> recursive fs.watch -> bus -> WS broadcast
//
// Single Bun.serve instance owns both HTTP routes and the WS upgrade. Nothing
// else binds to a port. The orchestrator (slash commands) reads _server.json
// to detect a live instance and avoid duplicate boots.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canvasOfSlug, createWsVisibility, seesSlug } from './access/filters.ts';
import {
  accessForDesktop,
  acpRefusal,
  lanesClosedFromProxy,
  notInScopeResponse,
  runWithAccess,
  setAccessFallback,
} from './access/request.ts';
import type { AskQueue } from './acp/ask-queue.ts';
import { type Acp, createAcp } from './acp/index.ts';
import { cancelInstall, cancelSignin } from './acp/login-state.ts';
import { registerLiveRuns } from './acp/running.ts';
import { createActivity } from './activity.ts';
import { artboardSpans } from './agent-runs.ts';
import { createLocalLeaseHome, selectLeaseHome } from './ai/lease-home.ts';
import { createRunProgress } from './ai/run-progress.ts';
import { createRunRegistry } from './ai/runs.ts';
import { migrateAnnotationsV2 } from './annotations/migrate-boot.ts';
import { runContext, runTagOf, stageRunAnnotations } from './annotations/run-tag.ts';
import { ASSET_MAX_VIDEO_BYTES, createApi } from './api.ts';
import { bootSelfHeal } from './boot-self-heal.ts';
import { isSandboxArmed } from './canvas-build-sandbox.ts';
import { createCanvasListWatch } from './canvas-list-watch.ts';
import { canvasTopLevelRefusal, topLevelGuardedRoutes } from './canvas-top-level.ts';
import { type AiActivityEntry, createAiActivity } from './collab/ai-activity.ts';
import { createGitLifecycle } from './collab/git-lifecycle.ts';
import { createCollab } from './collab/index.ts';
import { createContext, reloadConfig } from './context.ts';
import { installLogRing } from './debug-bundle.ts';
import { initDiagnostics, registerStatus, stopDiagnostics } from './diagnostics/store.ts';
import { parseEmbedOrigins } from './embed-origins.ts';
import { createExportJobQueue } from './exporters/jobs.ts';
import { formatGate, STAGED_FORMAT_GATE_OPTS } from './format.ts';
import { createFsWatch } from './fs-watch.ts';
import { createGenerationJobQueue } from './generation/jobs.ts';
import { createGitWatch } from './git/watch.ts';
import { createHttp } from './http.ts';
import { flushAllIndexes } from './index/service.ts';
import { createInspectRegistry } from './inspect.ts';
import { listenLoopback, V4_LOOPBACK } from './loopback-listen.ts';
import { startHeapWatch } from './mem.ts';
import { canvasOriginRoutes } from './routes/canvas-origin.ts';
import { runStageHooks } from './routes/index.ts';
import { normalizeSessionKey, runInSession, SESSION_HEADER } from './session-scope.ts';
import { writeShellInfoFile } from './shell/info-file.ts';
import { createActionFeed } from './sync/action-feed.ts';
import { sharedDocEnabled } from './sync/cell-pairing.ts';
import { accessFor, getHubRecord, watchHubsConfig } from './sync/hubs-config.ts';
import { hubHealth } from './sync/journal-client.ts';
import { attachLocalHome } from './sync/local-kernel.ts';
import { createSyncSupervisor } from './sync/supervisor.ts';
import { stopAllThumbs } from './thumbs/service.ts';
import {
  assertContainment,
  isForbiddenRoute,
  isWorkspaceMode,
  pruneForWorkspace,
} from './workspace-mode.ts';
import { createWs, isLoopbackHost, isSameOriginWs, parseCollabSlug, type WsData } from './ws.ts';

// feature-bug-report-button — mirror console output into the in-memory log
// ring BEFORE anything else logs, so a bug report's serverLogTail covers the
// boot sequence too (where "wrong project root" class failures announce
// themselves). Stdout/stderr behavior is unchanged.
installLogRing();

// Phase 19 / DDR-044 — covers the marketplace-cache-install gap where
// node_modules/ ships empty (git clone honors .gitignore). Auto-installs +
// builds on first boot; opt out with MAUDE_NO_AUTOBUILD=1.
await bootSelfHeal();

// V2-3.3 (contract V2-1.1 §5.3) — `--home` is the project-less Home server: its own module and
// route table, no createContext(). Only the explicit flag gets here; project mode below still
// fails loud without `.design/`. A top-level await keeps everything after it from running.
if (process.argv.includes('--home')) {
  (await import('./home/main.ts')).runHome();
  await new Promise<never>(() => {});
}

const ctx = createContext();

// V2-2.9 (T23) — persist the per-source diagnostics (server · sync · ai · export) under
// ~/.maude/logs (or $MAUDE_LOG_DIR), scrubbed, 7 days. Local only: nothing is sent anywhere.
await initDiagnostics({ repoRoot: ctx.paths.repoRoot });

// DDR-064 cutover (Sync v2 Increment 7) — `MAUDE_SHARED_DOC` now defaults ON:
// the collab room's Y.Doc is THE doc per canvas, everywhere. The two-doc +
// disk-reconcile path still exists in full and `MAUDE_SHARED_DOC=0` flips a
// machine back onto it — that config flip is this release's rollback, which is
// why NOTHING is deleted here (the relay's deletion is the next increment,
// one soak later). The flag is threaded onto ctx here (before createCollab /
// createSyncRuntime read it) so every downstream consumer sees one source of
// truth, parsed by the same function the cell-pairing interlock uses.
ctx.sharedDoc = sharedDocEnabled(process.env);

// Forward-declared so the api.commentsAdd/patch/delete/addReply callback can
// reach into the collab registry (Phase 8 Task 3 bridge). collab is initialized
// synchronously below; the callback only fires at runtime, by which point the
// binding is set.
let collab: ReturnType<typeof createCollab> | null = null;
// Forward-declared for the same reason — moveCanvas (feature-file-tree-
// drag-drop-folders, Task 3) retargets `_active.json` through the live
// Inspect instance, which is constructed after `api`.
let inspectHandle: ReturnType<typeof createInspectRegistry> | null = null;

const api = createApi(ctx, {
  onCommentsChanged: (file, comments, base) => {
    // Accepted-revisions mode (DDR-241): the change is PROPOSED; the room's
    // document changes when the project publishes it. Fire-and-forget — the
    // proposal is durable in the outbox before this returns, and the sidebar
    // below already shows the author their own comment.
    const runtime = ctx.syncControl?.current?.();
    const proposed = runtime?.proposeLane?.(
      api.fileSlug(file),
      'comments',
      JSON.stringify(comments),
      base ? { baseText: JSON.stringify(base) } : {}
    );
    if (proposed) {
      void proposed.catch(() => {});
      ctx.bus.emit('comments', { file, comments });
      return;
    }
    // Phase 8 Task 3 — bridge into the live Y.Array so collab peers see the
    // change without waiting for cold-open re-seeding. No-op when no room is
    // live for this canvas slug.
    //
    // Issue #111 — this runs BEFORE the mutation reaches disk (see
    // `publishComments`), and `comments` is the post-mutation list handed over
    // in memory. It used to be `await api.loadCommentsForFile(file)`: a disk
    // round-trip sitting between the file write and this publish, wide enough
    // for a `Room.flush()` to project the pre-mutation doc back over the file.
    // Nothing here touches disk any more, and the doc is updated synchronously,
    // so there is no window for a flush to be the stale writer.
    if (collab) {
      collab.registry.syncRoomFromComments(api.fileSlug(file), comments);
    }
    // After every comments mutation, re-broadcast the updated list.
    ctx.bus.emit('comments', { file, comments });
  },
  // Phase 8 Task 5 — same bridge for annotations. PUT /_api/annotations writes
  // the SVG blob to disk; we mirror it into the live Y.Map for collab peers.
  onAnnotationsChanged: (file, svg, writeId, base, recordedWithLanes) => {
    const runtime = ctx.syncControl?.current?.();
    // T-S4.5b — a `run:<id>` batch (gated in http.ts annotationOps) joins its run's stage.
    const runId = runTagOf(writeId);
    if (runId) {
      const staged = stageRunAnnotations(runtime, {
        runId,
        ...runContext(runRegistry, runId),
        slug: api.fileSlug(file),
        canvasRel: file,
        text: svg,
        ...(base !== undefined ? { base } : {}),
        writeId: writeId as string,
      });
      if (staged) {
        void staged.catch(() => {});
        return;
      }
    }
    // A board that rides the same action as another lane (the artboard move rider) is recorded by that
    // proposal; a stroke of its own here would make ⌘Z a two-step gesture.
    const proposed = recordedWithLanes
      ? null
      : runtime?.proposeLane?.(api.fileSlug(file), 'annotations', svg, {
          ...(writeId ? { writeId } : {}),
          ...(base !== undefined ? { baseText: base } : {}),
        });
    if (proposed) {
      void proposed.catch(() => {});
      return;
    }
    if (collab) {
      collab.registry.syncRoomFromAnnotations(api.fileSlug(file), svg, writeId);
    }
  },
  // Code review H1 — the canvas op path goes to a live room's replica, not to a
  // file its debounced flush hasn't caught up with. Accepted mode keeps the
  // disk + proposeLane path: there the hub kernel merges against the base.
  applyAnnotationOpsLive: (file, ops, actionId, guard) => {
    if (ctx.syncControl?.current?.()?.acceptedMode?.()) return null;
    return collab?.registry.applyOpsToRoom(api.fileSlug(file), ops, actionId, guard) ?? null;
  },
  // S4.V4 G4 — the reader's half of the same shortcut (the vote door reads its own write back).
  readAnnotationsLive: (file) => {
    if (ctx.syncControl?.current?.()?.acceptedMode?.()) return null;
    return collab?.registry.readRoomBoard(api.fileSlug(file)) ?? null;
  },
  // feature-file-tree-drag-drop-folders (Task 3) — moveCanvas's collab guard
  // + `_active.json` retarget, bridged the same forward-declared way as the
  // comments/annotations hooks above.
  isRoomPinned: (slug) => collab?.registry.isPinned(slug) ?? false,
  // The move protocol (codec stampMovedTo): the sync runtime stamps the old
  // document retired + detaches, which unpins the room — after which the
  // forceDrop below actually drops it and the rename is safe. Forward-declared
  // like the other hooks; `ctx.syncControl` is set once the supervisor exists.
  retireCanvasForMove: async (fromSlug, toRel) => {
    try {
      const runtime = ctx.syncControl?.current?.();
      return (await runtime?.retireForMove?.(fromSlug, toRel)) ?? false;
    } catch (err) {
      console.warn(`[move] retire failed for ${fromSlug}:`, err);
      return false;
    }
  },
  proposeFolder: (op) => ctx.syncControl?.current?.()?.proposeFolder?.(op) ?? null,
  onMetaChanged: (file, text, baseText) => {
    const proposed = ctx.syncControl
      ?.current?.()
      ?.proposeLane?.(api.fileSlug(file), 'meta', text, baseText ? { baseText } : {});
    if (proposed) void proposed.catch(() => {});
  },
  flushAndDropRoom: async (slug) => {
    if (collab) await collab.registry.forceDrop(slug);
  },
  retargetActive: (fromFile, toFile) => {
    // D3 — a canvas moved on disk moved for EVERY member, so every member's
    // state is retargeted, not just the one whose request did it.
    for (const one of inspectHandle?.all() ?? []) one.retarget(fromFile, toFile);
  },
});

const inspects = createInspectRegistry(ctx, (file) => api.loadCommentsForFile(file));
inspectHandle = inspects;
// The shared instance is the desktop's, and a cell's fallback for anything that
// arrives without a vouched session.
await inspects.for('').load();

// Semantic structural notifications include remote sync operations as well as
// API actions. Keep every session's agent/inspector context on the live path.
ctx.bus.on('canvas-list-update', (change) => {
  if (!change?.rel) return;
  const file = path.posix.join(ctx.paths.designRel, change.rel);
  if (change.action === 'moved' && change.fromRel) {
    const fromFile = path.posix.join(ctx.paths.designRel, change.fromRel);
    for (const inspect of inspects.all()) inspect.retarget(fromFile, file);
  } else if (change.action === 'removed') {
    for (const inspect of inspects.all()) inspect.remove(file);
  }
});

// DDR-242 — convert legacy `<slug>.annotations.svg` boards to
// `.annotations.json` BEFORE any room seeds or sync scan reads them. Skipped in
// a cloud workspace: the hub owns that checkout (its workspace agent migrates).
if (process.env.MAUDE_WORKSPACE_MODE !== '1') {
  migrateAnnotationsV2({ designRoot: ctx.paths.designRoot });
}

collab = createCollab(ctx, api);
const aiActivity = createAiActivity(ctx);

// S5.3 — THE AI run registry (ai/runs.ts, V2-1.15): every AI run on this Mac — a Maude chat, a
// terminal Claude Code, a v1 `/design:edit` — with its per-artboard leases. Records live in
// `_state/runs/` (runtime state); boot() ends what a crash left live as `interrupted`. The lease
// home starts per-Mac and moves to the linked hub once its `/health` says `runs-v1` (below).
// S5.6 — the registry sends a chat run's turn through the ACP manager (built below, after the
// registry boots: boot only ends crashed runs, it never sends a turn).
let acpTurns: Pick<Acp, 'sendTurn' | 'cancelTurn'> | null = null;
const runRegistry = createRunRegistry({
  turns: {
    send: (rec, text) => acpTurns?.sendTurn(rec, text),
    cancel: (rec) => acpTurns?.cancelTurn(rec),
  },
  designRoot: ctx.paths.designRoot,
  designRel: ctx.paths.designRel,
  home: createLocalLeaseHome({ actor: 'you' }),
  // a whole-canvas ask leases each artboard of the canvas
  artboardsOf: (rel) => {
    try {
      const src = readFileSync(path.join(ctx.paths.designRoot, rel), 'utf8');
      return (artboardSpans(src) ?? []).map((s) => s.id);
    } catch {
      return [];
    }
  },
  emit: (e, p) => ctx.bus.emit(e, p),
  // S7.14 — your runs' studio-local progress (the AI cut's shots), derived from their files
  progressOf: createRunProgress({ designRoot: ctx.paths.designRoot }),
  // S5.5b — THE end of every run's stage, by its run id (publish / partial / hold), announced as
  // `project:action`. The ACP tracker leaves a registry run's stage to this hook, so without it no chat
  // turn's edits would ever publish (http.ts wires the same hook only on its test fallback registry).
  stage: runStageHooks({
    control: () => ctx.syncControl?.current?.() ?? null,
    emit: (e, p) => ctx.bus.emit(e, p),
  }),
});
await runRegistry.boot();
// S5.15 — every accepted action reaches the shell as `project:action`, not only a run's publish and the
// undo routes': a person's edit (yours, or a teammate's arriving from the hub) clears "Made by AI".
const actionFeed = createActionFeed({
  control: () => ctx.syncControl?.current?.() ?? null,
  designRel: ctx.paths.designRel,
  emit: (e, p) => ctx.bus.emit(e, p),
  on: (e, fn) => ctx.bus.on(e, fn),
});
ctx.bus.on('fs:any', (rel: unknown) => {
  if (typeof rel === 'string' && /\.tsx$/i.test(rel)) actionFeed.poke();
});
ctx.bus.on('sync:projected', () => actionFeed.poke());
// runningChats() / activitySnapshot() read the registry (unioned with the bridge until S5.6)
registerLiveRuns(() => runRegistry.live());
// the hub's `{t:'runs', seq}` on the control channel (sync/ctl-provider.ts → bus)
ctx.bus.on('hub:runs', (p: { seq?: unknown }) => {
  if (typeof p?.seq === 'number') runRegistry.poke(p.seq);
});

// Phase 30 — bridge agent `ai-activity` onto the per-canvas room awareness so a
// remote peer sees "X is editing" cross-machine. The `ai-activity` bus event is
// loopback-only (inspector WS); awareness is the one channel that crosses the
// hub. Soft heads-up — projected onto the room's own awareness slot, cleared
// when the activity ends/expires. No-op when no room is live for the slug.
ctx.bus.on('ai-activity', (payload: { file: string; entry: AiActivityEntry | null }) => {
  if (!collab) return;
  const slug = api.fileSlug(payload.file);
  collab.registry.setAgentEditing(
    slug,
    payload.entry ? { name: payload.entry.author, since: payload.entry.startedAt } : null
  );
});
// T16 — an AI edit whose heartbeat went silent (the driver crashed) did not
// finish: whatever it wrote stays unpublished for the person's decision. An
// explicit /end already closed its action, so this is a no-op then.
ctx.bus.on('ai-activity', (payload: { file: string; entry: AiActivityEntry | null }) => {
  if (payload.entry) return;
  void ctx.syncControl
    ?.current?.()
    ?.endAiAction?.(`edit:${payload.file}`, 'failed')
    ?.catch(() => {});
});
const gitLifecycle = createGitLifecycle(ctx, collab.registry);
// Phase 13 / DDR-029 — fs-watch-driven canvas activity overlay. Subscribes to
// `fs:any` and emits `activity:change`; ws.ts forwards it to canvas iframes.
const activity = createActivity(ctx);
// Phase 31 (DDR-123) — ACP chat bridge manager. Owns one claude-agent-acp
// subprocess per /_ws/acp socket; main-origin + loopback only (wired below).
// Gets the ai-activity registry so agent edits raise the same "Claude is
// editing" banner + presence as /design:edit (RC5,
// rca/issue-canvas-hmr-optimistic-update-consistency).
// S5.6 — chat turns run on the run registry (V2-1.15 §5.4), and every state-changing frame is
// gated PER FRAME on the live read-only predicate: the role (hubs.json, re-read each call — a
// workspace sign-in or an A6 removal lands on the next frame) + the format gate, the same pair
// http.ts's `projectReadOnly` reads. `/_ws/acp` never runs in a cell, so no per-request role.
const acp = createAcp(ctx, aiActivity, {
  runs: runRegistry,
  queue: () => askQueue,
  // S9.9 (D2) — `acpRefusal`: the chat needs `edit` (C30), from the linked hub's stored
  // access (`accessFor`, re-read per frame), the same answer the HTTP gate gives.
  readOnly: () =>
    acpRefusal(accessForDesktop(ctx.cfg.linkedHub?.url, accessFor)) !== null ||
    formatGate(ctx, STAGED_FORMAT_GATE_OPTS) !== null,
});
acpTurns = acp;
// V2-1.14 — the outbox lives in createHttp (below); the chat reaches its door lazily.
let askQueue: AskQueue | null = null;
// S9.11 (V2-1.16 L12) — a canvas-only socket hears only about canvases it sees. The closure
// is http's (declared below; only read once a canvas-only socket exists).
const ws = createWs(
  ctx,
  api,
  inspects,
  collab,
  activity,
  acp,
  createWsVisibility({
    designRel: ctx.paths.designRel,
    closureOf: (access) => http.closureOf(access),
  })
);
const exportJobs = createExportJobQueue(ctx.bus, ctx.paths.designRoot, { runs: () => runRegistry });
// feature-ai-media-generation (DDR-16x) — background AI-media generation queue.
const generateJobs = createGenerationJobQueue(ctx.bus, ctx.paths.designRoot);
const http = createHttp(ctx, api, inspects, aiActivity, exportJobs, generateJobs, {
  shellCount: () => ws.shellCount(),
  runs: runRegistry,
});
askQueue = http.askQueue;
// S9.9 — `currentAccess()` outside a request (timers, boot): this process's own answer.
setAccessFallback(() => http.accessOf());
// S9.12b (V2-1.16 U6, desktop) — a socket keeps the access stamped at its upgrade; when that is
// wider than the session's access now (hubs.json rewritten by a re-sign-in or a role drop, or the
// project linked / relinked), it is closed and its client reconnects at the new access. A cell's
// sockets are closed by the hub's proxy instead (studio-proxy.mjs `closeUpgrades`).
if (!isWorkspaceMode()) {
  const narrowSockets = () => ws.closeWiderThan(http.accessOf());
  watchHubsConfig(narrowSockets);
  ctx.bus.on('config-updated', narrowSockets);
}
const fsWatch = createFsWatch(ctx);

// Port: --port arg > $PORT > $MDCC_DEV_PORT > 4399.
// When the port wasn't explicitly chosen and the default is busy (another
// project's dev-server is running on the same machine), walk up to 4408 before
// giving up. Explicit ports stay fatal so users notice their own collisions.
function resolvePort(): { port: number; explicit: boolean } {
  const i = process.argv.indexOf('--port');
  if (i !== -1 && process.argv[i + 1]) return { port: Number(process.argv[i + 1]), explicit: true };
  const env = process.env.PORT ?? process.env.MDCC_DEV_PORT;
  if (env) return { port: Number(env), explicit: true };
  return { port: 4399, explicit: false };
}

const { port: BASE_PORT, explicit: PORT_EXPLICIT } = resolvePort();

type BunServer = ReturnType<typeof Bun.serve<WsData, never>>;

// Phase 23 security review (DDR-088) + DDR-148 — hard ceiling on a request
// body. Bun's 128 MB default would let the untrusted canvas origin send huge
// bodies to any route. DDR-088 pinned this at 16 MB. DDR-148 raises it to the
// video cap + 8 MB headroom so `POST /_api/asset` can accept a 100 MB clip —
// but that route now STREAMS the body to disk (saveAssetFromStream), so a big
// upload never lands as one ArrayBuffer in RAM. Other routes keep their small
// LOGICAL caps (annotation 1 MB, JSON) — a body over those still rejects; the
// only change is Bun accepts more bytes pre-handler (a bandwidth-bounded
// transient-buffer tradeoff on the buffering routes, noted in DDR-148).
const MAX_REQUEST_BODY = ASSET_MAX_VIDEO_BYTES + 8 * 1024 * 1024;

// Containment invariant (DDR-193 §2) — the boot-assert. No-op outside workspace
// mode; in a cell it refuses to start when a rendering / evaluating / exporting
// surface is reachable, naming exactly which one. See workspace-mode.ts for why
// this is a process that will not start rather than a convention.
//
// Checked against the ACTUAL route table (`http.routes` keys plus the paths the
// `fetch` fall-through owns), not a hand-maintained list, so a future route can
// only escape it by being invisible to both.
//
// Split by verdict (DDR-209 A′1), because the two halves are asserted
// differently. `/_ws/acp` is FORBIDDEN and the fall-through 404s it in a cell,
// so it is only asserted outside workspace mode (where it is genuinely
// reachable). The canvas surfaces are SANDBOXED — a cell serves them — so they
// are asserted ALWAYS, which is what makes the sandbox attestation load-bearing
// rather than decorative.
const FETCH_ROUTES_FORBIDDEN_IN_WORKSPACE = ['/_ws/acp'];
const FETCH_ROUTES_SANDBOXED = ['/_canvas-shell.html', '/_canvas-runtime/'];
const WORKSPACE = isWorkspaceMode();
// DDR-209 A′1 — the contract that lets a cell serve `/_canvas-shell` +
// `/_canvas-runtime` at all: the canvas build runs out of process, with an empty
// environment, an import allowlist and ceilings. Computed here rather than
// inside workspace-mode.ts, which has no business importing the build host —
// and passed in, so an unstated contract reads as an unmet one.
const SANDBOX_ARMED = isSandboxArmed();
// PRUNE first, then assert over what survived — so the assert is a
// post-condition on the pruning rather than a second, driftable opinion. A
// prefix added to the vocabulary then both prunes and is verified, together.
const pruned = WORKSPACE ? pruneForWorkspace(http.routes) : { routes: http.routes, removed: [] };
/**
 * Establish WHOSE request this is, once, at the only place every request passes
 * through — Cloud Phase 27 D3.
 *
 * Bun matches `routes` BEFORE `fetch`, so a wrapper on the fall-through alone
 * would miss the entire route table (the same asymmetry that made a
 * canvas-origin route 404 in Phase 23). Wrapping here covers both halves, and
 * the leaves — `canvasViewPath`, `canvasStatePath` — read the ambient key
 * instead of every function between here and there growing a parameter.
 *
 * Outside workspace mode this resolves to `''` on every request, which
 * `runInSession` treats as "no scope at all" and skips.
 */
function withSession<T extends unknown[]>(
  handler: (req: Request, ...rest: T) => Response | Promise<Response>
): (req: Request, ...rest: T) => Response | Promise<Response> {
  // S9.9 — and WHAT it may do: the request's Access (V2-1.7 §5.4) in AsyncLocalStorage,
  // so a leaf asks `currentAccess()` instead of re-deriving a role.
  return (req, ...rest) =>
    runWithAccess(http.accessOf(req), () =>
      runInSession(WORKSPACE ? normalizeSessionKey(req.headers.get(SESSION_HEADER)) : '', () =>
        handler(req, ...rest)
      )
    );
}

/** Bun route entries are either a handler or a `{ GET, POST, … }` map. */
function scopeRoutes<R extends Record<string, unknown>>(routes: R): R {
  const out: Record<string, unknown> = {};
  for (const [path, entry] of Object.entries(routes)) {
    if (typeof entry === 'function') {
      out[path] = withSession(entry as (req: Request) => Response | Promise<Response>);
    } else if (entry && typeof entry === 'object') {
      const byMethod: Record<string, unknown> = {};
      for (const [method, fn] of Object.entries(entry as Record<string, unknown>)) {
        byMethod[method] =
          typeof fn === 'function'
            ? withSession(fn as (req: Request) => Response | Promise<Response>)
            : fn;
      }
      out[path] = byMethod;
    } else {
      out[path] = entry;
    }
  }
  return out as R;
}

const SERVER_ROUTES = scopeRoutes(pruned.routes) as typeof http.routes;
if (WORKSPACE && pruned.removed.length > 0) {
  console.log(
    `[studio] workspace mode — withheld ${pruned.removed.length} route(s) that would evaluate ` +
      `tenant content: ${pruned.removed.join(', ')}`
  );
}
try {
  assertContainment(
    [
      ...Object.keys(SERVER_ROUTES),
      ...FETCH_ROUTES_SANDBOXED,
      ...(WORKSPACE ? [] : FETCH_ROUTES_FORBIDDEN_IN_WORKSPACE),
    ],
    {
      sandboxArmed: SANDBOX_ARMED,
      // Presence of the dependency is the signal: a cell image that ships
      // Playwright is one import() away from rendering tenant content. Skippable
      // in a dev checkout, where Playwright is a legitimate devDependency of the
      // E2E harness and would otherwise make workspace mode untestable locally.
      // A BUILT cell image has no such escape — scripts/check-containment.sh
      // enforces the runtime-dependency half at build time.
      resolveModule:
        process.env.MAUDE_WORKSPACE_ALLOW_DEV_MODULES === '1'
          ? undefined
          : (specifier) => {
              try {
                return !!import.meta.resolveSync?.(specifier);
              } catch {
                return false;
              }
            },
    }
  );
} catch (err) {
  console.error(`\n${(err as Error).message}\n`);
  process.exit(1);
}
if (isWorkspaceMode()) {
  console.log('[studio] workspace mode — sync + git + assets only (DDR-193 containment invariant)');
}

// V2-3.6 NEW-1 — `hostname` is 127.0.0.1 or ::1: every localhost listener is
// bound on BOTH families through listenLoopback (loopback-listen.ts).
function startServer(port: number, hostname = V4_LOOPBACK): BunServer {
  return Bun.serve<WsData, never>({
    port,
    hostname,
    development: process.env.NODE_ENV !== 'production',
    maxRequestBodySize: MAX_REQUEST_BODY,
    routes: SERVER_ROUTES,
    async fetch(req, srv) {
      const pathname = new URL(req.url).pathname;

      // Containment (DDR-193 §2) — the `fetch` fall-through owns paths that are
      // not in the route table (`/_ws/acp`), so pruning the table alone would
      // leave them reachable. 404, not 403: a cell should look like it never had
      // the feature, rather than like it is refusing one.
      //
      // `/_canvas-shell.html` and `/_canvas-runtime/*` used to be caught here
      // too. DDR-209 A′1 reclassified them: a cell SERVES them (the browser is
      // what evaluates), attested by the build sandbox at boot. They are not in
      // `isForbiddenRoute` any more, so they fall through to `http.fetch` — on
      // purpose, and the boot-assert is what keeps that honest.
      if (WORKSPACE && isForbiddenRoute(pathname)) {
        return new Response('not found', { status: 404 });
      }

      // Phase 8 — collab WS, binary y-websocket protocol. Loopback-only;
      // DDR-047 makes cross-machine collab a Phase 9 hub-deploy story, not
      // a `--bind 0.0.0.0` flag on this server.
      //
      // IN A CELL the loopback gate can never pass — the hub's authenticating
      // proxy rewrites Host to the public URL (D4) on purpose — and it must not
      // have to: the proxy already terminated the session and vouches the role
      // per request with injected `x-maude-*` headers (stripped-then-injected,
      // the Cloud Phase 27 model the inspector branch below already trusts).
      // Without this vouched path every cloud collab upgrade 403'd here and
      // cursors/annotations/live-sync were dead in the browser door — RCA
      // issue-cloud-live-collaboration-dead. Outside workspace mode the DDR-047
      // gate is verbatim unchanged.
      const collabSlug = parseCollabSlug(pathname);
      if (collabSlug !== null) {
        const vouchedRole = WORKSPACE ? req.headers.get('x-maude-role') : null;
        if (!isLoopbackHost(req.headers.get('host')) && !vouchedRole) {
          return new Response('cross-machine collab requires Phase 9 hub deploy', {
            status: 403,
          });
        }
        // CSWSH (Phase 2 gate): a WS handshake bypasses SOP and every page in the
        // browser sends a loopback Host to ws://localhost, so on a desktop a drive-by
        // site could open this realm-'main' (ungated) socket. Same check as /_ws/acp.
        // Not in a cell: the proxy authenticates and rewrites Host (D4).
        if (!WORKSPACE && !isSameOriginWs(req)) {
          return new Response('collab is same-origin only', { status: 403 });
        }
        // S9.11 (V2-1.16 L11) — a canvas-only session joins only its canvases' rooms.
        const access = http.accessOf(req);
        if (!seesSlug(access, collabSlug, ctx.paths.designRel)) return notInScopeResponse();
        const ok = srv.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            remote: req.headers.get('x-forwarded-for') ?? '127.0.0.1',
            kind: 'collab',
            slug: collabSlug,
            access,
            // Privileged shell origin — ungated (see collab/origins.ts) —
            // UNLESS the proxy marked this socket as canvas-realm (a cell's
            // canvas lane forwards here when the canvas listener is the same
            // process; defense in depth either way).
            realm:
              WORKSPACE && req.headers.get('x-maude-collab-realm') === 'canvas' ? 'canvas' : 'main',
            // Same fail-closed posture as the inspector branch: in a cell an
            // absent header is an unproven session. S9.11 — from the access, so a
            // hub-linked desktop viewer is read-only too (and a grant edits its canvas).
            readOnly: !access.can('edit', canvasOfSlug(access, collabSlug, ctx.paths.designRel)),
            // S9.15c — a paused project (`x-maude-readonly: plan`): no lane writable, comments too.
            ...(WORKSPACE && lanesClosedFromProxy(req.headers) ? { lanesClosed: true } : {}),
          },
        });
        if (ok) return undefined as unknown as Response;
        return new Response('Upgrade failed', { status: 400 });
      }

      // Phase 31 (DDR-123) — ACP chat bridge WS. Main origin ONLY (this server,
      // never startCanvasServer) and loopback-guarded like collab: the bridge
      // spawns the user's `claude` and can drive file edits, so the untrusted
      // canvas origin and remote hosts must never reach it. Checked BEFORE the
      // generic `/_ws` inspector branch since `/_ws/acp`.startsWith('/_ws').
      if (pathname === '/_ws/acp') {
        if (!isLoopbackHost(req.headers.get('host'))) {
          return new Response('ACP chat is loopback-only', { status: 403 });
        }
        // CSWSH defense: a WS handshake bypasses SOP, so loopback-Host alone would
        // let a cross-origin drive-by open this privileged socket (spawns `claude`,
        // drives edits). Reject any Origin that isn't this same loopback server.
        if (!isSameOriginWs(req)) {
          return new Response('ACP chat is same-origin only', { status: 403 });
        }
        // D2 (S9.9) — and only for a session that may edit (C30: no AI below `edit`).
        // The socket used to check WHERE the handshake came from, never WHO; a
        // hub-linked viewer's chat could drive edits its sync would then refuse.
        const refusal = acpRefusal(http.accessOf(req));
        if (refusal) return refusal;
        const ok = srv.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            remote: req.headers.get('x-forwarded-for') ?? '127.0.0.1',
            kind: 'acp',
          },
        });
        if (ok) return undefined as unknown as Response;
        return new Response('Upgrade failed', { status: 400 });
      }

      // Legacy inspector WS — JSON frames, designer-facing live tab state.
      if (pathname.startsWith('/_ws')) {
        // CSWSH (Phase 2 gate) — the shell's own socket; a drive-by Origin is refused
        // on a desktop like /_ws/acp and collab above (a cell's proxy vouches instead).
        if (!WORKSPACE && !isSameOriginWs(req)) {
          return new Response('inspector is same-origin only', { status: 403 });
        }
        const access = http.accessOf(req);
        const ok = srv.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            remote: req.headers.get('x-forwarded-for') ?? '127.0.0.1',
            kind: 'inspector',
            // D3 — whose socket this is, from the proxy's vouched header. Same
            // handshake-time reasoning as `readOnly` below; `''` on a desktop.
            session: WORKSPACE ? normalizeSessionKey(req.headers.get(SESSION_HEADER)) : '',
            // Who, for attribution (a comment's author) — the proxy's vouched
            // member; a desktop leaves it to the project's git identity.
            user: WORKSPACE ? (req.headers.get('x-maude-user') ?? '').slice(0, 120) : '',
            // Cloud Phase 27 — stamp the role onto the socket at the handshake,
            // the one moment the session is unambiguous. Fails CLOSED in a cell
            // for the same reason the HTTP gate does: an absent header is an
            // unproven session, and this channel can delete other people's
            // comments. S9.11 — derived from the request's access: in a cell the
            // proxy's claim (fail closed as before), on a desktop the linked hub's
            // stored claim — a hub-linked viewer's socket was writable here.
            readOnly: !access.can('edit', null),
            // S9.15c — a paused project: no comment write over this socket either.
            ...(WORKSPACE && lanesClosedFromProxy(req.headers) ? { lanesClosed: true } : {}),
            // S9.11 (V2-1.16 L12) — what this socket may hear.
            access,
          },
        });
        if (ok) return undefined as unknown as Response;
        return new Response('Upgrade failed', { status: 400 });
      }
      // D3 — the fall-through half of the same scope the route table gets above.
      return withSession(http.fetch)(req);
    },
    websocket: ws.handler,
    error(e) {
      console.error('[bun.serve error]', e);
      return new Response('Server error', { status: 500 });
    },
  });
}

// T2 (9.1-A) — the segregated canvas-content origin. A second Bun.serve on its
// own (OS-assigned) port, sharing this process's ctx / api / inspect / collab /
// ws. Canvas iframes load from here; hub-pushed JSX that executes in a canvas
// can therefore only reach THIS origin (locked further by the CSP on the shell
// + an iframe sandbox), never the main origin's /_api/export, /_config,
// /_sync-status, /_comments, or arbitrary repo files. Routes are a hard
// allowlist: Bun matches `routes` before `fetch`, so we expose ONLY the two
// gated API endpoints the runtime needs here and 403 everything else in fetch.
//
// V2-2.8 S9 (V2-1.16 L21) — `{ capture: true }` starts the CAPTURE origin: the
// same listener, a third port, for headless renders only (exports, `maude
// design screenshot`, smoke, perf, …). The main origin 307s every canvas-shell
// request to it (http.ts `captureRedirect`), so tenant canvas code in a capture
// runs here — read-only by construction — and never on the main origin, where
// its requests passed sameOriginWrite + isTrustedRequestHost.
function captureWriteRefusal(): Response {
  return new Response('the capture origin is read-only', {
    status: 405,
    headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
  });
}

/**
 * What the capture origin refuses before anything else is consulted — applied
 * to its `routes` entries AND its `fetch` (Bun matches `routes` first, so a
 * gate on `fetch` alone would miss the route table). Read-only BY
 * CONSTRUCTION: it is its own origin, so nothing a page runs can remove these
 * properties (a restricting cookie or header could be stripped by
 * `fetch(…, { credentials: 'omit' })`; a port cannot).
 *   - loopback only: it never sits behind a proxy, so a foreign Host is a
 *     DNS-rebound page;
 *   - no upgrade: no collab room, no HMR feed;
 *   - no service worker: in a reused browser session (agent-browser keeps one)
 *     it would answer the NEXT canvas's capture with whatever the first chose;
 *   - GET/HEAD only.
 */
function captureRefusal(req: Request): Response | null {
  if (!isLoopbackHost(req.headers.get('host')))
    return new Response('local request required (DNS-rebinding guard)', { status: 403 });
  if (req.headers.get('upgrade'))
    return new Response('the capture origin accepts no upgrades', { status: 403 });
  if (req.headers.get('service-worker'))
    return new Response('the capture origin installs no service workers', { status: 403 });
  if (req.method !== 'GET' && req.method !== 'HEAD') return captureWriteRefusal();
  return null;
}

/** Each route behind the capture gate — the capture origin's copy of the ONE table. */
function readOnlyRoutes<R extends Record<string, unknown>>(routes: R): R {
  const out: Record<string, unknown> = {};
  for (const [path, handler] of Object.entries(routes)) {
    const fn = handler as (req: Request) => Response | Promise<Response>;
    out[path] = (req: Request) => captureRefusal(req) ?? fn(req);
  }
  return out as R;
}

function startCanvasServer(
  port: number,
  { capture = false, hostname = V4_LOOPBACK }: { capture?: boolean; hostname?: string } = {}
): BunServer {
  // Hard allowlist of route-table endpoints (Bun matches `routes` before
  // `fetch`) — routes/canvas-origin.ts (V2-2.5 moved the literal there verbatim,
  // so test/canvas-origin-parity.test.ts can hold it to CANVAS_SAFE_API).
  const routes = canvasOriginRoutes(http);
  return Bun.serve<WsData, never>({
    port,
    hostname,
    development: process.env.NODE_ENV !== 'production',
    // DDR-088 follow-up — bound the pre-handler request buffer on the UNTRUSTED
    // canvas origin (the asset upload lives here). See MAX_REQUEST_BODY.
    maxRequestBodySize: MAX_REQUEST_BODY,
    // The capture origin serves the SAME route table, each entry behind a
    // GET/HEAD gate — never a third allowlist (V2-2.8 S9).
    // V2-3.6 N-M2 — the interactive canvas origin refuses a top-level document
    // (canvas-top-level.ts); the capture origin is loaded top-level by design.
    routes: capture ? readOnlyRoutes(routes) : topLevelGuardedRoutes(routes),
    async fetch(req, srv) {
      const pathname = new URL(req.url).pathname;

      // V2-2.8 S9 — the capture origin's gate (see captureRefusal), before
      // anything else is consulted.
      if (capture) {
        const refused = captureRefusal(req);
        if (refused) return refused;
      } else {
        const refused = canvasTopLevelRefusal(req);
        if (refused) return refused;
      }

      // Collab WS — shared registry, loopback-only (same gate as the main
      // origin), with the same workspace-mode vouched path: in a cell the hub's
      // canvas lane forwards the iframe's collab socket HERE, capability-
      // authenticated, with Host rewritten to the public canvas origin (D4) —
      // RCA issue-cloud-live-collaboration-dead.
      const collabSlug = parseCollabSlug(pathname);
      if (collabSlug !== null) {
        const vouchedRole = WORKSPACE ? req.headers.get('x-maude-role') : null;
        if (!isLoopbackHost(req.headers.get('host')) && !vouchedRole) {
          return new Response('cross-machine collab requires Phase 9 hub deploy', { status: 403 });
        }
        // CSWSH (Phase 2 gate) — the canvas iframe keeps its own origin
        // (`allow-same-origin`), so only a page ON this canvas origin passes; a drive-by
        // site could otherwise read the Y-doc and write comments/annotations here.
        if (!WORKSPACE && !isSameOriginWs(req)) {
          return new Response('collab is same-origin only', { status: 403 });
        }
        // S9.11 (V2-1.16 L11/L15) — the render token's access joins only its canvases' rooms.
        const access = http.accessOf(req);
        if (!seesSlug(access, collabSlug, ctx.paths.designRel)) return notInScopeResponse();
        const ok = srv.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            remote: req.headers.get('x-forwarded-for') ?? '127.0.0.1',
            kind: 'collab',
            slug: collabSlug,
            access,
            // UNTRUSTED canvas iframe origin (DDR-063 split). Every sync frame
            // from here goes through the origin gate and may never write a
            // body lane — DDR-122 follow-up, collab/origins.ts. ALWAYS
            // 'canvas' on this listener — the proxy's realm marker is not
            // consulted, so a forged header cannot promote the socket.
            realm: 'canvas',
            // Fail closed in a cell (absent header = unproven session);
            // loopback desktop keeps full capability as before. S9.11 — from the access.
            readOnly: !access.can('edit', canvasOfSlug(access, collabSlug, ctx.paths.designRel)),
            // S3.7c — the hub's canvas door opened this on a receive-only FOLLOW
            // capability (stripped-then-injected, so a client cannot claim it; it
            // only ever narrows): the room drops its sync, keeps its `watching`.
            ...(WORKSPACE && req.headers.get('x-maude-collab-follow') === '1'
              ? { follow: true }
              : {}),
            // S9.15c — a paused project (`x-maude-readonly: plan`): no lane writable, comments too.
            ...(WORKSPACE && lanesClosedFromProxy(req.headers) ? { lanesClosed: true } : {}),
          },
        });
        if (ok) return undefined as unknown as Response;
        return new Response('Upgrade failed', { status: 400 });
      }

      // HMR-only socket — canvas iframes listen for `canvas-hmr` here. Carries
      // NO privileged inspector feed and ignores inbound messages (ws.ts) — but its
      // frames name files (→ collab slugs), so a drive-by Origin is refused too.
      if (pathname.startsWith('/_ws')) {
        if (!WORKSPACE && !isSameOriginWs(req)) {
          return new Response('canvas socket is same-origin only', { status: 403 });
        }
        const ok = srv.upgrade(req, {
          data: {
            id: crypto.randomUUID(),
            remote: req.headers.get('x-forwarded-for') ?? '127.0.0.1',
            kind: 'canvas-hmr',
            // S9.11 (V2-1.16 L12) — the render token's access decides which frames it hears.
            access: http.accessOf(req),
          },
        });
        if (ok) return undefined as unknown as Response;
        return new Response('Upgrade failed', { status: 400 });
      }

      // Canvas mount harness with the strict CSP ALWAYS on (F1 gate).
      if (pathname === '/_canvas-shell.html' || pathname === '/_canvas-shell') {
        return http.serveCanvasShell(true, false, new URL(req.url).searchParams);
      }

      // Allowlist gate — runtime bundles, comment-mount, transpiled .tsx + CSS/
      // assets under designRoot. Everything else is refused at the door.
      if (!http.isCanvasSafeRoute(pathname)) {
        return new Response('Forbidden (canvas origin)', { status: 403 });
      }
      return http.fetch(req);
    },
    websocket: ws.handler,
    error(e) {
      console.error('[bun.serve canvas-origin error]', e);
      return new Response('Server error', { status: 500 });
    },
  });
}

function isAddrInUse(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; errno?: number };
  return err.code === 'EADDRINUSE';
}

let server: BunServer;
{
  const MAX_TRIES = PORT_EXPLICIT ? 1 : 10;
  let lastErr: unknown;
  let bound: BunServer | null = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    const tryPort = BASE_PORT + i;
    try {
      bound = listenLoopback((h, p) => startServer(p, h), tryPort);
      if (i > 0) {
        console.log(`[port] ${BASE_PORT} busy, using ${tryPort} instead.`);
      }
      break;
    } catch (e) {
      lastErr = e;
      if (!isAddrInUse(e)) throw e;
    }
  }
  if (!bound) {
    if (PORT_EXPLICIT) {
      console.error(
        `\n  Port ${BASE_PORT} is in use. Pick a different one with --port <N> or $PORT.\n`
      );
    } else {
      console.error(
        `\n  Ports ${BASE_PORT}-${BASE_PORT + MAX_TRIES - 1} are all in use. Stop a running dev-server or pass --port <N>.\n`
      );
    }
    throw lastErr;
  }
  server = bound;
}

// T2 (9.1-A) — advertise the main origin so the canvas origin's CSP can
// allowlist it in `frame-ancestors` (the legit embedder). Must be set before
// the canvas listener serves its first shell. Both loopback host spellings are
// listed: the server binds 127.0.0.1, so a user who opens the printed URL as
// `127.0.0.1:<port>` is the same legit embedder — with only `localhost` allowed
// the canvas iframe was silently refused (blank sad-page, no error anywhere).
//
// D4 AGAIN — the PUBLIC name, not the bound one. In a cell the parent frame is
// `https://<project>.cloud.maude.sh`; listing only the loopback origins made the
// browser refuse to render the canvas iframe at all ("refused to connect"),
// which looks like a network failure and is a CSP one. The loopback spellings
// stay for local tooling (screenshots, smoke) — a cell simply has one more legit
// embedder, and naming it is configuration, never a Host header.
const publicShellOrigin = (() => {
  const url = process.env.HUB_PUBLIC_URL;
  if (!url) return '';
  try {
    return ` ${new URL(url).origin}`;
  } catch {
    return '';
  }
})();
// Additional legit embedders, space-separated (validated per-origin). A cell
// can genuinely have MORE than one shell name — the local rig serves its shell
// on `http://studio.cell.localhost:<port>` (same-site with the canvas origin,
// so the SameSite=Strict capability cookie flows exactly as it does in
// production) while `127.0.0.1:<port>` stays alive for tooling — and listing
// only one of them turns the other into a silent sad-page iframe refusal.
const extraShellOrigins = (process.env.MAUDE_EXTRA_SHELL_ORIGINS ?? '')
  .split(/[\s,]+/)
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  })
  .filter(Boolean)
  .map((o) => ` ${o}`)
  .join('');
ctx.mainOrigin = `http://localhost:${server.port} http://127.0.0.1:${server.port}${publicShellOrigin}${extraShellOrigins}`;
// DDR-247 — apps that may FRAME the studio for the read-only `?embed=1` view.
// Deliberately NOT folded into `mainOrigin` above: those are shells, and the
// hub's canvas door accepts shells as writers. An embedder only gets framing.
ctx.embedOrigins = parseEmbedOrigins(process.env.MAUDE_EMBED_ORIGINS);

// T2 (9.1-A) — segregated canvas-content origin. ON BY DEFAULT (opt-OUT) since
// phase-9.1: a second listener binds an OS-assigned free port, advertised as
// `canvasOrigin`, and the client loads canvas iframes cross-origin under the
// strict CSP + sandbox + route-allowlist (the F1 containment). This is purely
// protective — for a solo user it sandboxes their OWN canvas code (no untrusted
// content, no exfil concern), and interactive-feature parity (selection,
// comments, presence, motion) is verified. It does NOT by itself enable
// untrusted `.tsx` sync — that still requires the per-canvas `syncable` opt-in
// (sync/index.ts), so the WebRTC/self-nav exfil residual only applies to a
// canvas explicitly opted into syncing (DDR-060 + the F1 re-audit report).
// Set `MAUDE_CANVAS_ORIGIN_SPLIT=0` (or false/off/no) to fall back to the legacy
// same-origin path.
const CANVAS_ORIGIN_SPLIT = !/^(0|false|off|no)$/i.test(
  process.env.MAUDE_CANVAS_ORIGIN_SPLIT ?? ''
);
// The canvas origin exists to SERVE canvases into a segregated origin (DDR-063
// / DDR-054). A workspace cell used to skip it, back when a cell was forbidden
// to serve them at all. DDR-209 A′1 reverses that, and in a cell the split is
// not merely protective — it is the boundary between one tenant's executing
// canvas and everything else on that host, which is the strongest reason any
// deployment has ever had to keep it on.
const canvasServer = CANVAS_ORIGIN_SPLIT
  ? listenLoopback((hostname, p) => startCanvasServer(p, { hostname }), 0)
  : null;
// D4 — PUBLIC IDENTITY COMES FROM CONFIGURATION, NEVER FROM THE REQUEST.
//
// The loopback origin is what this process BINDS; behind a reverse proxy it is
// not the address the member's browser can reach, and deriving it from the Host
// header is exactly the bug Cloud Phase 25 shipped into production twice (a
// member signing in was sent to an address that was not their project). So a
// cell states its canvas origin explicitly and we use it verbatim.
const canvasOrigin = process.env.MAUDE_PUBLIC_CANVAS_ORIGIN?.replace(/\/+$/, '')
  ? process.env.MAUDE_PUBLIC_CANVAS_ORIGIN.replace(/\/+$/, '')
  : canvasServer
    ? `http://localhost:${canvasServer.port}`
    : undefined;
if (canvasOrigin) ctx.canvasOrigin = canvasOrigin;
// V2-2.8 S9 — the read-only CAPTURE origin (see startCanvasServer). Desktop /
// plain server only: a cell renders nothing in-process (the render worker
// captures on the public canvas origin), and with the split OFF there is no
// segregated origin to mirror — captures stay on the main origin there, as do
// interactive canvases (a named residual). Not advertised in `_server.json`:
// callers reach it through the main origin's 307.
const captureServer =
  CANVAS_ORIGIN_SPLIT && !WORKSPACE
    ? listenLoopback((hostname, p) => startCanvasServer(p, { capture: true, hostname }), 0)
    : null;
if (captureServer) ctx.captureOrigin = `http://localhost:${captureServer.port}`;

const startedAt = new Date().toISOString();
await Bun.write(
  ctx.paths.serverInfoFile,
  JSON.stringify(
    {
      pid: process.pid,
      port: server.port,
      url: `http://localhost:${server.port}`,
      ...(canvasOrigin ? { canvasOrigin } : {}),
      // The port the canvas listener actually BOUND, as distinct from the
      // public `canvasOrigin` name above. A co-located reverse proxy (the cell's
      // hub) forwards canvas-origin traffic here; nothing else needs it.
      ...(canvasServer ? { canvasPort: canvasServer.port } : {}),
      started: startedAt,
      project: ctx.cfg.name,
      config_source: ctx.cfg._source,
    },
    null,
    2
  )
);
// V2-1.1 decision 8 — the same facts, to the desktop shell's own info file when it asked for one
// (MAUDE_SHELL_INFO_FILE; atomic, 0600). Its probes read only that file + call the token-gated
// /_api/shell/status, so a planted _server.json is never believed. _server.json is unchanged.
writeShellInfoFile({
  pid: process.pid,
  port: server.port ?? 0, // a TCP listener always has one; the type allows a unix socket
  url: `http://localhost:${server.port}`,
  ...(canvasOrigin ? { canvasOrigin } : {}),
  started: startedAt,
  mode: 'project',
});

fsWatch.start();
startHeapWatch();

// Phase 27 Task 5 (E2) — live dirty-state. Subscribes to `fs:any` (after
// fsWatch.start so it sees every event) and broadcasts `git-status` to the shell
// on each versionable change. No-op for a non-git project (gitStatus → repo:false).
const gitWatch = createGitWatch(ctx);

// Phase 31 follow-up — external-canvas list watcher. Subscribes to `fs:any` and
// emits `canvas-list-update` when a canvas file appears/disappears on disk from
// OUTSIDE the dev-server (ACP agent `/design:new`, agent Write, git checkout),
// so the browser file tree refreshes without a reload — the symmetric
// counterpart to api.ts's create/delete emit. RCA:
// `.ai/logs/rca/issue-acp-new-canvas-not-in-filetree.md`.
const canvasListWatch = createCanvasListWatch(ctx);

// Config hot-reload — `/design:setup-ds` (or a hand edit) rewrites
// `.design/config.json` mid-session; without a re-read the server keeps
// serving the boot snapshot and a newly added canvas group (`system`) never
// reaches /_index-data, so scaffolded DS files stay invisible even on a
// manual tree reload. On change: swap ctx.cfg in place (reloadConfig), let
// canvasListWatch's set-diff emit `canvas-list-update` for canvases the new
// groups uncover, and tell shells to refetch /_config.
// RCA: .ai/logs/rca/issue-ds-scaffold-files-not-in-filetree-stale-config.md
const CONFIG_RELOAD_DEBOUNCE_MS = 150;
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
ctx.bus.on('fs:json', (rel: string) => {
  if (rel.replace(/\\/g, '/').replace(/^\/+/, '') !== 'config.json') return;
  if (configReloadTimer) clearTimeout(configReloadTimer);
  configReloadTimer = setTimeout(() => {
    configReloadTimer = null;
    if (!reloadConfig(ctx)) return;
    console.log('  config.json changed — reloaded live.');
    void canvasListWatch.refresh();
    ctx.bus.emit('config-updated');
  }, CONFIG_RELOAD_DEBOUNCE_MS);
});

// Phase 9 Task 4 — bidirectional sync agent. No-op when the project isn't
// linked to a hub (`.design/config.json` has no `linkedHub` field). Kicked
// off after fsWatch so the agent's bus subscription receives every fs event.
// Owned by a supervisor rather than started inline: linking a project from the
// cloud panel cycles the runtime in place (ctx.syncControl), so pressing
// Connect starts syncing instead of printing "restart the studio server".
const syncRuntime = createSyncSupervisor(ctx, collab ? { registry: collab.registry } : {});
// S5.1b — a project with no hub answers history / undo / restore from its own
// store (`_state/project-store.sqlite`, the in-process kernel); a linked one is
// unchanged. The watcher feeds it through the bus.
const localHome = attachLocalHome(ctx, syncRuntime);
ctx.syncControl = localHome.control;
// S5.3 — the run registry's lease home (Q2): the linked hub when its `/health` advertises
// `runs-v1`, else per-Mac leases plus the Diagnostics line. An unreachable hub (capabilities
// null) keeps the per-Mac home without the line — it is offline, not old. A cell keeps its own.
{
  const hubUrl = ctx.cfg.linkedHub?.url;
  if (hubUrl && !isWorkspaceMode()) {
    void hubHealth({ hubUrl })
      .then(({ capabilities }) => {
        if (capabilities === null) return;
        const sel = selectLeaseHome({
          actor: 'you',
          linked: { hubUrl, token: () => getHubRecord(hubUrl)?.token ?? null },
          capabilities,
        });
        runRegistry.setHome(sel.home, sel.diagnostics);
        if (sel.home.kind === 'hub') void runRegistry.pull();
      })
      .catch(() => {});
  }
}
registerStatus('sync', () => ({
  linked: Boolean(ctx.cfg.linkedHub),
  hub: ctx.cfg.linkedHub?.url ?? null,
  running: syncRuntime.current() !== null,
  cycling: syncRuntime.busy(),
}));
// A linked project that had NOTHING syncable at boot asks for one cycle the
// moment it gains its first canvas — see the zero-canvas branch in
// `sync/index.ts`. The runtime cannot cycle itself (the supervisor owns the
// serialization), so it asks and this answers. Refused while a cycle is already
// in flight, exactly like the Resync button.
ctx.bus.on('sync:needs-restart', () => {
  if (syncRuntime.busy()) return;
  void syncRuntime.restart().catch((err) => {
    console.error('[sync] first-canvas restart failed:', err);
  });
});
try {
  await syncRuntime.start();
} catch (err) {
  console.error('[sync] startup failed — continuing in solo mode:', err);
}

const url = `http://localhost:${server.port}`;
console.log(`\n  ${ctx.projectLabel} — local browser`);
console.log('  ─────────────────────────────');
console.log(`  ${url}`);
console.log(`  Project:   ${ctx.cfg.name}`);
console.log(`  Config:    ${ctx.cfg._source}`);
console.log(`  Design:    ${ctx.paths.designRoot}`);
console.log(`  Active:    ${ctx.paths.activeFile}`);
console.log('  Press Ctrl+C to stop.\n');

// A workspace cell has nobody at the keyboard, and no browser to open — the
// member is already looking at this project through the proxy in front of it.
// Attempting it there was not merely pointless: the spawn threw ENOENT on a
// headless image and took the whole server down with it, which the supervisor
// then dutifully restarted into the same crash. Two fixes, because they are two
// separate mistakes: do not TRY in a cell, and do not DIE when it fails.
if (!process.env.NO_OPEN && !WORKSPACE) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (opener) {
    // `Bun.spawn`, not `node:child_process.spawn` — it reports a missing
    // executable SYNCHRONOUSLY, so one try/catch genuinely covers it. The node
    // shim signals ENOENT through an async 'error' event, which a try/catch
    // does not catch and an unhandled listener turns into a process-level
    // throw. That is precisely how a headless image with no `xdg-open` took the
    // whole server down. (DDR-009 also prefers Bun.* here.)
    try {
      Bun.spawn([opener, url], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref();
    } catch {
      console.log(`  (could not open a browser automatically — visit ${url})`);
    }
  }
}

const SHUTDOWN_WATCHDOG_MS = Number(process.env.MAUDE_SHUTDOWN_WATCHDOG_MS) || 5000;

async function shutdown() {
  console.log('\n  Stopping…');
  // V2-2.8 B4: a teardown step that never settles (syncRuntime.stop, a collab flush) must not
  // keep the process alive after a signal — 26 CI runs hung in figma-routes this way. Logged,
  // then out; the JSON snapshots are the ground truth anyway.
  setTimeout(() => {
    console.error('  Shutdown did not finish within 5 s — exiting anyway.');
    process.exit(0);
  }, SHUTDOWN_WATCHDOG_MS).unref();
  // Test seam (V2-2.8 B4 regression test only): simulate a teardown that never settles.
  if (process.env.MAUDE_TEST_HANG_SHUTDOWN === '1') await new Promise(() => {});
  void stopDiagnostics();
  // live run records stay on disk: the next boot ends them `interrupted` (R11)
  runRegistry.close();
  flushAllIndexes();
  stopAllThumbs();
  // DDR-166 — reap in-flight claude-provisioning grandchildren before this
  // process exits. Security-review finding: neither the SIGTERM/SIGINT path
  // here nor sidecar.rs's child.kill() on the Tauri side propagate to a
  // spawned `claude auth login`/installer child by default, so quitting
  // mid-signin or mid-install orphaned it — exactly the DDR's own named-but-
  // previously-unanswered "how does app-quit reach the grandchild" question.
  cancelSignin();
  cancelInstall();
  // Addendum Task 8 — bridges now outlive their WebSocket, so socket-close is
  // no longer the reaper it used to be. App quit / dev-server shutdown is the
  // ONE lifetime boundary the detached model deliberately does NOT survive
  // (DDR-166's SIGTERM-first path): extending a session across a project or
  // branch *switch* is the point; extending it across a quit is not, and a
  // surviving `claude` subprocess after quit would be an orphan.
  try {
    acp.stopAll();
  } catch {
    /* best-effort — the process is exiting either way */
  }
  fsWatch.stop();
  try {
    gitWatch.stop();
  } catch {
    /* timer cleanup is best-effort */
  }
  try {
    canvasListWatch.stop();
  } catch {
    /* timer cleanup is best-effort */
  }
  try {
    activity.stop();
  } catch {
    /* timer cleanup is best-effort */
  }
  try {
    await syncRuntime.stop();
  } catch {
    /* best-effort — provider sockets will be closed by process exit anyway */
  }
  try {
    localHome.close(); // releases `_state/project-store.lock`
  } catch {
    /* a dead pid's lock is taken over at the next boot anyway */
  }
  try {
    if (collab) {
      collab.dispose();
      await collab.registry.destroyAll();
    }
  } catch {
    /* best-effort flush; the JSON snapshot is the ground truth anyway */
  }
  try {
    aiActivity.stop();
  } catch {
    /* janitor cleanup is best-effort */
  }
  try {
    gitLifecycle.stop();
  } catch {
    /* watcher cleanup is best-effort */
  }
  try {
    await Bun.write(ctx.paths.serverInfoFile, '').catch(() => {});
    // Remove the file by writing empty then unlinking.
    const fs = await import('node:fs/promises');
    await fs.unlink(ctx.paths.serverInfoFile).catch(() => {});
  } catch {
    /* ignore */
  }
  server.stop();
  try {
    canvasServer?.stop();
  } catch {
    /* best-effort */
  }
  try {
    captureServer?.stop();
  } catch {
    /* best-effort */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

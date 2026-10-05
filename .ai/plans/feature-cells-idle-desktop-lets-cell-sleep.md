# Feature: An idle desktop lets its cloud cell sleep

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils and imports. **Read the comments in `apps/studio/sync/index.ts` around every timer you touch.** Almost every constant there records a named incident, and issue #118 (sync stalled after the cell slept) is the regression class this plan must not reopen.

## Description

On 2026-10-05, the first night after v1.6.12, the Alligators cell was awake **all night: 10.55 instance-hours** between 20:00 and 07:00Z. Bots were not the cause; members-only wake held them off. The owner's paired desktop sat open and idle. It kept the cell up until the Mac slept at 05:07, and the cell then slept exactly `sleepAfter` (20 min) later.

Research (2026-10-05) found three layers, two of them bugs:

1. **Bug A: a self-fed 2-second journal poll.**
   - Every file-plane pass ends with `ledger.setPosition(...)` and `ledger.flush()` (`sync/file-plane.ts:2101-2102`), and `persist()` always restamps `updatedAt` (`sync/file-ledger.ts:442`). So every pass writes `.design/_state/file-ledger/<hubId>.json`.
   - `_state/` is deliberately not in the watcher's skip list (`fs-watch.ts:28`, `RUNTIME_DIRS`). The `fs:any` handler (`sync/index.ts:2715-2739`) calls `fileLedger.noteChanged(rel)` and `schedulePlanePass()` for any path.
   - The next pass therefore runs after the 400 ms debounce and the `MIN_PASS_INTERVAL_MS = 2_000` floor: about 150 `GET /api/journal` per 5 minutes, with nobody editing.
2. **Bug B: the control socket recycles every ~33 s.**
   - The `maude.files` control provider (`sync/ctl-provider.ts:155`, a default `HocuspocusProvider`) hears nothing while idle. The hub drops awareness on it (`hub/src/files-ctl.mjs:68`), and the Hocuspocus 4.3 server never pings.
   - The client's 30 s silence check therefore closes the socket and reopens it. Every reconnect also fires `onDocuments` → `documentDiscovery.schedule()`, an extra `/api/documents` + `/v1/bootstrap` pull, about 9 extra pairs per 5 minutes.
3. **The design itself keeps a warm cell warm.**
   - The 20 s `REMOTE_POLL_MS` timer (`sync/index.ts:262`, `:4614`) and the open document and control sockets reach the container through `containerFetch`.
   - `@cloudflare/containers` 0.3.7 renews the activity timer on every request and on every socket message. An open proxied socket also holds `inflightRequests > 0`, which blocks expiry outright (`container.js:887-953`, `:1687-1690`).
   - So a connected desktop keeps its cell awake forever, even with both bugs fixed. Issue #118's RCA noted that "the 20 s reconciler poll keeps [the cell] warm" as an implicit property.

## User Story

As the operator paying for Maude Cloud, I want a project's container to sleep when nobody is working in it, even if a member left the desktop app open, so that an idle project costs ~$0 and the €19 plan keeps its margin (L7c).

As a member, I want an open desktop that I come back to after an hour to just work. My next edit reaches the cloud, and changes others made while I was away arrive, without a stalled-sync state or lost work.

## Problem

The desktop has no idle state. While it is open it always holds two sockets and a 20 s poll against the cell, which by the container library's rules is permanent activity.

## Solution

**Approach chosen (owner, 2026-10-05): fix the two bugs, then let the DESKTOP park itself. The cell is never forced to stop under an open socket.**

The divergent debate (builder / shipper / breaker) converged on fixing bugs A and B first.
- The breaker **blocked** any cell-side forced expiry with sockets attached. The hub's SIGTERM path flushes before it closes sockets (`hub/src/server.mjs:3865`: stopWorkspaceAgent → stopJournal → finalBackup → `server.destroy()`). Today sleep is lossless only because it has always happened with no socket attached. Keep that invariant.
- So the client chooses to go quiet, and the cell sleeps through its ordinary `sleepAfter`.

1. **Bug A.** Stop the ledger write from driving the plane:
   - `persist()` writes only when position or rows actually changed;
   - the plane's `fs:any` trigger ignores the ledger's own directory (`_state/file-ledger/`), keeping `_state/` visible to every other subscriber per the `fs-watch.ts` note.
2. **Bug B.** The hub broadcasts a tiny stateless keep-alive on each open `maude.files` document every 15 s, via the `broadcastStateless` seam `files-ctl.mjs:159` already uses. The client's 30 s silence check stays on, so a dead socket is still detected (#118) and stops firing on a healthy one. The client ignores the keep-alive payload.
3. **Cell state probe.** Add `GET /_cell/state` to `MaudeCell.fetch`, answered **by the DO itself**: it never calls `containerFetch` or `renewActivityTimeout`, so it never wakes or warms the cell. It returns `{ state: 'asleep' | 'running', changedAt }`, where `changedAt` is the last content change the hub reported (item 4).
   - **Gated:** the request must carry the sync client's `authorization: Bearer` header and `x-maude-sync-park: 1`.
   - **Oracle:** awake/asleep is already public (members-only wake), so `changedAt` is coarsened to a minute.
4. **Change signal (hub → DO, push).** On any accepted content change (a Yjs document update applied, a journal row appended), the hub calls a debounced (≤ 1/10 s) `noteChange(at)` RPC on its own DO through the existing outbound interception (`project-store.internal`, the same seam `projectStore` RPC uses in `cell-do.mjs:107`). The DO stores `changedAt` in `ctx.storage`.
   - **Push, never pull.** A DO pull of the hub's `/health` would go through `containerFetch` and renew the timer, which is the loop render had to escape.
   - Hub-originated noise does not count: a hydrate during boot sets `changedAt` once, and a desktop that sees it does a normal resync.
5. **Desktop park.** A small state machine in the sync runtime:
   - **Park** after `PARK_AFTER_MS` (default 20 min) when all of these hold: no local edit (doc update with a local origin, or a design-root fs change outside `_state/`/runtime dirs); no studio UI activity (the client already reports focus and interaction for `activity.ts`, so reuse it, or add a heartbeat if it does not); no pending outbound work (ledger clean, no proposal in flight, no unflushed doc updates); and a **cloud** hub (never a self-hosted hub, which does not sleep).
   - **On park:**
     - flush;
     - destroy the doc and control providers;
     - stop the 20 s remote poll and the plane triggers;
     - set status `parked`, worded honestly per DDR-214: "Cloud project asleep. Wakes on your next change.";
     - then probe `GET /_cell/state` every `PARK_PROBE_MS` (60 s). Each probe is a Worker invocation only, with no container time.
   - **Unpark when:**
     - a local edit happens;
     - there is UI activity;
     - a probe returns `changedAt > parkedAt` (another member changed something; the cell must be running then);
     - or a probe fails in a way that is not "asleep" (fall back to today's behaviour; never park blind).
   - **On unpark:** run the #118 resume path exactly as after a reconnect: re-create providers, re-promote docs, run a full plane pass, and treat a changed journal epoch as a full resync. The first socket or write wakes a cold cell; members-only wake lets bearer requests and sockets through.
6. **Compatibility.**
   - An old desktop never sends `x-maude-sync-park`, so it keeps today's keep-warm behaviour.
   - A new desktop against an old cell gets a 404 or proxied answer from `/_cell/state` instead of the JSON contract. It must treat that as "park unsupported" and never park.
   - A new desktop against a self-hosted hub never parks.

**Out of scope (recorded):** browser tabs left open and idle. They hold doc sockets and keep the cell up. A browser park (Page Visibility + idle → close the providers) is the natural follow-up and reuses items 3–4. Cell-side forced expiry stays rejected unless a hub shutdown handshake (refuse writes → tell clients to park → close sockets → flush) is built first.

## Metadata

- **Type**: Bug Fix + Enhancement (cost)
- **Complexity**: High (three packages: studio sync, hub, cells; a client/server contract; a #118-class regression risk)
- **App/Package**: `apps/studio` (sync), `apps/hub`, `apps/cells`
- **Affected Systems**: desktop sync runtime, the `maude.files` control channel, the cell DO, the L7c unit-economics gate
- **Dependencies**: none new

---

## Context References

### Must-Read Files

> Read all of these in parallel in one message during `/flow:execute`.

- `apps/studio/sync/index.ts`:
  - `:250-400`: timer constants (`REMOTE_POLL_MS`, `FILE_PASS_DEBOUNCE_MS`, `MIN_PASS_INTERVAL_MS`, `POKE_COOLDOWN_MS`, stall-watchdog floors);
  - `:1389-1566`: the plane pass scheduler, pokes and `pokesSeen`;
  - `:2700-2740`: the `fs:any` trigger;
  - `:4240-4260`: `pullRemoteOnce`;
  - `:4580-4720`: `pollRemote`, the watchdog, "THE POLL STAYS AT 20 s";
  - `:5810-5850`: document provider options (#118);
  - `:3860-3880` and `:5945-5960`: `onStateless`.
- `apps/studio/sync/file-plane.ts` (`:1540-1600`, `:2095-2105`) and `apps/studio/sync/file-ledger.ts` (`:420-450`): pass shape, `setPosition`, `flush`, `persist`.
- `apps/studio/sync/ctl-provider.ts`: the control provider, the `status` wiring, `onDocuments`.
- `apps/studio/fs-watch.ts` (`:15-40`, `:90-105`): why `_state/` is not skipped globally.
- `apps/studio/activity.ts`: existing local-activity tracking; can it signal "a person is here"?
- `apps/hub/src/files-ctl.mjs`: the `maude.files` channel, `dropCtlAwareness`, `broadcastStateless` use (`:116-170`).
- `apps/hub/src/server.mjs`: Hocuspocus setup and `onChange`/`onStoreDocument` hooks; shutdown order `:3865`; outbound store client.
- `apps/cells/cell-do.mjs`: `fetch` top half (no-wake probe, members-only wake, `WAKE_PATH` handler: same "answer in the DO" pattern), `projectStore` RPC (`:107`), `onStop`.
- `apps/cells/cell-config.mjs`: `wakePolicy`, `WAKE_EXEMPT` (`/_` paths already wake, so `/_cell/state` must be handled **before** the policy, like `/_cell/wake`).
- `apps/cells/project-store.mjs`: `projectStoreOutbound`, how the container reaches its DO.
- `apps/cells/node_modules/@cloudflare/containers/dist/lib/container.js` (`:770-783`, `:864-1000`, `:1560-1570`, `:1680-1695`): what renews and what blocks expiry.
- `.ai/logs/rca/issue-118.md` (gitignored; use `kg search "issue 118"` if absent): the resume guarantees.
- DDR-214 (one honest sync status), DDR-226 (journal file plane, pokes), `apps/render/idle-policy.mjs` (pure policy plus a pinned library seam).

### Files to Create

- `apps/studio/sync/park.ts`: a pure park state machine (inputs: now, last local edit, last UI activity, pending-work flag, probe results; outputs: park, unpark, probe). Testable without a hub.
- `apps/studio/test/sync-park.test.ts`: the state-machine table plus an integration test against a fake hub and a fake `/_cell/state`.
- `apps/cells/cell-state.test.mjs`: the `/_cell/state` contract and gating, and `noteChange` storage and coarsening.
- `apps/hub/test/files-ctl-keepalive.test.mjs` (or the hub's test location): a stateless keep-alive every 15 s on every open `maude.files` doc, and nothing on other docs.

### Patterns to Follow

- **An answer that never touches the container:** the `WAKE_PATH` handler and the `asleep-reply` branch in `cell-do.mjs fetch()`. Same placement, before `wakePolicy`, never `containerFetch` or `renewActivityTimeout`.
- **Pure policy plus thin wiring:** `cell-config.mjs wakePolicy` and `apps/render/idle-policy.mjs`.
- **Stateless channel use:** `files-ctl.mjs:159` (`doc.broadcastStateless(...)`), with the client parse at `sync/index.ts:3866-3880`.

---

## Tasks

Execute in order. Tasks 1–2 are independently shippable (they cut traffic now). Tasks 3–7 deliver the sleep.

### Task 1: FIX Bug A (self-fed 2 s journal loop)

- **Do**:
  - In `file-ledger.ts`, `persist()`/`flush()` writes only when the serialized state (excluding `updatedAt`) differs from the last write, or `setPosition` is a no-op when the position is unchanged.
  - In `sync/index.ts` `fs:any`, skip `schedulePlanePass()` and `noteChanged` for paths under `_state/file-ledger/` (helper `isPlaneOwnStateRel`). Do **not** add `_state/` to `fs-watch.ts RUNTIME_DIRS` (see the note there).
- **Gotcha**: the ledger is also written on genuine row changes, and those must still persist. A crash between pass and flush must still recover (keep the flush on change).
- **Validate**: a test where an idle plane with no remote or local change runs exactly **one** pass after boot and then only on the 20 s poll. It must be red on today's code (revert and watch it fail).

### Task 2: FIX Bug B (control socket recycling)

- **Do**: in the hub, for every open `maude.files` document, `broadcastStateless(KEEPALIVE)` every 15 s (one interval per hub, iterating the open ctl docs). On the client, `ctl-provider.ts`/the `onStateless` parse ignores the keep-alive payload, and the files-ctl integer parse must not throw on it. Leave `messageReconnectTimeout` at the default.
- **Gotcha**: an old desktop receives the keep-alive. Check the old client's stateless parse ignores a non-integer payload (read `sync/index.ts:3866-3880` as shipped in v1.6.12). If it would throw or act on it, choose a payload the old parser already ignores.
- **Validate**: a hub test (keep-alive on ctl docs only, 15 s cadence, stops on close) and a client test (a ctl provider with a fake 30 s silence check stays connected with keep-alives and still reconnects without them).

### Task 3: ADD the hub → DO change signal

- **Do**:
  - In the hub, on an accepted content change (Hocuspocus `onChange`, or after a store, for any non-ctl document; journal append), debounce at ≤ 1 per 10 s and send `noteChange(at)` to the cell's DO.
  - Use the existing outbound route (`http://project-store.internal`, or a sibling route on the same interception) so the tenant is fixed by the DO, never by the container.
  - In the DO, store `changedAt`.
  - Self-hosted hubs, with no store URL, do nothing.
- **Gotcha**: the call must not block or fail a write. Fire-and-forget with a bounded retry. A missed signal costs only a later unpark (the 60 s probe then sees it on the next one), never correctness.
- **Validate**: hub unit (debounce, no call on ctl docs, no call on a self-host) and DO unit (`noteChange` stores a monotonic max).

### Task 4: ADD `GET /_cell/state` to the DO

- **Do**:
  - In `cell-do.mjs fetch`, before `wakePolicy`: when the path is `/_cell/state`, the method is GET, the request is not on the canvas origin, `x-maude-sync-park: 1` is present, and an `authorization: Bearer …` is present, return `{ state, changedAt }` (`no-store`).
  - `state` is `running` when `ctx.container.running === true`, otherwise `asleep`. `changedAt` is floored to the minute.
  - Never `containerFetch`, never renew, never start.
  - A missing header falls through to today's behaviour unchanged.
- **Gotcha**: `/_cell/*` must not reach the hub. Check that no hub route uses `/_cell/` (the defender review on 2026-10-04 confirmed none).
- **Validate**: `cell-state.test.mjs` (pure decision helper in `cell-config.mjs` plus a contract table), then the `wrangler dev` + Docker rig: probes on a cold cell answer `asleep` with 0 containers; probes on a warm cell do not extend its life (set `sleepAfter` to 1 min in the rig and watch it stop while probed every 10 s).

### Task 5: CREATE the desktop park state machine (`sync/park.ts`)

- **Do**: a pure reducer: `{phase: 'active'|'parked'|'unsupported', lastLocalEditAt, lastUiActivityAt, pending, parkedAt}` plus events (tick, localEdit, uiActivity, pendingChanged, probeResult) → next state and effects (`park`, `unpark`, `probe`).
  - Constants: `PARK_AFTER_MS = 20 min`, `PARK_PROBE_MS = 60 s`.
  - Probe outcomes:
    - a non-JSON or missing answer → `unsupported` (never park again this session);
    - a network error while parked → stay parked and probe again with backoff;
    - `changedAt > parkedAt` → unpark.
- **Validate**: a table test of every transition, including "pending work blocks park" and "self-hosted hub → never park".

### Task 6: WIRE park into the sync runtime

- **Do**:
  - In `sync/index.ts`, feed the reducer: local edits (doc updates with a local origin, `fs:any` outside `_state/` and runtime dirs), UI activity (reuse `activity.ts`, or the studio client's existing focus/interaction signal; add a lightweight `ui:active` bus event from the client socket if none fits), pending work (ledger dirty, proposals in flight, unflushed doc updates), and only for a cloud hub (`linkedHub` on the cloud zone).
  - **Park effect:** flush, destroy the doc and ctl providers, stop `remotePollTimer` and the plane triggers, set status `parked` (DDR-214 wording), start the probe timer.
  - **Unpark effect:** stop the probe, re-create the providers, and run the #118 resume path (re-promote docs, full plane pass, epoch-change full resync, watchdog reset).
  - Sync panel: show "Cloud project asleep. Wakes on your next change."
- **Gotcha**: the #118 stall watchdog must not fire while parked. `parked` is a deliberate state, not a stall. And `lastSyncAt` must not be faked by unparking (the #118 rule).
- **Validate**: an integration test with a fake hub, where nothing is lost across a park/unpark cycle:
  1. edit → sync;
  2. idle → park (providers destroyed, no polls);
  3. remote change (`noteChange`) → unpark;
  4. the change arrives;
  5. idle → park;
  6. local edit while parked → unpark and the edit reaches the hub.

  Then run the sync lane (`cd apps/studio && bun test test/sync-*.test.ts`) alone, per the memory "parallel test runs contaminate".

### Task 7: RIG + RELEASE + MEASURE

- **Do**:
  - Local rig: a real studio desktop against `wrangler dev` with the real hub image (or the closest feasible rig, documented). Show the desktop parks, the cell stops 20 min later (shortened in the rig), an edit while parked wakes it and lands, and a browser edit while parked unparks the desktop and arrives.
  - Release (`.ai/release-guide.md`; remember the `site/lib/whats-new.json` regen that v1.6.12 missed), then upgrade design.studyfi.com.
  - Leave a desktop open overnight, then measure exactly as on 2026-10-05: GraphQL `containersUsageAdaptiveGroups` for app `a03fc173-…`, plus Workers Logs for the bearer client's request rate.
- **Target**: overnight instance-hours ≈ the residue of genuine member wakes. Record the result in STATE.md and L7c.

### Task 8: RECORD decisions

- **Do**: `kg ingest`:
  - (a) the cell never stops under an open socket; the client parks (breaker rationale, the shutdown order);
  - (b) the hub → DO change-signal push and the `/_cell/state` contract;
  - (c) browser park is deferred, and forced expiry is rejected without a shutdown handshake.

  Extend `maude/cells-members-only-wake-as-built`.

---

## Validation

1. **Tests**: `cd apps/cells && npm test`; `cd apps/studio && bun test test/sync-*.test.ts` (alone, not alongside hub tests); the hub tests for files-ctl.
2. **Lint/format**: `pnpm lint`, `pnpm format`.
3. **Typecheck**: `cd apps/studio && bunx tsc --noEmit && bash ../../scripts/check-tsc-coverage.sh`.
4. **Bundle**: `cd apps/cells && npx wrangler deploy --dry-run --outdir "$TMPDIR/cells"`.
5. **Rig**: Task 4 (probe never warms) and Task 7 (park/unpark end to end).
6. **Live**: the overnight measurement with a desktop left open.
7. **Desktop E2E** (`desktop-e2e` skill): one scenario where the app parks and unparks on input. A `data-testid` on the parked status in the Sync panel.

## Scenario Coverage

UI change: one status string in the Sync panel. Add a desktop E2E scenario `sync-park-unpark` (the app idles to parked; a click or edit unparks; the status returns to synced). There is no web-surface change.

## Risks

- **#118 class, sync stalls after the cell slept.** Mitigated: unpark reuses the exact reconnect resume path; the watchdog is parked-aware; an integration test covers a remote change while parked.
- **Lost edit at park.** Park requires no pending work and flushes first. The cell sleeps only after the sockets are closed by the client, which keeps today's lossless-sleep invariant (shutdown order, `server.mjs:3865`).
- **A missed change signal.** The desktop stays parked until its next local edit, then resyncs fully. That costs latency, not data. Bound it: an unconditional unpark-and-resync every 6 h while parked, if measurement shows misses.
- **Old/new mixes.** Header-gated and capability-detected in both directions (see Solution §6).
- **Viewer on desktop.** UI activity (focus/interaction) counts as presence, so a person reading in the desktop does not get parked.
- **Library bump.** `/_cell/state` relies on the DO answering without `containerFetch`. A test asserts the DO path never calls `containerFetch` or `renewActivityTimeout` (spy), pinning the seam like `apps/render`.

## Acceptance Criteria

- [ ] An idle desktop makes no journal pass more often than the 20 s poll (Bug A, test red before).
- [ ] The `maude.files` socket stays connected while idle (Bug B, test red before).
- [ ] `/_cell/state` answers from the DO, never starts or warms the cell (rig with a shortened `sleepAfter`).
- [ ] A parked desktop holds no sockets and no polls. An edit while parked lands, and a remote change while parked arrives (integration test).
- [ ] Old desktop × new cell and new desktop × old cell / self-host behave as today.
- [ ] Released. One night with a desktop left open measures ≈ 0 instance-hours beyond genuine wakes. Recorded in STATE.md and L7c.
- [ ] Decisions recorded in kg.

# Follow-up: multiplayer parity issues (#131, #133, #134, #136)

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Four open user reports about comments and presence across web ↔ desktop, filed
after the multiplayer hardening (`archive/followup-multiplayer-hardening.md`,
v1.4.5). None is fixed on `main` as of 2026-09-29. Before this plan was written,
each hypothesis was measured (E2E in Playwright, a unit repro at the persistence
seam), then **re-verified on the shipped v1.4.5 binaries** after the 2026-09-29
rollout (cloud fleet + design.studyfi.com): real hub, two shipped studios, real
Safari. The evidence is summarised below and the harness is kept in
[`notes/multiplayer-parity-harness/`](./notes/multiplayer-parity-harness/)
(`v1.4.5-reverify/` for the shipped-binary runs).

| Issue | Symptom | Cause (evidence) | Status |
| --- | --- | --- | --- |
| [#136](https://github.com/1aGh/maude/issues/136), [#134](https://github.com/1aGh/maude/issues/134) | A comment on an annotation disappears / cannot be saved | **Every floating comment deletes itself after ~3 s for everyone.** A click outside an artboard (sticky, drawing, empty canvas) creates `selector: ''` (`canvas-comment-mount.tsx:429`); `CommentPin` cannot resolve it (`comments-overlay.tsx:190`), the orphan timer fires after `ORPHAN_GRACE_MS` (`:843`, `:878`) and `onOrphaned = handleDelete` (`:550`) sends `comments-delete`. | **Confirmed by E2E**: element comment survives 10 s; sticky and empty-canvas comments deleted at 3528 / 3527 ms by the shell's own WS `comments-delete`. |
| [#133](https://github.com/1aGh/maude/issues/133) | Some web comments never reach the desktop | (a) **The desktop comments file freezes after relaunch.** The "ids this doc has ever carried" set lives only in memory (`collab/persistence.ts:117`), so after a restart a disk id deleted remotely while the app was closed reads as "a write still in flight" and every later projection is refused (`:287-291`). (a′) **In legacy mode the same state resurrects the deleted comment for everyone** (the relaunched peer re-seeds it from disk). (b) **A web comment can stay local only.** `proposeLane` returns null during boot/resync or when pairing is off, and a rejected proposal is swallowed (`server.ts:87-95`); accepted cold start never re-proposes it (`sync/accepted-cold-start.ts:218-237`). (c) An existing self-host without `MAUDE_CELL_PAIRING=1` (G7 operator note). | (a) **Confirmed end-to-end on shipped v1.4.5** (real hub + two shipped studios, accepted mode, 3/3 runs, both directions): the relaunched peer logs `1/1 synced` but its file stays `[A,B]` forever while the other peer has `[B,C,E]`; the control run without a delete converges. (a′) **Confirmed on shipped v1.4.5**: legacy ends `[B,C,A,E]` on both peers. (b) from code, not reproduced. (c) **Done 2026-09-29** by the v1.4.5 rollout: design.studyfi.com reports `browserPaired: true`, parity 144/144; cloud fleet on 1.4.5. |
| [#131](https://github.com/1aGh/maude/issues/131) | The canvas stutters as soon as someone joins | H1: `useForeignAwareness` (`use-collab.tsx:331-361`) rebuilds fresh peer objects on every awareness change, including our own 30 Hz pointer publishes, so no `memo` in `cursors-overlay.tsx` ever holds and `ParticipantsChrome` re-renders with every cursor move. H2: `PeerSelection` / `PeerAnnotationSelection` do `querySelector` + `getBoundingClientRect` inside render (`cursors-overlay.tsx:186-188`, `:243-245`). H3 (found while measuring): **the observer's own pan on a large board is very slow in WebKit, with no peer at all.** | **Real Safari 26.5 on shipped v1.4.5** (observer = Safari, peer = headless Chromium, 3 × 10 s): H1 costs nothing measurable. Cursor-only conditions (B idle, B frozen, B moving) match the "second browser, not connected" control. **H2 is real**: only a peer *with a selection* adds hitches on the heavy board (160 artboards + 400 stickies, fit-all): p99 35 → 65 ms, max up to 1.35 s, +385–441 layout reads / 10 s. **H3 is bigger**: A's own pan at fit-all on the heavy board runs at ~1 s per frame (p50 928 ms) *without* a peer; 48 boards at the stored viewport ran ~0.5 s per frame in smoke runs. Chromium showed none of this. |

## User Story

As a designer working on one project from the web and the desktop app at the same time, I want every comment I write to stay where I put it and to appear on every peer, and a teammate joining my canvas not to slow it down, so that I can trust collaboration instead of re-checking it.

## Problem

- Commenting on annotations (stickies, drawings) or on empty canvas is currently impossible: the comment is saved and then deleted by the client ~3 s later, for everyone. Any client that cannot resolve a comment's target also deletes it for everyone.
- A desktop that was closed while a comment was deleted on the web stops updating its comments file permanently. Comments written on the web while the sync runtime is not ready, or whose proposal is rejected, never leave the web.
- With a peer present, the presence overlay re-renders and forces layout far more often than needed; this is the most likely cause of the stutter on large boards in WKWebView.

## Solution

1. **Comments are never deleted by software** (owner decision 2026-09-29: *detach, don't delete*). A comment whose target cannot be resolved becomes **detached**. It keeps its last known world position, is marked as detached in the pin and the comments panel, and only a person can delete it.
2. **Anchor comments to annotations** (owner decision 2026-09-29). A click on a sticky or drawing stores a new `annotationId` target, so the pin follows the annotation. Deleting the annotation detaches the comment. Floating comments on empty canvas store **world** coordinates instead of create-time screen coordinates.
3. **The comments projection survives a relaunch.** Persist the last projected id set per canvas, so "deleted remotely" and "still in flight" can be told apart after a restart.
   The same record stops the legacy-mode resurrection: a relaunched peer must not re-seed an id that it had projected earlier and the doc has since dropped.
4. **A comment always leaves the author's side.** Queue proposals made before the runtime is ready. Rebase and re-propose after a conflict rejection. On accepted cold start, re-propose local-only comment ids instead of parking them. A failure that stays after retries becomes a visible error, never a silent one.
5. **#131 is mostly single-user WebKit rendering cost, plus the peer selection halo.** First find why panning a large board costs ~1 s per frame in Safari with no peer (H3, root-cause first). Then move the selection-halo layout reads out of render into one rAF-batched measurement pass (H2). Presence re-render churn (H1) is cheap to fix but not shown to matter in frames, so do it only as a small cleanup inside the H2 change, gated by a render-count test rather than frame numbers.
6. **Measure in WebKit, not Chromium.** Use `perf.sh --engine safari` with a peer mode. Chromium showed neither H2's hitches nor H3.

## Metadata

- **Ticket**: GitHub [#131](https://github.com/1aGh/maude/issues/131), [#133](https://github.com/1aGh/maude/issues/133), [#134](https://github.com/1aGh/maude/issues/134), [#136](https://github.com/1aGh/maude/issues/136) (one combined task; close all four from the final commit)
- **Type**: Bug Fix
- **Complexity**: High
- **App/Package**: `apps/studio` (client, canvas runtime, collab, sync), `apps/hub` (comments lane only if the merge needs a change), `apps/desktop/e2e`
- **Related plans**: [`feature-annotations-v2-element-model.md`](./feature-annotations-v2-element-model.md) provides the stable annotation ids that Task 4 anchors to, and may own the fix for H3 if the pan cost is in the annotation layer
- **Affected Systems**: comment overlay and mount, comments API + persistence projection, accepted-revision proposals, presence/awareness overlay, perf harness
- **Dependencies**: none new

---

## Context References

### Must-Read Files

> During `/flow:execute`, read every file listed here in parallel in a single assistant message.

- `apps/studio/comments-overlay.tsx` (170-230 target resolution, 460-560 overlay + `handleDelete`, 840-910 `CommentPin` orphan timer): the #134/#136 defect
- `apps/studio/canvas-comment-mount.tsx` (400-450): floating-comment creation with `selector: ''` and screen `bounds`
- `apps/studio/input-router.tsx` (790-820): comment-mode target resolution, which only looks inside artboards
- `apps/studio/annotations-layer.tsx` (the portal ~3826, how stickies/strokes carry `data-id`): the anchor for `annotationId`
- `apps/studio/api.ts` (297-330 `Comment` type, ~1289-1311 `/_comments-all`, `publishComments`): the schema and the single mutation choke point
- `apps/studio/client/app.jsx` (13050-13075 `ownsActiveComment`, 13725-13735 `comment-delete` relay, 5336-5340 panel filtering, 13882 `comments-set`): shell relays and the panel
- `apps/studio/collab/persistence.ts` (95-190 `docSeenComments`, 270-300 the "behind" guard): #133(a)
- `apps/studio/server.ts` (80-112): comment proposals in accepted mode, #133(b)
- `apps/studio/sync/index.ts` (~4925 `proposeLane`, ~733 pairing, ~3811 tripwire), `apps/studio/sync/accepted-cold-start.ts` (21-25, 218-237), `apps/studio/sync/projection.ts` (749-779): the proposal lifecycle
- `apps/hub/src/project-transactions/lanes.mjs` (80-156): comments lane validation + `mergeById`, the rebase target
- `apps/studio/use-collab.tsx` (320-365 `useForeignAwareness`, 450-460 + 850-875 publish throttle): H1
- `apps/studio/cursors-overlay.tsx` (whole file): H1/H2
- `apps/studio/participants-chrome.tsx` (~326): the re-render on every cursor move
- `apps/studio/test/comments-persist-race.test.ts`, `apps/studio/test/comments-overlay.test.ts`, `apps/studio/test/comment-mount.test.ts`, `apps/studio/test/use-collab.test.ts`, `apps/studio/test/participants-chrome.test.ts`: existing seams to extend
- `apps/desktop/e2e/multiplayer/surface.e2e.ts` (3499-3590 L11 comments, 4194+ L19 presence): the native rows to extend
- `apps/studio/bin/perf.sh`, `apps/studio/bin/_perf-probe.mjs`, `apps/studio/bin/_perf-shared.mjs`, `apps/studio/bin/perf-canvas.mjs`: the perf harness
- `.ai/plans/notes/multiplayer-parity-harness/`: the measurement scripts and raw results behind this plan

### Files to Create

- `apps/studio/test/comments-detached.test.tsx`: overlay: an unresolvable target never posts `comment-delete`; detached state rendered
- `apps/studio/test/comments-annotation-anchor.test.ts`: mount + resolve an `annotationId` target
- `apps/studio/test/comments-relaunch-projection.test.ts`: #133(a) at the persistence seam across a simulated restart
- `apps/studio/test/comments-proposal-outbox.test.ts`: #133(b): proposal before runtime ready, conflict rebase, cold-start re-propose
- `apps/studio/test/presence-render-budget.test.tsx`: layout reads (and render counts) under synthetic awareness traffic

### Design canvases

No canvas matches; this is behavioural work on existing surfaces. The only new visual is the **detached** pin/panel state (see Design Decisions).

### Patterns to Follow

- The mutation choke point is `publishComments` in `api.ts` (#111, commit `720c948d`): doc first, then disk, both awaited. New comment fields go through it and through `loadCommentsForFile` default-filling for legacy entries.
- Peer-supplied content is untrusted (DDR-054 §2d): new fields (`annotationId`, `world`, `detached`) must be validated at every trust boundary where `sanitizeForeignState` / lane validation happens, and they need bounds.
- The persistence guard's safe-direction rule (`persistence.ts`, `MAX_SEEN_COMMENT_IDS` comment): any new state must degrade towards *deferring* a write, never towards deleting.
- Retry loops need a bound by construction (retro of `followup-multiplayer-hardening`, G1): the proposal outbox must answer "what does a permanent failure do".

---

## Design Decisions

### Components (from registry)

| Component | Source | Notes |
| --- | --- | --- |
| `CommentPin` | `apps/studio/comments-overlay.tsx` | Gains a `detached` visual state instead of `onOrphaned` deletion |
| Comments panel | `apps/studio/client/app.jsx` (panel list, 5336-5340) | Detached comments listed with a label and a "jump to last position" action |
| `CursorsOverlay`, `PeerSelection`, `PeerAnnotationSelection` | `apps/studio/cursors-overlay.tsx` | Same visuals, cheaper updates |

### Tokens / visuals

Use existing comment-pin and muted tokens from `apps/studio/client/styles/4-components.css`; no hardcoded colours. Detached = the existing pin at reduced emphasis plus a small "detached" label. The label must meet WCAG AA contrast (see `b96754d8`), and the state must not be conveyed by colour alone.

### Custom Components Needed

None.

---

## Tasks

Execute in order. Each task is atomic and testable. **Regression tests must fail first**: revert the fix locally and watch each new test go red before committing (memory `maude-verify-regression-tests-fail-first`). Run the `apps/studio` suite alone, never concurrently with the hub suite. Check `git status apps/studio/dist/` before and after every `bun test` or server boot, and use `MAUDE_NO_AUTOBUILD=1` for verification boots.

### M1: Comments are never lost (#134, #136)

### Task 1: ADD failing regression tests for self-deleting comments

✅ Task 1 — completed 2026-09-29: `test/comments-detached.test.tsx` (4 tests, all red on `main`), `test/comments-annotation-anchor.test.ts` (6; API half red without the fix), `test/annotation-stable-id.test.ts` (3; stability red without the fix). **Deviation:** the desktop E2E rows (L11b) are not added — the Tauri debug build was not run in this session; the Playwright harness `notes/multiplayer-parity-harness/exp1-comments.mjs` against the source server is the E2E evidence (before: sticky/empty deleted at ~3.5 s; after: all three persist, sticky comment stored with `annotationId: sticky_1` + `world`, empty-canvas comment with `world`). Porting it into `surface.e2e.ts` stays open for `/flow:done`.

- **Do**: In `comments-detached.test.tsx`, render `CommentPin`/the overlay with (a) `selector: ''`, (b) a selector that matches nothing, (c) a resolvable selector. Advance timers past 3 s and assert that no `comment-delete` postMessage is ever sent. Port `notes/multiplayer-parity-harness/exp1-comments.mjs` into a desktop E2E row next to L11 (`surface.e2e.ts`): *comment on a sticky*, *comment on empty canvas*, *comment whose element is deleted by a peer*. Every row must still show the comment on both peers after 10 s.
- **Pattern**: `comments-overlay.test.ts`; L11 in `surface.e2e.ts:3499-3590`
- **Gotcha**: The canvas iframe is unreachable from the shell DOM (memory `maude-canvas-iframe-unreachable-by-dom`). Use frame locators or coordinates, as the exp1 harness does.
- **Validate**: `cd apps/studio && bun test test/comments-detached.test.tsx`, which must be RED on current `main`

### Task 2: REMOVE auto-delete; ADD the detached state

✅ Task 2 — completed 2026-09-29: `CommentPin` has no delete path; `locateComment` + a local `detached` state (`data-detached`, aria-label suffix, hollow dashed pin in `client/comments-overlay.css`). Verified in a real browser: deleting the sticky on disk turned its comment's pin detached at the sticky's last place, nothing deleted. **Deviation:** the `ownsActiveComment` user-gesture flag was not added — after this change the only sender of `comment-delete` is the thread's Delete button, and the existing origin + `e.source` gates are unchanged; a hostile canvas could already send it before. The "show where it was" panel action is not added (detached comments stay listed in the panel as before).

- **Do**: Replace `onOrphaned={handleDelete}` with a local, non-persisted `detached` render state. The pin stays at the last resolved position, falling back to stored world coordinates (Task 3), and gets a detached style and label. Remove the path from the orphan timer to `comment-delete` entirely. Detachment is a *view* of the local DOM, not a fact about the comment, so it must never be written to disk or proposed. Otherwise one peer's missing element becomes everyone's state. List detached comments in the comments panel with "show where it was". Deletion stays an explicit user action (existing delete button → `comments-delete`).
- **Also**: Tighten `ownsActiveComment` in `app.jsx:13060`, so that a delete relayed from the canvas iframe is honoured only when it follows a user gesture. Mark it with a flag set by the delete button handler, not by the timer.
- **Gotcha**: Keep the DDR-054 origin + `e.source === activeWin` gates intact (`comment-relay-origin-gate.test.ts`).
- **Validate**: Task 1 tests green; `bun test test/comments-overlay.test.ts test/comment-relay-origin-gate.test.ts test/comment-edit.test.tsx`

### Task 3: ADD world-coordinate floating comments

✅ Task 3 — completed 2026-09-29: `comment-anchor.ts` (`clientToWorld` / `worldToClient` via `window.__maudeViewport`, exposed by canvas-lib), `world` stored on create, validated in `commentsAdd` and on read (`backfillComment`), relayed by the shell (`client/app.jsx` comment-submit whitelist — it dropped both new fields until fixed).

- **Do**: A floating comment stores `world: {x, y}` (canvas world coordinates at the click, converted through the current camera, the same conversion `canvas-rects` / annotations use) alongside the legacy screen `bounds`. `screenRectFor` projects `world` through the live camera, so the pin stays put through pan and zoom. Legacy floating comments that only have `bounds` render as today, detached rather than deleted. Default-fill and validate `world` (finite numbers, bounded magnitude) in `loadCommentsForFile` and in the hub comments lane if the lane validates fields.
- **Validate**: unit test for the camera round-trip; the E2E row "comment on empty canvas" still sits on the same world point after a pan and a zoom

### Task 4: ADD `annotationId` anchor for comments on stickies and drawings — AFTER annotations v2 Milestone B

✅ Task 4 — completed 2026-09-29, **ahead of annotations v2 by owner decision** ("implement it first, the other session builds on it"). `annotationIdAt` (geometric, smallest box, sections excluded) runs before element resolution in `dropComment`; `resolveCommentTarget` resolves `annotationId`. Annotation ids were already persisted as `data-id`; the one unstable case — an element written without `data-id` got a new `rid()` on every parse — is now `stableAnnotationId` (content hash + occurrence), with the stability contract documented in `annotations-model.ts` for the v2 migration to keep.

- **Sequencing**: [`feature-annotations-v2-element-model.md`](./feature-annotations-v2-element-model.md) (planned 2026-09-29 by a parallel session) replaces the single-SVG annotation store with per-element JSON records and **stable ids**, and names this task as its dependent. Land Task 4 only after its Milestone B, and anchor to v2 ids. Tasks 1–3 do **not** wait: with no auto-delete and world coordinates, a comment placed on a sticky already persists and stays put, which closes the #134/#136 symptom. Task 4 adds "follows the sticky when it moves".

- **Do**: In comment mode, a click whose hit target is inside the annotation layer (element with `data-id` under the annotations portal) produces a target `{ annotationId, world }` instead of the floating branch (`input-router.tsx:800-819`, `canvas-comment-mount.tsx:420-445`). `resolveCommentTarget` resolves `[data-id="<escaped>"]` inside the annotation layer (same lookup as `PeerAnnotationSelection`). If the annotation is gone, the comment is **detached**, never deleted, and falls back to `world`. The composer chip shows "sticky" / "drawing" instead of "canvas".
- **Gotcha**: `annotationId` is peer-supplied. Validate it as a bounded token and always `CSS.escape` it. Check that annotation ids are stable across edits and undo (the annotation-operation-identity work in `feature-reliable-project-multiplayer`). If they are not, anchor to the id the whiteboard toolkit (DDR-151) already treats as stable.
- **Validate**: `bun test test/comments-annotation-anchor.test.ts`; E2E row "comment on a sticky": the comment survives and follows when the sticky is moved on the other peer

### M2: Every comment reaches every peer (#133)

### Task 5: ADD failing tests for the relaunch freeze and the local-only comment

✅ Task 5 — completed 2026-09-29: `test/comments-relaunch-projection.test.ts` (projection freeze, #111 safe direction, upgrade/no-ledger, agent cold-start resurrection, shared filter, owed-comment rule). The freeze and resurrection tests were red before wiring. The E2E harness (`exp3-relaunch.mjs`, copied to the scratchpad with a `STUDIO=source` switch plus `EARLY` / `OFFLINE_WRITE` variants) is the end-to-end evidence.

- **Do**: In `comments-relaunch-projection.test.ts`, turn the scratch repro into a test: fresh `createPersistence`, disk `[A,B]`, doc `[B,C]`, flush, push `D`, flush. The expected disk is `[B,C,D]`. It stays `["A","B"]` on current `main`, verified 2026-09-29. Also cover the safe direction: disk `[A,B]` where B was written *after* the last projection and the doc is `[A]` must keep B. Add the **legacy resurrection** case: a relaunched legacy peer with disk `[A,B]` joining a room whose doc is `[B,C]` must not re-seed A into the room. Port `notes/multiplayer-parity-harness/v1.4.5-reverify/exp3-relaunch.mjs` (real hub + two studios) as the end-to-end check for both modes and both directions; it is the evidence behind this task. In `comments-proposal-outbox.test.ts`: (1) a comment added while `syncControl.current()` is null must eventually be proposed once the runtime is ready; (2) a comments proposal rejected as a conflict must be rebased and re-proposed; (3) accepted cold start with a local-only comment id on disk must propose it, not only park it in a recovery slot.
- **Validate**: all RED on `main`

### Task 6: FIX the relaunch freeze — persist the last projected set

✅ Task 6 — completed 2026-09-29: new `sync/comment-ledger.ts` (per-hub, `_state/comment-ledger.json`, written immediately; a 500 ms debounce lost the record in the E2E run because the peer quit right after syncing), shared per design root by `collab/persistence.ts` (the "behind" guard now skips ids the ledger knows were synced), `sync/agent.ts` and `sync/migrate-seed.ts` (both cold-start unions drop remotely deleted ids via `withoutRemotelyDeleted`), invalidated with the journal on a hub change. **The legacy resurrection came from `migrate-seed.ts`'s union, not the agent's.** E2E against the source server: accepted 3 variants and legacy all converge; the no-delete controls are unchanged.

- **Do**: After each successful comments projection, store the projected id set per slug in `_state/` (already runtime-state and ignored; no new `_*` path, so the four-list rule in CLAUDE.md is not triggered). On a fresh process, seed the "ever seen" knowledge from it. A disk id that was in the last projected set and is absent from the doc is a genuine delete, so write. A disk id that is not in it is still in flight, so defer as today. Missing or corrupt state falls back to today's behaviour (defer), which is the safe direction.
- **Gotcha**: A write for one slug must not race another projection of the same slug. Reuse the existing per-slug serialization.
- **Also (legacy)**: the file → doc seed on room mount (`collab/unpaired-reseed` / cold-start union path) must skip ids that are in the last projected set but not in the room's doc, because the remote side deleted them. Ids never projected are still seeded (the #111 first-comment path depends on that).
- **Validate**: Task 5 relaunch tests green, including legacy; `exp3-relaunch.mjs` converges in accepted and legacy, both directions; `bun test test/comments-persist-race.test.ts test/comments-duplication.test.ts test/comments-fs-rebroadcast.test.ts test/collab-unpaired-reseed.test.ts`

### Task 7: FIX local-only comments — a bounded proposal outbox with rebase

✅ Task 7 (cold-start part) — completed 2026-09-29. **Reproduced first**: a comment added right after the desktop boots stayed local and froze the file in 1 of 2 runs. It then reproduced deterministically as a comment written to disk while the studio is down, which stays `[A,B,EARLY]` without the fix. `accepted-cold-start.ts` now proposes comments that are only on disk and never synced (`commentsOwedToProject`) as the accepted list plus the local ones. The ledger keeps remote deletes out, and with no ledger record nothing is decided (the old recovery-slot rule). With the fix it converges, and the log shows `cold start: comments=propose`. **Not done, not reproduced:** the conflict-rejection rebase (`void proposed.catch`) and a runtime-ready queue. The hub's `mergeById` already merges independent adds three-way, and a comment written before the runtime is up lands on disk, where cold start now picks it up. Known limit: a canvas with no ledger record (no comment ever synced from this machine) still uses the old rule.

- **Do**: In `server.ts` `onCommentsChanged`:
  - **Runtime not ready.** When `proposeLane` is unavailable in accepted mode, queue the latest post-mutation list per file and flush the queue when the runtime becomes ready. Only the newest list per file is kept.
  - **Rejected proposal.** Replace `void proposed.catch(() => {})` with handling of the typed result. On a conflict, re-read the accepted comments, three-way merge by id (mirror of `mergeById`, `lanes.mjs:133-154`) and re-propose. Cap retries at 5 with backoff. After that, emit a visible `sync-error` notice naming the canvas, and keep the comment on disk.
  - **Accepted cold start.** Re-propose ids that exist only locally (`accepted-cold-start.ts:218-237`), merged by id, instead of only writing a recovery slot.
- **Gotcha**: Never re-propose a comment the accepted state deleted. A local id that the accepted history shows as deleted stays deleted. Check accepted history via the lane's base or tombstones, not just "absent now". Answer in code review what a *permanent* rejection (`invalid`) does: it must stop, not loop.
- **Validate**: Task 5 outbox tests green; `bun test test/sync-accepted-projection.test.ts test/sync-accepted-runtime.test.ts --timeout 20000`; hub `apps/hub/test/project-transactions.test.mjs` if the lane changed

### Task 8: ADD comment-parity diagnostics

⏸ Task 8 — deferred: not needed for the fixes above; still the way to find comments stranded on design.studyfi.com before pairing (Task 9).

- **Do**: Add the count of local-only comment ids per canvas (on disk but not accepted) to the sync status surface and to the `maude-report/v1` bundle, so the next #133-style report says which side holds what.
- **Validate**: unit test on the status payload

### Task 9: OPERATOR — stranded comments on design.studyfi.com

- **Done 2026-09-29 (v1.4.5 rollout):** design.studyfi.com reports `browserPaired: true` and parity 144/144.
- **Remaining**: comments written on the web *before* pairing may still sit only in the cell's `_comments/`. After Tasks 6–8 ship, read the new diagnostic on that project. If local-only ids show up, re-propose them with the Task 7 cold-start path (restart the cell), not by hand.
- **Gotcha**: This touches production the owner operates. It needs the owner's explicit go-ahead in chat and must not be automated.
- **Validate**: the diagnostic reports 0 local-only comment ids for the StudyFi project; the #133 reporter sees the missing comments on the desktop

### M3: Large boards stay smooth in WebKit, with or without a peer (#131)

### Task 10: ADD a WebKit peer mode to the perf harness and a failing layout-read test

✅ Task 10 (test part) — completed 2026-09-29: `test/presence-render-budget.test.tsx`. A peer's cursor move causes 0 layout reads in `PeerSelection` / `PeerAnnotationSelection` (30 moves re-measured 30× on `main`); a camera change or a selection change still re-measures; the `touchesForeignClient` predicate is covered. **Deviation:** not ported into `perf.sh --peer`; the Safari harness `notes/.../v1.4.5-reverify/exp4-safari.mjs` was used directly against the source server.

- **Do**: Port `notes/multiplayer-parity-harness/v1.4.5-reverify/exp4-safari.mjs` + `exp4-matrix*.sh` into `perf.sh --engine safari --peer idle|move|move-select` (the peer is a headless Chromium; the observer is real Safari via safaridriver, already enabled on this machine). Report frames over 50 ms, p99, max and `getBoundingClientRect` counts, delta'd against history like the other lanes. Always run the "second browser, not connected" control. (The fixture annotation-slug mismatch in `perf-canvas.mjs` is fixed by annotations v2 Task 3; do not duplicate it here.) In `presence-render-budget.test.tsx`, drive a fake awareness and assert that a foreign selection causes at most one layout-read pass per frame, and zero reads when only a cursor moves.
- **Gotcha**: On a single local server, two browsers share `_active.json`, so B's selection leaks into A's own selection. The harness must clear A's selection and record it (see `sel-probe.mjs`). Safari's rAF cadence flips between ~14 ms and 28/42 ms from run to run even with no peer, so gate on frames over 50 ms and on max, not p50/p95. Perf timings are not a CI gate (CLAUDE.md, `perf.sh`). Only the unit test gates.
- **Validate**: layout-read test RED on `main`

### Task 11: RCA H3 — slow pan on large boards in WebKit (no peer)

⏳ Task 11 — open. New evidence from the Task 12 measurement: on the heavy board in Safari, a peer **with a selection** (C3) still produces isolated 2–2.7 s stalls after the fix, **even with zero layout reads** (halo refresh disabled). C0 and C2 have none. So the remaining #131 cost is not the halo: look at what a peer's selection triggers elsewhere (the canvas shell's reaction to awareness selection, the single-server shared `_active.json` confound, editing-presence), together with the pan cost. Machine load was 14–26 during these runs, so repeat on a quiet machine.

- **Do**: Run `/flow:bug-rca` on this: "panning a 160-artboard + 400-sticky board at fit-all runs at ~1 s per frame in Safari 26.5 (p50 928 ms), and 48 boards at the stored viewport at ~0.5 s per frame; Chromium on the same fixtures holds 60 fps". Profile with Safari Web Inspector timelines (layout, paint, compositing, style recalc) on the fixtures from `exp2-make-fixture*.mjs`. Check the existing pan path: per-frame React commits in `canvas-shell.tsx` (C0 showed ~340 overlay commits / 10 s during a pan), the annotation layer's SVG size at fit-all, `will-change` / compositing layers per artboard, and whether WebKit re-rasterizes each artboard per camera change. Compare against the #94 scroll fix and DDR decisions on canvas camera (`kg search "canvas camera pan performance"`). **Check the overlap with annotations v2 first**: today the whole board is one sanitized SVG string, and at 400 stickies that layer alone may be the WebKit paint cost. Measure the heavy fixture with and without its annotations. If the cost is in the annotation layer, the fix belongs to annotations v2 (record the numbers there as its gate) rather than here. The RCA decides the fix; do not guess it in this plan.
- **Gotcha**: This is the most likely real cause of #131: the reporter was on the native mac app (WKWebView), on a large board. A peer joining may be what made the user start panning or looking, and it adds H2 hitches on top. Measure in WebKit only.
- **Validate**: an RCA document with a measured cause, and a fix task appended to this plan (Task 11b) with a gate: pan at fit-all on the heavy fixture has p95 ≤ 50 ms in Safari, or the RCA explains the floor

### Task 12: FIX H2 — layout reads out of render (H1 cleanup included)

✅ Task 12 — completed 2026-09-29, **simpler than planned**: no rAF measurement scheduler. `Cursor`, `PeerSelection` and `PeerAnnotationSelection` get field-wise `memo` comparators, so a peer's cursor move re-renders neither halo. An explicit `tick` prop (annotation changes + a 500 ms refresh only while a peer has a selection) replaces the implicit 30 Hz re-measure. `useForeignAwareness` ignores changes that touch only the local client (`touchesForeignClient`). Safari, heavy board, fit-all, source server, 3×10 s: C3 layout reads 385–441 → 20–23 per 10 s; C3 p99 was 65 ms at baseline and 16 ms in 2 of 3 runs (224 ms in the run with a 2.2 s stall); C0/C2 unchanged (p99 15–16, 0 frames over 50 ms). Isolated multi-second stalls remain in C3 and are not caused by the halo (see Task 11).

- **Do**: `PeerSelection` / `PeerAnnotationSelection` stop calling `querySelector` / `getBoundingClientRect` in render. One rAF-batched measurement pass per frame (a `useLayoutEffect`-driven scheduler in `cursors-overlay.tsx`) resolves all peer halos at once, only when the viewport tick, a peer's selection, or the canvas DOM (existing HMR signal) changed. The results are cached. Keep the published-`bounds` fallback and the `viewport` memo-invalidation contract described in the existing comments (halo must follow pan and zoom).
- **H1 cleanup, same change, small**: in `useForeignAwareness`, return early when only the local `awareness.clientID` changed, and keep the previous peer object when its sanitized fields are equal, so `memo` can hold. Measurements showed no frame cost from H1, so do not refactor `ParticipantsChrome` or anything beyond this.
- **Validate**: Task 10 unit test green; `bun test test/peer-selection-follows-camera.test.tsx test/use-collab.test.ts test/participants-chrome.test.ts test/canvas-cursors.test.ts test/collab-awareness-bridge.test.ts`; `perf.sh --engine safari --peer move-select` on the heavy fixture: frames over 50 ms and max match the no-peer control, where they were p99 65 ms, max up to 1.35 s

### Task 13: VERIFY in the real app (WKWebView)

- **Do**: After Tasks 11b and 12, run the heavy fixture in two real Maude.app instances, on **two machines** if possible, or with the desktop E2E harness and a second peer. Measure pan at fit-all and a peer moving with a selection.
  - **Gate:** the Task 11 pan gate holds in the app, and a peer with a selection adds no frames over 50 ms compared with the app alone.
  - **If it does not:** attach the Web Inspector profile to #131 and keep it open. Do not close #131 on Chromium numbers.
- **Validate**: numbers recorded in this plan's close-out; the reporter (installId `i-3d7cc4110888`) re-checks on the "Team Structure" board

### M4: Close-out

### Task 14: What's New, docs, issues

- **Do**: Pending What's New entry via the `whats-new-entry` skill: comments on stickies, comments never vanish, and presence is lighter. Update the comments docs page under `site/content/docs/` if it describes floating comments. Run `/flow:validate`, then the security pair on the new peer-supplied fields (`annotationId`, `world`) and the outbox retry bound. Close #131/#133/#134/#136 from the final commit with evidence links. For #131, close only if the Task 13 gate passed.

---

## Validation

1. **Format / Lint**: `pnpm format` · `pnpm lint`
2. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
3. **Tests**: `pnpm test && cd apps/studio && bun test test/sync-*.test.ts --timeout 20000`, plus every new test file above, run alone
4. **Build**: `pnpm --filter @maude/site build`; if `client/*` changed, rebuild `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` and commit `dist/client.bundle.js` + `dist/styles.css`
5. **Desktop E2E**: the new L11 rows plus L19 presence, `pnpm test:e2e:desktop:build && pnpm test:e2e:desktop`, in both directions (memory `maude-sync-test-both-directions`: web → desktop and desktop → web)
6. **Perf**: `apps/studio/bin/perf.sh --engine safari --peer move-select` and the pan-at-fit-all run on the heavy fixture, before/after (informational), plus Task 13 on WKWebView
7. **A11y**: `a11y-auditor` on the detached pin + panel state
8. **Manual**: StudyFi project after Task 9: comments written on the web appear on the desktop; a comment on a sticky survives a desktop relaunch

## Scenario Coverage

| Scenario | Covers | Status |
| --- | --- | --- |
| L11 comments (`surface.e2e.ts`) | element comments across peers | ✅ existing |
| L11b comment on sticky / empty canvas / deleted target | #134, #136 | 🆕 |
| L11c web comment while desktop closed + remote delete, then relaunch (accepted + legacy, both directions) | #133(a), (a′) | 🆕 |
| L19 presence | presence survives reconnect | ✅ existing, extended with a render-budget probe |

## Acceptance Criteria

- [ ] No code path deletes a comment without a user gesture; comments on stickies, drawings and empty canvas persist and follow their anchor
- [ ] A desktop relaunched after a remote delete keeps receiving new comments, and in legacy mode the deleted comment stays deleted (L11c green)
- [ ] A comment written before the sync runtime is ready, or after a conflict rejection, reaches the accepted state or surfaces a visible error
- [ ] H3 root-caused and fixed to the Task 11 gate; peer-selection layout-read unit gate met; WKWebView gate from Task 13 met, or #131 stays open with a profile attached
- [ ] Every new regression test was seen RED before its fix
- [ ] `/flow:validate` passes; security review of the new peer-supplied fields has no blockers
- [ ] What's New entry pending; issues closed with evidence

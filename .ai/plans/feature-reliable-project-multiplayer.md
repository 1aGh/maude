---
name: feature-reliable-project-multiplayer
status: in-progress
created: 2026-09-13
decisions:
  - Complete the designer workflow on both self-hosted and Cloudflare hubs; containment fixes and prototypes are milestones, not a scope cut.
  - Separate working candidates from server-accepted project revisions; every persistent writer must pass the same transaction boundary before publication.
  - Preserve local files, offline work, arbitrary TSX source fidelity, and existing file-ledger investment.
  - Freeze persistence and source-validation runtime only after bounded two-backend experiments with explicit failure oracles.
  - History follows accepted logical actions; personal undo is a conditional compensating action.
  - Migrate behind a persistent project epoch and retire old write paths; never run two writable authorities.
---

# Feature: Reliable project multiplayer

Designers accept an invitation, open a project in Maude, and immediately work together across browser and desktop. Changes save durably, large media loads progressively, and personal undo preserves teammates' work.

Validate current docs and code patterns before implementing. Recheck Git history and the working tree before treating any task as unimplemented. This plan spans packages and therefore belongs in the root `.ai/plans/` directory.

## Description

Implement the complete product contract requested on 2026-09-13: cloud and self-hosted invitations, project-first desktop entry, live bidirectional browser/desktop/local-editor/AI collaboration, uninterrupted local/offline work, automatic logical history, and safe personal undo/redo. Start by containing the reproducible data-loss paths, then introduce one accepted-revision contract and finish all user-facing and operational paths above it.

This is a **planned implementation**, not a report that the system is already reliable. No implementation, deployment, production migration, or new paid infrastructure was performed while writing it. Deployment tasks are included so the plan does not confuse a merged protocol with a working product; they produce reviewable rollout artifacts before changing real projects.

## User Story

As a designer who knows nothing about Git or synchronization infrastructure, I want an invitation to give me an editable project in the desktop app, with changes immediately visible to my teammates, so I can focus on design, return to history, and undo my own actions without checking whether synchronization worked.

As a collaborator using local files or an AI agent, I want my edits to enter the same project history without overwriting changes made elsewhere, including after an offline session or application restart.

## Problem

The [audit](../../docs/audits/2026-09-13-hub-sync/README.md) reproduced stale whole-file imports removing unrelated remote edits, the hub committing invalid source through a different validation path, misleading `synced` summaries, and omission of oversized files. CSS/attribute undo drops its expected-current-value precondition. Passing transport tests do not establish preservation of author intent or persistence after loss of a renderer disk.

The existing hub `afterStoreDocument` hook runs **after** Yjs state has changed. Guarding that hook alone protects a checkout, not the accepted document or every connected renderer. A later valid-looking Yjs update may depend on an earlier rejected update. Introducing a new transaction endpoint beside writable Hocuspocus documents would preserve the central defect.

Deployments also differ: the audit observed StudyFi 1.0.9 with identity off and no configured shared-doc loopback, versus Alligators 1.2.0 with cloud live pairing limited to that tenant. These are dated observations, not immutable prerequisites. Re-inventory before rollout.

## Solution

### Product scope and boundaries

**Full scope:** both deployment families, browser studio, native desktop, local edits/AI, all currently supported persistent editing categories, invitation/membership/renewal, managed local copies, media, history, undo/redo, migration and release evidence. Use isolated projects as pilots before wider migration; do not stop the feature at a pilot.

**Preserve:** arbitrary TSX bytes outside deliberately changed spans; local-only projects and advanced folder attach; user-owned repositories; local trust anchors; existing tenant isolation; durable recovery copies; path/runtime-state classifiers; ledger/CAS/tombstone/backoff work; Git as source export/history integration.

**User amendment, 2026-09-13 — protect the working product:** the user currently finds sync usable and does not want the redesign to make it worse. A comprehensive **local, real-process UI E2E baseline is a prerequisite to changing sync behavior**, and the same suite is a regression gate throughout implementation. It must exercise every persistent editing surface and verify the receiving UI/render/media, not only API success or disk arrival. The authoritative operation matrix, measurement procedure and pass/fail rules are in [local-e2e.md](../scenarios/reliable-project-multiplayer/local-e2e.md). Existing successful workflows must remain successful and have no reproducible material latency degradation. A safer architecture is not permission to make routine editing slower, conflict-prone or dependent on manual resync.

**Outside this feature:** a universal TSX-to-scene-graph converter, a new mobile native app, a new vector drawing engine, replacing billing, global active-active editing across regions, and shared editing of incomplete unpublished code drafts. This feature must still let each author keep and repair such a draft locally.

### Accepted revision contract

```text
browser / desktop optimistic work / external edit / AI action
                           |
                   candidate proposal
                           v
       authenticate + epoch check + base/dependency checks
            + source validation + complete blob references
                           |
                    durable transaction
           (head + log + idempotency result atomically)
                           |
                   ACK + revision event
                    /               \
       accepted client replica    one checkout projector
              |                     |             |
        local overlay          renderer       Git export
```

Define these terms in T6 and keep them distinct in API and UI:

- **Working candidate:** locally preserved work which may be incomplete, invalid or based on an older revision. It is never silently discarded.
- **Accepted revision:** ordered project action committed by the project coordinator. This is the serving authority for persistent content.
- **Durable ACK:** evidence that the accepted action and every referenced payload can be reconstructed after the documented failure model. It is not Hocuspocus `synced`, a socket event, or a debounced backup timer.
- **Last successful render:** execution result for a particular accepted revision. Syntax acceptance does not guarantee runtime success. A new runtime failure must retain access to the prior working render and the failed revision.
- **Preview/presence:** ephemeral, bounded and non-authoritative. It may show motion before final commit but may never manufacture a saved revision.

The transaction envelope includes protocol version, project ID, persistent write epoch, document generation, actor/device/session origin, transaction ID, payload hash, base revision, dependency/read-write sets, parent pending IDs, action type, and preconditions. Derive identity and capabilities on the server. Do not trust an actor, role, landing path or trust setting supplied by a client.

Same ID + same payload returns the original result; same ID + different payload is rejected. A dropped ACK cannot create a second action. Validate rights again when a queued action is accepted. Define a bounded idempotency retention policy covering supported offline replay; after that horizon, retain the candidate and request explicit resync instead of pretending an old action is new.

### Candidate and accepted Yjs state

Chosen planning direction: clients cannot directly mutate published project Y.Doc state. Proposals travel through an explicit transaction path; only the server replayer writes accepted documents. Existing Yjs/Hocuspocus may distribute accepted state and presence. The local optimistic overlay is separate from that replica.

T7 proves this boundary with the installed Hocuspocus/Yjs versions and the actual browser client. It must reject raw `Update` and `SyncStep2` messages from writers as well as readers while retaining permitted awareness. Do not rely on `afterStoreDocument` rejection or attempt to reverse already-broadcast CRDT updates.

If pending action U2 depends on rejected U1, pause/rebase the dependency chain against a fresh accepted generation. Do not replay raw U2 bytes assuming they are independent. Preserve original candidate bytes and undo context until resolution succeeds.

### Durable storage decision gate

T8 is a bounded engineering experiment with concrete outputs, not a placeholder to “choose a database later.” Implement the same tiny append/read/replay contract against candidate backends and select **one cloud adapter and one self-host adapter** before T9–T12 proceed.

Start with Cloudflare SQLite-backed DO coordination plus immutable R2 payloads, and self-host persistent SQLite with a verified object-storage journal/conditional durable head using the existing S3 integration. These are **candidates**, not assumed guarantees. If the self-host candidate cannot atomically establish a fenced, replayable head without ambiguous acknowledgment, evaluate a transactional PostgreSQL metadata adapter; document its operational/dependency cost. Do not turn periodic SQLite backup into a durable commit claim. If source validation cannot run safely in a Worker, compare a portable validator with a dedicated validation service independent of renderer restore; never trust client-only validation.

Required T8 outputs: executable adapter probes; validated acceptance/validation runtime; failure-model table; atomic commit sequence; split-brain proof; measured payload/snapshot bounds and ACK cost/latency; compaction/retention design; chosen dependency versions; migration/runbook requirements; graph-recorded implementation decision. Maximum two candidates per backend before revising the design with evidence. A failed gate blocks dependent production integration, not the independent P0 fixes.

Failure contract: accepted actions survive process restarts and replacement of renderer/checkout disks, with **RPO 0 for acknowledged actions under those failures**. Disaster loss of the canonical storage system has separately stated RPO/RTO and restore evidence. Do not claim one proves the other.

### All-writer coverage

T6 expands this inventory to exact mutating functions/routes and attaches a conformance assertion to each row. No “remaining writers” catch-all task is acceptable.

| Persistent input | Existing integration surface | Target owner |
|---|---|---|
| Browser/desktop Yjs updates and cell loopback | `apps/hub/src/server.mjs`, `apps/studio/sync/index.ts`, `apps/studio/collab/` | T12/T13: proposal channel; accepted stream read-only |
| CSS, attributes, text edits | `apps/studio/api.ts`, `commands/edit-source-command.ts`, `client/app.jsx` | T15/T24 |
| External editor saves and atomic renames | `sync/projection.ts`, `sync/fs-mirror.ts`, `sync/echo-guard.ts` | T15: candidate import with proven base or explicit conflict |
| AI source and multi-file edits | `apps/studio/api.ts`, `apps/studio/acp/`, design CLI helpers | T16: begin/propose/commit action boundary |
| Canvas create, duplicate, rename, move, delete | Studio API + hub document deletion/path/tombstone handlers | T17: project transaction, generation retirement |
| Meta/layout and artboard positioning | `canvas-lib.tsx`, codec/meta paths, studio API | T17/T25: persistent properties only; camera remains local |
| Comments and annotations | `sync/codec.ts`, `canvas-lib.tsx`, studio collab/annotation paths | T17: transaction adapters; presence remains ephemeral |
| Photo and timeline actions | Existing `client/app.jsx` bridges and their API handlers | T17/T26: grouped operation adapters, no second history |
| Styles, design-system code/dependencies and eligible support files | `sync/file-plane.ts`, hub `file-door.mjs`, membership classifiers | T18/T20: manifest + role/trust policy |
| Assets/media upload and replacement | `sync/asset-push.ts`, file plane, hub `asset-lane.mjs`/file door | T18: durable blob then accepted reference |
| Workspace projection/autocommit/import walks | `workspace-agent.mjs`, `workspace-files.mjs`, `journal.mjs` | T14: one projector; old writes fenced |
| History restore, resync repair, legacy fallbacks | `history.ts`, hub `history.mjs`, sync migrations/runtime | T27/T28/T30: explicit new action or read-only repair |

### Source fidelity and operation policy

Use the existing source-editing vocabulary first: stable `data-cd-id`, text/CSS/attribute changes, structural edits and established meta/comment/annotation operations. T23 enumerates supported syntax before implementation; no regex-based universal JSX reconstruction.

For valid independent operations preserve both authors' effects. For the same property, the initial planning policy is deterministic server acceptance order with authorship in history; deletes, missing targets and invalidated dependencies reject/require rebase rather than inventing intent. **Undo always has stronger expected-current preconditions** and cannot erase a later peer assignment even if it restores equal-looking text. Track effect/operation identity, not just string equality, to avoid ABA errors.

Instrumented local edits and AI supply exact base tokens. A watcher cannot know the base of an arbitrary editor's stale in-memory buffer merely from the latest projected disk hash. A base-unknown edit is preserved and surfaced as a candidate; never silently converted into a replacement of the accepted document. For safe unambiguous ordinary saves, use a documented merge rule and prove it with independent-edit tests.

## Metadata

- **Type:** Bug Fix + Refactor + Enhancement
- **Complexity:** High; staged cross-package implementation with data/migration risk
- **Ticket:** GitHub tracker configured; no umbrella issue assigned or created in this planning pass
- **Packages:** `apps/studio`, `apps/hub`, `apps/cells`, `apps/cloud`, `apps/desktop`, `cli`; release/scenario tooling and documentation
- **Planning baseline:** audit source `d50954df`; planning checkout advanced concurrently to `a0193828`, with latest sync commit still `01bdcfdc`; audit on 2026-09-13
- **Package managers:** root pnpm 11 (`pnpm-lock.yaml`); studio independently uses Bun (`apps/studio/bun.lock`); native Rust/Cargo
- **Loaded expertise:** `flow:skill-loader`, `flow:kgai-backend`, `flow:debate-protocol`, `durable-objects`; official Yjs/Hocuspocus/Tauri docs fallback
- **Dependencies:** current Hocuspocus 4.3/Yjs 13.6, OXC source validation, SQLite, R2/S3, Tauri 2. New runtime dependencies require T8 evidence and packaging validation; no speculative installation during planning.
- **Scope status:** execution in progress; T2–T5 complete (2026-09-14/15 checkpoint below); T1 real UI baseline partially exercised and preserved; T6 executable draft, T7 socket/browser proof and T8 storage experiments in progress

### Execution checkpoint — 2026-09-14

T1 remains **unchecked and incomplete**, but the environment block is resolved.
After the user enabled full access in Codex desktop, Chromium, ordinary
`pnpm dev:desktop`, and `pnpm test:e2e:desktop:build` succeeded. The shared WDIO
config now uses WebDriver's own Undici dispatcher and canonical native paths.
The multiplayer config keeps cross-origin containment ON; an explicitly opted-in,
debug-only frame probe observes the actual native canvas without disabling TSX sync.

The initial real three-participant run at `2026-09-13T21-14-16.079Z` verified
rendered source changes in all directions and byte/pixel-correct PNG plus MP4
playback and seeking on hub browser, bundled WKWebView, and an independent
sidecar. New-canvas tree arrival took roughly 3–12 seconds in passing observations;
one receiver missed the 15-second deadline. These are individual observations,
not certified latency distributions. The corrected empty-directory assertion
accepts zero-byte `.gitkeep`; the repeated measurement fails all six remote
folder observations. All six open-canvas receivers also failed to follow a
UI-originated move within 15 seconds in `2026-09-14T05-47-40.258Z`; each origin
successfully moved its own canvas. The native screenshot still reports `synced`
on the old path. Dependent deletes were unexercised because their move
preconditions failed. Independent deletes subsequently reproduced all six
receiving failures, confirmed again in clean run `2026-09-14T06-12-31.155Z`.
Earlier annotation observations could read underneath a canvas-load overlay;
the observer now rejects loading/error overlays and unavailable frames. Clean
isolated-canvas run `2026-09-14T06-20-05.872Z` passes sticky create/text/move/
resize/color/delete in every direction, but Undo-delete fails on both receivers
for every author. A separate shared-canvas sequence retains the failed Undo and
reproduces subsequent native/peer delete failures. These profiles cannot replace
each other. UI text editing passes short runs, while the planned 100-actions-per-
author run `2026-09-14T06-28-41.549Z` recorded nine failed actions out of 208
before its whole-scenario time budget aborted the incomplete series.
Failed/missing samples invalidate the affected percentile rather than being
dropped. The control-only watcher profile also misses external saves at the hub
view despite passing UI edits. Other tools/history variants remain unexercised.

The completed follow-up `2026-09-14T06-56-28.401Z` performed all 300 UI text
edits: 223 passed and 77 failed. Fifteen hub edits reverted in all three final
TSX snapshots; from sample 70 onward the hub view also missed every native/peer
edit despite current source on disk. Bun parsed 1,239 TSX files/snapshots with
zero syntax errors; 45 of 900 final comparisons mismatched. This establishes
lost edits and stale rendering, not malformed TSX or a certified timing baseline.
Real PNG intake and reference deletion now pass every direction, and a viewer
fixture session verifies read-only controls. Photo brightness passes; native
reset reverted. Square/rounded-square create/move/resize pass all directions;
rounded deletion reaches remote disk while all six remote views retain the
shape. Empty-folder deletion fails both remote UI and disk in all directions.
Pen/highlighter/arrow and text/section basic lifecycle actions now pass, while
eraser undo reproduces the stale-view failure. A content-history echo guard
identifies repeated SVG bytes as duplicate actions, explaining repeated deletion
and undo failures. Cold video intake also records a media request before local
bytes arrive; explicit playback and recovery are measured separately from the
visible reference. The full evidence and harness-error qualifications are in
the execution report.

An independent UI defect is reproduced on all three participants: clicking an
already active canvas resets the shell load state without reloading the iframe,
then blocks the rendered canvas with a server-error overlay after 15 seconds.
The baseline records this as L05; T22 must cover its correction. Test preparation
now opens a canvas only when needed; it does not refresh a failed receiving edit.

- Run: `bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline`.
  Exit 2 means **partial/incomplete**, not a passing full baseline. No `baseline.json`
  is emitted until the full matrix, provenance and measurement gates are satisfied.
- Clean expanded evidence: `.ai/device/scenario-runs/reliable-project-multiplayer/2026-09-14T06-12-31.155Z/`
  (`surface-results.json`, native/screenshots, source/bundle/fixture manifests).
  PNG/MP4 evidence remains in `2026-09-13T21-14-16.079Z`.
- Detailed history: [T1 execution report](../scenarios/reliable-project-multiplayer/execution-2026-09-13.md).
- Remaining T1 work: all operation variants and directions, full owner/designer/viewer
  matrix, remaining media formats and controls, history, concurrency/offline/failure recovery,
  standalone-hub and complete control-only profiles, exhaustive source/bundle/fixture provenance,
  measured observer overhead, three warm timing passes and the 30-minute soak.
  T2 has started under the dated execution amendment below. T6's contract draft
  has started as the independent M1 preparation allowed below; it remains incomplete.
  At that checkpoint T3–T5 and T7–T35 had not started; the newer architecture checkpoint below supersedes that progress snapshot.
  Its first candidate rejects unchanged body notifications after an echo expires
  or is consumed; 38 focused tests, studio typecheck and native build pass.
  Candidate `2026-09-14T08-15-27.812Z` passes 59/60 UI text actions and all six
  external/atomic-save actions; one hub edit still rolls back on all three peers.
  The first hub guard also failed. Hash-only tracing in `08-32-37.391Z` proves
  six hub writes replacing each next local edit with the preceding peer edit:
  the hub's last stored body was older still. The current guard checks the last
  body observed/materialized by that writer against actual disk before writing.
  Both real-Git regression variants and all 923 hub tests pass. The temporary
  tracing was removed; no new runtime dependency was introduced.
  Candidate `08-50-27.936Z` passes all 60 UI text actions and six external/atomic
  saves; all 360 TSX parse checks and final source comparisons pass. The 300-edit
  candidate `08-53-38.316Z` passes all 300 edits; 1,311 source parses and final comparisons are clean. These guards do not yet prove
  restart-safe conflict lifetime, arbitrary stale-buffer handling or atomic
  multi-process projection. T6 is drafted in `docs/architecture/project-transactions.md`.
  Annotation echo identity containment is now implemented across UI/API/registry
  and filesystem imports (T26/T28 compatibility subpart). 153 focused tests,
  studio typecheck and native build pass. The first native run `09-19-58.469Z`
  fails during bootstrap (`/_index-data` 502), before annotation actions. Retry
  `09-25-47.937Z` passes all 18 shape deletes and 12 undo/redo checks but retains
  two annotation rollbacks and native photo reset (179 pass, 3 fail). A separate
  stale-projection re-publication race now has three red-to-green tests and a
  dedicated freshness-checked disk sink. The wider 401-test suite (including all
  API cases) and typecheck pass. Native candidate `09-42-15.543Z` completes with
  217 pass, 1 fail, 3 unsupported and 70 not-run: all executed annotation and
  text rows pass; native `.photo.json` reset still reverts. All 240 TSX parse
  checks/final expected-text comparisons pass. Diagnostic photo run `09-57-41.648Z`
  reproduces native reset rollback and traces it to reset-click before field blur:
  `PhotoKnobs` cloned stale state before React rendered. Its mutation ref now
  advances synchronously; both event-order regressions and all 47 photo tests
  pass, along with typecheck and rebuilt client/native artifacts. Candidate
  `10-01-50.780Z` completed the affected annotation/text/photo matrix:
  218 pass, 0 fail, 3 unsupported, 70 not-run, including all three photo-reset
  directions and final disk/render checks. Peer photo reset delays of 0.93–3.59s
  still miss the final performance goal. Cold video/audio arrival recovery now
  has eight DOM regression cases (four observed red before the change), with
  44 scoped tests passing. Media candidate `10-13-40.303Z` completes 29 pass,
  0 fail, 235 not-run: all nine uploaded-video play/seek observations pass,
  including receivers with captured initial MP4 404s. Seeded video and photo
  rows also pass. Audio decode/large media/performance remain open. The next
  small UX repair prevents a repeated active-canvas click from entering an
  impossible loading state. Client/native builds and typecheck pass. Candidate
  `10-17-57.376Z` completes 32 pass, 0 fail, 232 not-run: all three re-click
  cases pass beyond 17 seconds, along with repeated photo/video regressions.
  Index fetch now automatically retries transient errors and serializes refreshes.
  Seven lifecycle tests, typecheck and client/native builds pass. Deterministic
  502 fixture failed startup before the fix (`10-22-27.070Z`); candidate
  `10-27-24.891Z` completes 43 pass, 0 fail, 223 not-run, including both browser
  recovery cases, text/media/navigation rows and 132 clean source parses with
  nine matching final texts. Structural candidate `10-30-34.935Z` completes
  6 pass, 20 fail, 3 unsupported, 235 not-run: empty folders do not propagate,
  two create directions exceed 15s, remote open views fail move/delete checks.
  All three subsequent created-canvas render cases pass; logs confirm actual
  remote retirement/quarantine, so next trace structural delivery versus active
  view updates. T6 draft now records exact folder/retirement/deletion seams.
  First-class manifest directories, acknowledged moves/deletes, full coverage
  and the rest of the plan remain required.
  Full operation coverage and accepted-revision architecture remain open.
  No milestone is complete.

### Architecture integration checkpoint — 2026-09-14

- Metadata-only discovery is now wired through both ordinary and cell-owned
  control providers. The last frozen native run `2026-09-14T11-12-06.584Z`
  completes **32 pass / 0 fail / 232 not-run**, including all selected canvas
  create/move/delete, UI text and uploaded-photo/reset rows. Source audit:
  123 parses, zero errors, nine exact matches. Dedicated move/delete fixtures
  remove unrelated folder setup dependencies; empty directories are still open.
  Delete observations are below 637 ms in this run, but create/move and some
  text render observations still take seconds. Full latency acceptance is open.
- T6 now has a 93-row concrete writer registry and executable strict schemas:
  125 tests, 25 named operation families, 69 representative variants, 146 valid
  and 24 invalid corpus records, 11 checked writer bindings. Remaining variants,
  permission/effect/inverse mappings and full registry conformance stay open.
  `.footage.json`/`.edl.json` exclusion in current file membership is recorded as
  a product surface gap; these schemas do not migrate that path.
- T7 has four passing real socket/process cases plus an actual Chromium SDK +
  IndexedDB U1/U2/rebase/unsaved-storage case. Accepted/private state separation
  and exact retained candidates work in the fixture. Full production/native
  outbox and accepted gateway integration remain required.
- T8 has **13 passing self-host SQLite** and **3 passing local workerd/DO**
  storage tests, including actual process death after commit/before ACK and
  reconstruction from storage outside the renderer checkout. These are local
  primitives, not chosen adapters or real AWS/R2/S3 durability evidence.
- Detailed source paths, test commands, bounds and remaining gates are in
  `notes/reliable-project-multiplayer-spikes.md`. No T1–T35 checkbox is complete.
  Next architecture work: validation-runtime choice and one shared two-backend
  failure corpus, then actual persistence/staging evidence before T9–T12.

### Storage conformance checkpoint — 2026-09-14

Shared strict ProposalV1 storage corpus now passes 22 cases across local SQLite
and actual workerd DO storage. Warm production-parser pool passes three cohesive
failure/recovery tests and 17 source cases; an initial cold-process benchmark
504 is retained, while the final separate 50-sample comparison passes unchanged
limits. Optional S3 conditional-write primitives retain 58 passing related tests;
hub build and cold bundle import pass. AWS read-only inspection confirms v1.2.0
image tags and local Docker data/repo volumes; Cloudflare still gates live pairing
to Alligators. See [spike evidence](notes/reliable-project-multiplayer-spikes.md)
for paths, measurements, failed attempts and scope limits. T8 is still open:
object-store journal/head, real staging, blobs, snapshots, isolated validator and
adapter selection remain prerequisites to T9–T12. All T1–T35 checkboxes stay open.

### Real S3 journal checkpoint — 2026-09-14

The object-journal candidate now passes 11 local HTTP/process cases and three
actual AWS S3 cases: two-process conditional head race, live stale-owner fencing,
and SIGKILL after real S3 commit before ACK with fresh-owner replay. The isolated
prefix was cleaned by exact version ID: 16 deleted, zero remaining. Shared
SQLite/workerd conformance remains 22/0 after extracting its fixture policy.
See [candidate report](../../scripts/dev/sync-e2e/durable-store-spike/object-journal/README.md)
and [spike evidence](notes/reliable-project-multiplayer-spikes.md). This is a
small real S3 proof, not production adapter selection: full-chain O(N) reads,
snapshots/compaction, cached indexes, blob readiness, DO/R2, isolation and measured
latency/cost remain T8 gates. No product sync switch or deployment occurred.

### Indexed snapshot checkpoint — 2026-09-14

The object-store candidate now passes 9 local snapshot cases and 7 actual S3
checks with bounded state/receipt reads and complete retained test history.
Normal journal regression remains 11/0. All 53 new test object versions were
removed, with zero left under its isolated prefix. See
[snapshot evidence](../../scripts/dev/sync-e2e/durable-store-spike/object-journal/SNAPSHOTS.md).
Cold state uses 2 GETs and historical receipt 3; warmed appends use 1 GET + 2 PUTs.
Observed development-host append samples are 321–445 ms before peer rendering,
so final latency is not established. T8 remains open for full blob-backed state,
actual DO/R2, AWS-local performance, retention/compaction and validation isolation.
This adds a bounded experimental snapshot/index, not a production sync switch.

**Concurrent plan boundary:** `.ai/plans/feature-share-link-deeplink.md` was created in the shared tree during this planning pass. It owns file share URLs, `?open=` navigation/return-to and file-target deep-link parsing. This plan owns invitation/project membership, managed local copies and accepted state. T21/T22 must reuse or extend its project resolver and link parser when present, not create a second competing resolver or change its URL contract incidentally. Neither plan blocks M0/M1; coordinate the shared native open/auth seams before their UI integration.

### Regional and paged-document checkpoint — 2026-09-14

AWS-local prototype ACK medians are 91.38/98.93 ms for 1/64 KiB (20 samples
per size, earlier inline snapshot format); this is not peer-render SLO proof.
Current paged document snapshots remove the demonstrated whole-project 1-MiB
cap: 160 documents / 10 MiB restore progressively, with two metadata GETs and
two additional GETs for a selected document. Final local journal/snapshot/document
suite: 23 pass; standalone bundle: one pass; final actual S3 suite: eight cases
pass, all 148 created versions removed. Source bytes/code units and old receipts
survive recovery; production UI was not changed in this block. See the latest
execution report and `object-journal/{REGIONAL,DOCUMENTS}.md` for exact evidence.
T8 still requires actual DO/R2, validation isolation, retention/compaction and
final adapter selection. All T1–T35 checkboxes remain open.

### Cloud DO/R2 checkpoint — 2026-09-14

Fifteen local workerd/DO/R2 tests pass, including six SIGKILL boundaries,
146 valid / 24 invalid in-Worker contract fixtures, and cold paged restoration
of 80 documents / 5 MiB. An isolated actual Cloudflare Worker/R2 run passed
correctness and exact retry/fencing checks. All 64 objects, diagnostic Worker,
bucket and DO namespace were removed and absence verified.
The current R2-first hot path **fails performance**: coordinator medians 337/444 ms
for 1/64 KiB, excluding peer rendering. Next revise this same candidate to commit
small operations/payloads in DO SQLite and move R2 archive work off the live ACK
path, then repeat fault and actual backend measurement. T8 and all T1–T35 remain
open. Exact evidence and limits are in the execution report and
`durable-store-spike/cloud-r2/README.md`.


### 2026-09-14 — DO SQL hot path passes actual remote correctness and storage latency probe

The existing Cloudflare candidate now atomically stores exact proposal/source
bytes, payload usage, action, head, document reference and dedup result in DO
SQLite before acknowledging. Append/current-source reads do not call R2;
snapshots archive source to immutable R2 objects. This changes the same candidate,
not the product sync or its deployment. Local workerd tests: 17 pass, 0 fail,
0 skip (27.02 s), including four SQL rollback boundaries, six append/snapshot
SIGKILL boundaries, no-R2 acceptance/restart, archive corruption, 80-document
cold reconstruction and bounded inline-capacity refusal without partial state.
Evidence: `/tmp/maude-cloud-inline-proof/evidence.json` and matching `.log`.

The first actual run failed before samples with a JSON parse error. Its original
HTTP status was not captured, so its cause remains unproved. The runner now
records HTTP status/content type and bounded redacted response detail before
JSON decoding. Explicit `--resume-empty` preserves the failed evidence, reuses
the private diagnostic token and requires all three projects to have epoch 1,
revision 0, zero actions/results/documents and zero payload bytes before writes.
All three readiness assertions passed; no unknown accepted writes were replayed.

Actual run 14:01:22–14:01:39 UTC passed: twenty first submissions each at 1 KiB
and 64 KiB, snapshot restoration, exact receipt retry, ID reuse rejection,
membership/epoch fencing, one accepted concurrent base claimant and three SQL
rollback injections. Coordinator median/sample p95: 49/58 ms (1 KiB), 42/62 ms
(64 KiB). Client ACK median/sample p95: 91.40/132.21 ms and 96.21/152.41 ms.
The prior R2-first coordinator medians were 337/444 ms. This is a promising
storage result, not a controlled speedup estimate: the observed edge changed
from FRA to PRG, DO location is unknown, and each size has only 20 observations.
Timing excludes OXC validation, accepted publication and peer UI rendering;
no native latency SLO or managed host crash guarantee is proved by this run.

Tested/deployed bundle SHA-256:
`66bffa14b1c6ee2ee9a91c7b80dad27bcc9dc3b924cbb0d165feea84a01b7785`.
Fresh isolated Worker/bucket `maude-sync-probe-0115bcc93157` used no product
routes/bindings. All 18 archive objects were deleted (9 + 9 + 0), all projects
drained, then Worker and bucket deleted. Read-only checks confirm Worker 10007,
no matching bucket and no matching DO namespace in the complete four-namespace
list. Private token removed. Evidence, original failure, readiness, measurements
and teardown: `/tmp/maude-cloud-inline-staging/`.

T8 remains open for bounded retention/compaction and archive progress, validation
service isolation, adapter selection and deployable recovery/runbook requirements.
The 32-MiB inline payload guard is not a production retention policy. T7/T8 are
still hard dependencies of T9 production integration; do not bypass them because
this storage probe passes. Full onboarding, all writers/surfaces, history/personal
undo, all local native E2E rows and cloud/self-host staged matrices remain open.
All T1–T35 checkboxes remain open. No commit, push, product migration or release.


### 2026-09-14 — bounded archive retirement and non-starving snapshots

The existing DO/R2 candidate now archives at most 16 payloads / 1 MiB per call.
It loads only selected bodies, verifies SHA-256 before upload and by R2 readback,
then atomically records archive references, removes obsolete inline bodies and
updates usage. Current document hashes remain inline. Retirement rechecks epoch,
membership and drain state; concurrent batches cannot decrement usage twice.
Exact history reads resolve proposal/source hashes from inline or verified archive
storage; original dedup receipts remain SQL-resident and unchanged.

Snapshot publication now accepts its immutable captured revision while newer edits
continue, with a monotonic pointer and epoch/member fences. A captured old source
can be read from the archive after inline retirement. A slower old snapshot cannot
replace a newer completed snapshot. This removes the previous edit-induced
snapshot-raced starvation condition without deleting the log needed to reach head.

Final local actual workerd/SQLite/R2 proof: **26 pass / 0 fail / 0 skip**, 27.91 s.
This retains the strict wire corpus, previous crash/retry/isolation cases and
adds three archive SIGKILL boundaries, transactional rollback, corrupt/missing R2,
24 revisions under an 8192-byte inline budget with exact cold history/receipts,
epoch/member/edit races, overlap accounting, and 20 multibyte documents archived
in four bounded batches with exact history. The first large-batch fixture exceeded
the 65536-character operation limit and was correctly rejected. It was replaced
with valid multibyte text of the same approximate byte size; no limit was relaxed.
That failed evidence remains `/tmp/maude-cloud-archive-final-proof/`.
Passing evidence: `/tmp/maude-cloud-archive-final-proof-v2/` and matching `.log`.
Final bundle SHA-256:
`f46cb539eebf6d93d9ee7e4578315b4f6f9e864975bb0cbddafdd758740b936c`.
Scoped Biome checks had zero errors and seven existing/style suggestions.

This archive revision has not been deployed or remotely measured; do not reuse
the previous bundle's 42–49-ms Cloudflare latency as evidence for this bundle.
No external infrastructure was created this turn. No product source was changed.
The probe still has explicit operator invocation, no durable background scheduler,
and growing action/result/archive metadata. Full metadata compaction, automatic
retry, validation-service isolation and deployment/recovery decisions remain T8
gates. RETENTION.md defines retirement/crash semantics and the requirements for
metadata segments/dedup indexes, GC liveness and separate disaster recovery.
Body archival alone cannot restore the SQL action/dedup index after storage loss.

The full native surface matrix, accepted publication, all writers, personal undo,
history UX, designer onboarding and cloud/self-host staged product tests remain
open. All T1–T35 checkboxes remain open. No commit, push or product deployment.

### 2026-09-14 (evening) — work committed; M0 audit reproductions closed

Continued in Claude Code after the Codex session hit its usage limit. First the
uncommitted pass above was verified (hub 930/930, studio sync+affected 1474/1474,
typecheck, tsc coverage, lint, import coherence) and committed on `main` in
reviewable units (`088c8a32`…`a80a6b98`, not pushed). The pre-tag import-coherence
guard had been red on `main` already (spike `dist/` and repro `node_modules`
imports); it now skips deliberately ignored targets and still fails an
intent-to-add module importing a missing sibling (`0f086aec`).

Re-running `docs/audits/2026-09-13-hub-sync/reproduce.ts` on that commit showed
**all five audit probes still reproducing** — the earlier containment fixed
E2E-observed defects, not the audit's P0 set. Each is now fixed with regression
tests watched red first (fix reverted → named cases fail):

- **T3** (`79aaa24b`) — hub workspace agent runs the studio's own
  `sourceError()`; invalid body + coupled CSS are held (checkout keeps the valid
  body, no commit, other lanes flow). `oxc-parser@0.139.0` registered in
  `apps/hub/bun.lock` and the pnpm importer, external in the hub bundle, copied
  sources in the Dockerfile. Hub 932/932; release bundle cold-imports on Node 22;
  the built image (`node v20.20.2`, arm64) loads the bundle and the linux binding
  rejects invalid TSX. Probe: `overwritten: false`.
- **T5** (`0a3b19e5`) — css/attr routes accept `expected` (atomic under the file
  lock; source already at the target = idempotent success; otherwise 409
  `conflict`). The shell forwards the command's `from`, repaints only after
  acceptance and answers `apply-edit-result`; the canvas sink awaits it, so a
  refused undo/redo keeps its stack entry and toasts. 9 API + 6 wire tests.
  **Open:** no two-user GUI case in the surface runner yet (needs inspector-knob
  driving); ABA/effect identity stays with T28.
- **T4** (`069575a0`, `942beda3`) — files over the 512 MiB ceiling are enumerated
  as present-but-unsyncable and held (`refused`/`too-large`), which also closes
  two reproduced data-loss paths: a synced asset that grew past the ceiling was
  deleted on the hub, and a smaller hub copy overwrote the larger local file.
  `syncPresentation` now reads every `_sync.json` lane: refused source changes,
  failed/blocked/held files and failed uploads → `attention`; moving files/media
  → `syncing`; unreadable lanes fail closed. Probes: `largeEnumerated: true`,
  `phase: attention`.
- **T2** (`a0cb75d9`) — character-level three-way merge from `lastHtml`
  (`sync/source-merge.ts`); overlaps, invalid merged source and over-budget diffs
  are preserved and blocked, the conflict stays until a resolving save. The
  agreed body is saved as a `base` recovery slot, so a restart merges
  (`conflict-merged`) or holds (`conflict-held`, `projection.adoptBase`) instead of
  newest-wins; without a verified base DDR-102 is unchanged. Probe:
  `remoteEditSurvives: true, localEditSurvives: true`, no conflict.

Decisions recorded in kgai: `maude/hub-shares-studio-source-validator`,
`maude/stale-import-three-way-merge`, `maude/truthful-summary-and-oversized-hold`.

**Real local UI lane.** Bundled debug app rebuilt with the current sidecar
(hash-checked against `apps/studio/dist/maude-darwin-arm64`). Full implemented
catalogue `2026-09-14T19-13-20.807Z`: **225 pass / 9 fail / 6 unsupported / 24
not-run** — every failure is the known `L01.empty-folder.{create,move,delete}`
(T17 owns durable directory entries); unsupported are folder rename and text
resize (absent controls); not-run rows are the unimplemented "remaining
variants". L06 external, atomic-rename and UI text saves pass in all directions;
source audit 132 parses / 0 syntax errors, 9/9 final comparisons.

A new two-user GUI case `L18.css-undo.{peer-value-kept,own-value}` (inspector
font-weight → teammate changes the same property → Cmd+Z in the canvas) found a
second T5 defect: the inspector kept its own superseded value (a peer edit does
not re-post the selection), so the next undo recorded a stale `before` and
restored a value nobody had on screen. Writes now return what they replaced
(`previous`, read under the file lock) and every css/attr undo record site uses
it (`7ce8a55e`, `53ac5a1e`). Final `L18` run `2026-09-15T04-52-01.011Z`: 8/0 —
the teammate value stays on all three participants in every direction and the
author is told; an own undo reaches peers in ~1.1–1.3 s. Full re-run
`2026-09-15T04-54-07.663Z`: **231 pass / 9 fail (same L01) / 6 unsupported /
24 not-run**, audit 132/0, 9/9 — no regression.

**Task state:** T2–T5 meet their own Validate lines and are checked. M0 is not
complete: T1 coverage (variants, roles, media formats, offline/concurrency,
timing passes, soak) and the empty-folder gap remain; no latency target is
claimed. Next: M1 — close T8 with an adapter-selection DDR (validator isolation,
retention/compaction decisions), then T9 kernel and T12 fencing.

### 2026-09-15 — accepted revisions implemented end to end; M1 closed, M2 largely closed

Decided in **DDR-241** (kgai `decision:maude/DDR-241`): the acceptance kernel
lives in the hub for both distributions; one store schema (`store-core.mjs`)
in two durable homes — better-sqlite3 WAL + `synchronous=FULL` self-host, and a
per-tenant `ProjectStore` Durable Object in the cloud (its own class, so a
container-class migration can never abandon it), reached by the container at
`http://project-store.internal/`. Commits on `main` (not pushed): `fd57f0e2`
kernel/store/fence, `a64116a6` studio client, `8d0de360` live mode switch +
baseline import, `80ba8df4` cloud store, `55e1a787` surface-run fixes.

What exists now (see `docs/architecture/project-transactions.md` § Implemented
protocol v1): `/api/projects/:id/v1/{bootstrap,proposals,transactions,revisions,
history,blobs,mode}`; `lane.replace` over the five canvas lanes with server
three-way merge from a hash or inline base; `doc.create/move/delete`;
first-class folders (`dir.*`, empty included, folder actions carry their
canvases); effect-aware `history.undo/redo/restore` (ABA-safe); idempotency by
(actor, tx); U1→U2 `dependsOn`; per-message read-only fence on every socket;
mode switch = persist → socket notice → grace → fence → import → reconcile;
baseline import incl. legacy-interval changes; durable studio outbox written
synchronously; cold start per lane; room refusal of browser writes; replica
tripwire; executable `/_api` writer registry.

Evidence:
- hub 940/940 (+ `project-durability.test.mjs`: SIGKILL of the hub process with
  a proposal in flight — every acknowledged revision survives, one action per
  revision, no torn commit); `project-transactions.test.mjs` 8 real-hub cases
  incl. baseline import + rollback boundary (watched red without the fix) and
  `store-not-durable` refusal.
- cells 55/55 incl. `project-store.test.mjs` on local workerd (DO SQLite): the
  kernel scenario set ends identically to the self-host store, SIGKILL of the
  runtime keeps every acknowledged commit, tenants isolated. `wrangler deploy
  --dry-run` bundles both DO bindings and exports `ContainerProxy`/`ProjectStore`
  (106 KiB). No Cloudflare resource created or changed.
- studio 1622 sync/shared-doc/collab tests; `sync-accepted-runtime.test.ts`
  12 real-hub scenarios (two studios, real providers): create, edit (~300 ms
  alice→bob disk), independent merge, overlapping conflict kept + resolved,
  comment, empty folder, move, delete, offline outbox across a hub restart,
  live switch with an edit during it, studio closed across a switch, zero
  replica tripwire hits.
- hub release bundle cold-loads and serves the mode route.
- **Real UI** (bundled debug app + cell + peer, `--save-mode accepted`): first
  run found five real defects (resurrected annotation deletes, A→B→A edits read
  as redeliveries, API-write/peer-revision race, cell double projector, baseline
  path crash) — each fixed with a test that fails without it. Full run
  `2026-09-15T07-24-12.955Z`: **235 pass / 2 fail / 6 unsupported / 27 not-run,
  driver completed** (legacy candidate 231/9); the two failures (probe timeout,
  sticky UI) do not reproduce: L09 alone `2026-09-15T07-36-22.979Z` 170/0.
  L01 empty folders now pass in every direction (was the standing M0 gap).

**Task state:** T6 (contract v1 + executable registry), T7 (raw Yjs fence,
dependency replay, zero rejected bytes published), T8/T9/T10/T11 (adapters
selected and proved locally; real backends run under T32), T12 (gateway,
epoch, per-message fence, legacy routes 409, rooms), T13 (durable outbox,
dependencies, epoch rebase, local-persistence failure reported) are checked.
T14 one projector per checkout is done; staged multi-file revision visibility
is not — T14 stays open. T15 (API base + watcher) and T17 (canvas/folder/meta/
comments/annotations; photo/timeline ride the source lane or file plane) are
substantially done but stay open until T23–T26 bind UI operations to effect
ids. Still open: T1 remaining variants (27 not-run rows), T16 AI actions,
T18–T35.

### 2026-09-15 (later) — project entry, rights, revision visibility, AI actions, conflicts

Commits on `main` (not pushed): `a73fa823` managed team projects (T21/T22),
`3d47ff81` rights + sign-in again + truthful Saving + coordinator health
(T19/T20/T22/T29), `ab7e6c86` revision visibility (T14), `fc73f0f4` AI action
boundaries (T16), `2deb7998` SourceConflictPanel (T28).

- **T21/T22 — a designer opens the project with no folder.** `/_api/projects/
  prepare` (cloud, handoff code, team server email+password, known server) holds
  the credential and describes the project; native `managed_project_open`
  creates/reuses the copy under the app data folder keyed by (server, project
  id); onboarding door, switcher "Open a team project…", `maude://open` opens as
  its own copy. **Native E2E `pnpm test:e2e:desktop:team-project`** (real hub +
  seeding teammate studio, first-run home): 5/5 — door → wrong password refused
  → email/password opens the copy with the teammate's canvases → edits both
  ways → switcher offers team projects (evidence `.ai/device/scenario-runs/
  team-project/2026-09-15-0846/`). cargo managed tests 5/5.
- **T20 — rights.** Capability table per accepted op in project-transactions.md;
  a designer disabled mid-edit keeps the queued change (not applied, not
  dropped) and it lands after a new sign-in (real hub). Cell door manifest:
  history read, restore edit, personal undo/prepare/ai-action/conflict REFUSED
  (shared studio credential in a cell). Join page names the desktop way in.
- **T19/T29 — readiness + observability.** `/health` reports the coordinator
  apart from the renderer (posture public; counters, rejections by code, ack
  p50/p95/p99 to the cell secret; 503 when the store is unreadable in accepted
  mode). Studio status carries pending / oldest pending / ack latency; pending
  reads "Saving N changes", never "Saved".
- **T14 — revision visibility.** Cohort stamp + `sync/revision-barrier.ts`: an
  action editing A and creating B is seen as `A1 → A2+B` (was `A1 → A2 → A2+B`);
  a fresh checkout replays byte-identically.
- **T16 — AI actions.** Agent turn / `/design:edit` = one action (`kind: ai`);
  failure holds (persisted, crash-safe), Sync panel Publish/Discard. Test fails
  without the stage.
- **T28 — conflicts.** SourceConflictPanel: keep mine (new action) / use the
  project's; both choices driven on a real overlap.
- Fixed on the way: project history read a stale manifest (new canvas had no
  history).

**Task state:** T14, T16, T21, T27, T28 checked. T20 checked for the self-host
contract; the cloud half rides the existing dashboard invite + device sign-in
and is re-proved on real Cloudflare in T32. T22 open for its remaining
validation cells (offline state, switch with pending edits, dark/light and
narrow layout in a real WKWebView). T19 open (media priority order and explicit
offline preparation). T29 open (render revision lag, cold-open timing).

### 2026-09-15 (evening) — real backends, product gaps closed by the surface runner

Commits on `main` (not pushed): `ce2dc6ec` tree rename/duplicate + menu
placement + ⌘D selection, `42e0ddb4` Cloud Connect syncs again + artboard
rename, `906827fa` T32 kill rounds, `4e44f0bc` S3 multipart resilience,
`e8265c3b` formatting.

- **T32 real durable stores.** Disposable Cloudflare Worker hosting the real
  `ProjectStore` DO: 4 SIGKILL rounds × 25 proposals, each restart on a fresh
  data directory, the in-flight transaction retried by the client — 0 of 104
  acknowledged actions lost, 0 duplicate revisions/transactions, the retried
  action committed exactly once, head = last acknowledged; ack p50 151 / p95
  229 / p99 282 ms. Self-host SQLite, same oracle: ack p95 5 ms.
  (`scripts/dev/t32-verify.mjs`, `.ai/scenarios/reliable-project-multiplayer/evidence/`.)
- **T18 real S3.** The hub adapter against real S3 in a synthetic prefix
  (account/owner checked, every version deleted after): 96 MiB and 513 MiB
  round-trip byte-identical, part retry and abort without orphaned parts. It
  first FAILED at 513 MiB — a thrown network error (stale keep-alive socket) was
  not retried — fixed with backoff for throw/5xx/429 and HEAD-proved completion.
- **Native E2E.** cloud-attach 10/10 after two real defects: Connect never
  started syncing since 2026-08-18 (endpoints got a spread copy of ctx taken
  before `syncControl` existed), and `/_sync-status` served a previous
  process's "offline". team-project 6/6 incl. keyboard/Escape/dark theme.
- **Surface rows added and passing** (targeted runs, every direction): L01
  12/12 (folder rename in the real menu; a bottom-of-tree menu opened
  off-screen — fixed), L04 rename + duplicate (new product verbs), L07
  duplicate/delete (⌘D selected the next sibling — fixed), L08 add / rename
  (new: double-click the name) / move / remove 12/12, L21 same-property race
  3/3. Runner: toggle proxy in front of desktop B for L20, console warnings
  recorded, frame probe `fill` and computed color.
- **Product added for L03/L17:** supporting files (notes, styles, images,
  media in a canvas folder) rename / move / delete from the tree; a file a
  canvas still names is refused with that canvas's name.

### 2026-09-15 (night) — v1.3.0 released, StudyFi migrated, surface gaps closed

- **Release v1.3.0** shipped on every channel after two tag moves (hub image
  bundler stage; npm's new "previously staged" 409 wording). Fleet rolled;
  Alligators cell reports `durable: true` in legacy mode, awaiting the owner's
  switch from the dashboard.
- **StudyFi migrated (T33).** Rollback checkpoint, upgrade, dry-run (121 docs,
  34 folders, nothing skipped), switch with `expectEpoch`, parity 121/121,
  post-switch store snapshot `integrity ok`. Full record with SSM command IDs:
  `.ai/scenarios/reliable-project-multiplayer/t33-preflight.md`.
- **Product defects found by the surface rows and fixed:** palette "Comment"
  never armed the comment layer (two tool providers, separate bundles —
  L11); an image written beside canvases never reached the tree (L03); a
  folder made outside the app joined the project only at next launch, and a
  moved/removed folder lingered in a teammate's tree until the next tick
  (L02); a change arriving during a file-plane pass waited for the 20 s tick.
- **Harness corrections:** L02 rename oracle, L11 thread/resolve/reopen
  oracles, L19 hover-driven cursor and close-to-leave, L22 held-status
  wording, frame probe `hover`, catalogue timeout 4 h.
- **T19:** `sync-project-bootstrap.test.ts` (no renderer, first canvas first,
  cached reopen offline) on top of the earlier media-priority / offline
  preparation work.

### 2026-09-15 (late) — follow-ups after v1.3.0: presence, sign-in again, live cloud canvases

Commits on `main` after `v1.3.0` (not pushed at the time of writing): see
`git log v1.3.0..HEAD`. Product defects found by the surface runner and the
team-project scenario, each with a test watched red first:

- **Presence never left** (L19). Hocuspocus 4 re-encodes incoming awareness
  from a scratch Awareness and drops null (removal) states, so a tab closing
  behind a studio stayed on everyone's canvas for 30 s. The awareness bridge
  relays a departure as a `DEPARTED` state and turns it back into a removal
  (`7d382b5b`; real-hub test in `sync-accepted-runtime.test.ts`).
- **A removed teammate was told "check your connection"** (T20/T22). A 401 on
  a proposal was an "unknown outcome" retried forever. It is now
  `credentialRefused` → phase `refused` → **Sign in again**; signing in again
  to the server the studio already syncs with cycles the running sync onto the
  new credential, and the change kept meanwhile is delivered (`0a396b75`).
- **A cloud canvas stopped updating after 15 minutes.** The canvas-origin
  capability was minted once per page load. The shell now re-mints it before
  expiry (read off the token's own claim) and hands it to open canvases, which
  re-plant their cookie; open iframes are never reloaded for it (`0953b7d3`).
- **A design system's tokens.css never restyled the canvas importing it**
  (L16): sources dropped under a symlinked design root, and the shell matched
  stylesheets by file name (`b3e0c61d`; reproduced live before/after).

Harness: L17 shared media (12/12), per-person L19 leave, L23 mixed-session
soak (edits p95 ≈ 0.5 s, 13 media files byte-identical everywhere, RSS flat),
L24 compares `.meta.json` without `META_LOCAL_KEYS`, team-project steps 7–8
(server paused mid-edit; access removed → sign in again).

Evidence:
- Full surface run `2026-09-15T17-49-34.694Z` (`--save-mode accepted`, switch
  imported 39 documents): **350 pass / 1 fail / 11 not-run / 4 unsupported**.
  The 12 native resize rows could not run: the machine's screen was locked, so
  WebKit rendered nothing (`visibilityState: hidden`, no animation frames) and
  the rAF-positioned handles never appeared — the harness now records that as
  not-run (the one "fail" is the last row it had not yet covered, fixed after).
  The same rows passed with the screen unlocked (`2026-09-15T10-27-55.369Z`).
  Unsupported: text resize ×3 (no handles by design), and L18 personal undo for
  a **cloud browser** author.
- Team project (native, real hub + teammate): **8/8**
  (`team-project/2026-09-15-1639/`).
- Gates: lint clean; studio tsc + coverage; parity; tarball; import coherence;
  hub 974/974 + CLI 378/378; studio sync lane 1193/1193; full studio suite
  5903 pass / 0 fail (+1 cross-test `sonner` timer error, not reproducible in
  isolation); cells 53/53; cloud 597/597; cargo 50/50; site build + generated
  content current.

Known gap, now documented (site + runbook): every browser editor on a cloud
project proposes under the cell's one credential, so History names the
workspace and personal Undo is withheld in the browser. Per-person attribution
there needs a server-derived acting identity (the proxy-signed capability the
studio child already receives is the candidate) — open follow-up, not claimed.

**Task state:** unchanged checkboxes. T31 still open: the coverage catalogue
lists ~218 cases with no executed row (L09 context controls / alignment /
arrow heads, L13 photo controls and patterns, shape undo/redo, and the
per-surface requirement rows), and native resize needs a run with the screen
unlocked. T32 (disposable real backends at Alligators scale), T33 S20 and the
Alligators switch, T34 fleet rollout and T35 close remain.

### 2026-09-16 — every lane of the contract has executed rows; nine more defects closed

Follow-ups after `v1.3.1`; commits on `main` (see `git log v1.3.1..HEAD`).
Every product fix has a test watched red first, and every new harness row was
run against the real three-surface rig before it was committed.

**Product defects the new rows found:**

- **An edit made against a canvas a teammate moved came back as a conflict**
  (L21). `lane.replace` on a document a move had retired was refused
  `dependency-missing`; the kernel now follows the entry to the live document
  and merges there (`5e60e984`). Moved-and-then-deleted is still refused.
- **Renaming a folder made the renamer miss later edits** (L21). `moveFolder`
  carried each canvas's `_state/<slug>.ydoc.bin` cache to the new slug (the
  single-canvas move drops it): the new document opened stamped "moved away"
  and was released, so every later edit to it was missed — by the person who
  renamed the folder (`277463a2`).
- **A canvas made again under a deleted name jammed a desktop's whole outbox**
  (L20). A deleted document keeps its head rows; the create claimed "expect
  nothing", the store answered `head-moved`, and that code is RETRYABLE — the
  durable outbox re-sent it forever and everything queued behind it stayed on
  the machine. One entry cost 26 rows of a full run (`93fb9190`).
- **A teammate's desktop showed no design system** (L16). A managed copy is
  declared from group paths alone; the bootstrap now carries the project's own
  labels and design systems and a linked copy fills in only what it lacks
  (`0b99e03c`).
- **A replaced image was painted over with the photo it replaced** (L12)
  (`31dc43bd`).
- **A disk that refuses a write left the peer hanging** (L22). The file door's
  stream error was swallowed and the upload waited for a `drain` that never
  came (`80234abc`).
- **A too-big file that was removed kept being reported** (L22) (`e05eff17`).
- **A timeline drag could commit twice** (L15): the drags committed from inside
  a state updater, which React may run more than once (`1f5d4838`).

**New rows**, each in all three directions unless noted: L05 switch away/back
and reopen after restart · L06 CSS property and HTML attribute through the
inspector · L10 sticker replace · L12/L14 replace, delete-unreferenced,
move+rename with decode · L13 a moved photo keeps its edit, photo undo/redo ·
L15 the whole video lane (create from the palette, open, split, delete, undo,
redo, insert a title, its text, move, trim) · L16 token edit ×3, specimen
create/edit, moving a used file refused · L18 one drag is one action and one
undo takes it back, an AI agent's multi-file action · L19 presence across a
dropped connection · L20 quit-and-reopen catch-up, a fresh third copy · L21
delete / move / folder rename versus an offline edit, AI abort → discard and
publish · L22 a blocked file, a workspace that cannot store, the held
candidate named · L23 assets moved and deleted while a canvas keeps changing ·
L24 fresh reopen.

**Recorded unsupported, with the reason** (never faked): removing a
design-system specimen (the studio refuses to delete design-system canvases);
a code-module edit (code modules travel only with a per-hub consent the
product has no control for yet); photo crop/transform (no such control); text
resize; personal undo for a cloud-browser author.

**Runner:** a loopback lifecycle control for desktop B (stop / start) and for
fresh copies of the project, so "restart" and "a new machine" are real
processes, not simulations.

**Evidence:** full surface run `2026-09-16T01-50-54.345Z` (`--save-mode
accepted`, the switch imported 39 documents): **763 pass / 0 fail / 13
unsupported / 39 not-run**, where 24 of the not-run are the catalogue's
"remaining variants" placeholders and the other 15 are the rAF-placed resize
rows on the native window — the machine's screen was locked, so WebKit painted
no frames and the handles never appeared; the harness records that as not
exercised, never as a pass. The soak moved 60 edits (p50 447 ms, p95 501 ms)
and 20 media files with flat memory, and the final parity compared 163 files
across five copies — the three participants and two fresh machines — with no
mismatch. Gates: lint; studio tsc + coverage; parity; tarball; import
coherence; studio suite 5919 pass / 0 fail (plus the known cross-test `sonner`
error); sync lane 1195; hub 978; cells 53; CLI 392; cargo 50; site build and
generated content current.

**Still open:** T31 cannot be ticked — the catalogue's per-surface requirement
cases stay listed as unresolved by design, and the rAF-placed resize rows need
a run with the screen unlocked. Follow-ups: per-person attribution and undo
for cloud browser editors; a consent control for code modules (a declined
module reads as "stuck" with nothing a person can do); large media still has
no path into a hub (DDR-237's own open item).

### 2026-09-16 (morning) — v1.4.0 shipped, both deployments on it, S20 passed on StudyFi

**The release.** `v1.4.0` (`213b139f`), all six pipelines green on the first
tag: npm `@1agh/maude@1.4.0` with provenance and its seven platform
sub-packages, the desktop build past the blank-window gate, `maude-hub`,
the multi-arch self-host images, render, and the cell fleet. GitHub Release
published, 15 assets.

**StudyFi.** Checkpointed with hub and render stopped
(`/opt/maude-hub/pre-v1.4.0-20260916T024927Z` — env, compose, `hub-data.tgz`
10.8 MB, `hub-repo.tgz` 63 MB), moved to `v1.4.0`, answering `transactions`
and `durable`. **Project parity 121/121, no mismatches**, before and after
everything below.

**Alligators.** The fleet rolled to `1.4.0`, and the owner switched the project
through the dashboard's saving page — 87 canvases now saved as accepted
revisions; the cell answers `mode: transactions`, `durable: true`. Its parity
check is still owed: it needs an owner-role token on the cell, which only the
control plane mints.

**S20 passed on StudyFi** — the spec's one cell no fixture can answer. New
lane `apps/desktop/e2e/scenarios/s20-deployment.e2e.ts` +
`wdio.s20-deployment.conf.ts`, inert without an explicit target, isolating the
designer's machine so it can never touch the developer's own `hubs.json`.
Against the live deployment: the invited-project door, email and password, the
real project arriving in a copy nobody chose a folder for (242 canvas files,
49 MB), an edit the hub serves back, the product's own Undo on the designer's
own action, quit and reopen, and removal through the row's delete control.
Recorded identity: `version 1.4.0`, `protocol 1`, `coordinator {ready,
transactions, durable}`. The disposable account and its invitation are gone
(`410` / `401`), and parity after the run is unchanged.

**One product defect, found by running it** (`a7016208`): under managed saving
the Changes panel IS the project's history — every accepted action with its
author, and Undo on the ones that are yours — but the status-bar chip that
opens it was gated on the project being a Git repository. A managed team copy
is not one, so the invited designer had no visible way in; the View menu and
⌘⇧G worked, which is why it stayed invisible rather than broken. The chip's own
managed-saving branch was already written for this case and was unreachable.
`team-project.e2e.ts` step 4b asserts it, watched red first.

**A correction to the previous record.** StudyFi's `identity: {mode: "off"}`
was read as "this hub has no accounts, S20 needs `MAUDE_IDENTITY=on`". Wrong:
that field reports `MAUDE_CLOUD_IDENTITY` (federation to Maude Cloud) and
`authMode: "tokens"` describes only the token store. The hub was asked
directly — 5 users, 3 open invitations. The invitation door had been live all
along, and **no production environment change was made**.

**Release hygiene** (`0558a533`): `bump-version.sh` stamps
`apps/studio/whats-new.json`, but the site's mirror is generated by hand, so
the public feed still served `1.3.1` and showed this release's entries as
pending. Regenerated, and today's fix has its own pending entry.

**Gates, all green on this tree:** lint (0 errors), `tsc --noEmit` clean with
coverage over all 300 tracked sources, version parity, import coherence, root
978/0, studio 5919/0 (run alone — a run sharing the machine invented two
failures, exactly as the parallel-contamination note says), sync lane 1195/0,
cells 53/0, tarball shape, tokens, site build, and no generated-content drift.

**Still owed for T33:** Alligators parity, and S20 there.

### 2026-09-16 (later) — the task list is squared with the tree, and three gaps closed

Seventeen tasks still carried an unticked box. An evidence pass over every one
of them — the named implementation, the named test, executed rows, `git log`
on the files each task names — found most of the lag was bookkeeping, and
three gaps that were real.

**Ticked, against their own Do/Validate text:** T15, T19, T23, T24, T25, T26.
Each has the implementation the task names plus the test or the executed rows
its Validate line asks for. Two are naming drift rather than absence: T22's
"ProjectPicker" shipped as `TeamProjects.jsx`, and T25's proposed
`sync/structured-actions.ts` lives as `source-ops.ts` + `canvas-edit.ts`.

**Closed in this pass:**

- **T29** — the two things it named that genuinely did not exist.
  *Render revision lag*: the accepted revision is not what anybody sees, and
  publish runs after the durable commit, so a hub can be accepting work nobody
  is shown; four bounded fields on the privileged health now say how far the
  renderer is behind. *Blocked media in bytes*: `failed` counted files, and a
  count cannot separate nine CSS sidecars from nine videos. Both watched red
  first. T29 is now ticked.
- **T31's comparison.** `--baseline <dir>` judges a candidate against a
  preserved run cell by cell and fails on anything that passed then and does
  not pass now — including a cell that merely stopped being run, which is how
  a regression hides. Checked against the runs on disk: the certification run
  holds all 757 cells the previous one passed; the run that died after 8 rows
  reads as 745 regressions. Plus the two lane gates T31 names
  (`native-macos.sh`, `web-desktop.sh`) over the one rig — there is only one,
  because what is under test is what travels *between* surfaces.
- **T22's missing cell.** A project switch while work is still queued on this
  machine: the app tears its sidecar down and reopens through the picker, and
  the edit survives and is delivered. `team-project.e2e.ts` is 10/10.

**T17 closed by reading what is already there.** Its blocker was three entries
in `project-writer-registry.md`'s open list that the tree had overtaken: the
executable registry the first one asked for IS
`apps/studio/sync/writer-registry.ts` with its tripwire; supporting files,
public project configuration and footage/EDL all travel today; and the
"adapter-grade schemas" the third demanded are answered by the accepted design
rather than owed to it — DDR-241 carries a whole lane against an announced
base, identity is the document entry plus print addressing, and the inverse is
the compensating action personal undo already builds. A per-verb schema corpus
would be a second, weaker source of truth for exactly those two things. The
document now says so; a stale blocker reads exactly like a real one, and this
one had already cost an audit a wrong verdict.

**Corrected, not implemented — T30's "shadow comparison" is not missing.** It
is `previewSwitch()` before a switch (reports what would be imported, imports
nothing) and `parity()` after (reads every live document's lanes against the
store head and the checkout, reports, repairs nothing). Neither uses the word
"shadow", which already cost one reading of this plan an afternoon; the
rollout runbook now says so where an operator will meet it.

**What is still genuinely open, per task:**

| Task | What is missing |
|---|---|
| T1 | The baseline is still not certified, and `baselineComplete` is false in every artifact — correctly. Five of the contract's 116 declared actions assert nothing yet (each named, with its reason, in `surface-requirements.mjs`), so the catalogue is not complete. The rAF rows are no longer the obstacle: run with the screen awake they execute and pass. A full run on the current harness is owed — the last one predates the per-surface placeholder change and still carries all 24 blanket rows in its artifact. |
| T18 | Real-storage evidence is S3 only. Narrower than it reads: the hub has ONE object client (`apps/hub/src/s3.mjs`, path-style SigV4, `region: auto`) and no R2 branch anywhere — a cell reaches R2 by having `MAUDE_R2_*` copied into `MAUDE_S3_*`, so what is untested is that same signed client against a different endpoint, not a second implementation. Closing it needs one real multipart round-trip against an R2 bucket. Genuinely large media still has no path into a hub (DDR-237's own open item). |
| T22 | Ticked. Its last two cells are answered where they are reachable rather than left blank: **empty membership** on the panel itself (`team-projects-empty.test.tsx` — no harness can produce a cloud account that belongs to nothing), and **sign-in expiry** either side of the join (an expired stamp falls to the invalid-token path; that path reaches "sign in again" in the real shell). One stimulus walking the whole expiry path end to end is still owed, and is recorded in the requirement map rather than here. |
| T31 | The comparison, both lane gates and the requirement map are in. What is left is the same five actions T1 names, and a full run on the current harness to record the new shape. |
| T32 | The scale run covers S13/S14 only; S01–S19 on disposable cloud and self-host were never run end to end. |
| T33 | Alligators parity, and S20 there. |
| T34 | Its Validate line is already met — the writer registry has no unmapped route and a test that fails if one appears; raw writes are refused by the fence; Git's "go back" actions decline on a team project because the project's history is the authority; and both deployments plus the whole cell fleet run the current release. What holds it open is its own opening condition, "after initial deployments pass" — which means S20 on Alligators. |
| T35 | Follows T34. The gates, the PRD note, the user help, the operator runbook, the What's New entries and the kgai records are all written; what is missing is the acceptance it is supposed to close over. |

### 2026-09-16 (afternoon) — the rows that had never run, and what they were hiding

The resize lane and fourteen of its neighbours had recorded `not-run` for as
long as the harness existed: a locked screen paints no animation frames, the
handles never appear, and the row honestly declined to judge. Run with the
screen awake, against the preserved run as its baseline:

**768 pass · 8 fail · 13 unsupported · 26 not-run** — and, against the
baseline, **755 cells held, 13 repaired, 8 regressed**. The thirteen repairs
are rAF rows executing for the first time. Every one of the eight regressions
is now resolved; a targeted re-run of all of them is **38 of 39**, the one
failure being a probe timeout this session caused and fixed (see below).

**One of them was the product, and it is the most serious thing found in this
plan since the kernel fixes.** The coordinator's `state` starts at the `legacy`
default and only becomes a reading when the project store answers. `fence()`
asked `acceptedMode()`, so in that window "not transactions" was an assumption
— and a peer connecting into it was handed a WRITABLE socket on a project that
accepts only proposals. Two writable authorities on one document, which this
design forbids outright. `server.mjs` had reasoned the window away ("the SQLite
read resolves long before the caller's `listen()`"), true of a local file and
not of a Durable Object across the network on a cell that cold-starts
constantly — and production calls `listen()` without awaiting the coordinator's
first read; only the tests await it. Seen live while checking the Alligators
rollout: `/health` answered `coordinator.mode: "legacy"` seconds after boot and
`"transactions"` moments later, on a project switched hours earlier. Now it
fails closed, `/health` says `unknown` rather than passing a default off as a
reading, and `markReady()` — an exported setter nothing called, which would
have disarmed exactly this — is gone.

**The other four were the harness, and each hid behind a row that never ran:**

- element resize asserted `\d+px`, and a drag commits a measured box —
  `94.28px` far more often than `94px`. The row rejected a resize that had
  reached all three copies and read as a lost edit;
- artboard resize asserted the RENDERED width grew, on a canvas that fits its
  content to the viewport. The native participant failed all three directions,
  including as the author of its own resize, with its inspector plainly reading
  the new W and H. It now reads world geometry through the canvas's existing
  `__maudeCanvasRects()` manifest;
- the restart row read a file between `existsSync` and `readFileSync` while the
  catching-up peer was deleting it — a race the row ran straight into, since
  proving the canvas is GONE is the whole point of it;
- and the world-geometry probe, added for the second of those, first computed
  the manifest on every probe of every element. That walk made ordinary
  gestures time out. It is one operation now, asked for by name.

Two of these were announced as product defects before the evidence was looked
at, and were not. Recorded here in that order because the sequence is the
lesson.

## Context References

### Must-Read Files

Read the relevant independent files in one batched context load at each milestone. Source paths below are repository-relative. Large files should be read at the named seam; use `rg` to refresh line numbers after changes.

| File | Why / relevant seam |
|---|---|
| `AGENTS.md`, `.ai/workflows.config.json`, `.ai/release-guide.md` | Runtime, paths, packaging, platform and quality contracts |
| `docs/audits/2026-09-13-hub-sync/README.md`, `evidence.md`, `reproduce.ts`, `debate.md` | Evidence and limits; prior resolved audit direction |
| `.ai/docs/PRD.md`, `.ai/docs/epic-native-collab-app.md` | Historical product/personas; current request overrides obsolete cloud/native exclusions |
| `.design/system/maude/README.md`, `colors_and_type.css` | Actual studio design-system authority |
| `apps/studio/sync/projection.ts`, `source-recovery.ts`, `source-validation.ts`, `codec.ts` | Source candidates, base tracking, validation and encoding |
| `apps/studio/sync/index.ts` | Shared-doc wiring, conflict recovery, role/trust and project lifecycle |
| `apps/studio/sync/presentation.ts`, `connection-state.ts`, `file-ledger.ts`, `file-plane.ts` | Truthful state, complete inventory, reconciliation |
| `apps/hub/src/server.mjs` | Read-only Yjs gate around 656–747; after-store projection around 1588; document delete and auth |
| `apps/hub/src/workspace-agent.mjs`, `workspace-files.mjs`, `journal.mjs`, `file-door.mjs`, `history.mjs` | Competing writers, persistence, file gate and history |
| `apps/cells/cell-do.mjs`, `cell-config.mjs`, `wrangler.toml`, `apps/cloud/worker.mjs` | Cell availability, live-pairing rollout and control/data-plane routing |
| `apps/studio/sync/workspace-signin.ts`, `hub-listing.ts`, `hub-link.ts` | Existing self-host/account/attach contracts |
| `apps/studio/client/panels/CloudBar.jsx`, `OnboardingWizard.jsx`, `SyncPanel.jsx`, `GitPanel.jsx` | Reusable auth/project/status/history UI |
| `apps/studio/client/app.jsx`, `commands/edit-source-command.ts`, `undo-stack.ts`, `history.ts` | UI operation bridges, current undo and history |
| `apps/desktop/src-tauri/src/app_state.rs`, `deep_link.rs`, `lib.rs`, `sidecar.rs` | Managed project identity, native entry and sidecar switching |
| `.claude/rules/tauri-desktop.md`, `.ai/plans/feature-share-link-deeplink.md` | Four-site native command registration/committed permission files and concurrent URL/resolver ownership |
| `scripts/dev/local-cell.mjs`, `scripts/dev/sync-e2e.mjs`, `scripts/dev/sync-e2e/harness.mjs`, `scenarios.mjs` | Existing isolated real-process harness; extend instead of parallel tooling |
| `apps/desktop/e2e/scenarios/cloud-attach.e2e.ts`, `onboarding.e2e.ts` and matching WDIO configs | Native harness; current cloud test uses owner/stubs/prepared folder |
| `apps/hub/test/two-machine-workspace.test.mjs`, `journal-restore-drill.test.mjs`, `invite-flow.test.mjs` | Useful fixtures, but current KILL/restore labels do not prove renderer-disk-loss durability |

Configured `.ai/maude-prd.md`, `.ai/maude-design-system.md` and `.ai/context/codebase-map.md` do not exist in this checkout. The actual PRD above is historical (May); actual DS and current source plus the September request govern this plan. T1 documents these resolved paths without treating stale config stack fields (`next.js` for the repo) as the studio framework.

Prior art: DDR-064, DDR-110, DDR-115, DDR-120, DDR-126, DDR-193, DDR-214, DDR-226/227/228, DDR-240; audit graph `system-review:maude/hub-desktop-sync-audit-2026-09-13` and bookend `decision:maude/hub-sync-debate-2026-09-13`. Prior plans are historical evidence; `git log -- <their files>` determines what already shipped. Do not reopen delivered credential-cache/backoff/ledger work as new implementation.

### Files to Create

These are **proposed new files**, created only by their owning implementation tasks unless explicitly marked as planning artifacts. Test files below use production seams rather than duplicating algorithms.

| Proposed path | Task / purpose |
|---|---|
| `.ai/scenarios/reliable-project-multiplayer/spec.md` | Planning artifact created with this plan |
| `.ai/scenarios/reliable-project-multiplayer/local-e2e.md` | Planning artifact: exhaustive local surface/operation and regression contract |
| `.ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh` | T1: baseline and candidate runs via existing real-process/UI harness, independent of cloud credentials |
| `docs/architecture/project-transactions.md` | T6 protocol, inventory and state machine |
| `.ai/plans/notes/reliable-project-multiplayer-spikes.md` | T7/T8 findings, chosen adapters and bounds |
| `apps/studio/sync/project-transactions/contracts.mjs`, `kernel.mjs` | T9 pure shared ESM; no Node/Bun/Worker globals; shipped under existing npm studio surface |
| `apps/hub/src/transaction-gateway.mjs`, `transaction-store.mjs` | T11/T12 self-host adapter + acceptance integration |
| `apps/cells/project-store.mjs` | T10 cloud adapter; class/binding runtime chosen in T8 |
| `apps/studio/sync/transaction-client.ts`, `pending-actions.ts`, `revision-projector.ts` | T13/T14 client, durable outbox and projection |
| `apps/studio/sync/project-bootstrap.ts`, `project-manifest.ts` | T19/T20 bootstrap and public manifest/trust split |
| `apps/studio/client/panels/ProjectPicker.jsx`, `SourceConflictPanel.jsx`, `ProjectHistory.jsx` | T22/T27/T28; compose existing chrome |
| `apps/desktop/src-tauri/src/managed_projects.rs` | T21 managed copy identity/lifecycle |
| `apps/studio/sync/structured-actions.ts` | T24/T25 typed source/meta actions |
| `apps/hub/test/project-transactions.test.mjs`, `project-durability.test.mjs` | T7–T12 shared contract and actual failure tests |
| `apps/cells/project-store.test.mjs` | T10 deployed-runtime adapter conformance |
| `apps/studio/test/sync-transaction-client.test.ts`, `sync-pending-actions.test.ts`, `sync-revision-projector.test.ts` | T13/T14 replay/dependencies/projection |
| `apps/studio/test/sync-structured-actions.test.ts`, `sync-personal-undo.test.ts`, `sync-project-bootstrap.test.ts` | T19/T24–T28 product semantics |
| `apps/desktop/e2e/scenarios/project-multiplayer.e2e.ts`, `wdio.multiplayer.conf.ts` | T31 native clean-designer scenario |
| `.ai/scenarios/reliable-project-multiplayer/runners/web-desktop.sh`, `native-macos.sh` | T31 thin runners around existing harnesses |
| `scripts/dev/sync-e2e/faults.mjs`, `inventory.mjs` | T8/T18/T31 extend existing harness with fault and hash oracle |
| `docs/operations/project-multiplayer-rollout.md` | T30 migration/rollback and backend runbooks |

Additional regression cases belong in existing tests named under each task. Do not create another sync framework or publish a second hand-maintained copy of the protocol kernel. If source-validation extraction needs a shared runtime file, T3 chooses its path and verifies Node/Bun/bundled loading; T8 separately verifies the cloud validation runtime.

### Design canvases

Read-only sidecar discovery found the following existing input. All are under the configured/default `.design` root; no canvas was modified or server started while planning.

| Canvas | Status | Tags | Use |
|---|---|---|---|
| `.design/ui/Onboarding.tsx` | **handed-off** | none | Reuse wizard/chrome; replace obsolete GitHub-first/folder requirement for this hub workflow |
| `.design/ui/CreateProject.tsx` | **handed-off** | none | Project rows/actions and clear ownership; do not require repo creation to join |
| `.design/ui/GitHubIdentity.tsx` | **handed-off** | none | Existing identity presentation; not a new GitHub dependency |
| `.design/ui/OnboardingTour.tsx` | **handed-off** | none | Tour mechanics only; old Save/Publish/Pull teaching conflicts with automatic project saving |
| `.design/ui/Cloud Self Service.tsx` | draft | cloud, self-service, user-flow, onboarding, billing | Invitation/account flow context; not approved pixel authority |
| `.design/ui/Studio Hub.tsx` | unspecified | none | Existing self-host operator console reference |

### Documentation

- [Yjs updates](https://docs.yjs.dev/api/document-updates) — binary convergence/idempotence and origins; does not establish semantic validity of source edits.
- [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) — tracked origins and capture boundaries; validate against project action semantics before adopting.
- [Hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks) — identify pre-apply versus post-store integration against installed v4 source.
- [DO SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) — transaction/storage semantics for the cloud candidate; test outside the render container.
- [R2 uploads](https://developers.cloudflare.com/r2/objects/upload-objects/) — multipart implementation and resumability.
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) — conditional object/head candidate for T8; these primitives alone are not a multi-object transaction or a proven commit adapter.
- [Tauri commands](https://v2.tauri.app/develop/calling-rust/) — native project creation/opening; commands and permissions must agree.

### Patterns to Follow

Existing factory/injection seams are useful: `createDocProjection({ slug, doc, paths, onConflict, onRecovered })`, `createWorkspaceAgent({ repoDir, designRel, log })`, pure `syncPresentation(snapshot, context)`, and `sourceError(file, body): string | null`. Extend these responsibilities explicitly; do not hide a second writer behind an observer callback.

Use Bun APIs in studio runtime and `paths.ts` for filesystem-relative package assets. Hub remains Node ESM; cloud remains Workers; the shared kernel is runtime-neutral ESM. Bundle inclusion and npm tarball reachability are acceptance criteria, not assumed from workspace imports. Keep runtime classifier mirrors and all four runtime-state lists in agreement for any new `_state`/outbox paths. Use existing local per-project runtime directories and session isolation; never sync credentials, local camera or trust config.

## Design Decisions

### Components and screens reused

| UI need | Existing source | Planned change |
|---|---|---|
| Account login/device flow, project list | `client/panels/CloudBar.jsx` | Extract reusable logic into picker; retain URL validation and server-held credentials |
| First-run and returning project entry | `OnboardingWizard.jsx`, native `app_state.rs` | Hub invitation/project-first route and automatic managed copy; preserve local-folder advanced route |
| Save summary, per-file progress | `SyncPanel.jsx`, `sync/presentation.ts`, `client/app.jsx` | One state vocabulary including conflicts, outbox and media; details remain available without becoming required workflow |
| History and restore navigation | `GitPanel.jsx`, `history.ts`, hub `history.mjs` | ProjectHistory reads accepted actions; existing Git inspection remains advanced |
| Conflict decision / warning | SyncPanel rows + `.design/system/maude/preview/components-dialogs.tsx`, `components-callout.tsx` | New SourceConflictPanel preserves candidate/accepted versions, explicit resolution and download recovery |
| Empty/loading/project rows | DS `preview/empty-state.tsx`, `skeletons.tsx`, `components-list.tsx` | Reuse visual conventions; no new kit |
| Notification and focus behavior | Existing shell notification stack and dialog styles | Persistent actionable conflict, restrained completion updates; restore focus, keyboard navigation and live-region announcements |

New components are justified by missing product functions, not a new visual style. No Tailwind registry is assumed; the studio uses existing CSS class families (`gi-*`, `sp-*`, `ob-*`, `.st-*`) and CSS custom properties.

### Icons and tokens

Reuse existing thin inline SVG `Icon` vocabulary from CloudBar/OnboardingWizard: `check`, `folder`, `folder-open`, `download`, `server`, `globe`, `spinner`, `x`, `arrow-right`, `external`, `chevron-right`, `back`, `copy`. Sizes follow existing 15/16px chrome. These are local helpers, not invented Lucide imports; extract a shared helper only where actual reuse needs it. Any new history/undo glyph must follow DS `preview/iconography.tsx` and be recorded in T22.

| Purpose | Tokens / rule |
|---|---|
| Panels/background/text | `--bg-0..4`, `--fg-0..3`, `--border-default`, `--radius-sm/md` |
| Primary action / selection | `--accent`, `--accent-fg`, one accent job per surface |
| Save/error/offline state | `--status-success/warn/error/info`; text/icon accompany color |
| Human/agent presence | `--presence-online/away/offline/agent`; do not equate online presence with saved state |
| Typography | `--font-body` for UI; `--font-mono` for sizes, timings and numeric details |
| Motion | `--dur-flip`, `--dur-panel`, `--ease-out`; honor reduced motion |

Dark and light theme parity; dense keyboard-first desktop, usable narrow browser layout. No decorative gradients, emoji chrome, hardcoded colors or protocol jargon in default user flows. Product copy: “Saving…”, “Saved”, “Working offline — saved on this device”, “A change needs your attention”. “Saved” refers to shared durability, not proof that every offline teammate rendered it. Device persistence failure must prevent the local-saved claim.

## Planning Debate

The original audit debate is retained. This plan adds a bounded independent BUILDER/SHIPPER/BREAKER bookend focused on dependencies and implementation seams. All three returned **READY for a phased plan**, not for rollout; short-circuit applied without another user choice.

- **BUILDER, 0.90:** published Yjs channel must be client-read-only; durable transaction/replayer is the only author. Risk: new gateway beside an old writable channel.
- **SHIPPER, 0.88:** reuse auth/UI/test harnesses and finish actual designer onboarding on both backends. Risk: calling P0/prototype/stubbed owner attach a completed feature.
- **BREAKER, 0.90:** prove U1 rejection/U2 dependency replay, persistent fencing and real disk-loss recovery. Risk: invalid candidate published before a post-store gate, or dependent updates poisoned by its rejection.

Resolved sequence below preserves all three concerns. Storage technology is deliberately a T8 decision gate; this is not permission to omit either adapter or stop after an experiment.

## Milestones and Dependencies

| Milestone | Tasks | Exit gate |
|---|---|---|
| M0 — contain known loss and misleading status | T1–T5 | New regressions green, candidates preserved, truthful summary; no claim of a new accepted-document protocol yet |
| M1 — prove and implement acceptance/durability | T6–T12 | Pre-publication gate + both actual storage adapters pass identical fault oracles |
| M2 — all authors, offline and one projection | T13–T17 | No unfenced write bypass; browser + two desktops + AI; dependent offline replay |
| M3 — media, bootstrap, rights and project entry | T18–T22 | Large-media resume; no bulk-download prerequisite; real designer can open managed project |
| M4 — supported operations, logical history, undo | T23–T28 | Supported operation inventory complete; peer-safe undo and restore-as-new-action |
| M5 — observability, migration and product evidence | T29–T32 | Real storage loss, clean onboarding, large project, replay/migration proofs on both backends |
| M6 — staged rollout and retirement | T33–T35 | Both distributions pass product contract; obsolete write paths removed; final evidence/roadmap/docs accurate |

**Execution amendment, 2026-09-14:** the user's active goal is to iterate on sync repairs with E2E verification after each change. Preserve the collected, explicitly partial baseline and begin T2 containment now; expand remaining T1 coverage alongside individual repairs. T1 remains unchecked. This changes the ordering prerequisite, not the required surface coverage or regression standard. Every repair needs a failing reproduction, focused checks and the affected real hub/native/peer UI lane. Full local coverage and the mixed workload remain mandatory before rollout; a narrow passing run is not product certification.

**Containment ordering, 2026-09-14:** after the 300-edit text lane passes, address the reproduced annotation A→B→A/undo echo defect before expanding the transaction kernel. This is the compatibility portion of T26/T28 only; their accepted-action grouping and peer-safe undo requirements remain open. Preserve delayed self-echo protection, SVG bytes and legacy callers; require native/hub/peer E2E.

Execute serially by task ID unless explicit dependencies allow overlap. T6–T8 isolated experiments may run alongside M0; T18/T20 can begin after M1; T21/T22 UI preparation can begin after T6, but cannot pass until T19/T20 work. T23 fidelity research can start early; production operations require the gateway. Fencing is implemented in T12–T14, **before any pilot activation**, not postponed to M6 cleanup. Run the affected local surface rows after each behavior change and the full local matrix at every milestone; T31 extends/certifies this early runner instead of introducing E2E only near the end.

## Tasks

Each task includes implementation plus its meaningful regression/integration checks. Future file names/commands are specified here as deliverables, not as commands already present or already run. Record task evidence against T1–T35; do not check a milestone complete with skipped required scenarios.

### T1: CREATE the local surface E2E baseline before changing sync

- [ ] **Do:** Recheck Git history, six audited source seams and deployed versions read-only. Resolve actual PRD/DS paths; add a dated current-scope note to existing product docs without deleting history. Establish isolated owner, two designer and viewer identities; canvas+module+asset fixture and exact expected accepted/candidate bytes. Implement `runners/local-e2e.sh` as a thin extension of existing `scripts/dev/sync-e2e/` and native WDIO fixtures. Enumerate and run **all L01–L24 operation variants** from `local-e2e.md` against the unchanged baseline with visible UI assertions and actual decodable photo/video fixtures; record unsupported/failed baseline cases honestly. Capture the native bundled lane, per-direction correctness, no-refresh behavior and latency distributions. Preserve baseline artifacts keyed by source/bundle/config/fixture hash before refactoring production sync.
- **Pattern:** Audit `reproduce.ts`, `scripts/dev/local-cell.mjs`, hub real-client tests and WDIO fixture guards.
- **Gotcha:** The audit's five probes are observations, not assertions to preserve broken behavior. Existing 162 passing tests and old plans do not establish product completion. Current sync-e2e has `expected-pending` deletion/history assertions, a delete settle path forcing `ok: true`, folder creation hidden by adding a child canvas, and a create+delete scenario explicitly labeled not-real-rename: none may count as a passing CRUD baseline. Separate UI-triggered tests from API/watcher tests; don't substitute a direct API call for an untested UI control.
- **Validate:** `bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline` (new in this task), plus the audit probe and targeted suites. Every matrix cell has evidence-backed `pass | fail | unsupported | not-run`, no false green. Preserve actual initial failures with task ownership; protect all initially passing cells from regression. No production writes or seed during baseline collection. T1 is incomplete if the receiving UI/media or native lane was not actually exercised.

### T2: FIX stale local source imports and conflict lifetime

- [x] **Do:** Update `sync/projection.ts`, `source-recovery.ts`, `index.ts` and tests so a save never interprets stale untouched text as a new deletion of peer work. Track proven base/generation, preserve original candidate and accepted bytes, merge only demonstrably independent changes, and retain an unresolved conflict until actual resolution.
- **Pattern:** Existing projection/hash/recovery factories and `sync-source-safety.test.ts`.
- **Gotcha:** Last projected file hash alone cannot prove an external editor's buffer base. Both preserve-and-block and a correct verified merge are acceptable for an ambiguous import; silent overwrite is not.
- **Validate:** `cd apps/studio && bun test test/sync-source-safety.test.ts test/shared-doc-projection.test.ts test/sync-incident-replay.test.ts`; title/color race in both orders, atomic rename, restart with unresolved candidate, and failed snapshot write.

### T3: FIX hub checkout validation parity and package reachability

- [x] **Do:** Guard hub workspace projection/commit with the same source-validity semantics as studio; reject before overwriting valid disk, preserve the candidate/reason, and prevent Git committing the rejected source. Share implementation or generated conformance corpus rather than drift-prone duplicated regexes. Register any parser dependency at every actual package-manager root and verify the hub bundle/native studio distribution.
- **Pattern:** `source-validation.ts`, `workspace-agent.mjs`, `workspace-files.mjs`, existing source safety tests.
- **Gotcha:** This is checkout containment only. It does **not** yet prove that the published Y.Doc or peer render never saw invalid bytes; T7/T12 own that boundary.
- **Validate:** `pnpm --filter @maude/hub test`; source-validity corpus in studio; repeat audit hub probe expecting no overwrite/invalid commit; bundled hub cold-load smoke and compiled studio loading if dependency surface changes.

### T4: FIX complete inventory and one truthful project summary

- [x] **Do:** Extend file enumeration/ledger to account for every eligible user file, including >512MiB entries with explicit blocking reasons. Unify summary priority across conflicts, failed/pending files, auth, transport and docs; preserve unknown-state fail-closed behavior. Apply to CloudBar, SyncPanel and statusbar without separate rules.
- **Pattern:** `sync/presentation.ts`, `file-plane.ts`, `file-ledger.ts`, `connection-state.ts`, seed progress.
- **Gotcha:** Excluded runtime/trust files should have a policy classification, not become upload jobs. Avoid frequent hashing/reading of large files solely to populate a row. A green docs count cannot override a blocked required asset.
- **Validate:** `cd apps/studio && bun test test/sync-presentation.test.ts test/sync-file-ledger.test.ts test/sync-file-membership.test.ts test/sync-seed-progress.test.ts test/sync-panel-surface.test.ts`; blocked+91-doc case, sparse oversized file and contradictory UI states.

### T5: FIX current undo bridge preconditions

- [x] **Do:** Carry expected-current values through CSS/attr command → shell → API, enforce the precondition server-side, and acknowledge success/failure back to the command stack. Preserve the undo entry on rejection; surface a peer-change conflict. Keep this compatibility correction until T28 replaces it with effect-aware project undo.
- **Pattern:** `commands/edit-source-command.ts`, `client/app.jsx`, `api.ts`, existing text precondition path.
- **Gotcha:** Value comparison is only immediate containment; ABA and action identity are handled by T28. Do not advance the stack after swallowed HTTP errors.
- **Validate:** `cd apps/studio && bun test test/edit-source-command.test.ts test/undo-stack.test.ts test/undo-sequence-byte-compare.test.ts`; wire-level CSS and attr requests, peer replacement, failed request, redo.

### T6: CREATE transaction contract and exhaustive writer registry

- [x] **Do:** Write `docs/architecture/project-transactions.md` with versioned schemas, state transitions, rights, generation/epoch, retry semantics, source/candidate policy, persistent/ephemeral split, action boundaries, idempotency horizon and full writer registry above mapped to actual functions/routes. Specify bootstrap/proposal/result/events/history/upload-session APIs and errors (`base-conflict`, `source-invalid`, `dependency-missing`, `forbidden`, `epoch-stale`, `capacity`, `retryable`).
- **Pattern:** Existing pure journal/CAS/status contracts; preserve tenant/path gates and backward-read compatibility.
- **Gotcha:** Multi-Y.Doc events are not atomic multi-file visibility. Revision manifests define the visible unit; ordinary filesystem consumers have a documented weaker projection boundary.
- **Validate:** Schema examples cover every input row; protocol review traces one action browser→commit→desktop→undo. Every persistent writer has an owner task and a future tripwire. Record the contract decision in kgai with scope; do not supersede unrelated DDRs.

### T7: CREATE candidate/publication and dependency-replay spike

- [x] **Do:** Prototype explicit proposals and a server-written accepted Y.Doc against installed Hocuspocus v4. Separate accepted replica and optimistic candidate. Test valid base → rejected U1 → repair U2 authored with U1 present → restart/reconnect/retry. Record the chosen rebase representation and required browser persistence in spike notes.
- **Pattern:** Hub `connectionConfig.readOnly` gate and real-provider tests; use production parser semantics.
- **Gotcha:** Gate raw `Update` and `SyncStep2`, all existing sockets, loopback clients and document-creation paths. `onStoreDocument`/`afterStoreDocument` is not the publication barrier.
- **Validate:** `node --test apps/hub/test/project-transactions.test.mjs` (new): zero rejected bytes in accepted replica, peer, checkout or history; U2 cannot bypass U1 rejection through CRDT dependencies; valid corrected proposal produces one revision. Gate failure blocks T9–T17 integration.

### T8: CREATE real persistence, validation-runtime and crash experiments

- [x] **Do:** Exercise the bounded candidates in Solution using the same append/read/head/snapshot interface. Add subprocess kill and replaceable checkout disks to `scripts/dev/sync-e2e/faults.mjs`; compare cloud and self-host storage behavior. Select concrete adapters and source-validation runtime, limits, cost/latency envelope and recovery policy in spike notes + an implementation DDR.
- **Pattern:** Existing backup/restore/SQLite seams, with independent durable-store fixtures.
- **Gotcha:** Do not call destroying a provider `kill -9`, reuse the supposedly lost designRoot, or label a fileTarget fake as R2 verification. No remote I/O held inside a DO concurrency lock. Validation service availability cannot depend on restoring the entire render checkout.
- **Validate:** Fault oracle before/after payload, head commit, ACK and publication; two coordinators with stale/current epochs; lost ACK retry; same ID/different payload; storage timeout/quota; fresh empty renderer disk; missing blob; replay after snapshot/compaction. Actual staging backend probes complement local mocks. Publish chosen adapters and evidence before T9–T12.

### T9: CREATE shared transaction kernel and conformance corpus

- [x] **Do:** Implement runtime-neutral `sync/project-transactions/{contracts,kernel}.mjs`: deterministic validation/preconditions, action grouping, manifest hashes, idempotency, generation and dependency checks. Inject storage/clock/auth/validation effects. Keep one source imported by Node, Bun and the chosen cloud adapter.
- **Pattern:** Existing pure decision-layer/effects separation and journal CAS fixtures.
- **Gotcha:** No ambient process/env/fs/DOM imports in shared core. npm packing and compiled bundles must include it; do not introduce a workspace-only dependency unavailable to installed users.
- **Validate:** New hub/cells transaction conformance tests execute the same fixture corpus; Node/Bun and Worker bundle imports; `bash scripts/check-tarball-shape.sh` and hub build smoke. T7/T8 are hard dependencies.

### T10: CREATE Cloudflare durable project store

- [x] **Do:** Implement `apps/cells/project-store.mjs` using the adapter selected in T8; persist atomic head/log/dedup result and epoch outside the render container. Add schema migrations, snapshot replay, bounded paging and safe immutable payload references. Wire a project coordinator independently of cell renderer readiness.
- **Pattern:** Existing tenant routing/cell config, using cloud-specific effects around the shared kernel.
- **Gotcha:** Never put the authoritative doc log only in container SQLite or assume the file journal tail contains Yjs bodies. Old container env is not a feature-capability acknowledgment.
- **Validate:** `pnpm --filter @maude/cells test` plus actual Worker/runtime project-store conformance from T8; empty-container reconstruction, concurrent head conflict, lost ACK and cross-tenant isolation. Dry-run deploy/config validation without production mutation.

### T11: CREATE self-host durable project store

- [x] **Do:** Implement `apps/hub/src/transaction-store.mjs` with T8-selected storage, installation/migration checks and explicit durability mode. Keep required journal/payload/head outside disposable studio/checkout state. Supply a deployable standalone recipe and AWS persistent-storage configuration.
- **Pattern:** Existing hub factory injection, SQLite/object target and Docker/systemd deployment recipes.
- **Gotcha:** No self-host-only weakened “saved” semantics. If a deployment lacks required durable storage, refuse shared-save claims and give the operator an explicit configuration error; designers retain candidates.
- **Validate:** `node --test apps/hub/test/project-durability.test.mjs`; actual selected backend, process kill, replacement checkout, stale coordinator, replay and storage failure. Verify installation/upgrade from the observed self-host version on a disposable instance.

### T12: ADD gateway, subscriptions and mutation fencing

- [x] **Do:** Implement `transaction-gateway.mjs`, common proposal/results/revision-events APIs, server replayer, auth/capability derivation and persistent epoch checks. Make accepted Yjs content client-read-only, including loopback. Fence every legacy mutating route/document and already-open connection when project mode switches; rejected clients retain readable state and local work.
- **Pattern:** Existing hub readOnly/auth gates and T6 registry; retain bounded awareness as a separate capability.
- **Gotcha:** Epoch checks only at login are insufficient. Legacy delete/rename/import callbacks cannot mutate canonical state after mode switch. Snapshot SQLite is now a cache and cannot override the accepted head at boot.
- **Validate:** T7 attack/replay cases over real sockets; each registry row exercised with stale epoch; revocation during a queued proposal; valid transaction replay published once. Both adapters pass the same project API contract.

### T13: CREATE durable client outbox and accepted replica

- [x] **Do:** Implement `transaction-client.ts`/`pending-actions.ts` for studio/desktop and persistent browser storage where offline is promised. Persist action, base/generation, dependency chain and recovery bytes before local-saved acknowledgment. Manage accepted replica and optimistic overlay separately; rebase or hold dependent proposals after rejection.
- **Pattern:** Existing supervisor/reconnect/backoff and per-machine runtime storage; no new transport retry loop competing with them.
- **Gotcha:** sessionStorage alone is insufficient; account/project switching must not replay a queue into another project. Browser persistence eviction/quota failure must be visible. Never persist credentials inside synced project state.
- **Validate:** `cd apps/studio && bun test test/sync-transaction-client.test.ts test/sync-pending-actions.test.ts` (new); offline edit→kill client→peer edit→reconnect; U1/U2; permission loss; stale generation; quota failure; ACK loss and duplicate callbacks.

### T14: REFACTOR one checkout projector and revision visibility

- [x] **Do:** Implement `revision-projector.ts`; stage complete revision manifests and switch renderer-visible revision only after all required files are ready. Give one component write ownership of each managed checkout. Turn workspace-agent and legacy projections into adapters/readers or gate them off in transaction mode before enabling a pilot.
- **Pattern:** Existing atomic writes/echo guard and path containment; canonical paths from `paths.ts`.
- **Gotcha:** Multiple rename operations are not an atomic filesystem transaction for arbitrary external tools. Isolate their working tree and validate imports; renderer uses the immutable revision boundary. Projection failure cannot roll back the accepted log or erase candidate work.
- **Validate:** `cd apps/studio && bun test test/sync-revision-projector.test.ts test/shared-doc-cell-pairing.test.ts` (new + existing); kill between staged files; canvas+module never mixed on render; stale projector cannot write after epoch change; replay to fresh checkout hashes identically.

### T15: REFACTOR source UI and watcher imports into proposals

- [x] **Do:** Route text/CSS/attr/local HTTP source edits and fs watcher imports through transaction-client. Bind UI operations to accepted IDs/base tokens and preserve exact local editor bytes. Remove write→watch→second-author feedback for managed projects while retaining controlled import/export for local files.
- **Pattern:** `api.ts`, `commands/edit-source-command.ts`, source-recovery, fs-mirror, current editor rewrite helpers.
- **Gotcha:** Do not execute/resolve arbitrary imports to test syntax in a trusted process. Unknown editor base remains explicit candidate state, not silent replacement.
- **Validate:** Existing source/command tests + real `sync-e2e` scenarios in both directions; title/color interleavings, editor stale buffer after remote projection, conflict resolution and unrelated TSX byte preservation.

### T16: ADD explicit AI and multi-file action boundaries

- [x] **Do:** Add begin/propose/commit/abort integration to existing studio API and design CLI helpers/ACP adapters. Agent edits stage against a known manifest; one logical operation becomes one accepted history action with bounded preview. Preserve raw-tool edits via watcher candidates when an agent cannot use the structured API.
- **Pattern:** Existing `maude design` dispatch and project path resolution; plugin callers use `maude design <verb>` per DDR-062.
- **Gotcha:** User pause/agent crash/timeout cannot partially publish a canvas+module edit. Idle timers may suggest grouping but cannot define an atomic action. Keep both supported agent harnesses behind existing integration surfaces, not a new orchestration layer.
- **Validate:** Real multi-file fixture: agent writes valid partial files then fails; no accepted half-state. Commit once, duplicate commit, abort and concurrent designer action all have explicit results and one logical history group.

### T17: REFACTOR remaining persistent operations through the gateway

- [x] **Do:** Implement each T6 registry category: create/duplicate/move/rename/delete canvas; meta/artboard layout; comments; annotations; photo operations; timeline operations; supporting file replace/delete. Give each category a transaction adapter and fixture. Generation/tombstone semantics prevent old clients resurrecting deleted or moved canvases.
- **Local E2E contract:** cover empty and populated folders as first-class tree operations, including move/delete with all descendants and canvas sidecars. A newly created empty folder must be visible to peers; define durable directory entries in the project manifest/transaction model instead of silently inserting a canvas to make the test pass. Distinguish removing a media instance from the canvas from deleting the project's asset; preserve other valid references and history.
- **Pattern:** Existing codec/membership/tombstone and action handlers; retain ephemeral awareness and local viewport separation.
- **Gotcha:** This task is complete only when every named category has a checked adapter and no direct accepted write. If implementation size requires split tasks, enumerate them in the plan before starting, preserving these IDs as acceptance parents.
- **Validate:** Per-category write-registry tripwire plus browser/desktop/AI conformance. Rename asset + update reference, comment after target delete, artboard drag, annotation undo candidate, timeline/photo grouped edits, stale generation replay.

### T18: ADD resumable media and complete asset lifecycle

- [ ] **Do:** Extend existing asset/file plane and hub door with upload-session create/status/part/complete/abort, per-part retry, whole-object verification, quota reservation and completion idempotency for R2 and S3. Add immutable asset references and inventory helper; document tx commits reference only completed durable objects. Protect current/history/pending references in GC.
- **Pattern:** Existing ledger/CAS/hash/backoff and credential singleflight. Reuse them; do not re-mint credentials for every part.
- **Gotcha:** Avoid routing full media through the coordinator/Worker request cap or loading files into memory; preserve tenant/path/type gates and minimum authorized grants. Two concurrent sessions cannot overspend quota or delete each other's object.
- **Validate:** 96MiB, 513MiB and representative large video fixtures; interrupted part, lost completion response, restart, hash mismatch, expiry, quota rejection, duplicate completion and GC race. `pnpm --filter @maude/hub test`, cells tests and staged R2/S3 integration evidence. Retain the cold MP4 intake case from T1: distinct per-author content, reference before receiver-local bytes, then explicit playback without refresh. A player stranded after an early 404 fails even when the asset hash later matches.

### T19: ADD progressive bootstrap independent of renderer restore

- [x] **Do:** Implement project-bootstrap metadata, rights, manifest and active accepted snapshot endpoints before renderer/full checkout readiness. Desktop fetches a minimal working set, then media in priority order; add explicit full offline preparation. Separate coordinator readiness, renderer readiness and media completeness in health and UI.
- **Pattern:** `cell-do.mjs`, workspace mode/readiness, hub listing and existing asset progress.
- **Gotcha:** Opening the project need not wait for all blobs, but active missing modules cannot falsely appear ready. Browser render startup must hydrate only its working set and retain an actionable pending state.
- **Validate:** `sync-project-bootstrap.test.ts` (new); renderer stopped, large bulk restore ongoing, active dependency missing, offline reopening cached canvas and insufficient disk. Record action-to-first-interaction separately from full download.

### T20: UPDATE invitation, membership and project-manifest rights

- [x] **Do:** Define designer capability mapping for all supported operations and required DS dependencies. Unify cloud and self-host invitation→login→membership→project-list contract, renewal and revocation. Add a distributable project manifest with bounded dependency declarations; keep account credentials and local trust outside it. Specify self-host identity enablement/migration in the rollout recipe.
- **Pattern:** `apps/cloud` membership/invite/device-auth modules; hub identity/invites, `workspace-signin.ts`/`hub-listing.ts`/`hub-link.ts`.
- **Gotcha:** Designer must not require owner tokens to work, but accepting an invitation must not silently grant unrestricted code execution or project admin. Tenant identity is canonical ID+server, not display name/hostname substring.
- **Validate:** Cloud/hub membership and invite tests with real designer/viewer/owner roles, revoked/expired invite, queued edit after removal, cross-tenant attempt, code dependency trust denied and permitted supported action. Token-only legacy self-host remains explicitly legacy until upgraded.

### T21: ADD native managed project lifecycle

- [x] **Do:** Implement managed_projects using existing app-state/MRU/sidecar/deeplink facilities. Create/reuse a managed local copy keyed by server+project identity, fetch bootstrap, then open studio. Invitations on a clean install and project selection must not require choosing an existing directory. Provide advanced folder adoption without overwriting unrelated content.
- **Pattern:** Native `app_state.rs`, `deep_link.rs`, `lib.rs`, `sidecar.rs`, Tauri command/permission generation.
- **Gotcha:** Preserve pending edits across project switch/account logout; duplicate invitation/open requests are idempotent. Reuse the concurrent share-link plan's `project_resolve.rs` if present, extending identity from bare project name to canonical server+project without changing file-link semantics. Untrusted webviews must not choose arbitrary writable paths or broaden URL opener privileges. New native commands need registration in Rust/build.rs, committed permission TOML and default capability; avoid plugin command-name collisions.
- **Validate:** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; native command capability checks, same-name different-project, interrupted bootstrap, restart/MRU, conflicting local folder and two concurrent opens.

### T22: ADD project-first UI and truthful save/recovery states

- [x] **Do:** Compose ProjectPicker with existing CloudBar/OnboardingWizard logic for cloud and self-host. Use invitation-provided server, show only authorized projects, open managed copy, preserve advanced local workflow. Show consistent shared/device save state, active media progress and a persistent conflict entry. Add stable data-testids and keyboard/focus/live-region behavior.
- **Pattern:** Design Decisions registry and approved chrome; existing URL refusal and server-held credential behavior.
- **Gotcha:** Do not copy old GitHub-first or Save/Publish/Pull semantics from handed-off historical canvases. Project state should not expose websockets, epochs, hashes or a mandatory resync button to designers.
- **Validate:** Browser and actual WKWebView: clean invite, project pick, cancel/retry login, empty membership, revoked access, sign-in expiry, switch with pending edits, offline state, dark/light, keyboard-only and narrow browser layout. T19/T20/T21 required for completion.

### T23: CREATE bounded source fidelity and stable-ID pilot

- [x] **Do:** Enumerate the supported source vocabulary from real projects and existing edit operations. Pilot stable identity and operations for literal text, static JSX attributes/styles and artboard layout; preserve imports, comments, formatting, expressions and custom components not being edited. Classify unsupported transforms as code candidates instead of lossy conversion.
- **Pattern:** `data-cd-id` and existing source-edit helpers; actual DS canvas fixtures plus synthetic adversarial syntax.
- **Gotcha:** Stable IDs survive allowed move/duplicate rules; repeating component instances need explicit addressing. Source fidelity cannot be asserted from identical screenshots alone.
- **Validate:** Byte round-trip/no-op corpus, render parity and deterministic repeated edits. Output an explicit support matrix and source-size/performance limits. A failed representation changes implementation approach; it does not remove user-requested operations from full scope silently.

### T24: IMPLEMENT text/property operations and live action previews

- [x] **Do:** Implement structured-actions for supported text, CSS, attributes and persistent layout properties, using T23 addressing and source-preserving patches. Separate transient preview from final commit; drag/edit sessions yield one logical action. Preserve unrelated concurrent properties automatically and record same-property acceptance order.
- **Pattern:** Existing edit-source commands, canvas inspector events and shared transaction kernel.
- **Gotcha:** Don't apply one giant opaque replacement as the implementation of independent properties. Runtime errors remain isolated per revision/canvas; an accepted syntactic change is not proof of render success.
- **Validate:** New `sync-structured-actions.test.ts`; two designers change same/different properties, repeated component addressing, long drag with reconnect, runtime throw and last-good render access; GUI peer render latency measured under defined RTT.

### T25: IMPLEMENT structural and canvas lifecycle actions

- [x] **Do:** Complete insert/duplicate/move/reorder/delete supported elements and artboards, plus canvas move/rename/delete with stable IDs and referential checks. Unsupported arbitrary TSX structural edits use the explicit code-action path with equivalent history and conflict preservation.
- **Pattern:** T17 registry adapters, existing canvas structural commands, pathIndex and tombstone semantics.
- **Gotcha:** A concurrent child edit after parent deletion cannot silently resurrect or disappear; return a preserved conflict. Rename/delete must update references atomically in accepted manifests, including offline client generations.
- **Validate:** Structural operation matrix, move vs edit, delete vs reference, duplicate IDs, old client resurrection, nested paths and multi-file manifest render parity.

### T26: COMPLETE action grouping for comments, annotations, photo and timeline

- [x] **Do:** Bind existing per-domain commands to accepted action IDs and authorship; complete multi-property grouping for annotation gestures, photo transforms and timeline edits. Preserve comment thread/resolve semantics. Remove duplicate product-history ownership from private shell stacks as each domain passes parity.
- **Pattern:** Existing domain command implementations and T17 adapters; use transaction history rather than a new generalized UI framework.
- **Gotcha:** These categories remain in scope even if they do not use the T23 source representation. Native source model pilot completion alone does not complete multiplayer.
- **Validate:** One acceptance fixture per category in both directions, concurrent peer edits, interrupted gesture, multi-step undo/redo and deleted target. Each persistent effect has a project transaction ID. Include annotation A→B→A and repeated empty-SVG transitions: the current content-history echo filter in `annotations-layer.tsx` suppresses legitimate second deletions/undo. Deduplicate by action/revision identity while retaining protection against out-of-order self echoes from concurrent media intake.

### T27: ADD logical project history and restore-as-new-action

- [x] **Do:** Extend hub/studio history endpoints and ProjectHistory to read accepted action groups with author, timestamp, bounded summary, revision preview and restore. Retain legacy Git history for browsing; map imported baseline explicitly. Restore proposes a new revision with rights/preconditions, never rewinds the canonical head destructively.
- **Pattern:** Existing `history.mjs`, `history.ts`, GitPanel UI, snapshot/blob retention.
- **Gotcha:** Historic media and source needed by supported retention must survive GC. Renderer errors in a revision must not make history unavailable. Large source history cannot silently inherit an unrelated old 2MiB UI limit.
- **Validate:** Multi-file AI appears once, mixed authors stay distinct, pagination, large source preview policy, deleted assets, restore under concurrent peer changes, permissions and restart/replay consistency.

### T28: ADD effect-aware personal undo/redo and conflict resolution

- [x] **Do:** Implement undo/redo as conditional compensating transactions targeting the user's session action/effect IDs. Preserve peer changes, group drag/AI actions, handle partial conflicts explicitly, and keep redo dependent on current state. Build SourceConflictPanel comparing original candidate, base and accepted version; resolution itself is a new action.
- **Pattern:** Existing command stack/UI shortcuts plus T27 log. Adopt Y.UndoManager only where it satisfies these semantics; do not equate tracked origin with the entire solution.
- **Gotcha:** Expected-value-only checks miss ABA. Decide and test partial undo semantics: compensate independent safe effects atomically as a new action, leave conflicting effects unchanged and clearly list them; never report an unconditional full undo. Failed requests cannot advance history cursors.
- **Validate:** New `sync-personal-undo.test.ts` and actual two-user GUI: A color/B text/A undo; same-property peer edit; ABA; target deleted; AI canvas+module; redo after peer change; restart with candidate; explicit resolution preserves original recovery bytes.

### T29: ADD protocol and product observability

- [x] **Do:** Emit bounded project/revision/transaction correlation, oldest pending age, durable ACK latency, render revision lag, conflict/rejection counts, blocked/missing media bytes and cold-open timing. Add conformance/build/capability identity to health, separate from liveness. Reuse existing operator surfaces/logging with correct service ownership.
- **Pattern:** Current health/metrics/operator modules; no source content, tokens or private project names in telemetry payloads.
- **Gotcha:** Metrics must not infer people from provider count, successful sync from liveness or completed restore from backup logs. Keep source debugging opt-in/local where needed.
- **Validate:** Assertions over accepted/rejected/retry/cold-start events; bounded cardinality; fake sensitive strings absent; report explains whether latency measured through peer render or only server acknowledgment.

### T30: CREATE migration, shadow comparison and rollback tooling

- [x] **Do:** Inventory source/media/history/IDs/permissions and pending candidates; dry-run exact export to the new baseline. Shadow compares only, never writes a second authority. Implement drain/write barrier, persistent epoch advance, accepted snapshot import, byte/render parity, new mode open and legacy rejection. Write backend-specific runbooks with preflight and rollback boundary.
- **Pattern:** Existing journal generations, backups and containment; T12 fencing already implemented.
- **Gotcha:** Before new writes, snapshot rollback can be simple; after any new accepted action, preserve/export the new log first. If old representation cannot preserve it, keep read-only recovery and fix forward. Never lose offline/pending work to downgrade.
- **Validate:** Repeated dry-run/import, crash at every migration step, late old socket, stale loopback process, lost barrier response, both repo-owned/hub-owned fixtures, unsupported-source fidelity, rollback before/after new write and history/blob conservation.

### T31: CREATE repeatable browser/native product runners

- [ ] **Do:** Extend and certify the T1 local runner; do not postpone baseline E2E to this task. Implement the scenario spec's web-desktop and native-macos backend runners using existing sync-e2e and WDIO helpers. Run browser + two isolated desktop profiles/sidecars + AI with designer rights. Require every L01–L24 operation/direction/load-profile cell to pass locally and compare candidate against the immutable T1 baseline. Add real invite/account integration lane; keep stubbed UI checks labeled as such. Restore fixtures/config at teardown and capture revision/hash/GUI evidence.
- **Pattern:** `scripts/dev/sync-e2e/`, desktop fixture-guard/evidence/canvas-frame helpers, current onboarding/cloud configs.
- **Gotcha:** No source-server substitute for final bundled WKWebView checks. No writes to the developer's personal hubs.json. Required scenario not implemented, unavailable active display or skipped real backend is recorded as incomplete, not pass.
- **Validate:** `bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode candidate --baseline <T1-evidence-dir>` (runner created in T1), then `runners/web-desktop.sh` and `runners/native-macos.sh` under that scenario directory. No `expected-pending`, forced-success timeout, missing operation, automatic recovery reload or skipped required cell can produce a green gate. Run S01–S19 on isolated projects in both directions; implement S20's runner here but execute its upgraded-production check in T33. Native debug capability must remain absent from release app.

### T32: VERIFY real large-project and two-backend failure acceptance

- [ ] **Do:** On disposable cloud and self-host projects, run S01–S19 and the T8 crash oracle using real persistence. S20 is explicitly owned by T33 after the initial deployments are upgraded; it is not a prerequisite cycle for this pre-rollout gate. Run the actual included Alligators inventory or a documented authorized equivalent with the same byte/file/large-object profile, not only sparse placeholders. Two clean clients must hash-match the complete included set after interrupted/resumed seed while design edits continue.
- **Pattern:** T18 inventory helper, T31 runners, audit historical seed ledger and isolated backend targets.
- **Gotcha:** 8.8GB raw directory size includes excluded runtime files; preserve both raw inventory and eligible byte count. Measure disk peak, transient copies, CPU and quota; choose capacity from data. Do not run destructive drills against users' production projects.
- **Validate:** Publish machine-readable manifest/results, hashes, latency percentiles, screen evidence and actual storage-failure logs per backend. Zero unexplained missing entries, lost acknowledged actions, duplicate logical actions or peer-clobbering undo. Missing real evidence blocks rollout.

### T33: PREPARE release and migrate the two initial deployments

- [ ] **Do:** Build version-parity artifacts and reviewable migration/runbook outputs for AWS StudyFi and Cloudflare Alligators. Re-inventory running versions/flags. Upgrade self-host identity/config and cloud capability routing, then migrate one real project at a time with snapshots/fencing and monitored acceptance. Retain a per-project rollback/export checkpoint.
- **Pattern:** Existing release guide, hub/cell deploy recipes and T30 runbooks. This is the first task that changes the named live deployments.
- **Gotcha:** Finish all preflight artifacts before requesting any deployment authorization required by the active session. Never treat the planning request as production deployment approval. Do not blanket enable unknown tenant capabilities or overwrite operator-owned config.
- **Validate:** S20: the clean designer invitation→desktop project→browser peer edit→undo→reopen flow on each upgraded deployment, protocol/build identity, normal reconnect, baseline hash parity and no new blocked-media backlog. Log exact rollout and rollback checkpoint IDs without secrets.

### T34: REMOVE obsolete write authorities and complete fleet rollout

- [ ] **Do:** After initial deployments pass, remove competing projector writes, managed-project Git autocommit as product authority, obsolete fallback write endpoints and superseded per-domain history stacks. Keep explicit legacy read/import compatibility only for the documented window. Complete cloud tenant and self-host distribution rollout according to capability/version support matrix.
- **Pattern:** T6 writer registry, source reachability tests and version/capability fencing.
- **Gotcha:** Removal does not mean deleting user Git repositories or historical revisions. Local-only projects still work. Every active project either supports the contract or is clearly labeled legacy/read-only with recoverable work; no invisible permanent pilot exception.
- **Validate:** Registry has no unmapped persistent writer; obsolete raw writes rejected; all supported operation categories and local-only regression suite pass; cloud rollout inventory and self-host upgrade recipe validated. No manual resync required in the happy path.

### T35: CLOSE validation, docs, release notes and decision memory

- [ ] **Do:** Run final quality/product gates; update actual PRD/collaboration docs and reference configuration paths, publish precise user help, operator SLO/restore runbook and What's New entry via repo skill. Record implementation decisions and evidence in kgai, update plan task state and roadmap; archive only through `/flow:done` after full scope acceptance.
- **Pattern:** `.ai/release-guide.md`, `whats-new-entry`, `site/scripts/build-roadmap.mjs`, scoped graph record-log/ingest.
- **Gotcha:** Document residual unsupported syntax or disaster-recovery limits; do not advertise universal TSX co-editing. Do not mark missing live/native evidence complete just to archive the plan.
- **Validate:** Full gate table below, `pnpm --filter @maude/site gen:roadmap`, no generated drift, all task evidence linked and no unresolved critical findings. Record actual confidence/outstanding limits at close.

## Validation

The repository has real lint/types/test/build gates despite an obsolete early paragraph in AGENTS.md. Use current scripts/config. Planning itself does not run product builds or mutate release artifacts. During implementation, capture each task's targeted tests; broaden once at milestone boundaries and final validation.

The [local surface E2E contract](../scenarios/reliable-project-multiplayer/local-e2e.md) is mandatory from **T1 onward**, independent of vendor/staging credentials. After a behavior change, run affected operation/direction cells; at M0–M6 boundaries run the complete local matrix plus the fixed mixed-workload soak. Compare against the preserved working baseline on matched hardware/build mode/fixtures. An inconclusive timing sample is not a pass. Never widen timeouts, remove an assertion or regenerate the baseline merely to make the candidate green.

| Gate | Command / expectation |
|---|---|
| Scoped verify after each task | `/flow:utils-verify` against actual touched files; preserve unrelated shared-tree changes |
| Local surface E2E and no-regression gate | T1 `runners/local-e2e.sh --mode baseline`; subsequent `--mode candidate --baseline <T1-evidence-dir>`; paths under `.ai/scenarios/reliable-project-multiplayer/`. L01–L24 + all operation variants, real peer UI/image/video assertions and per-direction latency; full matrix at every milestone |
| Lint | `pnpm lint` |
| Format | Configured `pnpm format` is a whole-tree writer; run formatting on owned changed files during implementation, then verify formatting without rewriting unrelated work |
| Studio types + coverage | `cd apps/studio && bunx tsc --noEmit`; then root `bash scripts/check-tsc-coverage.sh` |
| Root CLI + hub tests | `pnpm test` |
| Sync required lane | `cd apps/studio && bun test test/sync-*.test.ts --timeout 20000` |
| Other affected studio suites | `cd apps/studio && bun test test/shared-doc-*.test.ts test/undo-*.test.ts test/edit-source-command.test.ts test/history-rollback.test.ts --timeout 20000` |
| Cloud control and cells | `pnpm --filter @maude/cloud test`; `pnpm --filter @maude/cells test` plus actual runtime/staging adapter tests selected in T8 |
| Native Rust | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; platform build checks for shipped native targets |
| Website/config build | `pnpm --filter @maude/site build` |
| Client release artifacts | When client/styles change: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`; check resulting minified bundle/style diff, never plain dev build over committed artifacts |
| Hub distribution | `pnpm --filter @maude/hub build`, then cold-load smoke of built bundle |
| Native scenario build | `pnpm test:e2e:desktop:build`; targeted existing onboarding/cloud commands plus T31 multiplayer config |
| Packaging/security invariants | `bash scripts/check-version-parity.sh`; `bash scripts/check-tarball-shape.sh`; existing canvas-origin, code trust, containment and classifier tripwires |
| Product scenario | T31 web-desktop and native-macos runners; T32 actual AWS/self-host + Cloudflare storage, no required skips |
| UX/DS/accessibility | scenario-runner for configured web-desktop plus explicit native lane; design-system-guard and a11y-auditor over new UI screenshots/live routes; zero blockers |

Any in-session studio boot uses `MAUDE_NO_AUTOBUILD=1`. Root Bun probes use `bun --no-env-file` where needed; never read denied env/key files to make a test run. Use isolated fixtures, accounts and configuration paths. Test doubles and staged/live evidence remain separate in reports.

## Scenario Coverage

New planning spec: `.ai/scenarios/reliable-project-multiplayer/spec.md`, with mandatory detailed local coverage in `local-e2e.md` (L01–L24). The local regression runner is built in T1 and reused throughout; T31 adds final backend/native conformance rather than being the first E2E run. Existing reusable coverage:

| Existing scenario/harness | What it covers | Gap this plan closes |
|---|---|---|
| `.ai/scenarios/live-multiplayer-hub-sync/README.md` | Historical real-hub cross-machine edit/presence | Ad-hoc runner, old delivery timing, no new acceptance semantics |
| `.ai/scenarios/native-onboarding-zero-terminal/spec.md` | Existing onboarding and later automated native checks | GitHub/folder-led flow; no complete clean hub designer scenario |
| Desktop `cloud-attach.e2e.ts` | Device login/project attach with isolated stubs | Owner + prepared directory; not real invited designer |
| `scripts/dev/sync-e2e.mjs` | Actual cell+peer and both directions | Add transactions, more participants, failure injection and full role matrix |
| `.ai/scenarios/structural-and-scope/spec.md` | Existing structural/source scope edits | Concurrent accepted operations and peer-safe compensation |

Required platforms follow actual project config (`web-desktop`) plus the native macOS desktop explicitly required by this feature. Windows/Linux package compatibility and native opening smoke are release checks. There is no iOS/Android native Maude app; mobile authoring runners are N/A, with this scope tied to PRD desktop-authoring limits and native distribution DDR-126. Do not report five-platform parity by silently skipping the actual native desktop.

## Acceptance Criteria

- [ ] T1–T35 completed with evidence; P0/prototype completion is not full feature completion.
- [ ] T1 captured the unchanged working baseline with real local hub, browser, desktop/sidecars and visible receiving UI; source/bundle/fixture hashes and baseline failures are recorded before behavior changes.
- [ ] All L01–L24 operation variants pass locally in all required directions; file/folder/canvas/annotation create-edit-or-move-delete lifecycles are complete, including empty folders, sidecars and no resurrection. Photo/video bytes **and actual decoding/render/playback** are verified on receivers.
- [ ] No previously passing workflow regresses, needs manual refresh/resync, gains an unexpected conflict or loses data. Full local matrix and mixed-load soak pass at milestone boundaries; initially known gaps are not relabeled as success and are closed before final rollout.
- [ ] Per-surface/per-direction local-to-peer-visible latency is compared with T1 under matched conditions; no reproducible material regression beyond the fixed noise policy in `local-e2e.md`, and final absolute targets hold. No widened timeout or baseline reset used to hide a failure.
- [ ] A newly invited designer opens an editable project without token, terminal, Git or folder selection on both cloud and self-host; a peer sees the first edit.
- [ ] Every persistent writer passes the accepted transaction boundary; old writers and already-open sockets are fenced at epoch changes.
- [ ] Invalid/rejected candidates never mutate accepted state, peer render, accepted checkout or history; repair/dependent pending actions retain their bytes and resolve safely.
- [ ] Independent concurrent edits survive; ambiguous stale-file imports preserve work and remain visible until resolution.
- [ ] Accepted actions survive the defined process/renderer-disk failures with RPO 0; duplicate retry has one effect. Disaster RPO/RTO is separately documented and tested.
- [ ] Browser/desktop offline work survives restart or reports local persistence failure truthfully; reconnect respects current rights and dependencies.
- [ ] Complete eligible inventory, resumable large-media transfer and final hash parity are proved on two clean clients; excluded/blocked files are explained.
- [ ] Project and active document opening do not depend on full media download or bulk renderer restore.
- [ ] Supported text/property/structural/comment/annotation/photo/timeline and AI actions all have logical history; arbitrary TSX remains preserved.
- [ ] Personal undo/redo respects peer effects including ABA/deletion; restore creates a new accepted action.
- [ ] All status surfaces use the same truthful state model; no known conflict/required missing media under a shared “Saved” claim.
- [ ] Target performance measured, not assumed: local normal edit p95 ≤50ms; peer render p95 ≤300ms/p99 ≤1s with RTT ≤100ms in one region; warm active-document open ≤2s on recorded hardware. Any failed target is resolved or explicitly reviewed, not hidden behind server-only timing.
- [ ] T32/T33 evidence demonstrates both actual backend families and bundled native UX; no required scenario left stub-only or skipped.
- [ ] Targeted/full quality gates, origin/trust/tenant checks, packaging/version parity, DS and a11y reviews pass; no critical findings outstanding.
- [ ] Migration preserves historical and pending work; rollback after new accepted writes cannot discard them. Old authority retirement and fleet support matrix complete.
- [ ] Product documentation, What's New, generated roadmap and scoped decision memory accurately reflect shipped behavior and remaining limits.

## Risks and Execution Confidence

| Risk | Mitigation / blocking gate |
|---|---|
| Accepted Yjs state still writable through a bypass | T7 raw-protocol proof, T12 per-write fencing and T6 registry |
| Rejected CRDT update poisons its dependent repairs | T7/T13 separate candidate generation and dependency-aware rebase |
| Persistence adapter appears durable only in mocks | T8 actual adapter proof, T32 empty-renderer-disk and staged storage tests |
| Portable source validation fails in Workers/native bundles | T3/T8 runtime proof before selecting deployment architecture |
| Universal TSX conversion loses semantics | T23 corpus and explicit support matrix; preserved code-action alternative |
| Work stops after a pilot | Explicit M0–M6 scope and final real designer/rollout acceptance |
| Large media saturates disk/memory or blocks docs | T18 streaming/resume + T19 independent bootstrap + measured T32 capacity |
| Migration resurrects old writers or loses pending work | Persistent epoch, drain barrier, preserved pending candidates and forward-safe rollback |
| New UI duplicates login/trust or makes code unsafe | Reuse existing identity/URL/permission logic; per-operation role contract and tenant tests |

**One-pass implementation confidence: 7/10 for executing this staged plan with its explicit gate-and-revise points; 4/10 for attempting the entire change as one uninterrupted rewrite.** The storage/validation runtime and source-rebase proofs are intentionally first-class tasks. Their results may refine downstream module details, while the full product acceptance remains fixed.

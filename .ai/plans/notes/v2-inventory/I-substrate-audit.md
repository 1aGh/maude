# I — Surface vs substrate audit of the v2 plan (BREAKER seat, 2026-10-08)

Adversarial completeness audit of `.ai/plans/feature-maude-v2-redesign.md` against the owner's direction (2026-10-08): "Maude is a design tool built around AI"; "what is on the surface must match what is under it"; plugins, skills, agents, hooks and the CLI evolve so Claude can drive every feature; design-system switching must not burden users with token mapping. Verdict at the time: **revise** (confidence 0.8). The amendments it asked for are folded into the plan as V2-1.11–1.17, V2-2.4b, V2-2.14–2.19, S12 and V2-8.14–8.16.

## Ranked gaps

1. **Claude cannot drive v2 (critical).** No verb or skill covers the ~60 % NEW behaviour: modes, Present order/notes, links, votes, sticky↔comment, DS switch/update, the queue, kinds and presets.
   - Inventory needs that are unplanned: an ACP voice contract, artboard declaration before an edit, element ids preserved across rewrites, an attribution and lock hook.
   - DDR-168 bundles plugins only into the ACP panel. Terminal Claude Code runs the marketplace version, which may be older than the server API. Nothing checks for this.
2. **File-format migration and v1↔v2 peer compatibility (critical).** New fields land in versioned files with no version, migrator, dry-run, rollback, or rule for v1 peers writing them:
   - annotations: `parentArtboard`, binds, `resolved`, stamps, `timeRange`, `folded`;
   - `.meta.json`: interactions, `dsRev`, notes/order, poster, `maxFrames`, Made-by-AI;
   - comps: overlay lanes move to Video 2;
   - chats: get a canvas link.

   During the rc soak a v1 and a v2 desktop share cloud projects.
3. **DS schema vs C1 (high, contradiction).** Keeping each system's own token names makes switching a per-pair mapping problem. Needs a strict schema, a validator, AI migration and skeleton templates that emit the schema.
4. **DS pinning on git (high).** `dsRev` plus `git show` breaks in four places: non-git local projects, cloud cells and browser shells, shallow clones, and a per-Mac base snapshot under `_state/`. Generated files sync, so every peer gets spurious "changed outside" reviews.
5. **Per-canvas ACL (high, security).** A path-scoped grant does not cover:
   - the sync file plane and Yjs rooms;
   - shared assets;
   - git/Version history;
   - Whole-project export/ZIP;
   - ⌘K, the usage index, comments.

   "Can view = no download" is UI-only. The Phase 4 role gate required Can view before S9 builds it.
6. **Unified undo (high).** "AI run = a version" vs "one op log, per-user stacks" vs CONTRACT "⌘Z includes AI". Out-of-order "Undo this chat" and per-user stacks need inverse ops rebased over others' ops. No test matrix exists.
7. **AI scheduler local-only (high).** One-AI-per-artboard across people needs hub leases. The soft lock has no enforcement, and quit-while-running strands locks. Missing: run registry schema, TTL, queue persistence, a two-Mac race test.
8. **Five ad-hoc offline queues (high).** AI prompts, invites, comments, offline create and cloud export have no shared persisted outbox, ordering, dedupe, expiry, or replay-against-gone-target rule.
9. **Thumbnails and indexes (high).** Home, ⌘K, history thumbnails, the usage index, kind counts and picture descriptions assume indexes no task builds. Snapshot files go stale after a crash. "Shared with you" / "not on this Mac" need a cloud API. Describe sidecars have no classification, budget or rate cap.
10. **Version history semantics (medium-high).** Line-range diff breaks on shared top-of-file code. There is no fixture corpus. Object history needs S2's element ids before S1 can use them, a cross-lane ordering problem.
11. **Votes and annotation secrecy (medium).** Hidden ballots in synced, versioned JSON are not hidden. Local projects have no server for secrecy or the timer. Bound arrows re-route per frame with no perf budget.
12. **Export, render and video (medium-high).** rc tags don't reach the render service, so new cloud formats are dead in the rc (memory: version string ≠ running image). New binaries must pass DDR-177 bundle completeness. B3/B4 have no task ids.
13. **Performance beyond pan/zoom (medium).** Untested: the 93-canvas panel, index builds, 93 Home thumbnails, 12-person presence, LOD annotations, 247 assets.
14. **Smaller gaps:**
    - **i18n:** no decision recorded, although CONTRACT says plurals are "i18n's job".
    - **A11y:** comes only at the end; the F6 cycle across native chrome + cross-origin iframe has no task.
    - **Crash/disk-full detection:** no task.
    - **Account deletion:** purge and e-mail unsubscribe are unplanned.
    - **Docs:** no `docs/MIGRATING-V1-TO-V2.md`.

## Phasing contradictions

- **L1 is serial and the plan waits on it.** S5 attribution needs S2's element ids. S10 runs last, yet S2 and S5 need the token schema. Fix: move the schema and element ids into Phase 2.
- **"One PR" vs "hub/cloud ship first".** The hub changes must be split out of the PR and released first.
- **A8 in Present.** "Lands on move-on" needs per-artboard reload gating, and no task exists for it.
- **Stale evidence.** About 380 fidelity screenshots go stale when a canvas changes. Fix: hash-pin the evidence to the canvas file.
- **New runtime paths.** Run registry, outbox, Home index, DS base, describe sidecars and vote state are all unclassified against the four DDR-115 lists. The `.gitignore` ↔ `gitignore-block.mjs` pair has no drift test.

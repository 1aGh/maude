# Follow-up: multiplayer hardening

Opened 2026-09-25 by the owner from the findings the closed
`archive/followup-reliable-project-multiplayer.md` left documented rather than
fixed ("tech 6 nálezů můžeš rovnou opravit"), plus the pending self-host pairing
decision. Owner decisions (2026-09-25): finding 3 — **both** accepted-by-default
for new cloud projects and a legacy write-behind; finding 5 — **immediate**
revocation; `MAUDE_CELL_PAIRING` — **on by default** for self-host.

The isolated cloud fixture was deleted at the previous close, so cloud behaviour
is reproduced locally: the hub from source in workspace mode with its studio
child paired over loopback, and the ProjectStore host (`apps/cells/project-store.mjs`,
the same `store-core`) served over HTTP with DO-like latency.

## Tasks

- [x] **G1 — A switch's import that never finishes.** **Fixed `107feb59`** —
  reproduced on the cloud-shaped fixture (one store call failed mid-import,
  `mode failed: fetch failed`, import pending until a restart); now answered
  truthfully and resumed in process; verified: the same blip, import finished
  at 28 s without a restart, parity ok.
  Originally: Once on the F3 cell,
  `importPending` stayed true >5 min with the revision still, until a cell
  restart resumed it. Reproduce on the local cloud-like cell; find and fix.
- [x] **G2 — A long switch answers 503.** **Fixed `107feb59`** — reconcile
  skips lanes already at their head and runs eight documents at a time; the
  kernel loads a proposal's heads in one call; reads are retried. 76 canvases
  at 40 ms a store call: 160 → 84 calls, answered 200 in 14.7 s.
  Originally: ~130 canvases took 55 s through the
  DO; larger projects exceed the edge request limit. Make the switch fast
  (batched/parallel store reads in the import and the reconcile), and never
  leave the owner without an answer.
- [x] **G3a — New cloud projects start in accepted revisions.** **`ee57c97d`** —
  MAUDE_NEW_PROJECT_MODE, applied only to a brand-new project through the
  owner's switch; cell-config emits it where store AND pairing are on.
- [x] **G3b — Legacy documents survive a hard kill.** **`50004fad`** — every
  document stored in legacy mode is written behind as its Y state
  (`docs/<workspace>/<seq>/…`, deletions as markers), rotated per backup generation and
  merged over the restored hub.db at wake. Verified (legacy-hardkill.mjs): a
  canvas edited and one created after the last generation, SIGKILL with both
  disks replaced — both back, 2 states replayed, no generation in between.
- [x] **G4 — A fresh link's canvases do not hold up the first edit.** **`93951124`**
  — creates within 25 ms travel as one proposal; a refused batch falls back
  to one each; no edit overtakes its canvas's create. (Was: 77 serialized
  `doc.create` proposals delayed the first edit 44 s on the cloud.)
- [x] **G5 — Removing a member ends their cell sessions immediately** **`b99e12e9`**
  — the control plane knocks `/internal/revocation-sweep` right after it
  writes the revocation; a knock during a running tick is queued. Verified by
  tests on both sides; a live-cloud check needs a deployed cell (the isolated
  one was deleted). The revocation sweep stays as the backstop.
- [x] **G6 — The hub suite once reported 996 of 1,002 tests** **`98ccb726`** — a
  preloaded guard fails a file that exits before its tests finish; the second
  early exit (history) came at a suite boundary under --test-force-exit, which
  the script no longer passes (every run since: all tests reported).
- [x] **G7 — `MAUDE_CELL_PAIRING` on by default for self-host workspaces** **`4ada0414`**
  — verified first: on the production self-host image in accepted mode an
  unpaired browser comment never became an accepted action (S09 failed; the
  same image passed paired). workspace-plan emits it; a hub with an unpaired
  browser studio refuses the switch (409 browser-not-paired) and says so.
  **Operator note:** an existing self-host created before this (StudyFi
  `design.studyfi.com` per the 2026-09-13 audit) needs `MAUDE_CELL_PAIRING=1`
  in its environment; if it is already in accepted mode, its browser edits do
  not reach the project today.

## Close-out security review (2026-09-25)

Defender + attacker both returned **NEEDS FIXES** on the committed diff; all
blocking findings fixed before the close commit (reports in
`.ai/logs/security-reviews/followup-multiplayer-hardening-{defender,attacker}.md`):

- **Import that can never finish froze the project** (M1/A1/chain 1): the
  cloud store refused any lane over 2 MB (Durable Object row limit) while a lane
  may be 4 MB, the kernel calls every store failure `retryable`, and the G1
  resume looped forever holding every proposal and the owner's rollback. Now the
  store keeps large bodies in parts (`blob_parts`), the resume is bounded (13
  attempts ≈ 10 min) and any `setMode` cancels it.
- **Deleted canvases could come back after a hard kill** (M2/A2/A3): a save
  pending at delete time erased the marker. Now tombstoned names get no state,
  writes of one name are serialized, deletion replays last, and an accepted-mode
  delete purges the legacy-era entries.
- **Shared bucket root** (A4): tail keys carry the workspace identity; a hub
  replays/rotates only its own entries at a shared root.
- **Proposals held behind a switch pinned their bodies** (chain 2): read-only
  refused and the switch awaited before the body is read; at most 64 wait.
- Also: bounded `flush()` before the final backup (A5), no DELETE per save (A6),
  per-write credential resolution, create-batch fallback ordering (A7),
  loopback studio token is a `member` not admin (A8), tail replayed on
  seed/fresh boots (A9).
- Follow-ups (not blocking): purpose-scoped nudge secret; attribute browser
  edits to the browser user instead of `cell-loopback-sync`; kernel
  classification of permanent store errors.

## Retro

- **The cloud-shaped local fixture paid for itself.** RustFS + a node:sqlite
  ProjectStore with DO-like latency reproduced G1 and measured G2 without a
  cloud account; keep it as the default for multiplayer work instead of an
  isolated cell.
- **A resilience fix needs an adversarial pass on its failure path.** G1's
  "keep resuming until it lands" turned a transient-error fix into a
  project-wide freeze for a *permanent* error; the review, not the tests, found
  it. When adding a retry loop, ask in `/plan` what a permanent failure does
  and bound it by construction.
- **Check platform limits against our own limits.** A 4 MB lane cap next to a
  2 MB Durable Object row limit was latent since DDR-241's cloud rollout; G3a
  (accepted by default) would have made it a first-save failure for new cloud
  projects.
- **Write-behind needs the same identity and ordering rules as backups.** The
  first G3b cut copied the backup's rotation but not its workspace ownership or
  per-name causality; both came back as review findings.
- **Verify on the real image, not only unit tests.** G7's S09 run on the
  production image proved the pairing gap was real before changing a default.


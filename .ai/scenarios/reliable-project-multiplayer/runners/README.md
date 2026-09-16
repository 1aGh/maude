# Local multiplayer surface runner

The runner records real observations from a real three-participant rig. It still
does **not** certify T1: `baselineComplete` is false in every artifact it writes,
because the catalogue is not fully enumerated (24 per-surface contract actions
are still carried as unresolved requirement rows) and rAF-placed resize rows are
`not-run` on a locked screen. Nothing here claims the L01–L24 matrix is complete.

What it does do is **compare**. A candidate run given `--baseline <dir>` is judged
against a preserved run cell by cell, and a cell that passed then and does not
pass now — including one that merely stopped being run — fails the run:

```sh
bash runners/local-e2e.sh --mode candidate --baseline .ai/device/scenario-runs/reliable-project-multiplayer/<stamp>
```

`baseline-comparison.json` lands beside the run's other evidence. The comparison
is one-directional on purpose: repairs and brand-new cells are reported, never
required, and no tally a candidate reaches on its own can buy back a cell the
baseline had.

Two lanes over that same single rig (there is only one — what is under test is
what travels *between* surfaces, so a native-only run would have nobody to send
to). Each judges only its own rows plus the rig's shared observations, and a
lane that executed none of its own rows fails:

```sh
bash runners/native-macos.sh  --mode candidate --save-mode accepted
bash runners/web-desktop.sh   --mode candidate --save-mode accepted
```

**Run it on a machine whose screen stays awake for the whole run.** WebKit
paints no animation frames in a window that is not rendering, so a display that
locks mid-run takes every rAF-placed row with it — resize handles never appear,
and a soak that lasts minutes is the likeliest row of all to meet a screen that
went dark halfway through. Those rows decline to judge rather than fail, which
is correct and is also why a run on a locking machine can never certify: the
candidate comparison reads "used to pass, now does not run" as a regression,
which is exactly what it should do.

```sh
pnpm test:e2e:desktop:build
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline

# Narrow diagnosis; excluded cases stay explicitly not run.
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L06
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L06.ui-text-edit --samples 100
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L09.sticky
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L12.upload,L13.photo,L22.viewer
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L14.upload-video
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L09.pen,L09.highlighter,L09.arrow,L09.text,L09.section,L09.eraser
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L01.empty-folder.move,L01.empty-folder.delete,L01.empty-folder.rename,L09.shape

# Retain the shared-canvas sequence after another participant's undo.
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --only L09.sticky --notes shared

# Separate container-style watcher lane. This is not a Cloudflare durability test.
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode baseline --watch control
```

The test uses a real local cell, independent project directories, a bundled
WKWebView participant and two Chromium contexts. The debug app is isolated by
bundle ID and WebDriver port. Run with an awake macOS display. The fixture and
credentials are created in a private temporary directory, printed through its
evidence metadata. Production projects and hub credentials are not used.

Cross-origin isolation remains enabled. `MAUDE_E2E_FRAME_PROBE=1` enables a
debug-only, source/origin-checked DOM bridge for native observations and synthetic
UI gestures. No shared application stores or sync APIs are invoked to simulate
an editing action. The native release build excludes this bridge. Rebuild the
debug app after changing its JavaScript initialization source.

Implemented checks include source saves and atomic saves, canvas text editing,
empty-folder creation, canvas create/open/move/delete, sticky create/text/move/
resize/paper color/delete/undo/redo, known-pixel PNG and decoded MP4 playback/seek,
distinct PNG drops from every author and image-reference deletion, a viewer UI
fixture session, and reopening an already active canvas. Photo brightness/reset
has been exercised in all directions (with a native-reset failure). Empty-folder
delete has been exercised and fails remotely. All six shape variants now have
create/move/resize/delete checks; early results retain deletion failures after
the first shape in a sequence. Folder move fails remotely. Pen/highlighter/arrow
create/move/resize/delete and text/section editing are exercised. Eraser delete
passes; its undo fails receiving views. Standalone text has no drag-resize handles.
Cold MP4 uploads use distinct hashes for every author: cards/bytes arrive and
reference deletion passes, but receiving playback fails after early asset 404s.
The mandatory playback/decoded-frame check is separate from card visibility. This list is **partial**: exposed tool
variants, uploads, other media controls, roles, offline/concurrency, topology,
statistical timing and soak requirements remain in `../local-e2e.md`.

Results live under `.ai/device/scenario-runs/reliable-project-multiplayer/`:

- `surface-results.json` and `report.md`: original successes, failures and unrun cases.
- Source, bundle and fixture manifests: exact inputs; final file manifest when available.
- Screenshots, per-operation annotation SVG and text TSX/heading snapshots: UI and persistence evidence.
- Upload input manifest: files outside project roots, delivered through actual canvas drop handlers.
- Driver result and timing summary: completion, missing/failed samples and provisional observations.
- `source-audit.json`: Bun syntax checks plus final snapshots versus expected TSX (valid stale source is still a mismatch).
- `resource-samples.jsonl`: owned process CPU/RSS and host load every five seconds, with stated measurement limits.
- `coverage-catalogue.json` and `coverage-results.json`: source inventory and exact case/direction observations; unexpanded/missing cases remain explicit.
- Browser event logs: attributed page errors, failed/HTTP-error requests and frame navigations, without URL queries. Native navigation events are not yet measured.
- `native.log` and `driver/`: native driver output; backend logs remain in the scratch directory.

Exit **2** means incomplete evidence, even when WDIO completed successfully.
Exit **1** means the driver or setup failed. No current invocation certifies a
regression comparison; `candidate` is reserved as a labeling mode. `--samples`
currently repeats only the UI text lane, round-robin across all three authors.
Every attempt keeps its sample index and separate screenshots. The timing
summary refuses p95 below 100 samples, p99 below 1000, and any percentile that
would silently drop a failed, missing or duplicated observation. These are still
provisional run statistics until observer calibration and matched passes pass.

`--notes isolated` (default) uses a fresh seeded canvas per originating direction.
`--notes shared` retains all participants' actions and undo residue in one canvas.
Both profiles are required evidence: a passing isolated result cannot replace a
failed shared-session result. This parameter and its fixture hash must match in
any later comparison.

Per-operation observation deadlines remain 15 seconds. The larger Mocha timeout
only accommodates the growing full catalogue. Preparation opens a canvas only
when needed; no receiver refresh or retry repairs a timed mutation. The separate
active-canvas reclick case deliberately exercises that UI action.

The DOM observer rejects shell loading/error overlays and distinguishes an
unavailable frame from a missing target. Successful removal requires a live
canvas without the deleted annotation, plus matching persistence where specified.
An absent iframe or error panel must never pass a deletion assertion.
UI and persistence are observed concurrently. After both finish, a fresh snapshot
must still agree before the next author acts; first-effect timings do not hide a
later reverted edit. Earlier evidence retains the observer version recorded by
its source manifest and is not retroactively labeled as using this stronger check.

The source-backed coverage inventory is intentionally incomplete. Its drift
test catches changed annotation/photo registries; adding an item to this list
does not count as testing it. Review new controls before regenerating with
`node scripts/dev/sync-e2e/surface-catalogue.mjs --write`.

# Execution checkpoint — reliable project multiplayer

T1 is **in progress and remains incomplete**. The earlier environment block was resolved after the user enabled full access. The user's active goal now authorizes
iterative repairs with E2E verification after each change: the partial baseline
below is preserved, and T2 containment has started. T6 has an independent contract
draft, executable schemas and writer registry. T7/T8 now have isolated runtime
experiments; dependent production integration remains gated. All task checkboxes
remain incomplete. Latest evidence is appended below; earlier entries retain
the observations and failures from their original run.
No changes have been committed, deployed or migrated.

Full baseline coverage remains required alongside the repairs and before rollout.
A successful local hub health request or native build cannot substitute for
receiving UI, media playback and multiplayer evidence. Baseline results below
predate the first candidate source change and must not be relabeled as its results.

## Current verified outcomes — 2026-09-14

These are partial baseline observations on unchanged production sync. They do
not certify the whole plan, performance targets, or all variants of a surface.
All directions below mean hub browser, native WKWebView and independent sidecar
as authors, each observed by both already-open peers.

| Surface | Verified result | Latest evidence / limit |
|---|---|---|
| UI source text, long sequence | 223 of 300 actions pass; 77 fail. Fifteen edits revert on every disk; later hub rendering stalls while disk updates. | `06-56-28.401Z`; 1,239 parse checks clean, 45/900 final source mismatches; not the required mixed soak |
| Empty directories | Create/move/delete succeed locally and fail on both remote UI and disk in every direction. Rename UI absent. | Move `07-43-17.688Z`, delete `07-29-34.514Z`; earlier move harness errors excluded |
| Six geometric shapes | All create/move/resize pass; 3 first deletions pass and 15 subsequent deletions leave remote ghosts. | `07-37-04.751Z`; content-history echo guard identified below |
| Pen/highlighter | Create/move/resize/delete pass in every direction. | `07-43-17.688Z`; fresh canvas per tool/author |
| Arrow | Create/move/endpoint-resize/delete pass in every direction. | `07-47-25.822Z`; corrected endpoint selector |
| Standalone text | Create/edit/move/delete pass in every direction; no drag-resize handles. | `07-47-25.822Z`; font-size controls not yet covered |
| Section | Create/edit/move/resize/delete pass in every direction. | `07-50-50.129Z`; measures region rectangle separately from label |
| Eraser | Erase passes; undo restores locally but fails both receiving UIs; dependent redo unexercised. | `07-50-50.129Z` |
| PNG intake/photo | Real drops, decoded pixels and reference deletes pass; brightness passes, native reset reverts. | `06-51-38.308Z`, `06-54-31.994Z` |
| Cold MP4 intake | Reference/card and bytes arrive; author can play, both receivers fail playback after an early 404 in every direction. Reference deletion passes. | `07-57-52.762Z`; distinct per-author hashes, retained media errors and network evidence |
| Seeded MP4 | All three renderers decode, play and seek to distinct known-color frames. | `06-12-31.155Z`; upload lifecycle verified separately below |
| Viewer | Fixture-provisioned read-only UI passes. | `06-51-38.308Z`; real invitation and server write rejection not certified |

Full run-directory names begin `2026-09-14T` and live under
`.ai/device/scenario-runs/reliable-project-multiplayer/`. The following sections
retain the original attempts and later corrections; historical harness failures
must not be reclassified as product defects.

## Original prerequisite evidence and attempts — 2026-09-13

Evidence root:
`.ai/device/scenario-runs/reliable-project-multiplayer/2026-09-13T19-45-09.454Z/`.
This directory is intentionally ignored; this checkpoint preserves the findings.

| Check | Actual result | Evidence / implication |
|---|---|---|
| Shared source | Last sync change remains `01bdcfdc`; concurrent unrelated work advanced HEAD during preflight | `source-manifest.json` records exact observed HEAD and SHA-256 of permitted tracked runtime files; this is provenance, not a completed baseline |
| Local workspace hub | Started on loopback port 18699; health 200, hub 1.2.0, studio ready, live pairing enabled | Throwaway project `/tmp/maude-multiplayer-baseline-20260913`; stopped at teardown and verified unreachable |
| Browser attempt 1 | Chromium exited with SIGTRAP before any page or product action | `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.…: Permission denied (1100)` |
| Browser attempt 2 | Committed prerequisite runner reproduced the same launch restriction | `browser-launch.log`; `preflight.json` has `baselineComplete:false` and all L01–L24 `not-run`; command exits 2 |
| Native build in shared checkout | Failed in `stage-resources.mjs` at recursive removal of generated `src-tauri/resources` with EPERM | No permission escalation or changes to protected files attempted |
| Isolated native build preparation | `pnpm exec` wanted to reinstall/remove the shared linked modules tree and refused without TTY | Did not consent to module removal. Invoked the already-installed Tauri binary directly instead |
| Isolated native build | **Passed** `tauri build --debug --config src-tauri/tauri.e2e.conf.json` | Permitted tracked source copied to `/tmp/maude-multiplayer-native-baseline-20260913`; denied env/key/secret paths excluded; source studio release binary copied; installed modules reused |
| Bundled native launch | Existing WDIO app-boot prerequisite failed before its first assertion; process exited SIGABRT before embedded driver readiness | `native-launch.log`; not a native sync pass |
| Native diagnostic retry | Same SIGABRT with `captureBackendLogs:true` in the isolated config; captured backend log was empty | `native-launch-diagnostic.log`; native crash cause not established, and no claim that it is the Chromium failure |
| Live version recheck, 19:46 UTC | StudyFi and Alligators both report 1.2.0; StudyFi identity off, Alligators hybrid | `deployment-health.json`; updates the earlier audit's dated StudyFi 1.0.9 observation. No config or production data changed |

The isolated native bundle is at
`/tmp/maude-multiplayer-native-baseline-20260913/apps/desktop/src-tauri/target/debug/bundle/macos/Maude.app`.
The test used the distinct `com.maude.app.e2e` identity, `maude-e2e` scheme,
embedded driver port 4455, `MAUDE_NO_AUTOBUILD=1`, no-keychain debug stub and
scratch hub/cloud credential paths. Its copied fixture is independent of user
projects. No real invite or designer membership flow was exercised.

## Changes made and verification

- Added `scripts/dev/sync-e2e/surface-preflight.mjs` and the thin scenario
  `runners/preflight.sh`. They record source identity and reproduce the browser
  prerequisite. They deliberately never create `baseline.json`, never report
  product tests as passed and return incomplete status even if browser launch
  works. The full `local-e2e.sh` and operation adapters are still unimplemented.
- Added dated scope notes to the actual PRD and native epic, retaining history.
- Started the plan and recorded this checkpoint without checking off T1.
- Corrected roadmap generation so a newly active graph-era plan cannot inherit
  the old release's `done` status/branch from unrelated legacy STATE metadata.
  Regenerated the roadmap from the current shared tree.
- Scoped Biome checks and Node/Bash syntax checks pass. The preflight command
  exits 2 with a retained launch log as intended; that verifies honest failure
  reporting, **not** T1 completion. No full product test gate is claimed.

## Resume

### User-requested retry — 2026-09-13, 19:52 UTC

Both prerequisites were executed again, retaining earlier evidence:

- Browser: `2026-09-13T19-52-09.928Z/preflight.json` and `browser-launch.log`
  under the same scenario-run root. Chromium again failed before page creation
  with `bootstrap_check_in … MachPortRendezvousServer: Permission denied (1100)`.
- Native: `retry-native-20260913.log` under the scenario-run root. The existing
  isolated bundle again exited SIGABRT before WebDriver readiness (exit 1).
- The macOS diagnostic report `maude-desktop-2026-09-13-215213.ips` locates the
  native abort in `___RegisterApplication_block_invoke` → `_RegisterApplication`
  → `GetCurrentProcess` → `NSApplication init`, during Tauri event-loop startup.
  A sanitized excerpt is retained as `2026-09-13T19-52-09.928Z/native-crash-summary.json`.
  This narrows the failure to native application initialization; it does not
  establish the exact OS denial or prove that it shares Chromium's cause.

T1 remains blocked and no sync behavior changed. The current execution profile
still does not permit requesting escalation. Repeating the same launches has
not changed the environment. No required case was relabeled as passing.

### Requested ordinary dev launch — `pnpm dev:desktop`

Ran the exact root package script in a PTY, with only scratch project/credential
paths and `MAUDE_NO_AUTOBUILD=1` plus the existing no-keychain debug stub in the
environment. This did not use WDIO or the E2E Tauri config. The command exited 1
in `beforeDevCommand`, before Cargo/app launch:

```text
Error: EPERM, Operation not permitted:
/Users/iagh/git/personal/maude/apps/desktop/src-tauri/resources
at rmSync (node:fs:1235:18)
at apps/desktop/scripts/stage-resources.mjs:72:1
```

The sidecar/CLI/agent-browser/kg staging steps preceding resource staging
completed. Ordinary `pnpm dev:desktop` therefore also cannot launch from the
shared checkout in this session; this attempt establishes a build-preparation
permission failure, not a sync failure or a completed desktop test.

### Continuation requirements

Further diagnosis: the resources directory is owned by UID 501 (the current
user), mode 0755, with no immutable flag shown. A newly created, non-sensitive
directory containing only `probe.txt` also failed recursive removal with EPERM.
The retained throwaway directory is
`apps/desktop/src-tauri/.permission-probe-mstBg5`. No chmod/sudo workaround was
attempted. This makes a resources-specific ownership problem unlikely.

The local launcher is relevant: `~/.claude/bin/codex` resolves through Maude;
global Claude settings select `bypassPermissions` with protected-file Read
denies. `cli/lib/harness/codex-runtime.mjs:239` maps that mode to
`approval_policy="never"` plus a named filesystem/network permission profile,
not to unsandboxed execution. `cli/commands/codex.mjs:49` rejects CLI permission
overrides that could discard those denies. The generated profile is consistent
with this session's effective restrictions, though the exact Seatbelt rule
behind each failure has not been captured. No launcher/security setting was
changed during diagnosis.

1. Use an interactive macOS execution environment that permits Chromium launch
   and the bundled Tauri app's embedded WebDriver. The current session cannot
   request permission escalation. Diagnose the native SIGABRT separately if it
   persists there. Do not disable sandbox/origin/trust checks in the product.
2. Re-run `bash .ai/scenarios/reliable-project-multiplayer/runners/preflight.sh`.
   Its scope is prerequisites only and its exit status remains 2 by design.
3. Finish T1: explicit catalogue of every exposed tool/control, UI action
   adapters, independent browser plus two desktop participants, designer/viewer
   roles, standalone/cell and watcher/no-watch modes, real decoded image/video
   fixtures, both receivers without refresh, matched warm latency samples and
   the fixed 30-minute soak. Preserve actual baseline failures with repair owners.
4. Only the complete measured surface baseline unlocks T2–T5. Do not promote
   these environment reports, API-only results or old `expected-pending` checks
   into passing E2E evidence.


## Full-access continuation — 2026-09-13, 21:14 UTC

The user enabled YOLO/full access in Codex desktop and authorized continuation.
Chromium DOM preflight passed (`2026-09-13T20-44-08.699Z`). Ordinary
`pnpm dev:desktop` built successfully and connected the isolated desktop project
to the local hub. It was stopped after this verification. Native bundled builds
through `pnpm test:e2e:desktop:build` also now pass in the shared checkout.

Three independent test infrastructure issues were found and contained:

1. WDIO's Undici 6 fetch combined with a newer global dispatcher rejected POST
   /session with `UND_ERR_INVALID_ARG: invalid content-length header`. A loopback
   reproduction confirmed the mixed-version failure and the same-version fix.
   `beforeSession` resolves and installs the dispatcher through WebDriver's own
   dependency chain, without upgrading shared dependencies.
2. Launching the bundled executable through `/tmp` failed Tauri's sidecar
   resolver: `StartingBinary found current_exe() that contains a symlink on a
   non-allowed platform: /tmp`. The shared WDIO app override now uses `realpathSync`.
   This is separate from the earlier sandbox denial.
3. Existing WDIO config sets `MAUDE_CANVAS_ORIGIN_SPLIT=0`. That correctly disables
   TSX sync (DDR-060), so it cannot certify multiplayer. The dedicated config
   sets it to `1`. A debug-only, environment-opt-in native initialization script
   exposes bounded DOM/media observations via source/origin-checked postMessage.
   It does not disable same-origin enforcement or expose Tauri commands to a canvas.
   An actual two-origin Chromium test proves the iframe remains inaccessible by
   `contentDocument`, the probe reads rendered DOM, unsupported mutation requests
   do not change the DOM, and another sender cannot spoof the response.

The thin `local-e2e.sh` now runs a real cell, two independent project copies,
member identities and a bundled native participant. It writes partial evidence,
never a certified baseline. Failed and not-run rows stay explicit. Original API
runner's false-green pending paths are not reused.

### First real UI/media run

Evidence: `.ai/device/scenario-runs/reliable-project-multiplayer/2026-09-13T21-14-16.079Z/`.
The native app uses `com.maude.app.e2e`, port 4455, no-keychain debug stub, isolated
hub/cloud credentials and the normal cross-origin TSX sync gate. Hub and peer
browser contexts are independent. All three open the fixture before mutation.

- **Passed:** actual heading render inside all three canvas documents.
- **Passed:** external source saves from hub/native/peer directories appear in all
  receiving canvases without refresh, with identical TSX SHA-256. Single observed
  receiver times were roughly 1.1–1.3 seconds. This is an external editor lane,
  not yet a UI text-editing or statistically certified latency result.
- **Passed:** a PNG seeded only at the hub downloads to both local copies, has
  identical SHA-256, decodes to 8×8 and the known pixel `[111,159,21,255]` on all
  three UIs.
- **Passed:** MP4 seeded only at the hub downloads byte-identically; all three
  render 160×90, playback advances, and seeking from 0.2 s to 1.4 s changes the
  decoded frame from red to blue. WKWebView color conversion differs slightly
  from Chromium, so the test uses bounded dominant-color checks plus byte hashes.
  These checks do not yet exercise UI upload or asset editing/removal.
- **Observed issue:** new canvases arrive in receiving file trees in roughly
  3–12 seconds; native→second-peer missed the 15-second observation deadline.
  Later sidecar logs show the file eventually pulled. No forced refresh used.
- **Harness correction required:** the empty-folder test called `.gitkeep` a
  nonempty directory. Product `createFolder` intentionally writes an empty
  `.gitkeep` (api.ts); it must be recorded as a sentinel, not a user child canvas.
  These three failing rows do not yet establish failed directory sync.

T1 is still incomplete. The full L01–L24 variant/direction/role catalogue,
annotation and editing actions, UI uploads, move/delete/history/offline/conflicts,
additional topology profiles, calibrated timing distributions and soak remain.
No production sync behavior, deployment, production data, Git commit or push
was changed. Only the opt-in debug test instrumentation touches native runtime source.

## Continuation — 2026-09-14: directories and open-canvas moves

The corrected empty-folder check accepts only a zero-byte `.gitkeep` sentinel.
Run `2026-09-13T21-22-09.189Z` exercised all three UI origins: all six remote
observations missed the 15-second deadline. This is now a measured baseline gap,
separate from the earlier erroneous nonempty-directory assertion.

Run `2026-09-14T05-47-40.258Z` repeated L01 and expanded L04. All three newly
created canvases could subsequently be opened and actually rendered on all
participants. Native→second-peer creation again missed the original deadline;
later scenario preparation does not turn that failed observation into a pass.

All three UI-originated moves succeeded locally (roughly 0.54–1.49 seconds), but
all six receiving open canvases failed to follow their new path within 15 seconds.
The native screenshot `L04-move-hub-to-native.png` shows the original path and
rendered content while the status bar says `HUB SYNC synced`. The dependent delete
cases could not establish their required moved-file/open-tab preconditions;
those rows are **unexercised deletes**, not evidence of a delete regression.
Independent seeded delete fixtures are being added so a move failure cannot mask
the separate delete contract.

Each new run records source, native bundle and fixture manifests in addition to
screenshots and structured observations. These are exploratory partial runs;
none emits `baselineComplete: true` or a certified `baseline.json`.

The opt-in debug frame probe now also supports bounded synthetic DOM pointer,
keyboard and contenteditable input, following the native harness convention.
It invokes actual UI handlers without direct application-store/API writes.
The two-origin test verifies real click/drag/text handler effects and continues
to assert same-origin isolation, unsupported-operation rejection and sender
validation. Release builds exclude the instrumentation. Sticky-note create,
text edit, move and remove scenarios are the next native three-participant run.

### Independent deletes and sticky-note UI/persistence

The first independent-delete run (`2026-09-14T05-54-16.993Z`) found an observer
race: Playwright's separate count/visibility/text calls could lose a row between
calls and wait 30 seconds for an element that correctly disappeared. The reader
now takes one atomic DOM snapshot. The same run's sticky move/delete selector
was also corrected: DDR-223 replaced the old Select tool button with the Edit
mode segment. Neither failure is counted as a product defect.

Corrected run `2026-09-14T05-56-13.941Z`:

- Independent canvas deletion succeeded at each originating UI, including
  removal of its active frame. All six remote observations failed the unchanged
  15-second deadline. Each receiver had already rendered the seeded canvas before
  deletion, so this is not an absent→absent assertion.
- Sticky creation, text edits and moves passed all three directions and actual
  rendered receiving DOM. Hub-originated sticky deletion passed; native and
  second-sidecar deletion disappeared locally but failed on both receiving UIs.
- Final retained SVGs on all three disks contained the native sticky again.
  This is evidence that a local disappearance did not guarantee durable deletion;
  the exact reintroduction path still needs RCA. It resembles the historical
  `sync carries presence, never absence` RCA (`d_00868237b0aa5621ce0bc091`), but
  that similarity alone does not establish the same current cause.

Expanded run `2026-09-14T06-01-41.344Z` captures per-operation SVG snapshots and
separates actual UI observation from persisted SVG confirmation:

- **Passed in all directions:** sticky create, text edit, move, resize through
  the real corner handle, and paper color through the properties toolbar.
- **Passed:** hub-originated delete, both receiving UI absence and SVG absence.
- **Failed:** native/second-sidecar deletes on both receiving clients, despite
  immediate local UI and disk removal.
- **Failed:** hub Undo after its successfully propagated delete restored the
  sticky locally but neither receiver showed the restored note within 15 seconds.
  Native/peer undo after an unpropagated delete is unexercised; downstream redo
  precondition errors likewise do not prove that redo itself was executed.
- Individual text/color UI observations were roughly 9–55 ms; synthetic drag
  observations include their deliberate ~180 ms gesture duration. Remote disk
  projection commonly completed around 0.85–1.13 seconds. These are exploratory
  samples, not p95/p99 estimates or proof of the 20 ms observer budget.

`surface-report.mjs` now renders a readable `report.md` beside structured results
and screenshots, explicitly stating that successful WDIO driver completion is
not product acceptance. T1 is still incomplete; passing sticky cases do not
represent the other annotation tools, history variants or full L01–L24 matrix.

### Observer correction and clean reruns — 2026-09-14

The conclusions above are historical observations, qualified by the following
clean reruns. Screenshot review found that clicking an already active canvas
could put a load-error overlay above an otherwise rendered iframe. The old probe
could read that hidden content and treated an unavailable frame like a missing
annotation. Those observations alone cannot prove visible editing or deletion.
The probe now rejects loading/error overlays and distinguishes an unavailable
frame from an absent target. The two-origin probe test covers that distinction.
Preparation no longer clicks a canvas that is already active; a separate L05 case
explicitly exercises that action. Cross-origin protection remains enabled.

Clean expanded run `2026-09-14T06-12-31.155Z` confirms:

- Empty-folder creation, open-canvas moves and independent canvas deletions
  each fail at all six receiving observations within the original 15 seconds.
  Each originating operation succeeds. Dependent deletes remain unexercised
  when their move prerequisite fails.
- Ordinary and atomic external source saves pass all three directions.
- Seeded PNG decoding and MP4 playback/seek pass all three actual renderers.
- Clicking the already active canvas produces a blocking load error in all
  three shells after roughly 15 seconds. Source inspection identifies a concrete
  path: `openTab` resets `loadedPath` and starts `loadingPath`, but the unchanged
  iframe key causes no new load notification. The load cap then reports a server
  failure. T22 must cover this entry/open-state bug. No production fix was made.

The expanded run's first two UI-text cases lacked a mounted editing toolbar;
these were unexercised preparation failures. Waiting for the heading and toolbar
corrected the precondition. Run `2026-09-14T06-20-05.872Z` then passed all three
UI-text directions, checking visible receiving headings and exact whole TSX bytes.

Sticky results must distinguish two workload profiles:

- **Isolated canvas per author**, shared with both receivers: create, text edit,
  move, resize, paper color and delete all pass in all directions in
  `2026-09-14T06-20-05.872Z`. Undo-delete restores locally but fails at both
  receivers for **every author**. Redo is unexercised when restoration is absent.
- **One shared canvas across authors**, retaining previous undo effects:
  hub deletion passes, its undo fails remotely, and subsequent native/peer
  deletions fail remotely. The clean normal-watcher run above and control-only
  run `2026-09-14T06-22-37.799Z` retain this sequence. A passing isolated run
  cannot replace this shared-session failure. The earlier shared resize failure
  is not established as a sync defect; the isolated resize passes.

The control-only run also exposes a distinct source-watcher gap. All three UI
text edits pass, but every ordinary/atomic external-save case fails: hub-origin
external saves fail all renderers; desktop-origin external saves reach the other
desktop but miss the hub view. This is a local container-style watcher profile,
not a Cloudflare storage durability certification.

The runner now preserves profile settings, runtime/source/bundle/fixture identity,
per-operation SVG snapshots, and separate UI/persistence observations. New text
runs additionally capture expected/observed TSX and receiving heading/error
snapshots. Timing summaries reject percentiles when observations are missing,
failed or duplicated; p95 needs 100 samples and p99 needs 1000. Observer overhead,
three matched warm passes and the complete matrix/soak remain unverified.

Run `2026-09-14T06-26-48.077Z` verified two UI-text samples per author (six actions).
The subsequent 100-sample-per-author run `2026-09-14T06-28-41.549Z` recorded
208 actions (199 passed, nine failed) before Mocha's whole-scenario 900-second
budget aborted it. Hub completed 70 attempts and failed samples 25, 26, 28, 29,
47, 49 and 69; native completed 69 attempts and failed sample 49; the second
sidecar completed 69 attempts and failed sample 48. This is an incomplete series,
not a 300-action pass and not a latency certification. The next runner scales
the whole-suite budget with workload, preserving the 15-second per-action
deadline. Driver exit and expected sample count now invalidate all percentiles
for an aborted run, including otherwise passing receiver groups.
Sample 25's native screenshot shows the previous peer text on a healthy visible
canvas while the status says `HUB SYNC synced`; it is not the overlay issue.
Run `2026-09-14T06-44-35.224Z` passed all six UI text edits and verified the new
per-receiver TSX/heading snapshots. Its viewer case did not establish a browser
session: the initial fixture used a bearer header, whereas the hub's studio UI
requires the scoped token in its session cookie, with an owner and project role.
This is a test preparation failure, not an authorization defect. The corrected
viewer fixture is being verified separately and does not claim a real invitation
flow. T1 remains incomplete, and no production behavior, deployment, commit or
push has changed.

### Real image intake and viewer surface — 2026-09-14

Run `2026-09-14T06-51-38.308Z` passes nine rows (two bootstrap, six image actions,
one viewer check), with the remaining matrix explicitly unrun:

- Each of hub, native WKWebView and second sidecar drops a distinct PNG through
  actual `DataTransfer`/DOM drag-and-drop handlers. Input files live outside all
  project roots; the app performs its own upload. All receivers show the SVG
  image, decode the expected 8×8 pixel pattern and persist the identical SHA-256
  blob plus annotation reference. Remote observations were approximately
  0.99–2.07 seconds in these single samples. Native screenshots also show the
  actual inserted image and selection handles.
- Deleting each uploaded image reference passes all receiving visible-absence
  and annotation-file assertions. This does not certify orphan-blob GC, history
  retention, batch upload, large files, JPEG/SVG or video intake.
- A viewer-scoped fixture session renders the real canvas while creation and
  annotation editing controls are unavailable, and double-click cannot enter
  source editing or change source bytes. The session is fixture-provisioned;
  invitation, real account login and server-side hostile-write rejection remain
  separate requirements. The previous viewer attempts used the wrong auth
  carrier and then `/studio/`, which is not the studio's root route. Those were
  harness preparation errors; the corrected run uses the session cookie and `/`.

The debug-only bridge gained bounded file-drop gestures and decoding of the
visible SVG image's resource. Its two-origin test verifies transferred file
bytes and rejection of unsupported payload paths; the rebuilt native app and
scoped TypeScript checks passed. This changes only opt-in test instrumentation.

Run `2026-09-14T06-54-31.994Z` adds the real Photo inspector brightness control
and its reset button. Brightness changes reached rendered pixels and persisted
parameters in every direction (individual receiving observations approximately
1.77–9.70 seconds on this busy host). Hub and second-sidecar reset passed. Native
reset briefly restored the original pixel locally, but persistence stayed at
`brightness: 0.25`; all three final JSON files and image pixels were back at the
brightened value. This is a failed reset, not a successful local save followed
only by slow networking. T26 owns photo action integration; projection/import
containment also needs this regression in T2/T14/T17.

The next 100-sample series, `2026-09-14T06-56-28.401Z`, retains per-step TSX
snapshots. Hub sample 11 initially passed its local visible/persisted check,
but before the next action all three files and visible headings had reverted to
`UI edited by peer sample 10`. Both receiver checks failed. The source remains
parseable in that example; it is a lost edit, not demonstrated syntax corruption.
The test observer now additionally checks final UI and persistence snapshots
before returning from each action, preserving first-effect timings separately.
That stronger check applies to subsequent runs, not retroactively to this series.

Host load was approximately 17 on ten cores during this series. These samples
cannot establish a controlled performance baseline. Future runner launches
record owned process ancestry/CPU/RSS and host load every five seconds, with
explicit exclusions for OS-owned webview services and unmeasured app queues.
No unrelated process is killed to improve results.

`coverage-catalogue.json` now lists 274 source-enumerated items and unresolved
requirements across L01–L24. It expands the eight annotation tools, six shape
variants, context controls and photo controls from actual source registries.
A drift test prevents changed registries from silently leaving the committed
inventory behind. This catalogue is explicitly incomplete: richer domain menus,
mutation-handler bindings, role/load profiles and applicability still require
review. Listing a case is not execution; exact matching observations are recorded
separately and absent cases stay unexercised.


### Completed 300-action text series and shape lifecycle — 2026-09-14

Run `2026-09-14T06-56-28.401Z` completed all 100 UI text actions per author:
**223 actions passed and 77 failed** (plus two bootstrap passes). Fifteen hub
samples failed: 11, 13, 20, 21, 22, 42, 45, 46, 52, 55, 58, 60, 62, 68 and 70.
For each of these, all three final TSX snapshots reverted to the preceding text.
Native and peer each failed every sample from 70 through 100: the hub's disk
contained the new expected source, while its already-open canvas retained the
older heading. The native and peer views continued updating. These distinguish
lost edits from a stale receiving render; the exact production causes remain
unconfirmed.

The post-run Bun audit parsed **1,239 TSX files/snapshots with zero syntax
failures**. Of 900 expected-versus-final snapshot comparisons, 45 mismatched
(the fifteen hub failures on all three disks) and none were missing. This run
reproduces valid-but-stale source, not the reported malformed-TSX incident.
Timing reconciliation invalidates samples whose final source reverted, including
an initially passing local observation; the original raw rows remain preserved.
This was a text-only series on a busy host, not the required mixed-workload soak
or controlled latency certification. Continuous resource sampling was added
after it launched, so no such record is claimed for this run.

Run `2026-09-14T07-29-34.514Z` separately exercises folder deletion and square/
rounded-square create, move, resize and delete. All three folder deletes succeed
locally but miss both receiving UI and disk within 15 seconds. Folder menus on
all participants expose new/delete and no rename; rename is unsupported in this
baseline. The three folder-move rows are unexercised harness failures: transpiled
function serialization referenced an unavailable `__name` helper in the browser.
They must not be classified as demonstrated move defects.

Both shape types create, move and resize in every direction. Square deletion
passes all directions. Rounded-square deletion fails all six receiving UIs even
though their persisted SVGs remove the shape in approximately 1.1 seconds.
Screenshots show the remaining rounded square on an unobscured canvas, including
`HUB SYNC synced` in the hub shell. This is a visible/persisted-state discrepancy;
T26/T14 must retain this regression. It does not establish that corner radius is
the cause: the rounded square is the second shape in each sequence.

The strengthened observer independently measures UI and disk, then confirms both
again before the next action. This run parsed 48 fixture TSX files with no syntax
failures and includes the new five-second resource samples. Individual timings
remain uncalibrated. The complete source catalogue, remaining domains, actual
invitation/authentication, all topology profiles, history/concurrency/offline,
three matched warm passes and mixed-workload soak still prevent T1 completion.


Run `2026-09-14T07-37-04.751Z` completes all six shape variants across all three
authors: **57 of 72 shape actions pass, 15 fail**. Every create/move/resize passes.
The first (square) deletion per author passes; each of the subsequent five
shape deletions fails both receiving UIs while succeeding on all disks. This
sequence dependency is retained explicitly; the shape geometry itself is not
established as causal. No refresh was used to rescue an observation.

In the same run, native folder drag executes locally and fails both remote UI
and disk. The two Chromium-origin folder moves are still unexercised: reading
the raw function removed the serialization helper failure, but Playwright's
string-expression API evaluates rather than invokes a function value. An explicit
invocation corrects that call site; the DOM test now verifies that the UI's
`dragstart` payload reaches its `drop` handler without global helpers. The
subsequent focused run verifies the corrected folder moves plus independent
pen/highlighter/arrow lifecycle fixtures. Historical no-op rows are preserved
and are not counted as product move failures.


### Content-based echo suppression loses legitimate returns to earlier state

Source inspection explains the repeated-deletion sequence in
`apps/studio/annotations-layer.tsx:1169–1220`. `recentSelfSvgsRef` is a bounded
set of SVG strings. The collab observer rejects every incoming string already
in that set, and also inserts accepted **foreign** strings into it. Therefore,
a new transition A→B→A is discarded merely because A was seen before. All six
deletions in each author's shape sequence have the identical 72-byte empty SVG,
SHA-256 `a2999609f08d235e7665da4b5c4c3bd3a8b94697b2a5f1a6e9312ae51261f03c`.
The first deletion is applied and remembered; subsequent empty-state transitions
hit the content-deduplication guard. Current native/browser evidence and the
source path agree. No patched production rerun has been performed yet.

This guard also rejects an undo that legitimately restores an earlier received
SVG. The earlier sticky undo failures are consistent with this mechanism; the
native photo reset and TSX regressions use different paths and are not assigned
the same cause without evidence. The historical guard was added to suppress
out-of-order self-write echoes during concurrent media intake. Simply removing
all echo protection would reintroduce that known race. T26/T28 must distinguish
action/revision identity and authorship from content equality, preserving both
out-of-order protection and repeated-state/undo acceptance.

Run `2026-09-14T07-43-17.688Z` verifies corrected folder moves in every direction:
each origin successfully moves its own directory through actual tree drag/drop;
both remote UIs and disks remain on the old directory after 15 seconds. Thus all
six remote move checks now have exercised stimuli. Pen and highlighter each
pass create/move/resize/delete for every author (24 actions). Arrow create/move/
delete also pass (nine actions). The three arrow-resize failures are unexercised
harness preconditions: arrows expose endpoint handles `ep1`/`ep2`, not rectangle
corners. The next run uses the actual endpoint handle and adds text/section
lifecycle. Raw counts are 35 pass and six fail including these three harness
errors; they are not six demonstrated product failures.


Run `2026-09-14T07-47-25.822Z` passes all twelve arrow lifecycle actions with
the correct `ep2` endpoint handle and all twelve standalone-text create/edit/
move/delete actions. Standalone text has no drag-resize handles in the current
`isResizable` registry or visible selection UI; those three cases are unsupported,
not replaced with a different operation. Font-size editing remains separate.
Section create/edit/move/delete passes, but the first resize observer included
the renamed label's wider bounds. Those three timeout rows are measurement
failures, not established sync regressions.

Run `2026-09-14T07-50-50.129Z` measures the section's actual region rectangle
and passes all fifteen section lifecycle actions. Eraser deletion passes every
author; each undo restores the original stroke locally and on every disk but
fails both remote views. Dependent redo is unexercised. This independently
reproduces the annotation return-to-prior-content guard described above. Together
these runs exercise the basic actions of all eight exposed drawing tools; they
do **not** complete every style, control, multi-selection, history or workload
variant required by the catalogue.


### Uploaded video cold-receive verification

The initial video run `2026-09-14T07-54-07.164Z` drops an MP4 through each
participant's real canvas intake, rather than seeding its project path. Reference
removal passes all directions. The hub's first upload reaches every disk with
the expected hash, but both receiving players fail the subsequent decode/seek
checks; the peer request log records HTTP 404 for `.design/assets/3ae5b8af.mp4`
before the asset arrives, and the native screenshot shows a broken player while
`HUB SYNC synced` remains visible. Later authors reused the same bytes and thus
had warm asset caches. Those later passes cannot certify cold intake.

The initial create oracle also expected a decoded first frame from a
`preload=metadata` player before playback. That is not a valid cross-engine
assumption; its native-only preview timeouts are not classified as sync defects.
The next runner separates actual reference/player visibility plus persisted
bytes from a **required** explicit playback/decoded-frame test, starts playback
before seeking, and retains per-receiver media readiness/error snapshots. It
never calls `load()`, refreshes, or reopens a failed receiving player. Per-author
MP4 inputs are remuxed with distinct metadata/content hashes while retaining the
same red/blue frame oracle, preventing a warm previous upload from hiding a cold
receiver race. The catalogue now lists 279 entries, including explicit PNG and
MP4 intake cases; remaining media formats and domain variants stay unexpanded.


Run `2026-09-14T07-57-52.762Z` completes the corrected cold-video lane:

- All three uploads produce visible cards/players, identical persisted blobs
  and annotation references on every participant. Those six receiving visibility
  checks deliberately do not claim decoding.
- The author plays/seeks the exact uploaded MP4 and decodes both known-color
  frames. **Both receivers fail playback for every author**, with `mediaError:4`,
  `readyState:0` and zero video dimensions. Their stored hashes already match.
  Both Chromium event logs record the corresponding early asset HTTP 404s.
  Because each originating player decodes its own exact bytes, this is not
  evidence of an unsupported codec. The first run additionally retained the
  same cold-receiver failure after its 15-second observation window.
- Reference deletion removes the card, actual player and persisted reference
  on both peers in every direction. Blob garbage collection/history retention
  is not tested by reference deletion.
- Raw results: eight passes including bootstrap, three failed playback cases;
  remaining 253 rows excluded/unimplemented. All 111 fixture TSX files parse.

T18/T19/T26 must coordinate asset readiness and rendering so a reference arriving
before receiver-local bytes cannot strand an already-mounted media element in an
error state. A late blob on disk or a passing warm reopen is insufficient. These
failures remain in the unchanged baseline; no production sync repair is claimed.

Scoped verification after this expansion: strict multiplayer TypeScript check,
Biome on the changed harness modules, nine Node tests (DOM bridge, raw tree drag,
source catalogue drift, resource ownership and statistics), and the Bun
source-audit test pass. Native UI runs still exit 2 for partial coverage or known
product failures; driver completion does not certify T1. No test app/runner is
left running after the completed runs; user-owned app processes are untouched.

### T2 first containment candidate — unchanged body notifications

The user's active goal on 2026-09-14 authorizes iterative repairs with real E2E
verification. The plan's ordering amendment preserves the baseline above and
continues missing T1 coverage alongside repairs; it does not waive full coverage.

A new real-Yjs/on-disk regression fails before the change: after the projector's
one-shot echo is consumed, a second notification with the unchanged body can
replace a newer remote body before its pending projection. `applyFromFs` now
ignores bytes equal to its current body baseline. This is not a history-of-content
filter: a second regression confirms a deliberate A→B→A edit still imports.
All 38 source-safety/shared-projection/incident-replay tests, studio typecheck,
release-minified studio build and the rebuilt native debug app pass.

Candidate run `2026-09-14T08-15-27.812Z` exercises external saves, atomic saves
and twenty UI text edits per author. The driver completed in 5m14s and the
runner exited 2: 67 passing rows (including two bootstrap and six external-save
rows), one failed row and 253 unrun. Of 60 UI text actions, 59 pass; hub sample 4
reproduces a rollback on all three participants. All six external/atomic-save
actions pass. The final source audit parses 360 files/snapshots without syntax
errors and finds three expected-body mismatches, all for the failed hub action.
Therefore
the guard fixes a proven watcher defect but does **not** resolve the entire
observed lost-update problem. Performance is not certified on this run: host
load varied substantially (a retained sample reports load average 31.98 on ten
cores), and the sample count/observer calibration do not meet the timing gate.
The test-owned processes were stopped by normal runner teardown.

A separate minimal reproduction using the actual workspace agent, Yjs and real
Git confirms a second overwrite path: store the previous body, write a fresh
local UI edit, then store the still-older document (e.g. after an independent
comment change) before the studio watcher imports the local edit. The workspace
agent replaces the new local file with its old body. The assertion fails with
`New local work` replaced by `Previous`. Its standalone script is retained in
the candidate artifact directory as `workspace-stale-store-repro.mjs`. This
demonstrates the competing writer defect; it does not yet prove the exact hook
timing of hub sample 4. No workspace repair has been applied yet.

Next: turn the retained workspace reproduction into a checked-in regression and
protect the hub's body write/commit against a local edit not yet imported into
the document. Re-run the same L06 lane after that change. T2 also still owns
ambiguous stale editor buffers, conflict lifetime/restart and recovery-write
failures; this small guard does not satisfy those remaining requirements.

### Hub writer ordering — reproduction, trace and corrected guard

The first hub candidate remembered its last stored body and skipped a repeat
when disk differed. Its real-Git test passed, as did all 922 hub tests, but native
run `2026-09-14T08-26-17.172Z` retained six failed text actions (54/60 pass),
18 final TSX mismatches and zero syntax errors. Thus that condition was too weak.

The next regression inserts an intervening peer update: the studio has already
projected it, the user makes a new local edit, and only then does the hub store
the peer update. This regression failed with the new local text replaced by the
previous peer text. A temporary hash-only trace was added to identify the real
writer before changing the condition again.

Trace run `2026-09-14T08-32-37.391Z` completed 36 text actions: 30 pass, six fail.
`hub-body-write-trace.json` proves the hub process overwrote the expected new
local body in **all six failures** (hub samples 5, 7, 8, 10, 11, 12). For example,
at timestamp 1789374852792 it reads the exact expected hub-5 body from disk, holds
peer-4 in its document and native-4 as its last stored body; one millisecond later
it writes peer-4. This is the actual ordering seen by the failing UI test, not
only a synthetic reproduction. The child environment allowlist does not forward
the diagnostic flag, so the retained trace certifies the hub's writes only.

The corrected guard compares **actual disk bytes against that writer's last
observed/materialized baseline**, initialized from the startup checkout. A file
changed by another writer is preserved unless it already equals the incoming
body. Body and coupled CSS are withheld from new write/staging notes; independent
metadata still updates. Once the watcher imports the local edit, normal history
can record it. Both regression variants assert local preservation, independent
metadata arrival, no wrong-body history entry in that sequence, and eventual
accepted-body history. This does not certify already-queued Git staging races,
atomic cross-process compare-and-write or restart-safe unresolved candidates.

All temporary trace sites were removed. Studio/native builds and all 923 hub
tests pass. One additional bare-Node focused invocation encountered a native
SQLite ABI mismatch; the project-managed `pnpm ... exec node` rerun passed all
67 then-current focused tests, without rebuilding shared dependencies.

Candidate `2026-09-14T08-50-27.936Z` completes with **60/60 UI text actions and
6/6 external/atomic-save actions passing**. Including bootstrap, it records 68
passes, no failures and 253 unrun rows. Its source audit parses 360 files/snapshots
without syntax errors and finds no final expected-body mismatch. Runner exit 2
correctly preserves the incomplete full-matrix status.

Long candidate `2026-09-14T08-53-38.316Z` completed all 100 text actions per
author: 300/300 pass, plus two bootstrap rows; 259 rows excluded/unrun. The
source audit parses 1,311 files/snapshots with zero syntax errors, zero final
expected-body mismatches and no missing snapshots. The earlier late-session
hub render stall did not recur in this lane. Individual peer observations still
include delays above one second; performance certification and the mixed soak
remain open. This is a text-lane pass, not T1 or product certification.

T6's independent contract preparation is now in
`docs/architecture/project-transactions.md`: candidate/accepted separation,
proposal/results, epochs/generations, action/effect identity, durable publication,
replay, media readiness and inspected writer entry points. It is explicitly a
draft; exhaustive writer/schema coverage and T7/T8 proof are still required.


### Annotation operation identity containment — 2026-09-14 (verification in progress)

The DDR-165 F2 residual is now being repaired: `recentSelfSvgsRef` remembered
foreign as well as local SVG contents, so a repeated empty wrapper or undo to an
earlier snapshot was incorrectly suppressed. The client now assigns a fresh
write ID for each PUT (including undo/redo). The API passes its bounded ID into
the same Y.Map transaction as the SVG. The renderer suppresses only matching
authored ID + exact content; foreign snapshots are never added to that history.
Filesystem imports clear old authorship, and svg-only legacy events cannot
borrow a previous write ID. A late initial GET cannot overwrite a newer live
annotation update. SVG sidecar bytes and old callers without an ID are unchanged.

This is transport echo identity, not authorization, project acceptance, durable
ACK, per-stroke merge or personal effect-aware undo. The existing whole-SVG LWW
model and rejected-save/outbox UX still require T13/T26/T28.

The new real-Yjs regression suite was observed red against the unmodified
registry, then green with propagation. 128 focused tests pass across echo
identity, annotation bridge/model/commands, media commit chain and cold start.
A root-directory Bun invocation accidentally collected packaged test copies
without dependencies; the authoritative rerun is scoped to apps/studio. The
first API suite invocation used Bun's 5s default instead of the repository's
20s timeout; the corrected invocation still had four server-boot timeouts
(three cases passed). Direct boot diagnostics showed no process startup error
before 16s; the host had load 36.74 on ten cores and 16.6GB swap used. These
are failed verification runs, not passing API or performance evidence. Typecheck,
native build and the real UI lane must finish before calling the repair verified.


Typecheck subsequently completed with exit 0; studio compile and the bundled
debug desktop build also completed successfully. The codec/reseed lane adds
25 passing tests (153 focused tests total). The warm API suite passes 6/7,
including the new identity/bounds test; the one failure is the initial empty-GET
fixture server boot exceeding 15 seconds, before its GET assertion.

Native candidate `2026-09-14T09-19-58.469Z` failed before any annotation action:
0 pass, 1 bootstrap/driver failure, 24 remaining-variant rows not run. The shell
never exposed `canvas-row-ui-home` within 60 seconds. Browser events record
hub `/_index-data` and `/_api/git/status` returning 502 during startup, and the
peer log records a Bun request idle timeout. The prior helper did not attach
the failing participant name; the diagnostic now does and captures the shell
text/screenshot without extending any deadline or refreshing. This finding
also belongs to T19/T22: a ready health endpoint does not prove a usable project
index, and failed initial index loading must not strand a designer. The high
host load is recorded context, not proof that product handling is correct.

Retry `2026-09-14T09-25-47.937Z` completed with 179 pass, 3 fail, 3 unsupported
and 79 not-run rows. All 18 shape deletions and all 12 sticky/eraser undo/redo
checks pass in the three directions. Failures are hub diamond move and hub
standalone text edit (initially visible, then reverted on all three files/views),
and the previously reproduced native photo reset. The 111 TSX parse checks are
clean. This supports the repeated-content echo repair, but not overall annotation
correctness or the full matrix. Failure snapshots and timings remain retained.


### Annotation projection re-publication race — 2026-09-14

A controlled real-API/Yjs/disk reproduction (retained alongside the 09-25 run as
`stale-annotation-write-repro.ts` and `.log`) demonstrates an independent rollback:
an older projection stalls in Bun.write; a newer UI save completes and publishes;
the old write finishes and `saveAnnotations` republishes the old SVG into the
room. Both the doc and disk return to the old value. This is a proven write-path
defect, not yet an event-by-event attribution of the two native-run failures.

Three checked-in tests in `annotations-persist-race.test.ts` were red against
the old path: delayed projection vs completed UI edit, projection vs remote edit,
and projection invoking the mutation hook. `persistJson` now calls the distinct
`projectAnnotations` sink. It sanitizes into a runtime `_state` temporary file,
checks that the captured SVG is still current after async IO, and renames it
synchronously with no check/rename await gap. It never invokes the user mutation
hook. A later document change schedules a fresh flush. Old temporary files are
removed on skip/error as well as success.

The three regressions pass; the wider annotation/collaboration/commands/media/
cold-start suite passes 401 tests across 25 files, including all seven API cases.
Studio typecheck passes. The prior high-load API failures remain evidence, but
all their assertions now have a clean suite run (24.45s, compared with helper
startup timeouts under load). Native rebuild and the affected UI rerun follow.

This is not the T14 single-projector protocol: it prevents stale publication
and same-process stale rename, but does not establish cross-process filesystem
CAS, protect every unimported external SVG edit, merge whole-SVG concurrency or
add accepted-revision durability. The independent hub workspace annotation writer
and native photo reset still require verification and, if reproduced, repair.


The second repair's native build completed successfully. Candidate
`2026-09-14T09-42-15.543Z` runs `L06,L09,L12.upload-png,L13` with ten text
samples per author against the rebuilt app. It completed: **217 pass, 1 fail,
3 unsupported, 70 not-run**. All executed annotation rows pass, including both
hub rollback cases from the previous candidate, all 18 shape deletes and all
12 sticky/eraser undo/redo rows. All 30 UI text edits and six external/atomic
saves pass. The source audit parses 240 files/snapshots with zero syntax errors,
zero expected-text mismatches and no missing snapshots. Normal teardown finished;
runner exit 2 correctly retains incomplete-matrix status.

The remaining failure is `L13.photo.reset-adjustments` from native to peers.
This is the independent `assets/<hash>.photo.json` file lane; the reset returns
to the prior brightness, as before the annotation changes. Investigate the local
photo-save/debounce path and file journal rather than assuming annotation identity
will fix it. Other unrun surfaces, legacy transport compatibility, full concurrent
merge/undo semantics, performance certification and mixed soak remain open.


The startup index failure has an inspected UI seam: `loadTree` in
`apps/studio/client/app.jsx` catches a failed `/_index-data` fetch/JSON parse and
only logs it. It has no automatic retry in that path; later focus or explicit
refresh triggers another attempt. Keep a transient-502 startup fixture in
T19/T22 so normal project entry can recover without either user action.


### Native photo reset — event ordering proof, 2026-09-14

Diagnostic candidate `2026-09-14T09-57-41.648Z` completed with 13 pass,
1 fail and 250 not-run rows. The sole failure remains native photo reset.
The fixture-only `photo-trace.js` records successful PUT payloads and focus/input
events without changing gestures or production logging. Native emits reset click
at 1789379900485, then Contrast blur at 1789379900493. Its next PUT still contains
brightness 0.25. Chromium emits blur before reset click and sends `{}`. There is
no reset PUT for the file plane to lose in this native failure.

`PhotoKnobs.mutate` updated its React state but left `editRef` stale until render.
The trailing blur cloned the pre-reset object and replaced the pending reset
save. The repair advances the ref synchronously before preview, persistence and
history callbacks. A real React DOM regression reproduces click-before-blur as
red before the change; both orderings now pass, including preservation of a
different photo section and the subsequent undo base. All 47 photo tests across
seven files pass; studio typecheck, release client build, native build and diff
whitespace check pass. The client release bundle is rebuilt.

The affected annotation/text/upload/photo native suite is running next. This
repair does not claim request serialization, remote photo field merging, durable
acknowledgment, correct complete personal undo or completion of the full matrix.


While the photo candidate runs, the next media defect has a concrete inspected
seam. `hmr-broadcast.ts` classifies video and audio arrivals as `mode: asset`,
but the matching handler in `plugins/design/templates/_shell.html` only heals
HTML/SVG images. A scratch DOM reproduction executes that exact handler body
against failed video/audio elements: both retain error 4 and their old URL,
with zero load calls. This agrees with the six cold-upload receiver failures
in `07-57-52.762Z`; it is not yet a real-decode or timing proof. Repair must
handle failed matching media (including source children), preserve capability
query parameters and working playback, and verify actual late-arrival playback
without any harness-triggered refresh/load. Runtime edits wait for the current
native run to finish.


Photo candidate `2026-09-14T10-01-50.780Z` completed: **218 pass, 0 fail,
3 unsupported, 70 not-run**. The native trace retains click-before-blur but
now sends `{}` and receives 200. All nine reset observations (three authors
by three receivers) end with correct rendered pixels and persisted sidecars;
all executed annotations and text rows still pass. Driver teardown completed,
runner exit 2 correctly reflects incomplete coverage. The first launch was
refused by the coverage-source hash gate after editing PhotoKnobs; catalogue
review confirmed unchanged cases and only the expected source hash changed
before regeneration and this successful run.

Photo reset peer-visible delays in this candidate range from approximately
0.93s to 3.59s. This proves propagation/recovery for these rows, not the plan's
p95 300ms/p99 1s target; latency optimization and matched-run measurements remain
required. Next repair the missing cold video/audio arrival recovery in the
canvas shell, then exercise real uploaded video playback/seek on all receivers.


### Cold video/audio arrival recovery — 2026-09-14

The shell asset handler now retries matching failed video/audio sources when
their file arrives. It preserves query parameters/capabilities and fragments,
handles direct src and source children, matches the full served pathname/origin,
and leaves metadata-ready playback unchanged. An arrival while an older request
is still loading arms one error retry; metadata success or source reset removes
it. A WeakMap replaces previous pending listeners so repeated arrivals cannot
accumulate retries. A changed source never gets replaced with the earlier asset.

Eight DOM regressions execute the actual shell asset branch. Four failed before
the repair (video, audio, source child, arrival-before-error), then all eight pass.
The HMR/classification/shell suite passes 44 tests across five files. The native
debug bundle rebuilt successfully; source template is staged into the app.
The real L12/L13/L14 image/photo/uploaded-and-seeded-video candidate follows;
DOM tests alone do not establish decoded media, playback or file-sync latency.


Media candidate `2026-09-14T10-13-40.303Z` completed with **29 pass, 0 fail,
235 not-run**. All nine uploaded-video playback/seek observations pass (three
authors by three receivers), plus every upload/reference deletion, all three
seeded videos and the image/photo/reset rows. Browser logs retain four actual
MP4 404 responses before later successful decoding, so this run does exercise
arrival recovery. The source audit parses 111 snapshots without syntax errors;
no source-edit comparison was selected. Driver teardown completed; runner exit 2
retains incomplete matrix status. Audio decoding, larger payloads, restart and
performance targets remain required despite the audio DOM coverage.

Next contained UX repair: L05 repeated click on the active canvas. Source still
cleared loadedPath and started loadingPath while retaining the same iframe key.
There is no navigation to emit another loaded event, so the 15s cap blocks an
already-rendered canvas. `openTab` now dismisses preview/comment focus but leaves
the current frame's load/error state intact for the same active path. Actual
Retry continues to remount via its nonce; opening a different path still resets
load state. Client build/typecheck passed; native rebuild and L05/media E2E follow.


The next startup-index regression should inject a small bounded number of 502s
into the first hub-browser `/_index-data` requests before navigation (Playwright
route fixture), then require the normal canvas tree/render within the existing
bootstrap deadline without focus/refresh. This isolates the already-observed
`09-19-58.469Z` blank-tree failure from host load. The UI `loadTree` currently
logs a failed response/parse without scheduling recovery. Preserve pending
concurrent reloads, prevent older responses from replacing newer tree contents,
and cancel retries on unmount; use the same path for initial and subsequent loads.
No index retry implementation or passing failure-injection run exists yet.


Candidate `2026-09-14T10-17-57.376Z` completed: **32 pass, 0 fail, 232
not-run**. All three L05 active-canvas re-click cases remain visibly rendered
and error-free beyond 17 seconds (the old cap is 15s). Baseline `06-12-31.155Z`
contains the same three failing cases before this fix. The full selected media
rows pass again, including all nine uploaded-video playback/seek observations
and every photo reset direction. Native build and studio typecheck passed;
111 source parse checks are clean, with no source-edit comparisons selected.
The driver completed and cleaned up, with runner exit 2 retaining the incomplete
full-matrix status. No runtime/E2E process remains from this run.

Next: initial index-fetch automatic recovery with deterministic 502 injection,
then remaining tree/folder/move surfaces and the rest of the 35-task plan.
Neither these compatibility repairs nor passing selected rows establish full
accepted-revision durability, logical history/personal undo, complete backend
parity, bulk media capacity or the target peer latency.


### Project-index automatic recovery — 2026-09-14

The new `--startup-index-failures 2` fixture intercepts the first two hub and
peer browser index requests with 502 before navigation. It does not alter native
startup, refresh/focus a page, extend the 60s bootstrap gate or replace normal
editing gestures. Fault settings are in run config/provenance; timestamped
request attempts are retained. Red candidate `10-22-27.070Z` failed bootstrap:
both browsers made only one request and stayed empty; hub exceeded 60 seconds.

`createIndexLoader` now owns the stable loadTree callback's request lifecycle.
Transient network/parse/timeout/408/429/5xx failures retry at 500ms, then capped
exponential backoff to 5s. HTTP authorization/client failures do not poll forever.
Concurrent refreshes serialize/coalesce; a superseded result is not published,
and existing callers await the pending fresh request. Unmount cancels retry and
aborts IO; a 10s AbortSignal timeout prevents a hung fetch from stranding startup.
The index is fully parsed/transformed before any project/tree/config state is
applied. Seven lifecycle/concurrency tests pass, plus studio typecheck and rebuilt
client/native bundles. Client files are excluded by repository Biome config;
scoped Biome covers the new test and changed harness, not those client files.

Candidate `10-27-24.891Z` is running L05/L06/L12/L13/L14 with the same two injected
errors per browser. Both browsers already made the expected third request after
approximately 500ms + 1000ms, recovered the tree, and continued actual editing.
Full native scenario completion and final-state checks still follow.


Index-recovery candidate `10-27-24.891Z` completed with **43 pass, 0 fail,
223 not-run**. Both injected startup recovery cases pass, as do external/atomic
source saves, three UI text edits, photo/video rows and all three 17s active-canvas
re-click checks. The source audit parses 132 snapshots and compares nine final
source texts with zero errors/mismatches/missing files. Runner exit 2 preserves
incomplete matrix status; native process teardown completed.

A new normal-startup L01/L04 tree run follows on the same built candidate to
re-inventory actual create/move/delete behavior. Older empty-folder and canvas
move/delete failures remain open; a healthy/retrying index cannot make missing
structural synchronization correct.


Structural candidate `10-30-34.935Z` completed with **6 pass, 20 fail, 3
unsupported, 235 not-run**. All nine empty-folder create/move/delete rows fail
remote propagation; three rename rows expose no control. New-canvas tree arrival
fails two directions at 15s (one peer arrives at 14.91s; another at 8.67s), but
all three subsequent new-canvas render rows pass. All three move rows fail on
remote open receivers while their initiator succeeds in about 0.55–0.62s. Three
delete-after-move rows and three independent-delete rows fail; one downstream
delete is blocked by the preceding move's missing precondition. The independent
delete rows exercise real deletion without relying on a successful move.

Runtime logs in the retained fixture scratch show remote old canvases actually
quarantined after move, and remote deletion tombstones applied. This narrows the
next investigation to both delivery timing and active-view updates. Source
inspection finds that retirement emits a bare `canvas-list-update`, whereas the
shell retarget branch requires `{action: "moved", fromRel, rel}`. Incoming
tombstones do not explicitly close/retarget the active shell/inspector. The
legacy discovery reconciliation interval is 20s; the current control poke is
driven by the file journal, whose membership excludes canvas-owned files and
`.gitkeep`. Do not assume shortening a timeout or accepting `.gitkeep` creates
the first-class directory/generation protocol required by T17. New-canvas timing
needs disk-vs-UI instrumentation before assigning every delay to that poll.

All 111 source parse checks remain clean; this structural run performs no
source-edit comparisons. The native driver completed normally with runner exit 2
and teardown. Updated structural seams are in the T6 contract draft. Full scope
remains open, with no complete milestone or deployment claim.


## Structural view lifecycle repair — 2026-09-14, candidate 10-46

The prior goal turn was a proposal/status response (no authoritative progress).
This continuation re-read the current worktree and made the next executable
repair. Remote retirement now sends both paths after old-body quarantine;
incoming tombstones announce removal after the body leaves the working tree.
The shell uses its current config/active-tab handler to retarget or close the
open canvas without reconnecting the WebSocket. Every server inspector session
receives the same structural lifecycle; deleting a canvas removes its selection
memory without transferring it to another canvas.

Two real-runtime/disk/Yjs regressions first failed on absent move/removal events
and then passed. The focused incremental-discovery, move API, retirement and
inspector suite passes **65 tests, 0 failures**. New inspector tests cover active
and background deletion while preserving another canvas's selection. Studio
TypeScript, scoped Biome and release client + native debug bundle builds pass.
The initial root-relative Bun invocation also matched staged desktop test copies;
the authoritative suite reran with explicit `./test/...` paths from studio.
Build-time missing path import and misplaced shebang were corrected before the
successful checks/build; no failing artifact was exercised as a candidate.

Native candidate `2026-09-14T10-46-52.813Z` runs the unchanged L01/L04 scenario,
normal startup, one sample, on three distinct roots. Source and harness stayed
fixed during the run. Result pending at this checkpoint. Existing directory and
new-document delivery failures remain open; no changed timeout, manual refresh,
accepted-revision/ACK guarantee or milestone completion is claimed.


Candidate `10-46-52.813Z` completed: **8 pass, 18 fail, 3 unsupported,
235 not-run**, runner exit 2, native driver completed/teardown finished. Compared
with `10-30-34.935Z` (6/20), the peer-origin move and independent delete now pass
on all three surfaces. Move arrival/render measured hub 4.139s, native 7.147s,
initiator 0.539s; independent deletion measured hub 3.503s, native 10.259s,
initiator 0.082s. Both still miss final latency SLOs despite passing the 15s
observation gate. Hub-origin move now retargets the peer in 13.157s but misses
native's deadline; native-origin move retargets hub in 3.191s but misses peer's
deadline. Both ensuing deletes retain failed destination preconditions rather
than counting absent→absent as success. Peer-origin delete-after-move reaches hub
in 12.801s but misses native's deadline. Independent hub→native deletion succeeds
in 1.537s; other deadline failures remain. All nine empty-folder operations and
two new-canvas tree rows still fail. No selected previously passing row regressed,
but this partial run cannot establish the full no-regression gate.

The source audit parses **108 snapshots, 0 syntax failures**; there are no source
edit comparisons in this subset. Visually inspected peer-move screenshots from
native and hub show the brief canvas at its new path, and native's independent
peer-delete screenshot shows the idle shell with no active canvas. This is
observed view lifecycle recovery, not accepted-revision or durability evidence.

The next concrete delivery seam is now inspected: hub `filesPoke.schedule` is
only subscribed to journal appends; `afterStoreDocument` projects/commits without
announcing document membership and document-item delete/revive routes emit no
control event. Studio's control handler schedules a combined document+file pass
with 1.5s settling and a 10s cooldown that drops an intervening trigger into the
20s periodic fallback. Preserve the expensive file-plane anti-amplification bound;
do not just lower its constants globally. A metadata-only, coalesced discovery
signal can remove this wait while re-reading the authenticated listing and
retaining reconciliation. T17's durable manifest/generation authority and T13's
outbox remain required; a notification is not their substitute.


## 2026-09-14 — metadata delivery and cohesive architecture experiments

Implemented metadata-only document discovery notifications after stored document
membership changes and delete/revive operations. Ordinary typing does not trigger
an inventory read. A bounded serialized studio queue batches notices, preserves
an in-flight follow-up and enforces a minimum interval. It bypasses the expensive
file-plane cooldown without lowering that plane's bounds. Cell mode owns a
separate control provider, so `sync:documents-changed` bridges its notification
into the same discovery queue. Reconnect requests an inventory even with no
canvas providers. Focused validation passed: 49 studio cases, 46 hub cases,
studio typecheck, hub/studio/native builds and diff checks.

First metadata candidate `2026-09-14T11-05-48.992Z` had 19 pass / 1 fail; the
remaining peer→hub independent delete exceeded 15 seconds because the cell-owned
control provider was not wired. That is fixed in the final bridge implementation.
Final frozen candidate `2026-09-14T11-12-06.584Z` ran
`--only L04.canvas,L06.ui-text-edit,L12.upload-png,L13 --samples 1` and completes
32 pass / 0 fail / 232 not-run. Driver completed with exit 0; partial runner exit
2 still means incomplete full matrix. All selected three-way lifecycle and text/
photo rows pass. Source audit: 123 parses, 0 errors, 9 matches, 0 missing files.
Native screenshots confirm moved canvas render at its destination and uploaded
photo render after reset; the browser experiment screenshot confirms visible
private Unsaved content with unchanged accepted content. This is scoped visual
inspection, not a whole-product visual audit.

Delete-after-move observations are 66–246 ms and independent delete 87–637 ms.
New-canvas tree arrival is still 1.85–3.19 seconds; remote move around 3–4 seconds;
hub-to-native text render 1.67 seconds. These fail the eventual Figma-like latency
target and one sample cannot establish p95/p99. The fixture now isolates move/
delete from empty-folder and create setup, so this is not a matched full-matrix
comparison with older failing structural runs. Empty folders remain a known gap.

In parallel isolated work, then reviewed repository integration:

- `docs/architecture/project-writer-registry.md`: 93 concrete call sites with
  owner tasks and planned conformance tripwires.
- `scripts/dev/sync-e2e/contracts/`: 125 passing Node tests, strict wire validation,
  25 named families / 69 representative variants; 146 valid and 24 invalid corpus
  records; 11 writer bindings. Native runtime is unchanged by these fixtures.
- `accepted-candidate-spike/`: four actual Hocuspocus/Yjs socket/process tests
  prove rejection before publication, dependent U2 containment and one accepted
  corrected revision. A removed-gate negative control fails as expected.
- `accepted-candidate-browser/`: integrated actual Chromium test passes on Node
  22.13.1, preserving exact IndexedDB candidate bytes across reload and refusing
  submit/saved claims on injected IDB abort/quota errors. One corrected revision,
  one history record, zero browser page errors. Quota is injected, not real disk
  exhaustion. Production outbox and native persistence remain open.
- `durable-store-spike/selfhost/`: 13 passing actual SQLite tests with five
  SIGKILL boundaries, actor-scoped dedup, live stale owner, real SQLITE_BUSY and
  SQLITE_FULL, and distinct empty renderer replay. Evidence directory printed in
  `/tmp/maude-sqlite-storage-in-repo.log`.
- `durable-store-spike/cloud-store.test.mjs`: three passing local workerd/SQLite
  DO tests, rollback/epoch/base serialization and SIGKILL after durable storage
  sync before ACK. Actual private workerd PIDs, signals and source hashes in
  `/tmp/maude-do-integration-proof/evidence.json`. Not deployed Cloudflare/R2.

The native source/build snapshot was frozen while it ran. Parallel architecture
implementation lived under explicit `/tmp` directories, then integrated after
native completion. Broad native runs are reserved for product integration
milestones; isolated contract/storage behavior receives its appropriate targeted
actual-runtime tests. All T1–T35 requirements and final native/two-backend matrix
remain intact. See `notes/reliable-project-multiplayer-spikes.md` for open gates.
No adapter selection, production protocol activation, commit, push or deploy.


### T8 validation runtime follow-through

Integrated `scripts/dev/sync-e2e/validation-runtime-spike/` and reran the full
bounded experiment from the repo. Node22 and Bun each match 17/17 production
source cases. Actual workerd exposes a throwing `process.dlopen` stub, and the
installed OXC WASI entry cannot bundle its absent optional binding. Existing
TypeScript JS parse-only validation executes in workerd but falsely accepts six
known duplicate-binding/export cases; it is explicitly not selected. No parser
semantics were weakened to make cloud validation pass.

The dedicated Node process alternative passes 2/2 HTTP tests with no render
checkout, zero candidate import/execution, bounded size/concurrency/deadline,
SIGKILL of a hung child and fail-closed crash/hash/schema results. This loopback
fixture does not provide deployment auth, per-tenant controls, hard OS resource
isolation or a proven warm-pool/remote latency budget. It is retained for the
next T8 decision experiment; no production validator/storage choice is recorded.
Full latest integrated verification: contracts+SQLite 138/138, browser 1/1,
local workerd storage 3/3, validator service 2/2; source runtime probes 17/17 on
Node and Bun. Scoped Biome errors were fixed; remaining diagnostics are style
warnings. Last full native selected product check remains 32/0, with all its
scope/latency limitations preserved. Goal and all incomplete plan tasks remain
active.

## 2026-09-14 — shared storage contract, warm validation and current infrastructure

Integrated `scripts/dev/sync-e2e/durable-store-spike/conformance/`: one strict
ProposalV1 corpus over actual SQLite WAL/FULL and local workerd SQLite-backed DO.
Final run has 22 pass, 0 fail, 0 skip in 2.90 seconds. Evidence:
`/tmp/maude-storage-conformance-final/evidence.json`; command output:
`/tmp/maude-storage-conformance-final.log`. Ten cases per adapter cover exact whole
bytes, scoped deduplication, changed-byte ID reuse, retained accepted/rejected
results, authorization before lookup, epoch transitions, base conflicts,
transaction rollback, competing base claims, schema rejection and restart/replay.
Exact retained outcomes remain readable after epoch advance without reapplication.
These use fixture authorization, one source-text action and text projection;
actual production auth/effects/TSX rendering are not asserted. Separate existing
SIGKILL probes remain the process-crash evidence. No deployed DO/R2 claim.

The temporary Worker startup failure was a Miniflare module-root error: its
implicit root produced parent-relative module names for the `/tmp` entry.
Setting `modulesRoot` explicitly fixed the unchanged storage corpus. This was a
harness failure, not evidence against SQLite DO durability.

Integrated `validation-runtime-spike/warm-pool/`: fixed two ready parser children,
production parser self-check and 17-case corpus, source/job/generation/hash
correlation, no queued overflow, fail-closed crash/timeout recovery and drain.
Three cohesive tests pass under Node 22.13.1; original log and failure retained in
`/tmp/maude-warm-validator-integrated.log`, pool evidence under the matching
`/tmp/maude-warm-validator-integrated/` directory. Tests no longer overwrite source
fault fixtures; output goes to temporary evidence directories.

The first integrated benchmark failed with a cold per-request child HTTP 504 at
the unchanged 2-second limit. Concurrent host load was observed; causation is not
proven. The benchmark now captures attempted samples on failure, fingerprints
sources before execution, cleans up startup failures and still exits nonzero.
A separate final run completes 50 alternating samples with unchanged limits:
`/tmp/maude-warm-validator-benchmark-final/benchmark-evidence.json`. Warm/cold
median milliseconds: 1 KiB 0.77/161.93; 1 MiB 16.38/178.50; 4 MiB 73.24/229.97;
5,000 JSX elements (287,813 bytes) 113.90/320.04. Two-worker warmup: 152.01 ms.
These exclude HTTP ingress, network and peer render and are not p95/p99/SLO or
sustained-load acceptance. Native/RSS/CPU isolation, service auth, fairness,
bounded diagnostic retention and real deployment remain open.

The preceding S3 implementation block adds optional signed conditional metadata
PUT and same-response GET+ETag to `apps/hub/src/s3.mjs`, bounded to 1 MiB and a
10-second default I/O deadline. It never retries as an unconditional PUT; lost
ACK requires read resolution. Existing call paths remain unchanged. The retained
58-test S3/backup/assets run passes (`/tmp/maude-s3-conditional-tests.log`). This
turn's hub bundle build and cold Node24 import pass. The HTTP S3-shaped fixture
is not AWS/S3 evidence and does not implement the durable project head/journal.
Final scoped static check covers 15 files: zero errors, six style warnings.

Read-only live infrastructure evidence updates the old audit:

- AWS shared host `i-0e484a007adbf57a5` runs hub and render image tags `v1.2.0`
  (SSM command `8b351cad-674c-448b-a391-8cb1e5f92a2a`, Success). A tag alone is
  not an exact source fingerprint.
- SSM command `33f3d504-7e09-4e7b-abfb-b50a77ea9d4b` confirms local Docker volumes
  `maude-hub_hub-data` at `/data` and `maude-hub_hub-repo` at `/repo`; render has
  no mounts. Allowlisted config names the S3 bucket
  `studyfi-shared-euc1-design-assets`, region `eu-central-1`. The final `findmnt`
  command exited 1, so the compound SSM result is Failed despite those successful
  reads; exact backing-device mapping and host-loss recovery remain unverified.
- Cloudflare cells version `fc766cf7-005b-4625-87b4-ed2ef0740eb9` has
  `CELL_LIVE_PAIRING=alligators`, `MAUDE_CELL=MaudeCellB` and bucket
  `maude-cloud-assets`. Bucket info reports EEUR, 5,190 objects, 8.46 GB; this is
  whole-bucket information, not a complete eligible Alligators inventory.

T8 remains open. Next cohesive architecture block is the replayable object-store
journal plus conditional head and ambiguous-ACK/fenced-owner failure oracle,
followed by the remaining blob/snapshot/runtime evidence needed to select actual
adapters before T9–T12. No production protocol activation, remote writes,
commit, push or deploy. Current product source behavior was not switched by
these experiments; the last native result remains 32/0 with 232 unrun cells and
its recorded latency misses. Full T1–T35, all surfaces, native, and real two-backend
acceptance remain required.

## 2026-09-14 — object journal CAS and real AWS S3 failure proof

Implemented the bounded `durable-store-spike/object-journal/` candidate using the
production S3 conditional client. One immutable content-addressed entry retains
exact ProposalV1 bytes, actor, receipt and previous-entry hash; a conditional
ETag head update is the commit point. Lost ACKs resolve from the authoritative
chain, never by unconditional retry. Epoch changes are also journal entries;
old owners keep a fixed epoch. Terminal accepted/rejected receipts are retained,
while orphaned losing branches cannot become accepted history. The shared fixture
receipt policy was extracted without changing outcomes; SQLite/workerd's shared
22-test corpus remains green (`/tmp/maude-journal-policy-conformance.log`).

Local object-journal suite: 11 pass / 0 fail / 0 skip. Two real owner processes
with separate cwd directories race on the HTTP store; a live old owner is paused
while its epoch advances. Four additional real SIGKILL cases target before
payload, after payload, after head and before ACK. Empty owner/renderer recovery
returns exactly one original action. Other cases cover byte identity, scoped
retention, revoked access before storage, HTTP payload/head response loss,
unavailable result lookup, 503/507 refusal, 409 head conflict, missing/corrupt
objects, capacity and hung-read deadlines. HTTP faults are injected, not claims
about actual S3 quota. Final evidence: `/tmp/maude-object-journal-final/`; log:
`/tmp/maude-object-journal-final.log`.

Then ran the explicit `aws-probe.mjs --scratch-write` against actual AWS S3 in
account 797601398300 / `studyfi-shared-euc1-design-assets` / eu-central-1 using a
new synthetic prefix, with no project/service/deployment/config changes. Caller
account and bucket owner were checked before writes. Three live cases passed:

- Two independent owner PIDs 44758/44759 prepared entries from one head; only one
  conditional head won, and the loser retained a base-conflict on explicit retry.
- Live old owner PID 44767 resumed a held write after durable epoch advance and
  could not overwrite current authority; the new owner retained stale rejection
  and accepted a fresh-epoch action.
- Owner PID 44779 was SIGKILLed after a real S3 head response, before an ACK file
  or parent result. The deleted owner cwd was not reused; a new owner resolved
  one retained action and reconstructed a synthetic renderer file.

Live evidence: `/tmp/maude-real-s3-journal-proof/evidence.json`; run 12:21:18–29 UTC.
Prefix `maude-sync-conformance/4070a86e-37d5-4ed7-95a2-0925d359756e` was empty before
writes. Cleanup deleted all 16 exact created object versions and independently
listed zero remaining versions/delete markers. Credentials remained in process
memory/child IPC and are absent from evidence. The probe never deploys anything
or edits IAM/lifecycle. No commit or push.

Read-only AWS config: versioning Enabled; lifecycle expires noncurrent versions
after 90 days and aborts incomplete multipart uploads after 3 days; no bucket
policy exists. This is not a full IAM or immutable-prefix enforcement proof.

This closes the missing *small actual S3 CAS/crash experiment*, not T8 or the
product. The current journal reader is O(N) full-chain replay and lacks snapshots,
compaction, indexed durable dedup and local SQLite caching. It must not become
the product hot path as-is. Limits: 1 MiB entry, 128 entries/8 MiB replay defaults,
10-second per-I/O deadline; no whole-loop SLO. Next block is bounded indexed
snapshot/replay with retention and crash oracles, then actual DO/R2/blob/runtime
and representative cost/latency evidence needed for adapter selection. All native
surfaces, history/undo, onboarding, large media and T1–T35 rollout acceptance
remain open. No production sync authority was switched by this experiment.

## 2026-09-14 — bounded snapshot/index/cache and actual S3 replay proof

The object-journal experiment now has a version-2 head with an immutable snapshot
pointer, a 256-shard receipt index, bounded immutable-byte LRU and bounded suffix
replay. Snapshot publication uses head ETag CAS without changing logical revision
or sequence. A late snapshot cannot overwrite concurrent work; old owners are
fenced. Historical exact accepted/rejected results remain indexed. Immutable old
entries are retained and read through bounded, accepted-anchor HMAC cursor pages;
per-instance cursors expire on restart. This compacts replay work, not retention
storage. There is no object deletion/TTL or production protocol migration here.

Local evidence: snapshot suite 9 pass / 0 fail / 0 skip, including three actual
SIGKILL boundaries and fresh renderer reconstruction. The prior normal journal
suite remains 11/0 after the changed head/cache. Tests establish cold state in
2 GETs, old receipt in 3 GETs, warm append in GET+PUT+PUT, bounded LRU, multiple
snapshot generations, old accepted/rejected retry, complete history, cursor
forgery rejection, snapshot/append race, storage refusal and corrupt/missing
snapshot/index. Sixteen 64-KiB synthetic documents exceed the inline snapshot
cap and fail without changing head or publishing a partial pointer. Evidence:
`/tmp/maude-snapshot-final-proof/snapshot-evidence.json` and
`/tmp/maude-snapshot-journal-regression/`, with matching `/tmp/*.log` outputs.

Actual S3 snapshot mode ran 12:39:18–49 UTC against the same verified AWS account
797601398300, bucket `studyfi-shared-euc1-design-assets`, region eu-central-1.
Seven reported cases pass: cold restore/index, five warm append measurements,
a real separate snapshotter racing a new action, SIGKILL before objects/after
objects/after pointer, and complete history of 13 accepted synthetic entries.
The oldest exact result remains unchanged. All 53 exact created object versions
were removed and the random prefix listed empty afterward:
`maude-sync-conformance/5b3f302d-c5d8-4174-8eb2-795d5dbd5df0`.
Evidence: `/tmp/maude-real-s3-snapshot-proof/evidence.json`.

Measured from this development host: cold state 237.73 ms (2 GETs). Warm appends
322.71, 321.18, 376.07, 375.70, 444.67 ms (each 1 GET + 2 PUTs; median 375.70 ms).
These are synthetic coordinator-to-S3 timings, not editor/source validation,
publication or peer render. Five samples are not p95/p99. They do not establish
the final live SLO; measure an AWS-local coordinator and complete product pipeline
before selecting or claiming performance. The full-history network cost is removed,
while each immutable cache assumes enforced storage retention and cold recovery
still verifies digests. Cold integrity tests intentionally clear the cache.

Next T8 work: blob-backed snapshot/materialization beyond the current 1-MiB root,
real DO/R2 counterpart, per-region cost/latency, immutable retention enforcement,
persistent local index and compaction/expiry policy, and chosen validation isolation.
Snapshots currently retain receipts indefinitely within bounded pages; page-cap
or suffix-cap capacity is explicit, not an invented successful save. Original
history/undo/onboarding/media/native/two-backend T1–T35 scope remains intact.
No production sync authority, project data, deployment, IAM or lifecycle changed.

## 2026-09-14 — AWS-region ACK measurement and paged document recovery

Actual in-region coordinator probe passed on StudyFi host i-0e484a007adbf57a5
(account 797601398300, eu-central-1), using its exact existing hub image and
Node 20.20.2 in a disposable read-only container capped at one CPU and 256 MiB.
Twenty synthetic appends per payload size gave medians **91.38 ms (1 KiB)** and
**98.93 ms (64 KiB)**; sample p95 values were 106.81 and 109.12 ms. Every append
used one GET and two conditional PUTs. This measured the prior inline snapshot
format, not the final document-page format or editor-to-peer latency. Source,
bundle and measurements are retained at `/tmp/maude-aws-regional-proof-v2/`;
SSM command 7c10eabb-35bc-407b-9e05-3f7d794494b6 is terminal Success. All 139
created versions were deleted and the prefix is empty. The first attempt's
unprivileged-container directory permission failure occurred before sync ran;
its single object was also cleaned. No hub/render restart or product deployment.

The current prototype replaces inline snapshot document strings with immutable
bodies and bounded document-index shards (snapshot version 2, head version 2).
Metadata reads, appends, epoch changes, initialization and receipts do not hydrate
unrelated documents. Cold metadata uses two GETs; a selected document adds only
its page and body. Full convenience reads have an explicit 8-MiB default cap;
progressive enumeration handles larger projects. JSON string encoding preserves
all accepted code units, including escaped lone surrogates that raw UTF-8 would
silently replace. Body/page/root publication precedes the same fenced head CAS.
The earlier disposable snapshot format is not a product migration contract.

Final local suite: **23 pass / 0 fail / 0 skip**, 12.31 seconds. It includes a
160-document **10-MiB** fixture across ten snapshots, exact progressive cold
reconstruction, oldest receipt retry, independent later edit, pinned older read
views, 128-KiB LRU, bounded eager-read refusal, missing/corrupt objects/pages,
507/lost body ACK, exact Unicode roundtrip, and existing CAS/epoch/SIGKILL cases.
Evidence: `/tmp/maude-document-index-final-tests.log` and
`/var/folders/t_/kf80xz3j79sfmkrq4snj2qk00000gn/T/maude-document-index-oBE1BT/evidence.json`.
Final standalone Node 22 bundle test: one pass, zero failures, from empty cwd
with no installed dependencies. Scoped static checks: 11 files, zero errors,
eight style warnings. No native UI behavior changed or native E2E rerun this block.

Actual S3 final document-page suite: **eight cases passed**, 13:09:41–13:11:17 UTC.
Includes concurrent snapshot/action CAS, three actual SIGKILL/recovery boundaries,
13-entry history with exact oldest receipt, and sixteen distinct 64-KiB documents
whose encoded aggregate exceeded the old inline snapshot cap. Cold metadata,
selected document and complete content parity were verified. Evidence and exact
source copies: `/tmp/maude-real-s3-document-pages-final/`. All **148 exact versions
were deleted**, zero remain under
`maude-sync-conformance/49dc89bc-f2e8-43f3-a6e4-06c9b84fbce0/`.
The preceding pre-code-unit-fix run also passed eight cases and cleaned its
148 versions; its evidence remains separate at `/tmp/maude-real-s3-document-pages-proof/`.

This closes the demonstrated AWS-region latency uncertainty and inline snapshot
capacity limitation. It does not close T8: actual Cloudflare DO/R2 parity,
production source-validation isolation, retention/expiry and immutable-prefix
policy, background compaction, persistent indexing and an explicit final adapter
selection/runbook remain gates before T9–T12. Per-object bounds still apply;
10-MiB source reconstruction is not large-media resumability or the Alligators
inventory test. Source semantics, all persistent writers, managed onboarding,
history/personal undo, complete native surfaces, migration and the absolute
peer-render SLO remain full T1–T35 requirements. All task checkboxes remain open.

## 2026-09-14 — coupled DO/R2 correctness passes; actual cloud latency fails

The existing Cloudflare T8 candidate now runs strict wire/schema/semantic
validation inside the Worker using Ajv standalone output generated from the
same T6 schemas. The actual local Worker accepts 146 valid fixtures and rejects
24 invalid fixtures with matching codes; no Node-side prevalidation or runtime
code generation. One SQLite DO owns each project. R2 stores content-addressed
exact proposals and JSON-string source bodies, while a synchronous SQL transaction
owns head/action/current-document/exact-result metadata. Membership, epoch, base
and dedup are rechecked after external I/O. Indexed snapshot pages capture old
source values and publish only against their still-current head/epoch.

Final local suite: **15 pass / 0 fail / 0 skip**, 14.95 seconds, Node 24.13.0,
Miniflare 5.20260831.0-alpha and workerd 1.20260831.1. The test process groups
contain actual workerd. Six controlled SIGKILL boundaries cover before/after R2
and after SQL commit, for both append and snapshot. Other checks cover exact
accepted/rejected retry, project/member separation, three SQL rollback stages,
missing/corrupt R2 content, deterministic competing base/epoch/member changes
across R2 awaits, consistent snapshot paging, and 80 documents / 5 MiB restored
from cold storage with exact source parity. The exact remote runner and scoped
cleanup/drain behavior also pass locally. These are storage tests, not native UI.
Evidence: `/tmp/maude-cloud-r2-final-proof/` and matching `.log`.

A temporary diagnostic Worker and separate R2 bucket were created under the
verified personal account b5b596efe65abb732777c7171dc18145. Name:
`maude-sync-probe-e286c7e8d6d0`; no product routes or bindings. The bundle hash
matched the local tested file. Initial deployment version was
e1e4c5bb-41b4-46f4-a53d-8479c51a9c53; a one-hour, randomly generated diagnostic
secret was supplied afterward. Bucket location hint was eeur; observed HTTP
edge was FRA, not proof of the DO's exact location. Product deployments, existing
R2 buckets, Alligators content and StudyFi services were unchanged.

Actual run 13:35:26–13:36:09 UTC: two projects each accepted twenty 1-KiB/64-KiB
changes, restored snapshot source and retained exact receipts, enforced epoch
and membership changes, and a third project accepted one of two concurrent base
claims while rolling back three partial SQL transactions. Correctness passed.
No managed Cloudflare process/host crash was injected; that proof remains limited
to the local workerd lane. **Performance failed the gate**: coordinator medians
337/444 ms, sample p95 675/605 ms; client ACK medians 405.42/603.76 ms, sample p95
758.92/716.36 ms. Twenty first-submission samples per size; retries/rejections
excluded. Median averages both middle observations; p95 uses nearest rank.
Coordinator timing includes DO RPC/R2/SQL but excludes preceding Worker wire
validation; client timing adds the development-host HTTP path. Neither includes
OXC source validation, publication or peer rendering, so this already exceeds
the final 300-ms peer budget and must not be integrated unchanged. These are
small descriptive samples, not qualified product percentile evidence, and their
timing boundary differs from the AWS probe.

The slow path currently waits for two R2 PUTs and two reads per accepted action.
Revise this same DO/R2 candidate so small operations and their recoverable payload
commit atomically in DO SQLite, with R2 archival/snapshots outside the live ACK
path. Large payloads still need validated immutable references. Repeat the
crash/retry/retention corpus and actual cloud measurement before selecting the
adapter; a predicted speedup is not evidence. Immutable retention, compaction,
validation-service isolation and final deployment/runbook selection remain T8
gates. The proposed change is not yet implemented in this checkpoint.

All 64 diagnostic R2 objects were removed (29 + 29 + 6), then the Worker and
empty bucket were deleted. Read-only verification found Worker 10007/not-found,
no matching bucket, and zero matching DO namespaces in the complete four-namespace
account list. The temporary token file is removed. Evidence/source/manifest,
latency summary and teardown verification: `/tmp/maude-cloud-r2-staging/`.
No test resources remain. Implementation documentation is
`scripts/dev/sync-e2e/durable-store-spike/cloud-r2/README.md`.
All T1–T35 checkboxes remain open; no commit, push, product migration or release.

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

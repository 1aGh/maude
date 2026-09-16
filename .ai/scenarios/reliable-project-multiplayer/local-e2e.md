# Local surface E2E — preserve the working product

**Plan:** `.ai/plans/archive/feature-reliable-project-multiplayer.md`

**Added:** 2026-09-13, explicit user requirement.

**Status:** specification only; T1 implements the runner and captures baseline before changing sync behavior. These tests have not been run by editing this document.

## Required topology and entry points

Run real local hub + browser studio + two independent local project directories/sidecars, with isolated identities and profiles. Include a bundled native macOS WKWebView participant using the existing WDIO harness. Run standalone-hub and cell-style workspace/studio-child configurations locally. Test normal watcher operation and the existing no-watch/control-event lane separately so macOS filesystem events cannot mask the container notification gap. Future cloud adapter emulation supplements this topology; local tests never claim to prove real R2/S3 durability.

Reuse `scripts/dev/local-cell.mjs`, `scripts/dev/sync-e2e.mjs`, its `harness.mjs`/`scenarios.mjs`, and `apps/desktop/e2e/`. Add a thin `runners/local-e2e.sh`; maintain one surface catalogue with stable case IDs, operation variants, action source, expectations and UI selectors. Each new persistent UI action or mutation route must map to a catalogue case, or the coverage tripwire fails. Shared UI and direct API paths get separate entries; an API-created file does not prove the file-tree menu works.

For every persistent operation below, exercise **browser → desktop A/B**, **desktop A → browser/B**, and **desktop B → browser/A**. Run external filesystem and AI edit cases with the local writer on each desktop side. Assert both other participants, not one convenient receiver. For native-only entry use the actual app; source-sidecar coverage alone is labeled partial.

Use real UI controls: file-tree menus/drag targets, canvas tools and inspector, annotation gestures, upload/drop, photo controls, video/timeline controls, history and undo shortcuts. API calls may seed fixtures or assert internal state; they cannot replace the user interaction under test. External-editor cases intentionally write through a real filesystem save/atomic rename. Assertions use actual supported UI actions; an absent rename button is recorded as absent, not simulated with create+delete and called rename.

## Baseline before refactoring

T1 fixes a baseline source/build/config/fixture identity and runs the complete matrix against it before changing production sync. Use isolated checkouts/build outputs if a comparison build is needed; preserve the shared working tree and committed release bundles. Capture the available unchanged source baseline and record which release the user was running; if a release baseline is available, retain its result separately. Do not assume different versions/configurations are comparable.

For each operation/role/direction/surface, record `pass`, `fail`, `unsupported` or `not-run`. Record known baseline failures with evidence and owning repair task. They are not success or a reason to weaken a future assertion. Every previously passing cell must remain passing throughout; final L01–L24 acceptance has no unexplained failures, pending or required skips. The local regression suite is an early prerequisite, not a test postponed until the architecture has been replaced.

Existing harness traps to remove from the **new gate**: `expected-pending` deletion/history checks; delete settle forcing `ok: true`; creating a child canvas to hide unsynchronized empty folders; treating create+delete as real rename; passing media solely because a reference or file exists. Preserve historical measurements, but do not inherit their false-green semantics.

## Surface and operation matrix

Each semicolon-separated operation is its own test result. CRUD sequences act on an entity already observed on both receiving peers; deleting something they never received proves nothing. Record supported current paths at T1 and map new target operations to their implementation tasks.

| ID | Surface | Individually required actions | Peer-visible and persistent oracle |
|---|---|---|---|
| L01 | Empty folders | create; rename when implemented; move into another folder; delete | Empty directory appears/moves/disappears in both receiving file trees without inserting a hidden canvas; path identity correct |
| L02 | Populated/nested folders | create nested hierarchy; move hierarchy; rename when implemented; delete subtree | All descendant canvas/source/meta/annotation/media paths handled; no old tree ghosts, orphan sidecars or resurrection |
| L03 | Supported non-canvas files | create; edit; move; rename when implemented; delete | Tree row, opened content and eligible bytes agree; unsupported/runtime/trust classes explicitly excluded, not silently uploaded |
| L04 | Canvas lifecycle | create; duplicate; rename; move across folders; remove | Tree plus title/kind/DS meta match; destination opens and renders; old path/document retired; duplicate has independent identity |
| L05 | Open canvas / tabs | peer moves active canvas; peer deletes active canvas; switch away/back; reopen after restart | Open tab follows valid move or explains removal; no stale rendering under wrong path; no duplicate tab/row or 404 loop |
| L06 | Canvas source editing | valid text source save; atomic editor save; UI text edit; CSS/property edit; attribute edit | Exact intended source and visible receiver result, including untouched peer edits; no syntax/import/runtime regressions |
| L07 | Elements | insert; duplicate; move/reorder; resize; edit content/property; delete | Correct stable element/instance and rendered geometry on peers; siblings remain intact; no unexpected duplication |
| L08 | Artboards/layout | add; rename/title; move; resize; reorder; remove | Persistent layout/title/kind reflected on peers; removed boards absent; each user's pan/zoom is not overwritten |
| L09 | Annotation shapes and strokes | create each exposed tool type; select/move/resize; edit available style/text; delete; undo; redo | SVG/data and actual overlay agree; coordinates remain correct after pan/zoom/reopen; deleted marks absent on both peers |
| L10 | Annotation stickers/images | add image sticker; move/resize; replace where supported; remove | Referenced asset arrives and decodes; sticker visibly renders at correct location; removal does not delete still-referenced asset |
| L11 | Comments | create thread/pin; reply; edit owned comment; resolve/reopen; delete where supported | Thread text/state/anchor and badges agree; author rights enforced; pin remains aligned after supported layout change |
| L12 | Photo asset transfer | upload/drop new image; replace content; move/rename supported asset path; delete unreferenced asset | Whole-object hash plus successful decode (`complete`, nonzero natural dimensions) and representative screenshot/pixel landmark; updated content invalidates stale cache |
| L13 | Photo canvas/artboard | create from image; crop/transform/adjust each exposed non-destructive control; move/resize; remove instance; undo/redo | Correct rendered photo and parameters on receivers; no blank/broken thumbnail or missing image after restart; shared asset remains for other users of it |
| L14 | Video asset transfer | upload/drop real video; replace; move/rename supported path; remove instance; delete unreferenced asset | Bytes/hash, nonzero dimensions, finite expected duration, metadata and decoded frames; play advances `currentTime`/decoded frame, seek shows a different known frame; no black placeholder or stale source |
| L15 | Video/timeline document | create/open composition; insert clip; move/reorder clip; trim; change exposed persistent clip properties; delete clip; undo/redo | Source/metadata and receiver timeline/preview match at known timestamps; media remains playable; scrub/playhead only sync if product explicitly defines them as shared |
| L16 | Design system/dependencies | create/edit/remove specimen; edit CSS/token/module; move dependency with reference update | Peer rebuild/rerender uses matching dependency revision, fonts/styles/assets visible; unrelated canvases remain functional; no fresh-client DS omission |
| L17 | Media reference lifecycle | reference same asset from two canvases/sticker; remove one instance; rename/move with refs; attempt delete of in-use asset | Other references and history remain valid, or explicit supported refusal; no successful operation leaves unexplained broken images/videos |
| L18 | History and personal undo | one action; gesture group; AI multi-file group; peer interleaving; undo/redo; preview/restore old revision | Correct authors/grouping, no peer overwrite, old media renders; failed undo does not advance stack; restore is a new accepted action |
| L19 | Presence/selection/local state | join; move cursor/select; leave/reconnect; local camera change | Correct peers/awareness without stale duplicates; local camera and credentials never propagate as content; presence is not a saved-state proof |
| L20 | Offline/restart/catch-up | disconnect one desktop; mutate each persistent surface; restart; peer edits; reconnect; open fresh third copy | No missing/duplicate entities, resurrected deletes, stale media or lost candidate; actual receiving UI catches up without manual repair |
| L21 | Concurrent UI/editor/AI | independent edits; same target; folder/canvas move during edit; delete versus edit; multi-file AI publish/abort | Deterministic preserved outcome or explicit real conflict; ordinary independent actions do not acquire new false conflicts compared with baseline |
| L22 | UI save state / errors | pending edits; blocked file; invalid candidate; auth expiry; unavailable storage; successful recovery | All surfaces tell the same truth; errors actionable and persistent as needed; no green saved status masking failed transfer |
| L23 | Mixed loaded session | edit canvas/annotations/comments continuously while photos/videos seed; move/delete assets safely; switch canvases | Peer visibility stays within budgets; media traffic does not starve edits; no reload loops, CPU runaway, unbounded queue/memory or disappearing work |
| L24 | Final reopen/parity/soak | fresh app/browser reopen; full eligible inventory compare; timed mixed-workload soak; final deletion reconciliation | Matching current semantic state and eligible hashes, valid source, decodable media, no ghost entities; histories/candidates retained per contract |

T1 expands “each exposed tool/control” against the **actual toolbar, menus and registered handlers** into explicit stable subcase IDs (for example `L09.arrow.create`, `L09.arrow.move`, `L09.arrow.delete`). Commit the resulting coverage catalogue with the runner. An unenumerated supported tool is a coverage failure; no vague “annotations passed” result can cover only shape creation. If an action is absent in the baseline, show that fact and its target task instead of manufacturing a fake UI test. New empty-folder synchronization and true canvas rename remain target requirements in T17/T25.

## What every result proves

Check four boundaries independently: **action completed locally → persisted/transmitted content → receiving tree/document state → actual visible render/media**. Record revision/action IDs when available, baseline-compatible content markers otherwise. The whole scenario passes only if every required boundary passes on both receiving peers. `200 OK`, provider synced, file presence, image URL assignment and screenshot capture by themselves are insufficient.

Keep receivers already open. Do not navigate, manually refresh, click resync, restart a server or clear caches to make a live update appear. A separately named cold-open test may navigate afterward, but cannot replace the first live observation. If today's product uses an automatic iframe reload, baseline records it; candidate must not add extra full-shell reloads, blank intervals, focus/selection loss or media playback disruption. Prefer bounded event/DOM/decoded-frame observations over sleeps. A timeout fails the cell; retries retain the original failure instead of erasing flakiness.

Use small real PNG/JPEG/SVG and browser-supported MP4/WebM fixtures with known dimensions, colors/frame landmarks and duration. Select the playback format supported by the target WKWebView/browser and record that choice; do not convert an unsupported-codec failure into a false sync pass. Media can play muted after an explicit test click. Range/seek behavior is checked on the actual serving route. Large-file transport has separate realistic byte fixtures; completion is measured against size/bandwidth, not a subsecond upload promise.

## Latency and baseline comparison

Measure with one orchestrator's monotonic clock from the actual originating UI gesture/save to observable receiver tree/overlay/render/frame; bound observer resolution (target ≤20ms) and record it. Do not subtract unsynchronized browser/OS wall clocks. Separate local response, accepted ACK, first peer-visible effect, final committed visual state and full media transfer. Group by surface, operation, direction, backend mode and idle/loaded profile; never hide a slow class in a fleet-wide average.

At T1 take at least three matched warm passes, ≥100 samples per ordinary live-edit class for p95, and ≥1000 samples per aggregated homogeneous workload when reporting p99. Store raw samples, counts, timeouts, fixture bytes, network profile, hardware, CPU/memory and bundle mode. Measure cold open separately. Use a fixed **30-minute mixed-workload soak** with seeded operation order at every milestone; capture queue/CPU/memory trends and final hash/semantic parity. Match the same conditions on candidate builds; run baseline/candidate interleaved when comparing performance.

Final absolute targets remain: ordinary local response p95 ≤50ms; ordinary peer-visible edits p95 ≤300ms and p99 ≤1s at RTT ≤100ms in a single region. Existing local functional pass cells are protected from T1 even if the old system has not met these final latency targets yet. For CRUD and asset-reference visibility, freeze the per-operation baseline measurements and desired deadline in T1; final known small changes should become visible promptly without waiting for the 20s reconcile fallback. Upload duration depends on bytes/bandwidth; once the asset is durable, measure reference/decode visibility independently.

No-regression policy: a **reproducible** candidate p95 increase exceeding `max(10% of baseline p95, 30ms)` or p99 increase exceeding `max(10% of baseline p99, 50ms)` blocks the milestone, as does any missed final target at release, new correctness failure, new timeout, manual recovery or increased false-conflict rate. These tolerances handle measurement noise, not authorize intentional slowdown. Freeze them before running the candidate. Compare paired repeated passes; noisy/inconclusive results require controlled reruns and remain inconclusive until resolved. Do not pass a p99 claim from a tiny sample. Do not widen timeout budgets, suppress cases or refresh the baseline to absorb regression.

## Execution and gate ownership

- **T1:** enumerate subcases, implement real local UI runner, run and preserve unchanged baseline. No production sync refactor before this evidence exists. Local fixtures need no cloud credentials.
- **T2–T30:** affected local subcases/directions after each behavior change; full matrix and soak at each M0–M4 boundary. Existing baseline gaps have named repair owners, not success labels. Compare the same established cases under legacy and candidate mode during rollout development.
- **T31:** full L01–L24, all implemented target operations, all directions, local standalone/cell profiles, native lane and noise-controlled performance comparison green; no required skipped/unsupported target cell. Add backend product runners, not another surface catalogue.
- **T32/T33:** real backend and post-upgrade scenarios remain required independently; a local file store does not certify vendor durability.
- **T34/T35:** repeat complete local coverage after old-path removal and release bundling. No final rollout/closure with regression versus the working baseline.

Keep `baseline.json`, per-cell `results.json`, raw timing samples, operation catalogue hash, source/bundle hashes, both receiver screenshots and diagnostic logs under an isolated run evidence directory; sanitize secrets and unrelated user files. Failure reports name the exact surface, operation, direction and first failed boundary, with the baseline/candidate comparison beside it. Link evidence from the plan; this document being present is not execution evidence.

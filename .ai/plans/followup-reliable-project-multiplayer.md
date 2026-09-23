# Follow-up: reliable project multiplayer

Deferred by the owner on 2026-09-16 from
`archive/feature-reliable-project-multiplayer.md` (T1 certified with one reservation;
T31 and T35 closed). Everything here was open when the parent plan closed.

## Tasks

- [x] **F1 — `L15.video.create` on the hub lane.** In a full surface run the hub
  browser's "⌘K → New video → Enter" does not open the name prompt (palette
  closed, no `.st-prompt`, an `INPUT` focused). Failed in 4 of the last 6 full
  runs; passes with `--only L15` and on the native and peer lanes. The stale-Enter
  fix (`aad823ab`) did not change it. Reproduce:
  `bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode candidate --save-mode accepted`
  (keep the display awake; prefix with `caffeinate -dimsu` on macOS).
  Done when a full run passes with no failed row, which lifts T1's reservation.
  **Verified 2026-09-23:** full candidate `2026-09-23T15-14-00.219Z` — **1,079 pass,
  0 fail, 13 unsupported, 0 not-run**; baseline `2026-09-16T20-10-34.675Z` compare
  778 held · **0 regressed** · 1 repaired · 300 new; 30-minute soak (874 edits,
  291 media files, zero misses/missing media), fresh reopen (465 files) and final
  parity (168 files) pass; source audit 1,617 snapshots, 0 syntax failures.
  See the 2026-09-23 checkpoint below for the three fixes this needed.
- [x] **F2 — T18 R2 multipart evidence.** Verified 2026-09-22 against the isolated
  `maude-multiplayer-test-20260922` R2 bucket through the production hub adapter
  (`apps/hub/src/s3.mjs`): 96 MiB, six multipart parts, downloaded SHA-256 equals
  the input. The object was removed, the scratch prefix is empty, and no
  incomplete multipart upload remains. See `followup-2026-09-22-r2.json` beside
  the linked evidence report.
- [ ] **F3 — T32 S01–S19 on real backends.** Run the scenarios and the T8 crash
  oracle on disposable cloud and self-host projects, with cleanup.
- [x] **F4 — Latency target.** Peer render p95 is still ~480–650 ms against the
  300 ms target; measure under matched conditions and close or re-scope.
  **Met 2026-09-23** (owner chose "reach 300 ms now", not re-scope): three matched
  `--only L06.ui-text-edit --samples 100` passes plus the certifying full run, 100
  samples per author each — every one of the six author→receiver p95s is
  **156–274 ms** (was 497–747 ms in full run `2026-09-22T19-09-46.637Z`); 906/906
  rows pass; no observation in the four runs exceeds 479 ms, so p99 ≤ 1 s holds for
  the samples taken (the runner's own p99 needs 1,000 per direction and is not
  claimed). Mechanism: a text-only edit reaches the receiving iframe as a text patch
  ahead of the remount. The mixed-load soak (external-editor file saves, which keep
  their deliberate 250 ms quiet window, while media seeds) measures p95 454 ms
  within its own 5 s budget — a different workload, reported separately.
- [x] **F5 — Refused pulled path.** Fixed and verified 2026-09-22:
  `resolvePulledTarget` now refuses a present invalid path; only a missing path
  may use the legacy slug fallback. Regression coverage in
  `sync-remote-docs.test.ts` and `sync-path-pull.test.ts` failed before the fix.
  **Audit correction:** `49121f30` and `sync-pull-manifest-path.test.ts` address
  manifest-first path resolution, not this refusal; the previous closure claim
  was incorrect.
- [x] **F6 — Pull-pin release race test.** Verified 2026-09-22. The fix in
  `befa4852` now has a deterministic stale-directory-listing test in
  `sync-path-pull.test.ts`: the file exists before the stale scan resumes, yet
  the same agent stays attached. A later fresh scan releases the pin so opt-out
  still detaches. Removing the `bySlug.has(slug)` guard makes the test fail.

- [x] **F7 — Render deploy verification keeps the old container alive.**
  `render-deploy.yml` polls `/_health` every 10 s for 15 minutes; each request
  resets the container's 10-minute `sleepAfter`, so the instance started with
  the previous release's environment never sleeps and the check fails although
  the rollout applied (v1.4.2: failed, then answered `v1.4.2` after 12 idle
  minutes). Fixed 2026-09-22: at most three probes, 11 idle minutes between
  probes, bounded curl requests and a 30-minute step timeout. The actual shell
  is exercised by `apps/render/test/deploy-verification.test.ts` against a
  virtual idle timer; it fails with the old workflow. No forced restart of live
  exports. This is a local regression proof, not evidence of a deployed rollout.

## Execution checkpoint — 2026-09-22

F2 and F5–F7 are verified. The plan remains **open**; no full
certification or production deployment is claimed.

- F1: the runner now supports Linux's staged native debug app (WebKitGTK),
  explicitly distinguished from a macOS bundle in provenance. Linux L15-only
  run: 32 pass, 0 fail, 760 not-run. The first 100-sample full attempt was
  interrupted after the test hub exited. The second run reached 772 pass,
  4 fail and 13 unsupported before deliberate interruption at the long soak.
  `L15.video.create` passed on hub/native/peer; CSS undo and native media-probe
  timeouts were found. After rebuilding with the bounded media-probe fix, a
  frozen-input focused run passed **64 rows**, failed **1 CSS-undo row**, and
  left 727 unrun. All three video-play/seek lanes now pass; F1 remains open.
  The next investigation reproduced HMR dropping an in-flight undo reply and
  allowing a replacement stack to undo the same entry concurrently. Both now
  have fail-without tests; 42 focused tests pass. Rebuilt native CSS-undo run
  `2026-09-22T13-23-33.982Z`: **8 pass, 0 fail**, 784 not-run. Full matrix with
  30-minute soak `2026-09-22T13-26-38.718Z` ended **764 pass, 12 fail,
  13 unsupported, 3 not-run**. Video and all six CSS-undo rows passed, but
  Chromium disappeared at 13:58:23 UTC during L16; the remaining UI checks
  reported a closed browser. The soak was not reached. Final disk parity passed
  (165 files); the source audit parsed 411 snapshots with zero syntax failures
  and compared nine snapshots with no mismatch. These do not certify the UI.
  The next frozen-input full run `2026-09-22T14-45-34.338Z` was deliberately
  stopped after four failures: **1,068 pass, 4 fail, 13 unsupported, 1 not-run**;
  its 30-minute soak did not complete. L07's missing native path was actually
  a wrong-case `ui/surfaceel-peer.tsx`: a transport room opened before doc.create
  pinned the legacy slug fallback. Accepted discovery now uses only live manifest
  entries. The real-hub regression failed before the fix and passes afterward;
  all 68 affected sync/path tests pass. Focused run `2026-09-22T15-48-31.013Z`
  passed all 15 L07 directions/operations plus three preview restores (20 rows
  including bootstrap, zero failures). A new full run is still required.
- F2: completed against actual R2 after the owner authorized a fresh bucket and
  supplied bucket-scoped credentials; no production bucket was used.
- F3: local T32 crash oracle passed four rounds (40 writes each) with zero lost
  acknowledged writes or duplicate revisions/transactions. The same four-round
  crash oracle now passes against a real Cloudflare ProjectStore Durable Object,
  including fresh local hub directories after each SIGKILL. Its disposable
  Worker and DO were deleted afterward. S01–S19 on both actual backend families
  remain unverified; the crash subset is not whole-product certification.
  A separate Cloudflare control plane and D1 fixture now exercise actual owner
  signup, two designer invitations, viewer acceptance, viewer invitation refusal
  (403), and expired/revoked invite refusal (404, no account created). This is
  the S01/S02 auth subset. Cloud S01 now also passes a real clean Linux-native
  login, project pick, managed copy, sync consent, canvas create and text edit;
  the independent owner browser renders the edited title and history records
  the designer's accepted action at revision 4. This uncovered and fixed a
  synchronous browser-launch wait freezing Tauri's main loop. The run and its
  limitations are in `followup-2026-09-22-cloud-native-entry.json`; all five
  native screenshots and the independent peer screenshot were inspected.
  Remaining cloud/self-host scenarios and cleanup are still pending. Resources
  are retained for that continuation. See also the cloud-auth and cloud-cell
  manifests beside the evidence report.
  Real-cloud protocol subsets now also verify stale-base title/color merging,
  effect-aware personal undo/ABA ownership and external-socket raw-update/epoch
  fencing, with independent receiving-browser evidence. See
  `followup-2026-09-22-cloud-protocol.json`. **S11 found a product bug:**
  Restore inside an accepted-history preview called Git discard (409) instead
  of restoring the selected accepted revision. The history-row Restore works
  and created revision 13. The preview now passes the selected revision to the
  project restore action and loads accepted history rather than Git. DOM and
  routing regressions failed before the fix; 48 affected tests now pass.
  History also invalidates on applied revisions and successful restores. Linux
  native + two Chromium participants passed the isolated preview scenario in
  `2026-09-22T15-58-35.918Z`: both previews rendered, changing the picker selected
  the restored content, a new action/visible history row appeared, and all three
  peers matched. All 12 screenshots were inspected. Real-cloud updated-build,
  media-history and concurrent-peer verification still remain; F3 is not closed.
  Subsequently the isolated cloud cell was rolled to `test-20260922-r2`
  (served client seal verified; revision 13 and all five documents survived).
  Actual two-browser UI verifies selection of revision 6 while a peer inspector
  edit creates revision 14, then preview Restore creates revision 15 with the
  exact revision-6 HTML hash. Both peers render it and owner history refreshes.
  **A further UI failure remains:** the receiving inspector retains the old
  title attribute until the heading is clicked again, despite correct live DOM
  and accepted source. See `followup-2026-09-22-cloud-history.json`; all four
  screenshots were inspected. Media/native-cloud history coverage, this fix,
  the rest of the backend matrix and cleanup remain required.
  Cloud media history now has actual two-browser preview/restore evidence:
  r16/r17 show distinct images, selected r16 Restore creates r18, and both peers
  render the old image. A controlled restart of only the isolated cell restores
  both R2 objects (2 restored, 0 failed), preserves head 18/epoch 1, current HTML
  and both historical source hashes. Direct R2 GETs and post-restart browser
  screenshots agree. See `followup-2026-09-22-cloud-media-history.json`. This is
  not native-cloud, large-media or the full crash-point matrix certification.
  The stale-inspector root cause has a failing-then-passing real React
  regression and a successful-commit handshake fix, first verified in an isolated
  source copy while the full run kept main-tree inputs frozen. The copy passes an
  actual receiving-browser check against the real cloud: inspector edit r19,
  owner preview Restore of r15 creates r20, and the unfocused receiving title
  input updates without reload/reselection. Accepted source and local disk hashes
  match. A second reproduced bug leaves Inspector covering History after the
  status-bar button; using the existing exclusive panel opener fixes it in the
  isolated copy (regression failed before the change; actual UI now opens rows).
  See `followup-2026-09-22-cloud-ui-candidate.json`. Both fixes were subsequently
  transferred to the main tree after the full run terminated; 57 affected tests,
  studio typecheck and scoped lint pass. Native UI verification and cloud-cell
  rollout are tracked below; F3 remains open.
- F4: completed inspector/text API writes now feed the existing accepted
  projection without waiting for the 250 ms external-editor quiet window.
  Fail-without tests cover completed-write delivery and late-watcher deduplication
  against a real hub. Matched UI measurements are still required; the 300 ms
  target is unchanged. Six peer UI observations in the focused run were
  409–711 ms despite 71–110 ms disk arrival: not a percentile or matched
  baseline comparison, and not proof of the target. T32 acknowledgement latency
  is not peer-render latency.
  Later 60-observation local runs measured p95 **616.1 ms before / 645.8 ms
  after** deduplicating delayed same-disk-version HMR broadcasts (32 focused
  HMR tests pass). The duplicate reload is removed, but overall performance
  improvement and the 300 ms target are **not established**. F4 stays open.
  The interrupted full run has 100 samples per author; canonical nearest-rank
  provisional peer 95th order statistics are 418.2–606.9 ms. Final driver/source
  audit parsed 1,608 snapshots and compared 900 with no mismatch, but the failed
  driver disables certified percentile claims. No p99 is
  claimed from 100 samples (the runner requires 1,000). The earlier 10-sample
  before/after figures are exploratory, not qualified per-direction p95.

Initial F5–F7 verification: sync **1,202/1,202**, hub **987/987**, render **9/9**.
After F4's new test, the first full sync lane was **1,202 pass / 1 timeout** during
concurrent native/smoke work; that unchanged AST test's file then passed **6/6**
alone. A subsequent complete rerun passed **1,203/1,203**, with the same 20 s limit.
Studio typecheck and changed-file Biome checks pass. Desktop E2E typecheck has
four errors in unchanged scenarios outside the multiplayer file. Smoke automation
passed 74/74; all screenshots were inspected, with unresolved visual warnings
(so not a clean visual certification). Detailed current results are below.

Commands, fail-without results and limitations:
[`followup-2026-09-22.md`](../scenarios/reliable-project-multiplayer/evidence/followup-2026-09-22.md).

## Execution checkpoint — 2026-09-23

F1 and F4 are verified; F3 remains **open** (below). Linux WebKitGTK native debug
app throughout; macOS WKWebView is not certified by these runs.

- **F1 root causes (three, each with a fail-without):**
  1. *Native timeline split/delete/undo/redo* — harness, not product. The embedded
     WebDriver clicks synthetically (`el.click(); el.focus()`), a no-op on the
     non-focusable timeline readout, so focus stayed on a file-tree row whose new
     roving keyboard handler (S19 tree repair) consumed Home / `.` / ArrowRight.
     The native `click` now moves focus the way a real pointer press does.
     `--only L15`: 32/32 with the fix; without it the exact four failures of the
     full run recur (`2026-09-23T11-36-30.733Z`).
  2. *Native L07 reorder "probe response timed out"* — harness. A held drag lasts
     `hold` + its moves, but the frame-probe reply deadline was a flat 1 s; it now
     allows the requested hold. `surface-frame-probe.test.mjs` asserts a 900 ms
     held drag answers; it fails without the change.
  3. *Native `L18.css-undo.own-value`, intermittent* — **product race**. The shell
     writes an inspector edit and only posts `record-edit` after its HTTP response;
     the write reaches disk first, so a Cmd+Z in that window inverted the entry
     BELOW the one on screen (refused as "changed by someone else"). Before
     undo/redo the canvas now posts `undo-barrier`; the shell answers once its
     recordable writes settle (window messages arrive in order). Unit coverage in
     `undo-shell-barrier.test.ts` (spoofed/other-request answers do not release it;
     bounded when unanswered). E2E: without the fix 2 of 4 `--only L18.css-undo`
     runs failed; with it 8 of 8 (64/64 rows).
- **F4 mechanism:** `canvas-text-patch.ts` (parser-free — in a cell the HMR
  broadcaster runs in the credential-holding process, where DDR-209 forbids parsing
  tenant source) diffs the new source against the canvas's last BUILD, proves the
  change is the text run of one element, and takes its id from that build's
  locator (`canvas-source-memo.ts`). `_shell.html` applies it via `textContent`
  only on single-text-node `data-cd-editable="text"` leaves the person is not
  typing in; the remount still confirms. A first in-process-parser variant was
  replaced; with it, the hub browser lost its studio session after ~5 min
  (401 on every studio route) in `2026-09-23T11-50-34.418Z` — gone with the
  parser-free version across four long runs, cause not otherwise established.
  20 unit tests (`canvas-text-patch.test.ts`).
- **Recovery candidate (F3/S04)** from `.ai/browser/eval/recovery-candidate.patch`
  is now applied to the main tree (45 targeted tests pass); **not deployed** to
  any cloud cell.
- **Gates:** sync lane 1,211/1,211 (`--timeout 20000`, as CI); `pnpm test` pass
  (hub 990/990 — one earlier `history.test.mjs` run lost its `git` child to
  SIGKILL and passed on two reruns, hub code unchanged); studio typecheck clean;
  scoped Biome clean (one pre-existing warning in `canvas-shell.tsx`); the
  committed release bundles were rebuilt with the pinned Bun 1.3.3 and are
  unchanged by the test runs.
- **F3 self-host (in progress, 2026-09-23):** the production hub image
  (`apps/hub/Dockerfile`) in workspace mode, SQLite accepted store on its data
  volume, R2 object storage in an isolated tenant prefix, and the operator's
  canvas hostname (`workspace-plan`, M7). Real accounts: first-user seed, operator
  invites accepted through `/join`, password `/auth/login`. Runners in
  `.ai/scenarios/reliable-project-multiplayer/runners/f3/`; manifest
  `followup-2026-09-23-selfhost.json`. **Passed:** S01 (clean Linux native profile
  signs in through the team-server form, creates + edits a canvas; the owner's
  independent Chromium renders the edit; accepted history names the designer),
  S02 (expired/revoked invites 410 with no account; removed designer 401 on
  write/read/sign-in with accepted work kept; same-named project on a second hub
  is a distinct project that rejects the first hub's credential), S03, S05, S08,
  S10, S15 (4 × 40 with SIGKILL + restart: 0 lost acks, 0 duplicate
  revisions/transactions; ack p95 17 ms — the in-flight write was answered before
  each kill, so this is retry-after-unknown, not a kill inside the commit).
  **Product fix found here:** a viewer invitation answered 201 `role: viewer` but
  stored `member`, so the joined account could write; `createInvite` now refuses
  any role but admin/member (fail-without regression in `invites.test.mjs`).
  A hub's accounts have no view-only role; S02's viewer row is therefore
  "refused", not "read-only". **Remaining on self-host:** S04, S06, S07, S09, S11,
  S12, S13/S14, S16, S17, S18, S19, then cleanup of the two containers and both
  R2 tenant prefixes.
- **F3 cloud: blocked, owner deferred (2026-09-23).** This session has no
  Cloudflare credentials (`wrangler whoami`: not authenticated) and the test
  control plane's owner/designer-B browser sessions expired. The owner chose to
  skip the cloud half for now. Isolated cloud resources remain as listed in the
  2026-09-22 checkpoint (test cell `f3-cloud`, workers
  `maude-multiplayer-{control,cell}-test-20260922`, D1, R2 bucket
  `maude-multiplayer-test-20260922`) and still need S01–S19 completion on the
  current build and cleanup. The plan cannot close while this is open.

## Validation

Full candidate `2026-09-22T16-00-42.733Z` completed: **1,077 pass, 2 fail,
13 unsupported, 0 not-run**. Its 1,900 source/build inputs stayed unchanged.
The 30-minute soak passed (750 edits, 250 media files, zero missed edits or
missing media); fresh reopen matched 424 files. Source audit parsed 1,617
snapshots, found zero syntax failures and matched all 900 expected text copies.
The preserved baseline comparison holds 777 cells, repairs video-create and
regresses hub history-restore; hub preview-restore is the other failed row.
These failures keep F1 open despite successful video creation on all lanes.

After the run terminated, both isolated UI fixes were applied to the main
tree. Their two regressions failed before the production changes and pass
afterward; all 57 related tests and studio typecheck pass. Source and rebuilt
release-client hashes match the isolated cloud-connected candidate. The native
preview scenario now starts with Inspector open and requires receiving control
readback after Restore, without clicking/reselecting. Native verification and
a new full certifying run are pending; no completion is claimed.

The strengthened native verification is currently **not passing**. Focused run
`2026-09-22T17-22-31.678Z` records 3 pass, 3 fail, 1 unsupported, 788 not-run;
all three preview failures occur before Restore, while selecting the heading
for the Inspector precondition. The recorded UI shows the surrounding `section`
selected, not `h1`, although the heading itself has the expected current weight.
The shared helper tests knob availability rather than selection identity and
can return before the asynchronous selection changes. After three unsuccessful
precondition adjustments, the execute verification loop is paused for review
of this helper, not another product change. No full-run restart is active.

The isolated cloud image `test-20260922-r3` was subsequently deployed to the
single test application (version 3). All three served artifact hashes match
the container's manifest; authenticated bootstrap is identical before/after
(revision 20, epoch 1, six documents). See `followup-2026-09-22-cloud-r3.json`.
It does not yet contain the newer text-editor fix described below. Source,
tests, evidence and fixture resources are retained; no archive/commit/push of
repository changes has happened.

After reviewing the selection architecture, the helper now clears the parked
selection through the UI, uses the existing Cmd/Ctrl+click deep-selection
gesture and waits for the current heading's stamped ID, text and Inspector tag.
No product change or timeout relaxation was made for this preparation fix.
Run `2026-09-22T17-34-27.762Z` selected correctly and restored all directions,
but the native author timed out waiting for its new history row. Diagnostic-only
repeat `2026-09-22T17-36-54.896Z` passed **6 rows, 0 failed**, with one known
unsupported personal-undo row and 788 not-run. All three previews, nine restored
views and receiving Inspector readbacks passed without reselection; all twelve
preview/restore screenshots were inspected. The intermittent history-row timeout
is retained as unresolved evidence, not declared fixed. A full run follows.

Full run `2026-09-22T17-38-58.932Z` was deliberately terminated after **83 pass,
8 fail** (not a completed matrix or soak). All failures were native L06 inline
text entry/commit; its 1,901 source inputs remained unchanged through termination.
The new loaded handshake exposed an existing editor-lifetime bug: a same-element
selection refresh changes `selSet`, causing effect cleanup to remove the active
editor. A real CanvasShell regression reproduces this (expected contenteditable,
received null). The text effect now reads the live selection through a ref
without depending on its changing snapshot; Enter and Escape are retained.
All 71 related tests and studio typecheck pass. Native rebuild and focused
L06/L18 verification precede another full run. This fix is not in cloud r3 yet.

Focused run `2026-09-22T17-48-16.419Z` completed **334 pass, 1 fail,
1 unsupported, 756 not-run** with all 1,902 source/build inputs unchanged.
All 300 inline text edits (100 per author), all 15 L07 operations, three
preview restores and ordinary history Restore passed. All twelve preview/restore
PNGs were inspected; receiving Inspector readback still requires no reselection.
The remaining failure was preparation for `L18.css-undo.peer-value-kept`,
native-after-peer: the peer's heading click left no selection. This is not
declared fixed. Read-only message-order diagnostics were added, without changing
the gesture, timeout or assertion. Isolated diagnostic run
`2026-09-22T18-00-46.437Z` then passed all six CSS-undo rows (8 total with
bootstrap), but this isolated pass does not resolve the intermittent failure.
F1/F3/F4 remain open; the next full run retains the failure diagnostics.

Full run `2026-09-22T18-03-24.145Z` was deliberately stopped after **591 pass,
1 fail, 3 unsupported** (remaining matrix and soak unrun). All 1,902 inputs
kept seal `d67cbd503980314c687554da72e7431ad9d19c91bb2961dcfc45ae58f4454be3`.
The same native-after-peer CSS preparation failure now records a `loaded`
message during the pointer gesture, with no selection message before or after.
The provider's unmount cancels its 50 ms pending selection post. A real React
HMR reproduction fails with that cleanup and passes when cleanup delivers the
latest pending post exactly once, before the replacement's loaded handshake.
A second regression preserves a latest clear instead of resurrecting an older
selection. Both failed in the main tree before the fix; 36 affected tests,
studio typecheck and changed-file Biome pass afterward. Native rebuild and
focused/full UI confirmation follow; this does not yet close F1.

Isolated cloud r4 rolled successfully (application version 4, one active
instance, no reported errors). The exact pushed image contains the text-editor
lifetime fix, verified by source hash inside the image. Its three served bundles
match the build manifest, and authenticated bootstrap is identical before/after
(revision 20, epoch 1, six documents and all lane hashes/effects). See
`followup-2026-09-22-cloud-r4.json`. This image predates the pending-selection
delivery fix above; no whole-F3 or native-cloud certification is claimed.

S19 has concrete actual-cloud blockers: six axe-core 4.13.0 scans cover History,
accepted preview and Sync in dark/light themes. They report invalid menu/tree
ARIA ownership, an unnamed canvas iframe, missing page language and low-contrast
shell labels/tabs (plus the light-theme project label). See
`followup-2026-09-22-cloud-a11y.json` for exact DOM targets and scope. These are
not waived as pre-existing. Cross-origin canvas, native/self-host, manual focus
and screen-reader checks are not certified by the automated shell scans.

Focused run `2026-09-22T18-23-28.273Z` is now terminal: **319 pass, 1 fail,
1 unsupported, 771 not-run**. All 300 text edits and six CSS undo rows pass.
The 1,903 input seal remained unchanged; 1,353 source snapshots parse and all
900 expected copies match. Native preview Restore stops before Restore because
the current-version pane stays blank, although the saved version renders. The
failure screenshot and all eight generated successful-direction preview/restore
screenshots were inspected. One receiving-native screenshot is still covered by
that failed preview dialog, so a passing underlying-frame probe is not clean
visible-UI certification. This native failure remains open; no rerun hides it.

S19 partial repairs now have failing-before/passing-after tests: menu ownership,
page language, named canvas frames, and readable shell text colors using the
existing fg-2 ladder. The affected five-file suite passes **21 tests / 60
assertions**, studio typecheck and new-test Biome pass, and release bundles were
rebuilt. Local Chromium axe scans in both themes verify the repaired shell
semantics and at-rest text contrast. Tree ownership still fails; an early scan
also reported the loading caption's contrast. Actual-cloud/native/self-host
rendered coverage, menu/tree keyboard behavior and the rest of S19 remain
required. See `followup-2026-09-22-shell-a11y-fixes.json`. Cloud r4 and the last
native build do not yet contain these accessibility repairs.

S19 tree repairs now preserve real tree semantics: named treeitems own their
native row/action buttons and descendant groups. Shared roving focus supports
arrows, Home/End, typeahead, activation and Escape from row actions. A focused
empty tree transfers focus when rows arrive; updates never steal outside focus.
The loading caption now uses the readable fg-2 token. Fail-before regressions
and controls pass: **25 tests / 75 assertions**, studio typecheck, scoped test
Biome and both catalogue/drag serializer tests. Release and Linux native debug
builds pass. Actual local Chromium verifies **30 keyboard checks** and zero
axe WCAG 2/2.1 A/AA violations in each theme; both screenshots were inspected.
See `followup-2026-09-22-tree-a11y.json` for hashes, exact scope and the keyboard
driver's expansion-settling correction. Actual backend/native S19 and manual
screen-reader checks are still pending. Focused native L01/L07/L18 run
`2026-09-22T19-04-45.975Z` completed **47 pass, 0 fail, 1 unsupported,
1,044 not-run**, with all 1,907 source inputs unchanged. All three preview
restores and six CSS undo cases pass. All twelve preview/restore screenshots
were inspected; the earlier intermittent blank preview is not declared fixed
by this isolated success. Other images in this focused run are not a complete
visual certification. A fresh full run with 100 text samples per author,
30-minute soak and the preserved baseline comparison is now running:
`2026-09-22T19-09-46.637Z`. Source/build inputs stay frozen until it terminates.

Actual-cloud S04 restart verification found a recovery-lifetime defect: invalid
U1 stays local and is initially backed up; after SIGKILL, valid repair U2 and a
concurrent designer-B color edit (r22), restart correctly holds U2 but overwrites
every retained copy of original U1. The owner still renders accepted red r22.
The regression fails against the real projection. An isolated source-copy fix
pins the original candidate and proven base in a bounded atomic record; four
fail-before cases also cover repeated repairs, a fresh conflict after resolution
and premature conflict clearing on a failed filesystem write. Initial related
verification passes **44 tests / 144 assertions**. It is not in the main tree
or deployed, and needs further verification. The actual conflict dialog also
leaks Shift+Tab focus into the background; Escape restores focus correctly.
See `followup-2026-09-22-cloud-recovery.json`. Both issues remain F3 work; this
client-side-invalid U1 is not proof of network-dependent U1/U2 replay. The full
surface run remains live; its frozen inputs have not been edited for this fix.

The isolated recovery candidate now passes **156 tests / 538 assertions** across
ten affected files (including actual hub runtimes), studio typecheck and seven
scoped Biome files. A fresh actual-cloud repeat proves U1/base survive SIGKILL,
U2 repair and designer-B color r24; the dialog exposes original/base and wraps
Tab. Taking the accepted version through keyboard UI retains original U1 and
U2 backups, while independent owner and local client render accepted red r24.
Both expanded-dialog theme audits report zero WCAG A/AA violations. A second
discovered defect left the resolved source in the summary's conflict list; its
fail-before tests and real U3 create/resolve repeat now pass. See
`followup-2026-09-22-cloud-recovery-candidate.json`; all six screenshots inspected.
First Escape focus returned to the iframe, a settled repeat to Resolve: retain
this timing limitation. All changes remain isolated with a patch backup; main
and native/cloud builds do not yet contain them.

The still-running full surface test has found native timeline split/delete
failures (initially **1,029 pass, 2 fail, 6 unsupported**). All six failure
screenshots were inspected: the split did not produce the fourth clip and the
playhead readout is at zero. Cause is not established; do not substitute an
isolated pass or relax the oracle. The run continues for remaining coverage and
soak. A live recheck confirms all **1,907** source/build inputs still have seal
`4e2c2f8e16426456c7a291dc46b70b24687cd8c2e59f5318ab53759f1e1917da`.

Later functional tally is **1,067 pass, 5 fail, 13 unsupported, 4 not-run**;
the same live handle continues into final coverage/soak. Failures include the
timeline's subsequent undo/redo and the native history preview's blank current
pane. Preview diagnostics show a saved heading, null current-preview heading,
valid bounds for both frames and the live canvas heading still present. Its
failure screenshot was inspected. F1 stays open; this is not a final run result.

A full certifying surface run with 0 failed rows, the sync lane and hub suite
green, and each fixed item with a test that fails without its fix.

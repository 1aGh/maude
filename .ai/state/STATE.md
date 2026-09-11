# Workflow State

> **kgai-active repo** — working state and history live in the knowledge graph, not this file.
> The `flow:workflow-state` skill reads/writes it via `flow:kgai-backend`.

**Status:** done — **v1.0.0 RELEASED 2026-08-20**, with one half unshipped. Plan `feature-production-grade-hardening` archived. The tag rolled the fleet for real (`releaseVersion 0.60.7` → instance restart → `1.0.0`, client bundle `d43058f5848b` matching the seal of the image that run built), published `ghcr.io/1agh/maude-hub:v1.0.0` + `:latest`, and built desktop installers past the bundle-completeness + client-boot gates.

> ⚠ **OPEN BLOCKER — npm is still on 0.60.7.** All 7 platform jobs failed with `npm error 404 ... PUT @1agh%2fmaude-linux-x64` (npm's spelling of "unauthorized"); `NPM_TOKEN` dates from 2026-05-20 and a 90-day token expired ~2026-08-18. `publish-main` was SKIPPED, so nothing shipped half-way — but the fleet runs 1.0.0 while `npm i -g @1agh/maude` gives 0.60.7. Fix: rotate the token, then `gh run rerun 32368661180 --failed`. The tag does not move; publish is idempotent.

> ⚠ **B2 drill 2 never ran.** The two-machine cloud↔desktop pass with a delete and a conflict — the drill covering what 1.0 principally sells — is unexercised. The fleet drill could not be rehearsed as specified (a `workflow_dispatch` deploy reports success while `wrangler` prints `no changes`, and `verify-fleet-release.sh` is tag-gated), so the fleet rolled for the first time on the real tag.

Phase A of the gate set found six silent bugs by pointing a typechecker at 52 files nothing was checking, closed the hub's missing delete budget, and put `npm publish` behind the desktop boot gates. Four CI-only failures followed the merge — all mine, all invisible on macOS/Node 24. Full account in the archived plan's Retro.


**Prior status:** feature-sync-journal-file-plane closed 2026-08-18 (branch `feat/sync-journal-file-plane`, archived). Seven sync lanes became two: Plane A (canvas CRDT docs) untouched, Plane B one journal-driven file lane — hub-ordered append-only `file_journal`, a payload-free poke over the existing Hocuspocus stateless channel, a per-hub ledger, one pure three-way `decideFile` table. **DDR-226** (architecture), **DDR-227** (git-as-transport rejected), **DDR-228** (two ownership modes). Increments 0–4.5 and 6 shipped; Increment 5 (burn-down) and 7–8 (shared-doc epilogue) moved to their own plan because both DELETE working code and the arc's rule is that nothing goes until its replacement has soaked a **released** version.

**What ships:** the whole `.design/` folder mirrors both ways by default (`syncFiles` ON) — the fresh-link RCA measured 216 delivered and 103 lost before this. Deletions propagate (`propagateDeletes` ON): a tombstone is a journal row with the same CAS a write has, so an edit that raced a delete wins at the door; nothing is unlinked, losers go to `_trash/` on both ends. A project is repo-owned or hub-owned, never both, with `adopt`/`detach` switching without moving a byte.

**Two security rounds, and the second found more than the first** — because the flag flip changed what "reachable" meant. Round one: 25 findings, all closed. Round two (`sync-v2-inc456-*`): 3 HIGH, and they invalidated the *justification*, not just the code. `propagateDeletes` shipped ON because the breakers were said to carry the weight the soak window would have carried; the delete breaker turned out to be a per-pass rate limit (two per pass were under every arm at every size, forever), the recovery story under it was one file class wide, and all three breakers had no consumer at all — declared, assigned, read by nothing. Fixed: a cumulative ledger-persisted budget, the hub force-staging the design root so backups carry it, and every hold reaching `_sync.json` and the Sync panel with an answer wired.

**Worst defect of the arc, found while fixing rather than reported:** the round-one containment fix resolved the deepest *existing* ancestor and appended the basename, so on a fresh link every nested file flattened to the top level. Invisible because every fixture pre-created its directories. Twice now a security fix here introduced a correctness bug the fixtures could not see.

**Next:** `.ai/plans/feature-sync-burn-down-and-shared-doc.md` — blocked on a shipped release plus a measured poke-miss figure, and carrying ~15 deferred findings from the second review.
**Active plan:** —
**Active task:** —

**Carried debt:** the doručenka's per-file rows reach `_sync.json` and the panel shows aggregates plus holds, but not per-file state; the `sync-doruceka-panel` scenario was never written; adopt/detach is CLI-only, so DDR-177's terminal-free desktop dialog is unbuilt; new-machine clone→link→pull parity is unit-covered, not run on a second machine; no live fleet drill, because the fleet only picks this up on a release tag. Version is still 0.60.7 — nothing here has shipped.


_2026-09-11:_ **fixed — validate: pending** | RCA `issue-sync-rate-limited-docs-never-retried` — 16 of 112 canvases stay `auth-rejected [rate-limit]` until restart (design.studyfi.com, no GitHub issue) | **DDR-102 parked `rate-limit`/`generic` refusals on "the provider's built-in backoff", and under its own multiplexing there is none per document**: `@hocuspocus/provider` 4.3 re-sends a token only from `onOpen`, and a partial refusal never closes a shared socket the 96 accepted documents keep busy. The stall watchdog bows out on `rejected > 0`, trusting the auth lane, which only ever re-probed the permanent classes. Each lane assumed the other covered it. **Fix:** a runtime-owned transient lane in `sync/index.ts`. The refused document alone is re-authenticated by swapping its provider on the same Y.Doc (the `reprobeNow` mechanism; `attach()` on an open socket sends the token at once), one hub window + jitter out (60 s + ≤15 s), doubling per repeat refusal up to the 5-min re-probe cap, reset by a handshake that lands. It is single-flight and paced under a sliding budget (150 re-auths per 60 s), and `stop()` clears it. The hint now says what happens instead of promising it settles on its own. **Found while fixing, not in the RCA:** a *pulled* canvas refused at its first handshake lost its deferred setup on every reconnect (permanent re-probe included, pre-existing), so the hub's eventual yes synced it into memory and nothing wrote it to disk. `owedSetups` now carries it through both lanes. Decision `maude/sync-transient-auth-paced-retry` SUPERSEDES DDR-102's backoff assumption. **Tests:** 6 new runtime tests + 2 pull tests + the original `:1699` test, which now asserts that `ui-c` actually recovers. 8 of them are red against the pre-fix runtime, and each guard (budget, doubling, single-flight, strike reset, stop clear) was mutation-checked to turn exactly its own test red. **Gates (scoped):** tsc 0, biome clean (the 5 warnings on the file are pre-existing), sync lane 1035/1035, `dist/` untouched. **Not done:** full `/flow:validate`; the hub's fixed window still counts refused attempts (out of scope, RCA); a retried provider's old status/auth listeners stay in `statusDetaches` until release/stop, exactly as they already did for the permanent re-probe.


_2026-09-09:_ **done (quick)** | issue #106 — Shift+Enter doesn't make a new line in a sticky note (no plan) | **The keystroke was never the problem.** `StickyEditor` lets `Shift+Enter` fall through untouched (`annotations-layer.tsx:4578`), there is no `beforeinput` handler in `apps/studio`, and both the input-router and the doc-capture shortcut handler bail on a contenteditable target — verified by reproducing a fresh sticky in Chromium **and** in WebKit (playwright WPE, booted on Arch by extracting Ubuntu `libicu74`/`libxml2`/`libflite1` locally): `"abc"` + Shift+Enter + `"def"` commits `"abc\ndef"` in both. So neither a swallowed shortcut nor a WKWebView quirk. **Three independent defects each reproduce the report on their own**, competed as three parallel `flow:investigator` seats (research bookend, reduce tier) — all three survived their own kill-tests. **(1) Clipping, the best literal match.** `.dc-sticky-body` is `overflow: hidden` on a card fixed at creation (`STICKY_DEFAULT_W/H = 200`), and `commitStickyText` never touched `w`/`h`; no autogrow existed anywhere. The decisive measurement is the MARGINAL case, not gross overflow: box exactly full → one Shift+Enter grows `scrollHeight` 200 → 217 (the line WAS inserted) while the rendered box is pixel-identical. The kill-test — native scroll-caret-into-view, which does operate under `overflow: hidden` — rescues 15-line overflow (`scrollTop` +96–130 px) and **not** this one (1–3 px of the ~17 needed). **(2) Keyboard entry select-alls, and Shift+Enter consumed it.** `annotations-layer.tsx:3259` never sets `editCaretPoint`, so `placeCaretAt`'s `fallbackToSelectAll` (`text-caret.ts:38`) spans the body; measured `isCollapsed:false` at open, and the FIRST Shift+Enter — before any typing — leaves `{html:"\n<br>"}`. Not `stripEditorMarkers` (a no-op for a plain sticky: `listType` undefined). **(3) A peer's commit overwrote the open editor.** The editors are UNCONTROLLED contentEditables; the collab ingest (`:1208`) had no guard on `editingId`, so `editingTarget` re-derived the live stroke and React rewrote the node. Reproduced with two real browser peers: B's differing-text commit wiped A's uncommitted text and line break; a same-id recolor did not (React bails on an identical primitive child) — which is what made a narrow fix sufficient. The reporter's own log shows `shared-doc ON` and a second live peer, so this path was armed for them. **Which one hit them is not determinable** — their board (`Combine-7-10.tsx`, repo `alligators`) isn't on this machine; one question settles it (did the text survive, vanish, or become someone else's?). All three fixed regardless. **Fix:** `collapseEntrySelectAll` collapses an entry select-all to its end before the break inserts, and ONLY when both boundaries still span the whole editable, so a partial selection keeps native replace semantics (⌘A+Shift+Enter now appends too — a deliberate deviation, pinned by a test). `useSessionValue` snapshots the editor's children per session so no store update reaches the DOM, and snapshots `listType` with it (the body is marker-prefixed at open and stripped at commit; a peer flipping the style mid-session would run a different rule than the prefix did). The sticky grows: the editor IS the measurement — same class, width and font, laid out in world units — so its `scrollHeight` needs no offscreen rig, and `grownStickyBox` is grow-only, normalizes negative extents, and is capped (`STICKY_MAX_GROWN_H`). **The adversarial review killed my own first design before it shipped** (`decision:maude/editor-protected-at-dom-not-in-store` SUPERSEDES `maude/annotation-editor-owns-text-until-commit`, recorded barely an hour apart): the first cut ALSO held the edited stroke's `text` back in `reconcileForeignEcho`, but that function's output IS the persisted store, so holding a field back doesn't shield a view — it reverts the peer's write and republishes stale text under the local user's name on the next commit of ANY stroke, no typing required, and weaponizable (commit A, wait for them to open it, commit B, their client re-publishes A as themselves into a versioned file). It bought no correctness either: the commit reads `innerText` off the node. Removed, LWW restored, and re-verified with two peers that the DOM snapshot alone holds. **General lesson: a reconcile function whose output is persisted state cannot be used as a view-layer guard.** The same pass caught the editor's new paper being the first UNWRAPPED CSS sink for a peer-controlled `fill` (`sanitizeAnnotationSvg` doesn't touch `fill`; the `background` shorthand takes a `url()` → a beacon from the studio origin on open) — it is `backgroundColor`, which cannot. Also fixed from the review: a growth-only commit no longer writes (opening a peer's overflowing note and blurring produced an undo entry + full-document PUT + broadcast), and the growth is capped against a peer-set `data-fs`. **Gates:** format/lint (0 errors, 201 warnings = identical to main, checked by stash)/typecheck + `tsc coverage` 278/278; 455 affected tests across 20 annotation/caret files; root suite 921 and sync lane 1027 green pre-review. `apps/studio/dist/` clean before AND after — verified `dc-sticky-body` is in NO committed bundle (canvas-shell builds dynamically), so the pinned-bun rebuild trap doesn't apply here. `--quick` deferred build, cross-platform scenario, a11y and design-system checks to a full `/flow:validate` before merge. **Unlike the two prior quick closes, the security review WAS the two-seat fan-out** (`security-auditor` + `ethical-hacker`, both PASS WITH SUGGESTIONS after the fixes above) — and it earned its keep: the finding that reversed a design decision came from the second seat, not the first. Commit `b89fa4e1` on `fix/106-sticky-shift-enter`. **Left undone:** text arriving from a board template, `maude design annotate` or Figma import can still clip — only the editing path grows a note; and `.dc-sticky-body` stays `overflow: hidden` in the read view deliberately, since loosening it without growth spills over neighbouring canvas content.

_2026-09-03:_ **done (quick)** | issue #109 — images never arrive on a linked project, while sync reports `synced` (no plan) | **The whole 200-line server-log tail was one line repeated** — `[sync/files] assets/<hash>.png: HTTP 429`, ~194 distinct assets — and the reporter saw broken image placeholders on a canvas whose status bar read `HUB SYNC synced` and whose tree read `88 / 88`. **429 is the workspace saying "come back in a minute", and the file plane did not know that.** Both refusal sites collapsed every non-ok response to `HTTP ${res.status}` (`file-plane.ts:375/645/679`), so a rate limit was handled exactly like a 500 or a hash mismatch: the pass fired its remaining requests at a door already shut, and since the cursor only advances on a clean pass (`out.failed.length === 0`), the identical work set came round on the next tick. **The retries were what kept the bucket empty** — self-sustaining, never converging. **The lesson had already been learned one lane over:** RCA 2026-08-11 (alligators, 182 assets, ~5 moved per boot) produced `asset-push.ts`'s `putWithRetry` — honour `Retry-After`, budget the backoff, keep a bounded body snippet so "rate limit exceeded" is distinguishable from a Cloudflare error page — and kept all of it in private constants, so when DDR-226's journal plane became the ONE lane for project files it inherited none of it. **Three defects turned a transient limit into a permanent one.** (1) The per-pass ceiling counted files that MOVED (`if (handled) moved += 1`), and a failed transfer moves nothing — so under any refusal the counter stood still and the loop ran to the end of `work`, one request per path, with no ceiling at all; **measured 320 requests where 200 was the intent**. (2) A pass could be started every 400 ms (`FILE_PASS_DEBOUNCE_MS`) by the cell file-event channel, with no floor and no mutual exclusion against the 20 s poll — putting the client's own request ceiling an order of magnitude ABOVE the hub's 600/min per-label read bucket (`fileReadBuckets`), i.e. the client manufactured the limit it then failed on. (3) `FilePlaneStatus` has a field for a held breaker and never had one for a failed transfer, so ~200 refusals rendered as `synced` — the same disease `held` was added to cure, one lane over, and the reason this arrived as "images don't load" instead of "sync is rate-limited". **Fix** (`decision:maude/sync-retry-after-shared-module`): the 429 semantics move OUT of `asset-push.ts` into a leaf `sync/retry-after.ts` that both lanes import, so they cannot drift a third time; a 429 now pauses the WHOLE plane until the hub said to come back — **checked before the cursor read**, which draws on the same bucket we are waiting to refill; the first refusal ends the pass instead of spending it; the hard ceiling counts REQUESTS, the quantity the hub actually meters; a refused cursor read reports through a new `onRefused` instead of collapsing to a null indistinguishable from a quiet pass; passes run through one entry point with an in-flight guard and a 2 s floor; and both the pause and any failures reach `_sync.json` and the Sync panel in words ("nothing is lost, it resumes by itself"). **My own inline security pass found a real defect in the fix**: the header is hub-controlled and `Retry-After: 0.001` parses as a valid millisecond, so a hub could have talked the client out of pausing at all and straight back into the storm while it believed it was obeying — `retryAfterMs` is now clamped at BOTH ends (`MIN_RETRY_DELAY_MS` 1 s / `MAX` 60 s), with a test. The body read is capped at 8 KB rather than the unbounded `res.text()` the asset lane had. **Fail-first verified empirically** by neutralising the two guards in place: 5 requests where 1 is correct, 320 where 200 is the ceiling — the exact numbers the RCA predicted. **Deliberately not done:** the RCA's hub-side `X-RateLimit-Remaining` (pacing before the wall rather than discovering it) — the hub already sends `Retry-After: 60`, `apps/hub/test/file-manifest.test.mjs:355` pins it, and a hub change only reaches users on a fleet roll while this one ships with the client. **Gates:** static + affected tests + full sync lane (971) + root suite (921) + typecheck and the coverage ratchet all green; client bundle rebuilt release-minified. `--quick` deferred the build, cross-platform scenario, a11y and design-system checks to a full `/flow:validate`, and the security review was **inline rather than the two-seat `security-auditor`/`ethical-hacker` fan-out**, per this session's standing no-subagents instruction — one reviewer, not two independent ones. Merged straight to `main` (`c58dfe35`) at the user's request; issue auto-closed. **I then broke Quality on main and had to fix it forward** (`a5602a50`): the committed `dist/client.bundle.js` + `comment-mount.js` were built with the bun on my PATH (1.4.0) rather than the pinned `.bun-version` (1.3.3), and the cloud-binary gate rebuilds before the sync lane runs — so the lane's own dirty-`dist/` tripwire fired on a clean checkout ("already dirty before the tests ran"). **The tell was `comment-mount.js` moving 54 bytes for a change that cannot reach it**; rebuilt under 1.3.3 it is byte-identical to 720c948d's copy, and a second 1.3.3 build reproduces both artifacts exactly, so the churn was the toolchain. CLAUDE.md's rebuild rule names the flags and the mode but not the bun VERSION, which is the part that actually decides the bytes. Quality green again on `a5602a50` (required job + export-lanes E2E). **The non-blocking full studio suite showed 7 failures against main's 6, and the extra one was mine to disprove, not to wave off** — an `AcpBridge` permission test, passing on the three preceding commits. It is not an assertion failure (`proc.stdout` undefined at `bridge.ts:1125` — the mock agent child never spawned), there is no import path from `sync/*` to it, and it passes 5/5 locally; but the decisive evidence was **re-running that job on the identical commit**: the ACP test passed and two entirely different tests failed instead. Across three runs the suite has a **stable core of 5** (exporters ×2, `fs-watch`, `import-asset`, `import-brand`) and a **rotating cast of 4** that are all spawn/network/timing shaped (ACP spawn, worker-lane export E2E, git watch, comments file-watch). So its failure set is not stable across runs of identical code — which is what `continue-on-error: true` is currently covering for, and worth measuring before that lane is ever made required.

_2026-09-03:_ **done (quick)** | issue #112 — comments self-duplicate on a linked hub and then refuse to resolve (no plan) | **The same defect as #114, one lane later, and #114 only fixed its amplifier.** The comments lane was written to its Y.Array wholesale (`delete(0, len)` + `push(next)`), which is not a replace under concurrency: two writers delete the same items (idempotent) but Yjs keeps both inserts, so the array became the list concatenated with itself, `persistJson` wrote that to `_comments/<slug>.json`, and the duplication became the canvas's truth. Every round doubled it — **1 → 2 → 4 → 8, the reporter's exact count** — and the cold-start union repair, published through that same wholesale write, re-created what it had just undone. #114's `unionCommentsById` fix removed the 2→4→8 amplifier and was tagged `Refs #112`, not `Closes`; the source stood. **The second symptom was downstream, not separate:** `commentsPatch`/`commentsDelete` matched by `findIndex` and returned on the first hit, so resolve marked copy 1 of 8 while the overlay — which renders everything with `status !== 'resolved'` — kept drawing the other seven. **Fix:** `applyCommentsToDoc` is an identity-keyed minimal diff, so a collapse is a PURE DELETE of items every peer holds (concurrent repairs converge instead of re-doubling) and dedupe runs on EVERY apply rather than only at cold start — duplication became self-healing instead of exponential. The law is `applyTextLane`'s, extended to the lane that is not text: comments carry stable ids, so sameness is decidable per ENTRY, which is why this needs neither the exact-repeat proof nor the elected writer an opaque Y.Text does, and no snapshot (per `e2924949`, a collapse preserving zero unique bytes must not spend the `_history/` ring). The other two writers stopped concatenating (`syncRoomFromComments` routes through the codec; `persistence.seed` pushes only identities the array lacks, closing the DDR-064 Risk 1 window `shouldSeed`/`isPinned` covers only when the pin already exists). Comment identity now lives in ONE leaf module, `sync/comment-identity.ts` — **a leaf is forced, not stylistic**: `collab/persistence.ts` owns `Y_TYPES` and `sync/codec.ts` imports it from there, so persistence can never import the codec back, yet both need the rule; four layers each had their own notion of "the same comment", or none. `saveCommentsForFile` dedupes and is the choke point every writer passes through including the room's `persistJson`, so **a project already corrupted in the field heals on its next read or write — no migration.** **The test that pinned the bug as EXPECTED behaviour was inverted** (`two peers replacing one comments array keep both pushes`), and convergence is now exercised on more than one replica — a one-peer repair test passes against the broken code, which is exactly how #114's first cut went green while still being wrong. Fail-first verified empirically by reconstructing the old write shape: 4 / 6 / 8 entries where the tests demand 2. Decision `maude/comments-lane-converges-on-identity` (EXTENDS `maude/text-lane-collapse-must-be-a-pure-delete`); the Y.Map-per-id transport, which makes duplication structurally impossible rather than repairable, is recorded as rejected-for-now — a wire-format change across peers and hub. Commit `a745cd71`; issue closed. **Not fully validated:** `--quick` skipped the cross-platform scenario, a11y and design-system checks, and the security pass ran **inline rather than as the two-seat fan-out** (session instruction against spawning agents) — one reviewer, not two independent ones. Run a full `/flow:validate` before this branch merges. Two pre-existing conditions surfaced and were left alone: `bunx tsc` has 8 errors in `generation/gemma-models.ts` + `git/service.ts` (`ChildProcessByStdio.on`, an `@types/node` drift) although the gate is documented green, and the full studio suite carries 12 failures none of which import anything this change touches.

_2026-09-03:_ **done (quick)** | issue #116 — PDF export emits Type 3 fonts a print shop rejects (plan `feature-pdf-text-outline-and-font-preflight`) | **The export was clean from every angle Maude could see, and unusable.** Chromium's `page.pdf()` has no other representation for a COLRv1 colour font (`@font-palette-values`) or a synthetic italic, so it emits **Type 3** — a per-glyph content stream, not a font program. Preflight calls that *not embedded*; the file downloads, opens, and looks right on screen, and the only signal was `pdffonts` on the delivered artifact or the printer refusing the job. Reported on a real print run (Brno Alligators A6 + A-board, brand font `AlligatorsSigns-Color`/`-Fill`), worked around by hand with Ghostscript outside the product. **Shipped:** top-level `options.text` = `keep`/`embed`/`outline` (beside `dpi`/`pageFit`, NOT inside `pdfPrint` — font representation is orthogonal to the box/marks post-pass), a native always-on font preflight (`exporters/pdf-fonts.ts`, pdf-lib object-graph walk, no new dependency) that names the offending faces and flags a **synthetic italic** specifically because that one is fixable at the source, `embed` as a hard refusal, and `outline` via Ghostscript `-dNoOutputFonts`. **The notice rides the EXISTING `ExportDegradation` channel** — `audioDropped` became optional and `fontsNotEmbedded` joined it — because a muted mp4 and an unprintable PDF are the same shape (*the file is real, the file is wrong*) and the job record / history ledger / WS emit / pill / toast were already wired to it; it propagates over the cloud lane for free via `x-maude-degraded`. **Failure posture is deliberately the OPPOSITE of `pptx.ts`:** svg2pptx silently falls back to a PNG deck, which is right there; silently returning live Type 3 fonts to someone who asked for outlines hands them the exact artifact the feature prevents, so a missing `gs` is an error carrying the install line. Ghostscript exiting 0 is not proof either — the pass re-runs the preflight on its own output and throws if a font survived. **gs is apt-installed in `apps/render/Dockerfile` (cloud lane needs no user setup) and deliberately NOT bundled in the signed `.app`** — AGPL-3.0 vs MIT, notarization, and a new DDR-177 bundle-gate arm, for one opt-in mode; a documented exception to DDR-177. **The flag set was MEASURED, not copied:** pass-through ON + forced Flate = 144 483 B jpeg; pass-through ON only = 144 417 B jpeg; pass-through OFF + forced Flate = 417 369 B flate, all identical px/ppi. `-dPassThroughJPEGImages` is what actually protects raster fidelity — its true default is *why* the hand-run recipe never corrupted anything, and the reported 16 MB → 254 MB is what happens when it does not win — so it is now explicit; the forced Flate filters stay for a different reason (`AutoFilter*` may pick DCT for an image gs must genuinely re-encode: a silent lossy pass over lossless print artwork). **Two landmines found by fixtures that mimic the producer rather than the API:** `/Resources` is an INHERITABLE page attribute, so a leaf-only lookup reports zero fonts for whole documents; and pdf-lib DEFERS `embedPage` until flush, so analysing the in-memory document reports nothing for every `pageFit` export — the adapter analyses SAVED BYTES, pinned by a deliberately-inverted test that fails if pdf-lib ever makes embedding eager. Validated against a REAL Chromium capture in `export-e2e-lanes` (`LiberationSerif-Bold=embedded`, which only resolves via the Type0-descendant walk — a naive read would have made `embed` wrongly refuse). **Security finding closed in-branch:** `x-maude-degraded` was `JSON.parse`d and cast unvalidated at the render-service boundary — latent while it carried a boolean, reachable once it carried an array the panel renders with `.join()`; `safeDegradation()` now clamps it like `safeArtifactName` does. Decision `maude/pdf-text-modes-and-external-outlining` (DDR-237). **Not validated:** `--quick` skipped build, the cross-platform scenario, a11y and design-system checks; the security pass ran **inline rather than as the two-seat fan-out** (session instruction against spawning agents) — one reviewer, not two. **`apps/render/Dockerfile` is UNVERIFIED** — no Docker daemon locally, so the image was never built and `gs --version` never ran inside it; the cloud lane's claim rests on CI. Run a full `/flow:validate` before release.

_2026-09-03:_ **done** | issue #111 — a second comment disappears seconds after it is added on a hub-linked project (no plan) | The **loss** half of the lane whose duplication half closed the same morning as #112, and a different mechanism despite the shared symptom surface. The reporter added a comment, it appeared, then a few seconds later it was gone and only the first one was left. **Cause: two authoritative writers over `_comments/<slug>.json` and nothing arbitrating between them.** A mutation wrote the file and only *afterwards* — across a disk re-read, in an `onCommentsChanged` nobody awaited — published the list into the room's Y.Doc, while `Room.flush()` projects that doc straight back over the same file on an 800 ms trailing debounce that **any** doc update re-arms, hub traffic included. So on a linked project a flush is essentially always pending, one landed inside that window, and it wrote the pre-mutation doc over the file. The comment was gone from disk before the hook's own read reached it, so `syncRoomFromComments` was handed the stale list, `jsonEqual` short-circuited, and the doc never learned about it at all. `c1` survived because it reached the doc earlier, via the cold-start union, on a path with no such window — hence "only the first one stays". **The reporter's own scoping was the diagnosis:** local projects never hit it, because nothing else drives their doc, so the only flush is the one scheduled *after* the doc already holds the comment. **Fixed as two ordering/ownership rules, not a narrowed race** (`decision:maude/comments-lane-publishes-doc-first`): (1) under DDR-064 the doc is the shared object and the file is its projection, so a mutation publishes to the **doc first** and disk second, both awaited, through one `publishComments` choke point — the hook now receives the post-mutation list in memory and the mutation path touches disk exactly once; (2) doc→file may materialize a delete but may **never** drop an identity the doc has never carried — that one is a write still travelling towards the doc (an import that hasn't landed, or an external edit, which is how `/design:edit` resolves comments), and overwriting it is silent loss with no error and no recovery. Deferring is self-clearing: whatever brings the id into the doc is itself a doc update, which re-arms the flush. **The evidence for (2) replaced DDR-064's `seenComments` latch,** which asked the same question — has this doc ever held comments — but sampled it at flush time only; an id that arrived and was deleted again between two flushes was never recorded, so its delete-all read as "never populated" and never reached disk. Two notions of one fact, and only the observer has it. **My own review pass found two real defects in the fix**, both introduced by that observer and both fixed before commit: the identity set was unbounded (peer-supplied content under DDR-054 §2d — a hostile hub streaming distinct ids is unbounded memory; now capped at 10k, evicting oldest-first, which degrades toward *deferring* rather than deleting), and it held a strong reference to every doc, pinning the Y.Doc of every canvas ever opened (now a `WeakSet`, since the observer closes over the set, not the reverse). **Fail-first verified**: 8 of the 12 original tests fail against the unfixed code; the 4 that pass are the must-not-regress guards (genuine delete, delete-all, hub-pushed comment landing on a fresh peer, remote value update). **Deliberately not done, with reasons:** a `commentsEditAt` stamp plus `decideCommentsColdStart` — what the annotations lane already has, and what would let an import arbitrate *value* differences rather than only identity — is the principled end state but a wire-format addition, and it fixes a different symptom (a late fs event deleting a hub-pushed comment, i.e. losing a *remote* comment); a `fileForSlug` cache (perf only — every flush of every room currently walks the whole canvas tree — but a stale cache would be a new correctness hazard); and `fs-watch`'s 50 ms leading-edge throttle, which **drops** events rather than deferring them (pre-existing, and it changes timing for every `fs:any` subscriber). **Gates:** full studio suite (5517), root cli+hub (921), sync lane (963), typecheck + coverage ratchet and the site build all green; `--quick` close deferred the cross-platform scenario, a11y and design-system checks to a full `/flow:validate` before release — none of them reach this change, which has no UI surface. Security review was done inline rather than by the `security-auditor`/`ethical-hacker` fan-out, per this session's standing no-subagents instruction.

_2026-09-03:_ **done** | issue #118 — sync stalls after the cloud cell sleeps and never resumes (no plan) | **Caught live rather than reasoned about:** `~/git/personal/alligators/.design/_sync.json` read `state:"online", docs:{synced:0,pending:85}` fifteen minutes after a boot whose own log line said `85/87 synced`, frozen since the reconnect, with **199 ESTABLISHED sockets** to the hub edge (design says one) and **not one sync line** in 20 minutes of failure. A cell sleeps after 20 min idle (`cell-do.mjs:53`), which drops the WebSocket; that correctly demotes every canvas to `pending`, and **nothing re-promoted them** — `noteDocState(slug,'connected')` had exactly ONE call site, the post-handshake reconcile inside `connectCanvas`, reached at attach/adopt/re-probe and never again. Permanent for the life of the runtime. `syncPresentation` then read "connected, zero settled, a while now" as a stall and **blamed the credential** (`rejected` was 0) — advice that sends the user to Resync, which re-handshakes 85 canvases against a waking cell and lands on `offline`. The reporter's sentence was the product's own advice looping back. **Fixed:** re-promotion on reconnect (bounded by the existing settle ceiling; deliberately NOT a re-run of `handleSynced`, whose migrate-seed is a one-time seed); `goOnline()` no longer stamps `lastSyncAt`, which its own field contract already forbade; a stall watchdog; the stall message stops blaming a sign-in where refusals are provably zero; the renewal failure `reason` is logged instead of discarded. **Three security rounds, and rounds 2 and 3 each found a HIGH inside the PREVIOUS round's remediation — all in the recovery path.** (1) `disconnect()`+`connect()` wedges the socket permanently shut: `connect()` early-returns on `status===Connected` *before* restoring `shouldConnect`, and that is exactly the state the watchdog fires from — the remedy would have made the outage permanent. (2) `onClose()` emits `status`/`disconnect` but **never `close`**, so calling it skips every provider's `boundOnClose`; must `emit`. (3) `provider.synced` is untrustworthy across ANY status transition, because the library's own `checkConnection` force-close calls `onClose()` directly — so `onceSynced()` would resolve with no handshake and invent a fully-synced display, then disarm the watchdog via its own `docs.synced > 0` guard. (4) the provider's `timeout` option is **fatal, not retryable** (`@lifeomic/attempt` rejects directly, bypassing the retry path) and every `connect()` call site floats its promise. (5) `generic`/`rate-limit` never enter `rejectedPermanent`, so guarding on it laundered a refused document into a green row. **Process lesson:** every guard was individually well-argued; their intersection was empty of the intended case and full of the harmful one — a recovery action must be evaluated in the state its own trigger selects for. Source-regex pins are not gates (they stayed green through all four HIGHs) and were replaced with behavioural tests; the watchdog went from zero coverage to driven by an injected clock. Every fix proved fail-first. Decisions in the graph: `sync-runtime-owns-connection-liveness`, `sync-socket-recovery-via-library-close-path`, `sync-forced-reconnect-emits-the-close-event`. **Not fixed, recorded:** the 199-socket leak (needs its own reproduction); the report's 3 crash logs + server-log tail were never readable (reports repo 404s for this token); a global `unhandledRejection` handler for the studio server; cell cold-start "bind first, restore behind a restoring page". `--quick` close: build, cross-platform scenario, a11y and design-system checks deferred to a full `/flow:validate` before release.

_2026-08-26:_ **done** | issue #105 — Linux canvas media kills the renderer, + a crash audit that found a second bug (no plan) | Two stacked failures, the second only reachable once the first is fixed. **(1)** `gst-plugins-good` carries `autoaudiosink` and is an *optional* dep of webkit2gtk on Arch and most non-Debian distros; without it `createAudioSink()` hits a `RELEASE_ASSERT` and aborts the whole web process — WebKit's own next line is a now-dead `if (!audioSink) return nullptr;`. **(2)** With the plugins present, `gst-gl` asks radeonsi for a colour buffer it rejects (`Invalid CB format: 133`) and `gst_gl_memory_read_pixels` faults. Fixed as **DDR-234**: `bundle.linux.deb.depends` names the plugin packages; `linux_media.rs` detects an AMD GPU from `/sys/class/drm/*/device/vendor` and sets WebKit's own `WEBKIT_GST_DISABLE_GL_SINK=1` (any user value wins, `0` included), and detects a missing audio sink at boot and names the install command for the distro `/etc/os-release` reports. **Verified by measurement, not by "it didn't crash":** with `GST_DEBUG=GST_ELEMENT_FACTORY:4` in real WebKitGTK, the pipeline builds 4× `glupload` + 4× `glcolorconvert` without the fix and **0** with it, playback still advancing; `/proc/<pid>/environ` of the shell-spawned `WebKitWebProcess` carries the var. **The crash itself did NOT reproduce** — the control survived 120 s of 4×1080p — so the claim is "the faulting component is out of the pipeline", not "it no longer crashes". A first run looked green and was worthless: `play()` was rejected with `NotAllowedError` and nothing decoded, until the driver was made to match wry's `AutoplayPolicy::Allow` default. **The crash audit found a separate, reproducible bug.** Two `maude-server` cores hours apart had byte-identical stacks; frame #3 is the signal trampoline, so disassembling frame #4 gave the real site: `div %r8` with the divisor loaded from `0x28(%rdi)`, followed by `mov %rdx,%rax; sub %rax,%rdx` — a modulo feeding a round-to-multiple. A zero stride → `#DE` → Bun's handler → `ud2` → SIGILL. Every frame is native, so it is **Bun v1.3.3**, not our TS; `.bun-version` is 11 patches behind (1.3.14 exists) and the bump was deliberately NOT folded in, because the crash could not be reproduced on demand (75 s standalone, full 84-canvas cloud sync, stayed up) and nothing here could verify it. **What was ours** is **DDR-235**: `MAX_RESTARTS` counted lifetime crashes, not a loop — it reset only on a deliberate project switch, so three unrelated crashes in one single-project session retired the project permanently, and two of the three had already happened; and reaching the cap was an `eprintln!` to a terminal a launcher-started app does not have, leaving a window whose server had stopped answering. Now uptime decides whether a death spends the budget, and the give-up is a modal naming the project with a working **Try again**. **Also fixed:** `check-tarball-shape.sh` had been failing on npm ≥ 11 (`npm pack --json` became an object keyed by package name; the script iterated an array) — a broken release gate nobody had noticed.

_2026-09-02:_ **done** | issue #119 — maude-server at ~16 GB and the ACP chat wedged for 55 min (no plan) | One defect presenting as two symptoms, and the guard that should have caught it was measuring the wrong number. **Cause:** `appendTranscript` persisted every ACP session update VERBATIM, so a tool result carrying a screenshot landed as a single **1.36 MB** line — 66–76% of a screenshot-heavy transcript's bytes — that **nothing ever reads back** (`readChatMessages` projects a tool call to `{toolName, done}` and discards `content`). Nothing capped, rotated or pruned `_chat/`, so the reporter's project reached **554 MB across 24 files, largest 177 MB in 1733 lines**. Every reader then loaded whole files (`readFileSync(utf8).split('\n').map(JSON.parse)`), and `listChats()` did it for EVERY transcript — to pull a ~60-character title out of the first user line — on a path `ChatPanel.jsx` fires at **every turn end**. Measured under Bun on the real data: **661 ms of fully synchronous, event-loop-blocking work and 1.29 GB peak RSS per call**, climbing to ~1.9 GB retained. The RSS is that churn; the "stuck chat" is the same single-threaded loop that serves the ACP socket being blocked by it. **The guard was blind by construction:** `mem.ts` watched `heapTotal`, a V8 intuition that does not survive DDR-009's Bun/JSC — measured, `rss` hit 1.29 GB while `heapTotal` peaked at **5 MB**, so neither threshold was reachable, no `[mem]` line ever entered the log ring, and the attached `serverLogTail` was silent. **Fix** (`decision:maude/acp-transcript-bounded-io`): a new `acp/transcript-io.ts` owns every transcript filesystem primitive under one rule — a transcript's SIZE must not determine the cost of reading it. It also **reverses a prior deliberate duplication**: `bridge.ts`'s line counter was hand-copied from `transcript.ts` with a comment asserting the two MUST agree; a comment is not an invariant, and the shared function takes an absolute path only, honouring the original objection. Blobs are elided on write; `mem.ts` watches `rss` with exponential GC backoff but never suppresses the log line. **Where the RCA was wrong, twice:** it proposed reconciling `fs-watch`'s skip list with DDR-115's runtime-state taxonomy — which would have **killed comment collab**, since `isRuntimeStateRel` excludes `_comments/` while `collab/index.ts` matches it on `fs:any`; and my first watcher fix didn't work at all, because macOS raises a bare-directory event alongside the file event, so every ACP append still woke every subscriber until the match covered `rel === d`. **Security fan-out: defender PASS**, and its findings were real — the two-pass count/read race would have re-introduced the exact seam desync the fix exists to prevent (`total` stale-low against a fresh window drifts every `seq`), now one fd + one `fstatSync` snapshot; plus `statSync(path)`→`fstatSync(fd)`, MCP's `blob` key added to the size control, a `__proto__` key silently dropped from the audit record, and the `process` field I added to the debug bundle was **dead** (nothing wired it into the report) — now under the log-tail consent with `docs/report-schema.md` updated. The attacker seat produced no verdict across three requests; its six angles were checked by hand instead (no `allocUnsafe` leak — probe-confirmed; `_trash` is a write destination with no `fs:any` consumer; no client reads `.data`). **Measured after: listChats 661 ms / 1.29 GB → 40 ms / 69 MB.** Every guard verified fail-first. **Deliberately not done:** transcript compaction/retention — once reads are bounded, 554 MB on disk is disk space, not correctness. `--quick` close: build, cross-platform scenario, a11y and design-system checks deferred to a full `/flow:validate` before release.

_2026-08-26:_ **done** | issue #107 — ACP sign-in dead end on Linux (no plan) | Maude Desktop told a signed-in user their `claude` CLI was "not signed in" and offered a Sign-in button that could only end in "Sign-in timed out"; no browser ever opened. **The cause was outside Maude and the first diagnosis was wrong.** Round one blamed stdout noise — the reporter's `~/.local/bin/claude` mise wrapper prints `mise use -g` to STDOUT ahead of the JSON, so `JSON.parse(wholeStdout)` threw. Real, proven, and NOT why they were stuck: the wrapper ends in `mise x claude -- claude "$@"`, which re-resolves `claude` **by name**, and outside a mise-activated shell that resolves back to the wrapper — **infinite recursion**. Measured with a depth-instrumented copy under the app's own `/proc/<pid>/environ`: unbounded invocations in the app, **1** in the user's zsh. Found by driving the probe under the app's exact environment after `/_api/preflight` and `signin-status` were interrogated live; disconfirmed along the way were inherited fds (5 785 per child, but 0/2000/5800 all timed at 0.33 s), mise lock contention, `mise` off PATH, and missing `TERM`/`MISE_*`. **What was ours:** `getClaudeAuthStatus()` returns null for four distinct conditions and every caller read null as "signed out", so an unreadable probe became a confident false accusation — then routed the user to an action whose only success signal is the probe that just failed. Fixed as **DDR-233**: unreadable ⇒ `status:'unknown'` with the action withheld; `readBounded()` replaces `new Response(stdout).text()` (which waits for pipe EOF — a descendant on fd 1 wedged the probe forever, so the honest-unknown path was unreachable in its own headline scenario); the JSON object is extracted rather than the blob parsed, scanning backwards with every giving-up path returning null; `resolvedPath` renders in every state again (gating it on `action==='signin'` had hidden DDR-166 Decision 3 exactly where a hijack is most likely). **Three security rounds, round 1 NEEDS FIXES from both seats** — every finding against the first cut was one shape: a giving-up path returning a guess instead of an admission (a candidate budget spent on noise before the answer let a 242-byte prefix flip fail-closed to fail-open; "last object that parsed at all" turned an NDJSON-logging wrapper into a false "signed out"; a hard byte-cap bail discarded a payload already in the buffer). Local hotfix applied to **all 13** affected `~/.local/bin` shims — the shipped v1.0.9 went green with no rebuild. (A first pass found only 8: the grep matched the literal `mise x "<tool>" -- "<tool>"` and missed five whose tool spec is qualified — `mise x npm:@kitlangton/ghui -- ghui` — while the COMMAND half is still resolved by name, so they carried the identical defect.) Commit `ecf28f8b`. **Two things this surfaced and did not fix:** `proc.kill()` still orphans a recursive wrapper's descendants, and `pnpm test`'s hub lane reports a **nondeterministic** test count (917/911/921 across three runs of one tree, zero failures) — a silently-dropped test file would read as green there.

_2026-08-24:_ **done** | hybrid-export-browser-images — export-fidelity phase (DDR-232) — export fidelity across all three lanes + security round 3 | The cloud/browser export lanes diverged from the tuned desktop `local` reference; found only by standing up a real cloud-shaped cell (`~/maude-smoke`) with a live project and reading the bytes. Root causes, none of which the same-engine fixtures caught: dom-to-svg is a partial CSS renderer — its image inlining never worked (writes `xlink:href`, reads `href.baseVal`), it ignores `object-fit`, and drops `filter`/`repeating-linear-gradient`/`clip-path`; the capture spine now owns polyfills for all of them (filter baked via canvas `ctx.filter`, object-fit→preserveAspectRatio, a leaf-element inline-SVG substitute for the unsupported paint). HTML export was `<base>`-relative → no assets off the serving origin; now self-contained (every image/font/def inlined). Worker-lane SVG/video failed 100% on the canvas-origin CSP (inline `addScriptTag`); fixed by preferring the page's own spine + a CSP-safe route-fulfil injection — no CSP relaxed. `format×scope` is now validated as a PAIR from one table (`exporters/format-scopes.ts`); the "PDF invalid render job" was `pdf`+`project-raw` accepted by a route that checked each half independently. **The cell→worker boundary re-introduced one bug class three times** — a guard that reads the checkout no-ops on the worker (which has none) and passes vacuously: scope targets, print props (`options.printProps`), and the `<Audio>` pre-flight (`options.unsupportedMedia`) all failed this way. Codified as `maude/export-checkout-inputs-ship-in-job`: checkout-derived inputs are resolved by the cell and shipped in the job. Bun's `fetch` has its own 300 s ceiling (independent of the signal) that killed every >5 min video as "service didn't answer" — `timeout: false`. **Every format e2e-tested on real bytes, both platforms** (`export-e2e-lanes.test.ts` web, required CI job; `export-formats.e2e.ts` native): png/svg/pptx browser + worker, pdf incl. print boxes, html self-contained, mp4/webm/gif, zip, canva. **`/flow:done` security fan-out (defender+attacker) found + fixed 5 blockers in-diff, fail-first**: `data-dc-screen` path-traversal file-write in the svg/html shims (png was hardened, siblings weren't), stored-XSS in the self-contained HTML artifact (no CSP, verbatim `<script>`/title), a viewer-flood ledger byte-eviction delete primitive, unchecked cell→worker options passthrough, and a remote-`url()` beacon left in the artifact. Alligators audio artboards fixed at source (`_broadcast.tsx` → `@remotion/media`). Commits `54cf41cf`…`49e0a49d`. Verified live on the local cell: cloud PNG/SVG matches the desktop reference (fonts, filter, cover, sash), Krpole MP4 exports WITH audio in 108 s.

_2026-08-21:_ **done** | hub invite landing + OIDC approve (no plan) | Report from a real self-hosted hub (design.studyfi.com): an invitee opening `/join/<token>` saw raw JSON. Cloud Phase 6 had built the server half (mint/look/redeem) for a `maude://join` desktop deep-link that was never built; the studio has since become a browser page at `/` (Phase 25/27), so the landing page now redeems IN THE BROWSER — `join-page.mjs` (server-rendered, script-free: bound email read-only, choose a password, one button; strict-OIDC hubs get the provider link) → form-encoded `POST /join` → same `maude_studio` cookie `/studio/signin` mints → 303 `/`. JSON contract unchanged; both redeem branches now STORE the project role (the v0.55.0 role-less-token class hit this door too). `servicePage()` had no CSS at all — centred now. **Second gap from the same report:** the invitee signed in via Google instead and sat in "Waiting for access" where "Link" → `no such user` and the invite could not be confirmed — added `POST /admin/api/oidc/approve` (`approveOidcSub`: create account with a random never-revealed password + link the subject, one transaction; open invites for that address revoked) + role select/Approve button in the People view; admin `api()` unwraps `{"error"}` so alerts read as sentences. **Security review before commit (defender + attacker, `.ai/logs/security-reviews/hub-invite-landing-*`): 1 HIGH (a mangled percent-escape in the GET threw out of `onRequest` and killed the hub process — pre-existing line, now the URL humans paste) + 1 MEDIUM (strict OIDC left the POST open as a third password door) + fail-open login-CSRF gate, existence oracle, missing referrer/frame/CSP headers, readForm without timeout — all fixed in-diff with fail-first regressions; server.mjs now catches non-null throws out of the human auth doors (500, not exit).** **Round 2 (fixes + approve):** defender PASS WITH SUGGESTIONS (R1 prompt-prefill → an `invited` tag + a warning when no invite matches; R2 `/studio/signin` had no CSRF gate → same `formOriginAllowed`), attacker NEEDS FIXES → 1 HIGH, the SAME crash class one door over: `cookieValue`'s unguarded `decodeURIComponent` — `Cookie: maude_studio=%E0` on signout / the studio proxy killed the process; guarded + test. Approve now requires the subject to actually be in the pending queue. Admin bundle sits at 28 549/28 672 B gz — DDR-097's ceiling is effectively spent. Hub suite 919/919; full quality gates green (lint's one pre-existing format error in `canvas-shell-build-error.test.ts` fixed in passing). Commits `9542819d` (landing) + close-out. Open: the structural `onRequest` crash contract still protects only the auth doors; `/studio/signin` has no CSRF gate (pre-existing, same fix applies); a `strict` hub can still MINT invites that can only fail.

_2026-08-20:_ **done** | feature-before-first-external-users (binding v1.0.0-deferred debt; archived) | The whole binding block cleared and merged to main. **Task 1** A7 shared-doc/TSX notices became an additive `notices[]` payload rendered in the Sync panel with a per-(notice, hub) dismiss (was `console.warn` a terminal-free user never saw). **Task 2** the three sync toggles (`syncFiles`/`propagateDeletes`/`resolveFirstAnchor`) got a MAIN-ORIGIN `/_api/sync/settings` route + panel section, per-file doručenka rows, a global first-upgrade consent dialog, and in-UI adopt/detach (`/_api/sync/ownership`) — every breaker remediation string used to say "edit linkedHub.* JSON" at a user DDR-177 says has no terminal. **Task 3** `_trash/` became findable/restorable/prunable (`sync/trash.ts` scanner — deliberately not a write-path index — + `/_api/sync/trash`), copy repointed off the hidden folder. **Task 5** hub-trust burn-down: F-4/F-7/F-8/F-14/B14(precondition)/F-11/F-12/B6/B13 fixed with fail-first tests, B11 fell to the ownership confirm row; scope half of B14/B15 deferred with rationale (prefix scope doesn't fit file paths — narrowing today makes broken tokens). **Task 4** OIDC AppSec pass: surface verified sound (SSRF/JWKS pinning, no email-auto-link, PKCE/nonce, alg pinning all already closed), one open gap fixed — `/studio/signin` + `/auth/oidc/callback` were unthrottled while `/auth/login` was rate-limited. Every new route pinned MAIN-ORIGIN in the canvas-origin gate + REFUSED in the cell manifest. **Still blocked by design:** Increment 8 (relay deletion) waits for a RELEASE — main carries all this but npm is 0.60.7. Concurrent hub/OIDC session ran throughout; staged file-by-file, no collisions. Commits `fee7150d`…`62b949ac` (+ `21e3af76` lint).

_2026-08-21:_ **done** | spike fixes round 2 (M7–M9, no plan) | The spike report grew three findings after the M1–M6 batch; all fixed. **M7 corrected the report's — and this session's — Task 11 conclusion:** the blank browser canvas was never DDR-193 containment, it was `MAUDE_PUBLIC_CANVAS_ORIGIN` that every layer supported and no deployment path ever set, so the iframe pointed at a container-internal port while all eight verification steps passed. `workspace-up --canvas-domain` now renders the whole chain (`.env` + compose + Caddy block + DNS duty) and warns loudly without it (`f342372c`, carries the parallel session's finished render-CLI surface — interleaved hunks, author-confirmed green). M9: the canvas sandbox now decides by NETWORK REACH — `data:`/`blob:` pass, `@import url(https://…)` stays denied; a DS film-grain used to take every build down (`246a68c5`). M8: a failed canvas import now refetches the URL and shows the 422 body instead of the bare TypeError. Docs un-conflate "never run on the server" from "not visible in your browser" — the trap this arc fell into three times. Incidental: macOS `/tmp` symlink silently DISARMS the sandbox allowlist in tests (realpath mismatch) — production (Linux) unaffected, suite pinned via realpath. Open: the ninth verification step ("a canvas actually renders in a browser") remains unproposed; `--seed-repo` PAT-in-argv stands.

_2026-08-21:_ **done** | cloud-export-render-workers (DDR-230) | Export in the hosted cloud studio (and self-hosted hubs) failed with `{"error":"not found"}` for every format — deliberate, since DDR-209 A′1 bars evaluating tenant TSX on vendor compute. Shipped the owner-ratified fix (Track 3 over browser-side rendering after an RCA debate): a separate, browser-bearing, **secret-free `maude-render`** service (`apps/render/`) that renders an export job through the existing exporter spine **unchanged** and streams the artifact back. Cell-side render lane `local`/`remote`/`none` (`exporters/jobs.ts`+`remote.ts`); `zip` always renders in-cell. Containment reshaped not weakened — the `/_api/export` forbidden prefix keeps an exact-path `except`-list for the job lane, the synchronous render stays refused, `check-containment.sh` pins both. Self-host `--render` sidecar + docs; tag-gated `render-deploy.yml`. **Security review (defender+attacker) before commit found 1 HIGH SSRF (parsed-URL vs raw-string allowlist bypass) + 4 MEDIUM, all fixed in-diff; 2 MEDIUM accepted with follow-ups in DDR-230.** Coordinated with a concurrent session holding interleaved M7 changes in 3 shared files (they committed the trio, I committed the rest atomically — jobs.ts+remote.ts together, dodging the v0.51.0 import-coherence trap). Commits `860c5851` + `0e9128b5`. **Open:** live fleet deploy is release-time (fires on the v* tag); the `cloud-export-jobs` scenario is authored but needs a live fleet to run.

_2026-08-20:_ **done** | hub `workspace-up` spike fixes (M1–M6, no plan) | Six defects from the first live-AWS run of `maude hub workspace-up` (report lives in `studyfi-design/.ai/reviews/`). **M6 was a blocker: BYO identity could never work with Auth0** — the hub strips the issuer's trailing slash twice on the way to `jwtVerify`, which compares `iss` as an exact string, so every sign-in died on the callback; `strict` + Auth0 meant nobody could get in at all. Fixed by accepting both slash forms (verified against `jose@6.1.0`: an array issuer is exact `.includes()`, and the JWKS is still origin-fenced). **M3 leaked a live GitHub PAT to stdout**, `--dry-run` included — it reached SSM history and CloudTrail on the real run and had to be revoked. M5: the OIDC button existed and no page called it, so a working door was a URL the UI never showed. M2: `--admin-password` on a re-run silently desynced `.env` from the DB, repairable only by `down -v`. M1: the restore drill was spawned without its env and reported "nowhere to run" as "backups broken". M4: our own least-privilege policy omitted `s3:GetLifecycleConfiguration`, permanently skipping the check that guards media expiry. Every fix pinned by a test verified to fail against the bug first. **Two follow-ups left open:** `--seed-repo` still takes a PAT in argv (the repo's own rule says secrets are `--config`-only), and Task 11 stands — the canvas still does not render in a browser workspace, so Maude Desktop remains required.

_2026-08-20:_ **partial** | post-1.0 backlog, E-block (E0/E2/E3) | Desktop-E2E harness only — no product code. Fixture restore for three scenarios moved into a shared crash-safe guard (a killed run used to leave the versioned fixture dirty and the next run baselined the dirt); the default wdio spec list no longer claims the seven scenarios that have their own configs; collab-stress headroom now scales with its stress window. E0's filed diagnosis was wrong and is corrected in place. **E1 and E-1 left open on purpose** — the plan forbids raising their timeouts without an idle-machine measurement, which this box cannot give. Backlog stays open (archived only when empty). Incidental find: `site/lib/whats-new.json` had been stale since the v1.0.0 release, outside what the site-content gate compares.

_2026-08-20:_ **done** | v1.0.0 released (npm blocked) | Phase A of the gate set + the release. The typecheck surface was completed (52 files nothing was checking) and yielded six silent bugs; the hub gained the delete budget it never had; npm publish sits behind the desktop boot gates. Merge to main went red four times, every cause mine and none reproducible on macOS/Node 24. Self-host drill found the first documented operator command broken on a fresh box; the fleet drill proved un-rehearsable as specified and rolled for real on the tag. npm remains on 0.60.7 pending a token rotation.

_2026-08-19:_ **done** | manual smoke verification of the sync arc | Nine-section checklist driven end to end against a live cell↔desktop pair. **Eight defects fixed, every one silent and none caught by 5163 passing tests**: a move carried the old document's retirement stamp in its `.ydoc.bin` cache (so a moved canvas reached nobody — reported as "folders don't sync"); a cell's two writers over one checkout made the studio child adopt hub-written files and double the body; a canvas the cell never adopted had its cloud edits reverted by the next projection; a spaced filename arrived twice and collided itself out of sync; the first change after a cell boot never healed; `maude.files` counted as a canvas; admin Revoke called a route the hub does not serve. Two security seats on the fix set found two HIGHs of my own making (the listing indexed by flattened slug across namespaces; the self-stamp repair reachable for a pulled canvas, hub choosing both sides) — both fixed and pinned before the commit. Test suite: `bootServer` waits 10 s under bun's 5 s default, so a loaded machine failed a different boot test every run. Commit `35a5b115`; findings in `~/maude-smoke/FINDINGS.md`.

_2026-08-18:_ **done** | feature-sync-burn-down-and-shared-doc (Tasks 1–2, override) | Sync v2 Increment 5 burn-down (engines deleted, hub write-behind is journal-driven for every class, −801 core) + Increment 7 shared-doc default ON. One tracked medium (A7 GUI consent) before Increment 8. Full validate + release checks deferred.
_2026-08-18:_ **done** | feature-sync-journal-file-plane | Sync v2 Increments 0–4.5 + 6: the whole design folder syncs, deletions propagate with cumulative breakers, and a project has exactly one owner.

**Not verified:** the live cloud↔desktop pass on a real fleet cell. The fleet only picks this up on a release tag, so the Increment-2 poke drill on `alligators.cloud.maude.sh` is a post-release check — and version is still 0.60.7, so none of Increments 0–3 has shipped as a release yet.

_2026-08-14:_ **feature-sync-file-plane closed** (commit `18f7c290`) — the predecessor this arc supersedes. Sync's unit was a canvas, so a fresh link delivered every canvas and lost 103 other files (the design system). Replaced the growing per-file-kind taxonomy with two planes + one positive classifier; acceptance was **216/216 byte-for-byte** on the real alligators tree, behind `linkedHub.syncFiles` default OFF.

_2026-08-12:_ **Figma import Phase 6 CLOSED — the feature is done and the plan is archived.** `.fig`/`.jam` now decodes
end to end offline: a hand-written ZIP reader, a Kiwi schema+data decoder ported from the documented
reference, tree rebuild from `parentIndex`, absolute bbox composed down the parent chain, then
**REST-shaped raw into the EXISTING `normalizeDocument(raw, {origin:'fig'})`** so the caps and the
prototype-pollution guard are the same code as the REST door rather than a parallel copy. Dependency-free
on `node:zlib` alone — `zstdDecompressSync` + `inflateRawSync` both measured present on Bun 1.3.3, so
`fzstd` is dropped, and `jszip` was REJECTED despite already being an `apps/studio` dep because it is
absent from the root and would have made `--fig` desktop-only on npm exactly the way `oxc-parser` does
for `--explode`. Verified on both committed fixtures: every documented node id, the hostile layer name
verbatim, all six connectors incl. the TEXT and GROUP degrade cases, the wide sticky 416×240, the nested
section composed to absolute (60,140) 560×700. **Measurement corrected the DDR twice while building it:**
Figma's exporter SETS the ZIP data-descriptor flag (D3's draft refused it from documentation and would
have rejected every real file), and `attrValue` is NOT sufficient to bound a report label — it maps
rejected characters to SPACES, so bounded prose still reads as prose; `reportToken` moved into
`sanitize.ts` because two lanes now need the one-token-no-spaces guarantee. **The float trap is the
lesson worth keeping:** Kiwi rotates a float's exponent into the low byte, and getting the framing right
with the math wrong kept the stream byte-exact — every string, enum and guid correct, accounting exact —
while zeroing every coordinate in the file. A structurally perfect, geometrically empty document with no
error signal. **Tier 1 therefore cannot be the gate**, and the tests assert concrete fixture dimensions.
The fuzz corpus earned its place immediately by catching a `FigZipError` escaping the door's own error
type. **The mandated independent security round did NOT run** — both subagents went idle without
reporting; the self-review that replaced it found 2 HIGH + 3 MEDIUM (all schema-hostility: the attacker
supplies the SCHEMA, not just the data) and all five are implemented and regression-tested, but a
self-review is blind to exactly the seam DDR-219 was caught in.
**Tier 2 landed the same day and paid for itself immediately** — it found two defects the 34 unit tests
could not, because each side looked valid alone: the decoder was emitting Figma's INTERNAL node
vocabulary (GROUP is internally a FRAME with `resizeToFit`; ROUNDED_RECTANGLE is REST's RECTANGLE;
SYMBOL is COMPONENT — 11 nodes, and the translators are written against the REST names), and **every
FigJam sticky and shape had silently lost its text** (20 nodes — a sticky is an internal template
instance whose text lives in `nodeGenerationData.overrides[].textData.characters`). Trees now agree
exactly, geometry to 0.000px asserted as `== 0`.
**Tier 3 and the verb followed.** Tier 3 runs both doors through the REAL translators and found three
more gaps in the same class: typography dropped (weight lives in the font STYLE NAME, a default alignment
is omitted where REST states it), every FigJam colour on the translator default (a sticky's `fillPaints`
are a template override — same root cause as its missing text, now one override lookup instead of two
special cases), and `lineHeight` genuinely unreproducible offline, which is now REPORTED as `lossyFields`
and asserted to be the only such field. `maude design import-figma --fig <path>` imports a local export
with no network, token or seat — verified by real runs (board 31 strokes with sticky text; design 6
artboards). The archive's prelude picks the route, so no mode can be got wrong; provenance is
content-addressed because a local file has no REST key.
**A real 12 MB export then refuted two things at once.** It is container version **101** — LOWER than the
fixtures' 106 despite a later export date — with a DIFFERENT embedded schema, and it decodes perfectly:
the framing is byte-identical and the file brings its own schema, which is D1's thesis working exactly as
argued. So D3's version allowlist was refusing valid files while predicting nothing, and it is removed
(reported instead, with a drift flag); STRUCTURE still gates, and it is much stronger than an integer.
The same file closed A6's image gap and exposed a defect **shared with the REST door**: `to-artboard`
only queued VECTOR clusters, so an IMAGE fill emitted an EMPTY positioned div — an 11.7 MB photo vanished
while the import reported success. Both doors fixed; the offline door now resolves fills from
`images/<imageRef>` through the same content-addressed promote, verified with zero network calls. A
server-side vector render still cannot exist offline and gets its own `asset-unavailable-offline`.
**A user's own export then closed the last gap and refuted one more claim.** I had shipped
`asset-unavailable-offline` saying a vector cluster needs Figma to render — false: every VECTOR carries
`fillGeometry[].commandsBlob` into `blobs[]`, and both blobs decoded to the byte under one small command
set (0 close, 1 M, 2 L, 3 Q, 4 C + float32 pairs). `figma/fig-vector.ts` now rebuilds icons offline into
real SVG (still through the DDR-167 lane). Verified by screenshot: photo AND icon render from a local
file with zero network calls. **Three corrections in one phase, all the same shape** — a rule derived
from documentation (ZIP data descriptors), from an assumption (the version allowlist), and from OUR data
structure (`PendingExport` has no `imageRef`, therefore the FORMAT has no geometry) rather than from the
bytes.
Debt carried forward: the independent security round never ran (four idle notifications, no report);
A.10 not RUN on a `--fig` canvas; the 3 planned scenarios never written; `desktop-e2e` +
`check-bundle-completeness --smoke` not run. Tier 4 now has two dated corpora (`106` n=2, `101` n=1).

_2026-08-12:_ **Figma import Phase 7 CLOSED (plan NOT archived — Phase 6 is untouched).** `--explode
<artboard-id>` turns one already-imported artboard into editable JSX by asking Figma's own Dev Mode
generator for that frame's resolved DOM, over the LOCAL loopback MCP with `apps/studio` as the client —
no model in the path, enforced by grep tests rather than intent. Verified live end-to-end (33/33 assets,
response sha identical across 30 calls) and by **rendered comparison against Figma's own export**, not by
count agreement — the acceptance rule this feature earned after reporting success three times while
losing content. **A real migration into `studyfi-design` was the actual test, and it found more than the
feature did:** `/design:smoke` had `-maxdepth 1` so it had NEVER gated an import (it reported 52/52 green
having not looked at the six imported pages); `--pages` lost every remaining page to one fault; an
imported FigJam board landed dark inside screen chrome because a board is not a screen; rendered frames
fell back to a SERIF because an SVG behind `<img src>` cannot see the DS webfonts; and one canary timeout
discarded all 272 assets while the verb still exited 0. **Two measurements corrected two of my own wrong
diagnoses** — the asset loss was not my font change (reproduced without it) and not chunk size (n=4 fails
too); it was 26 leaked `agent-browser` daemons making a trivial canary take 12.5 s against a 20 s budget
(3.4 s after killing them). **DDR-219 D11 is refuted by measurement:** A.10 was predicted "near-silent" on
this route from a flex:absolute RATIO, but it counts FINDINGS — 42 blockers per exploded artboard. Not
worked around: the only mechanical fix is the blanket justification comment D11 itself bans.
Post-implementation security fan-out (DDR-219 mandates it) returned **6 blockers, all of them a control a
comment claimed and the code lacked** — including `kind` as an unbounded JSX injection through a
`meta.kindHint` field with zero writers in the repo, and D8's "validate it parses" simply not existing.
All six fixed in `f75b71cb`. **Lesson:** every gap the reviewers found was in the seam AROUND the
carefully-specified part — the parser contract held completely, and the bugs were in what the write path
did with values that never came from the response.
Open: A.10 exemption for `route: "codegen"` needs a DDR amendment; `oxc-parser` is not in root deps so
`--explode` is desktop-only on the npm channel; the local Dev Mode DAILY cap is still unmeasured (rate is
not the constraint — 68/min measured vs the remote's 10/min); the 3 planned scenarios were never written;
`desktop-e2e` and `check-bundle-completeness --smoke` not run.

_2026-08-12:_ **"Canvas render performance" CLOSED + archived.** Reported symptom: large canvases
(128-artboard onboarding flow, sticky-dense FigJam board) unusable to pan/zoom. Built the meter before
the fix — `maude design perf`, two engine lanes (Chromium via agent-browser, **WebKit via safaridriver**,
because the desktop shell is WKWebView and Chromium does not reproduce its behaviour), plus `--fit-all`,
`--studio` and a deterministic fixture generator, with an append-only history so before/after is a
property of the tool. **The meter moved the target twice.** First it stopped a blind refactor: the
predicted React fanout was real (5504 DCArtboard renders per gesture) but frame time was never bound by
it — 60fps warm on both engines. Then `--studio` found where the jank actually lives: the same canvas,
engine and viewport measures 20 ms standalone and **42 ms inside the studio embedding**. That multiplier
is reproduced but STILL UNEXPLAINED — the `active-artboard` postMessage and the studio chrome were both
measured and ruled out. The fix shipped anyway because the waste is provable: viewport publishing is now
settle-only (5504 → 896 renders; 2 per board standalone = gesture-start + settle), with live reads kept
exactly where they are load-bearing — including the five `1/zoom` counter-scale chrome sites BREAKER
predicted would flicker. **Two planned tasks were deliberately NOT done, both on evidence:** viewport
stays in `WorldContextValue` (settle-only already satisfies the invariant without rewriting every
consumer) and the per-artboard `will-change` promotion is untouched (A/B below the noise floor, while the
earlier RCA shows it load-bearing for filter-heavy canvases). Security fan-out earned its keep on the new
verb: an auditor **proved RCE** through `node -e` argument interpolation before the fix, plus --history
containment, --canvas traversal/encoding, count caps, shape-validation of a result that comes from the
untrusted canvas origin, and safaridriver identity + child cleanup. **Lessons:** a performance task's
plan should carry "how do we know we're measuring the right thing" as a task, not an assumption — this
harness needed four self-corrections (isolated browser session, warm-up + median after two identical runs
came out 60% apart, refusing to record a gesture that never moved the world, zoom direction at fit-all); and in this
Syncthing multi-session tree, a concurrent session renamed the repro canvas mid-measurement and pushed
load average past 300, which alone flipped two tests red and one run 60% slower.
Open: the studio 2× multiplier, and WKWebView desktop still unmeasured (Safari is the closest proxy).

_2026-08-12:_ **"Fast, correct video export" CLOSED + archived — most of the plan was already shipped by
prior sessions before this close-out started (`3becccd9`/`354ec5c4`/`6b1b7a63`: the Remotion bump, the
muted-mp4 fix, the seek-bridge fix, the GPU spike), discovered by reading source + `git log` rather than
trusting the plan's own stale checkboxes. Closed the genuine remainder: a `--frame-format jpeg|png`
opt-in knob (default png, no default flip — the ΔE2000 measurement gate hasn't run), a source-shape test
pinning the encode-lib's no-clear-between-frames behavior, an RCA addendum disambiguating the reported
export failure from DDR-157's unrelated overflow class, and **DDR-220** recording the resolved
architecture (audio-in-one-pass via `renderMediaOnWeb`, pre-flight refusal as the correctness backstop,
parallel capture deliberately deferred behind BREAKER's frame-purity-contract dissent — falsification
spike passed, the safety contract around it isn't built). The `/flow:done` validate fan-out, run against
a diff with zero UI files, still earned its keep: the a11y-auditor's read of the *already-shipped*
`DegradedNote` UI (only in scope because the whats-new entry pointed at it) caught a live bug —
`--u-status-warning` was never a defined token, so the "degraded" export pill silently fell back to the
same color as "running," undercutting its own "must never read as success" intent — fixed same-session
rather than filed as a follow-up. Recording the close into the graph then surfaced a second, unrelated
bug: `maude kg record-log` ENOENTs in every repo-namespaced kgai store (this one included) because the
temp-staging filename never sanitized the `/` that `scopedSlug()` puts in every slug — fixed with a
regression test that reproduces the exact failure. **The lesson worth keeping:** in this Syncthing,
multi-session repo, a plan's own task list can go stale from work landing outside `/flow:execute`'s
checkpoint loop — check `git log -- <files the plan names>` before trusting it.

_2026-08-10:_ **"The cloud copy matches your desktop" CLOSED + archived — the remaining five faults
of the desktop↔cloud sync RCA (fixes 4–8, after 1–3's self-renewing link).** The drift had one root:
the hub memoised a FLAT fallback path on the first `onDocumentStored`, before the peer's
`syncMeta.path` stamp arrived — so a body that landed first was pinned to the wrong location forever
(a stub that 404'd its dynamic import in the cloud, and a duplicate next to the real file). The path
is now stamped BEFORE the handshake, and `pathIndex` carries provenance `{rel, fromPath}`: a
fallback-derived entry is relocated in place when a validated path arrives, a real-file entry a peer
owns is never moved (a peer may not move another peer's work). A one-shot boot migration quarantines
the pre-fix duplicates to `_trash/`, never deleting. Images reached the cloud for the first time
(DDR-217): the sync lanes were text-only, so `assets/` never left the desktop and the cell's
`/assets/` route served bytes it never had — the desktop now PUSHES them over the existing
authenticated route (the git-remote-pull option the plan recommended was REFUSED by the codebase's
own facts: the cell strips its tenant remote post-seed and its history is separate by design). The UI
stopped lying: the linked project reads **Connected** with a Disconnect, and a linked+credentialed
repo's GitPanel withdraws to a read-only "Cloud is saving" posture so there is ONE save mechanism, not
two (DDR-218 — presentation only, `.git` untouched). **The adversarial review earned its place:** both
defender and attacker independently found the SAME blocker — the new asset PUT contained its
destination LEXICALLY while the sibling relocation writer in the same PR already resolved symlinks, so
a peer-committed `assets/x -> ../../ui` symlink + one PUT would overwrite a served canvas the studio
child compiles (data→code, DDR-193 §2). Fixed by giving both hub writers ONE symlink guard
(`path-contain.mjs`), plus a per-process write budget, authenticated-PUT rate limit, and an atomic
detach. Shipped in `f0b5e8ca`. The recurring `bun test` clobber of `dist/client.bundle.js` bit twice
this cycle — the committed bundle was silently reverted to the stale copy after each rebuild, caught
only by `shasum` against the intended sha; the release rebuild must be the LAST step and verified by
hash, never by a clean `git status`.

_2026-08-08:_ **"Sync carries the path, so a project arrives whole" CLOSED + archived — a canvas now
lands in the folder its author made, in both directions.** The document name is a flattened slug and
`/`→`-` is not reversible, so BOTH receivers wrote the body flat at the design root — which is inside
no `canvasGroups` entry, so the tree never listed it and it never synced onward. Each side's comment
deferred to the other ("a flat file is trivially moved" / "a desktop peer will move it on its next
sync"); neither was a mechanism, and on the live fleet three canvases sat on the hub with full bodies
and appeared nowhere in the cloud while the desktop truthfully logged `76/76 synced`. **The path now
travels in-band** (`syncMeta.path` — an existing, already-synced, never-materialised lane) through
ONE validator both runtimes import (DDR-215), and is believed only because it slugs back to its own
document. The adversarial review then found the part the design had ruled out by construction: **rule
7 governs a path's IDENTITY, never its DESTINATION** — a legitimate path could still land on a local
file the project excluded with `syncable: false`, on the served `tokensCssRel`, or through a
committed symlink; and the FALLBACK reached the same places with nothing on the wire at all. Eight
guards added, each verified by falsification. `defaultBodyPath` deleted rather than deprecated —
leaving it would leave its false promise.

_2026-08-07:_ **"A release reaches the fleet, and says which one it is" CLOSED + archived — tagging
now deploys the cloud and proves it did.** v0.57.0 put a cell image tagged `v0.57.0` into production
whose hub layer was built from v0.56.0, with every workflow green: `hub-image.yml` runs on tags
only, so `maude-hub:latest` is rebuilt only at release time, and `cells-deploy` derived from it on
any non-tag ref — so a branch push rebuilt the CELL from a hub that could not contain the change.
The existence-based wait could not catch it (`:latest` always exists). **Only a release tag now
builds or pushes a cell image**; a branch push runs the data-plane tests and `wrangler deploy` and
nothing else — which removes the race, the stale derivation, and the same-tag-different-bytes
generator at once. **And green now means a live cell answered on the released version**: the
workflow polls a real tenant until `/health` reports the released version AND the client hash this
run sealed into the image it pushed. The two are complementary, not redundant — the hash catches
"same tag, different bytes", and only the version catches "the layer underneath is a release
behind", because the stale image was internally self-consistent (DDR in the graph,
`d_2152229760ff703da58e2d03`). The version is now readable in the Studio status bar, the hub admin
header, `/health` and `/_config`; `apps/studio` + `apps/hub` join the release line (14 manifests),
which is why `/health` had been reporting `0.0.0`. Two things the plan did not predict: a
pre-existing gate (`config-projection.test.ts`) caught that `/_config` is an explicit client-side
projection, so the version chip would have shipped permanently unrendered; and the tag run's hub
wait was 10 min against a hub build measured at ~16 min, so it would have kept failing after the
`:latest` fix — now 30 min, with the measurement in the comment. **The real proof is the next
release**: if `cells-deploy` goes green while production is stale, the gate is wrong.

_2026-08-07:_ **ACP turn notifications CLOSED + archived — the native shell now tells you when a
chat finishes or needs input, even in a project you're not looking at.** The webview's own
Notification path only ever knew about the project on screen and couldn't see a detached chat at
all; the notify decision moved into the Tauri native shell instead (new `notify.rs` + a background
poller over the sidecar pool + `tauri-plugin-notification`), fed by a new read-only per-chat
activity endpoint (`/_api/acp/activity`, kept off both canvas-origin allowlists). No in-app
settings toggle — macOS's own per-app Notification Center control covers it, deliberately, so
there's no in-app switch a user could flip that also silently loses the awaiting-input signal.
**Two rounds of security fan-out, and the second one mattered as much as the first**: the original
pass found the poller re-trusts an untrusted `_server.json` with no spawn-time authentication and
could otherwise fabricate an unbounded notification flood — mitigated with a per-project cap. The
`/flow:done` closing re-review then found the MITIGATION itself had two real gaps (the cap could be
reset via a normal, attacker-steerable pool-eviction cycle; the command surface had no cap at all)
— both fixed this session, not just noted. The deeper fix (spawn-time authentication instead of
re-trusting the file, which also affects a pre-existing pattern in `sidecar.rs`) is a named
follow-up, not done here. Also incidentally fixed: a real `ReferenceError` bug in
`/_api/acp/running` (a route handler referencing an undeclared `req`), caught by `cargo
check`/`bun run typecheck`, not by inspection. Task 1's WKWebView measurement was never actually
performed — no GUI in the execution environment — and is recorded as an honest open item rather
than assumed away.

_2026-08-06:_ **The deferred live cross-surface run finally happened — and it was not a formality.**
The last unchecked acceptance criterion on desktop ↔ cloud live pairing needed
"a real cell + a desktop app + a browser", so a local stand-in was built with
the fleet's actual topology: split shell/canvas origins through
`apps/cells/dev-edge.mjs`, real capability cookies, two accounts, a linked
desktop peer. The feature was code-complete and test-green, and **wrong in
production in two ways**, both living in the seam between the cell's two
processes where no unit test could see them. (1) Paired edits were never
committed: the hub staged only files it had written itself, and under pairing
the studio's projector always wins the race — so "exactly one committer" was
passing *vacuously*, with zero. (2) The annotations sidecar was written as a
canvas sibling while everything that reads it looks under the flat slug, so the
hub committed a junk file — the one that would reach the tenant's GitHub mirror
— and left the real one untracked. Both fixed, both with regression tests
verified to fail without the fix. A third, smaller finding: the cloud browser's
Changes panel offered Save/Publish and an "unsaved" count for work already
committed, and told a browser user to save from their terminal; it now withdraws
to History wherever the server owns history (desktop untouched — a hub-linked
peer does NOT self-commit, so hiding it there would remove the only local way to
save; verified rather than assumed). **The lesson worth keeping:** a manual
acceptance criterion parked because it "needs real infrastructure" is the only
test that runs the real topology — standing up the faithful stand-in cost one
session and converted three production bugs into three commits.

_2026-08-06:_ **Desktop ↔ cloud live pairing (C2) CLOSED + archived — a cell pairs with itself.**
The studio child now opens a loopback, commit-disabled, shared-doc provider to
its own cell hub (DDR-213, extends DDR-064 + DDR-209), so a browser tab and the
desktop app editing the same cloud project converge on one Y.Doc — presence and
edits cross both ways, the hub stays the sole committer. All six tasks landed:
the workspace-mode guard's one narrow exception, the loopback token minted
per-boot into the child's env, the sole-committer assertion (tested against a
real git repo), the DDR-064 pre-cutover checklist closed (slug collisions,
pinned-room ceiling, consent notice, comments doc→disk cap), the cold-start
seed verified for the cell topology, and — the one real bug the work turned
up — a doc-originated edit produced no `fs:any` inside a container at all
(not a double-fire, the opposite), fixed by having the projector announce its
own writes. Security-reviewed (defender + attacker): a wildcard, non-expiring
pairing token was flagged as a chain-promotable-to-High finding, evaluated
against the already-accepted `HUB_SECRET` precedent in this exact hub and
recorded as a residual with two explicit, reasoned-out follow-ups rather than
patched under review pressure. **Gated**: `CELL_LIVE_PAIRING` is a per-tenant
allowlist, `alligators` only — the live cross-surface run (real cell, real
desktop, real browser, one committer in `git log`) is the one acceptance
criterion left unchecked, and nothing widens past the pilot until it's green.

_2026-08-04:_ **Cloud Phase 26 CLOSED — the operator view, and figures instead of an estimate.**
`/operator` is live behind an allowlist that is empty by default; it is mostly a
route over `fleetBoard`/`costAlarms`, which had been tested and callerless since
Phase 9. Product analytics go to Analytics Engine and never to D1, on a CLOSED
vocabulary — every property an enum, an account id shape-validated — so the
privacy revision that shipped in the same change is a property of the code
rather than a promise. Each project now counts its own designs and build
sandbox, so the €3/cell model finally has real numbers. **The review earned its
keep**: four of the seven stated security invariants turned out weaker than
their comments (none was a broken control), and the counts had been put on the
hub's UNAUTHENTICATED `/health` — a correct disclosure argument about the
studio's endpoint, carried onto one with a different audience. All fixed and now
tested. Customers get one thing directly: the activity page says *why* we
looked, including the platform-wide reads that were previously the only ones
they could not see.

_2026-08-04:_ **Cloud Phase 27 CLOSED + archived — one studio, three shells.**
Every track landed. Today closed the shell-origin `/_ws` CSWSH gate, D5's second
half (a `/_health` `rootId` the supervisor compares — a child serving another
tree is killed rather than served), **D2, the preserved dissent** (the two
processes were not racing on a lock, they were running different git engines —
DDR-211), then D1 (a `--cloud` build that ELIMINATES the agent, the shell probes
and the BYOK keys from the binary), D3, B3, C3 and E4 (DDR-212). Two acceptance
lines deliberately NOT ticked and named where they are: desktop E2E has no CI
job at all, and a desktop attached to a real cloud project as a viewer is
owner-gated. **Three bugs, three different instruments** — a browser found a
banner that never rendered, the linter found a cross-scope assignment that would
have crashed every cell boot with storage configured, and writing the parity
spec found C1 was never actually landed (a viewer could not open the Inspector,
so an acceptance line had been false in production).

_2026-08-01:_ **Cloud Phase 24 CLOSED — tracks A + B, plus D2/D5 and D4's code half.**
The funnel now states the bill of materials (a computer, the free app, **your own
Claude subscription**) before the card; the legal pack exists and is linked; per-tenant
config left the Worker globals (customer #2's first boot could have cloned the pilot's
repo); the reconciler's actions became real effects with export-before-teardown; delete
purges the bytes. **C1 walked a real second tenant through the paid wizard** — two cells
concurrent, the new one seeded from nothing, then deleted through the product. **D3 drove
the dunning ladder through a real Stripe test clock.**

Eight defects found by using it rather than testing it: every outbound email had been
403-ing for two days · the deploy workflow had been red since 07-30, hiding a real failure
· an `exported` flap made the promised deletion unreachable · the deletion warning would
have sent ~48× · an empty project could never be deleted · the funnel quoted €19 and
charged €22.99 · `CF_PROVISION_TOKEN` could not attach a domain, so self-service was dead
· a CLI relink erased the role the studio had just written.

Left, all owner gates: **C3/C4** (a real non-technical human with a stopwatch), the Windows
certificate, counsel review, the accountant on *identifikovaná osoba*, and **D1/D3-live**.
Phase 25 C1 (read-only enforcement at the cell) also landed; its client half is open.

_2026-07-30 (side branch):_ **`feature-enhanced-video-editing` closed + PR'd** — TSX-first
manual timeline editor (split/trim/speed/crop/grade/audio/transitions as clip verbs over
`/_api/clip-edit`; three-band iMovie layout + stacked pure-JSX projection; movable layers;
AI placeholder clips; frame-anchored comment tool). 4 dogfood rounds; security review
resolved 3 blockers. Phase 6 deferred. Plan archived; kgai holds the close.

_2026-07-29 (later):_ **Phases 12 + 13 DONE + deployed live.** Signup/login/session
+ Google (unconfigured → honest 503) + project-grant mint at
`https://maude-cloud.maude1agh.workers.dev`, 126 cloud tests. Two live-only
bugs found by deploying: Workers refuse PBKDF2 >100k iterations (fixed by
chaining 6×100k — same work, no weakening), and the v2 migration never ran
against live D1 (fixed: cron applies migrations before sweeping).

_Earlier:_ **Phase 12 deployed live** — `maude-cloud` Worker at
`https://maude-cloud.maude1agh.workers.dev` (/health ok, d1 ok, cron hourly);
Workers/cron/D1 turned out Free-tier-capable, only Containers/Queues/R2 wait
for Phase 11. Deploy path: bun bundle + Cloudflare API multipart PUT.

_2026-07-29:_ four-seat debate (`debate-cloud-selfservice-gap-arc`) resolved the
self-service gaps: **DDR-197** narrows DDR-192 §4 (read-only browser share view
permitted; containment DDR-193 §2 reaffirmed verbatim; browser EDITING deferred
behind the Phase-21 gated spike with both dissents preserved). New plans:
phases 11 (owner vendor unblock) → 12 worker → 13 one-account identity →
14 provision-first checkout → 15 cell+alligators → 16 server-owned checkout →
17 desktop attach → 18 share view → 19 mirror effects → 20 self-admin →
21 editing spike (gated).

_Last closed:_ `cloud-phase-10-ga-launch-github-mirror` (2026-07-29, partial). All ten
phases are archived: 1-4 complete, 5-10 CORE COMPLETE / PARTIAL — the buildable half is
done and tested, deployment is blocked. **DDR-196** records why, and the pattern (split
every vendor-facing component into a pure decision layer and a thin effects layer).

_Earlier:_ `cloud-phase-4-selfhost-skill` (2026-07-28, core complete).
Phases 1, 2 and 3 closed the same day. Decisions: DDR-192, DDR-193 (arc
umbrellas), DDR-194 (phase-2), DDR-195 (phase-3); DDR-148 corrected in place.

### Phases 5-10 — what is built vs what is blocked

Everything below is written and tested; what is blocked is DEPLOYING it.

| Phase | Built (tested) | Blocked on |
| --- | --- | --- |
| **5** cell | `infra/cell/` image + entrypoint (containment assert, tenant-id guard, refuse-empty-rehydrate), `cli/lib/cell-plan.mjs` (naming, R2-prefix isolation, teardown order, lifecycle machine), containment CI gate extended to the image | persistence spike, `maude cell up` API layer, alligators pilot — need Workers Paid + R2 |
| **6** invites | `apps/hub/src/invites.mjs` + `/join` mint/peek/redeem/revoke, admin surface, 23 tests incl. 8 end-to-end | `maude://` deep link + desktop UI; the timed cold-start gate needs a real human |
| **7** control plane | `apps/cloud/reconcile.mjs` — the derive-don't-react reconciler, 19 tests incl. 20 chaos cycles | the Worker itself (D1/Queues/dashboard) — D1 is reachable, Queues needs Workers Paid |
| **8** billing | `apps/cloud/pricing.{json,mjs}` + real Stripe sandbox catalog, 11 tests | live-mode prices, Checkout + portal + test clocks against a control plane |
| **9-10** | — | need live cells |

**Phase 8 groundwork landed early** because Stripe is the one vendor that IS
usable: the `maude.sh sandbox` account is authenticated and test mode needs no
paid plan. The Phase-0 §3 catalog exists as real sandbox objects and
`apps/cloud/pricing.{json,mjs}` resolves them (live ids deliberately null — live
mode throws rather than falling back). Numbers are a proposal pending sign-off.

Carried into Phase 5 (all need a live host or a paid account):
- 60 MB asset through R2 specifically (phase 3)
- `desktop-e2e workspace-sign-in` — needs the Tauri UI (phase 3)
- `workspace-up`'s remaining verification steps — need a Docker host (phase 4)

**Phases 5-10 are BLOCKED on vendor prerequisites an agent cannot satisfy** —
re-probed live 2026-07-28: Cloudflare account is Free (0 subscriptions),
Containers refuses ("requires the Workers Paid plan"), R2 refuses ("enable R2
through the Dashboard"), 0 zones on the account. Needs a paid plan, R2
enablement, and `cloud.maude.sh` on Cloudflare DNS. See
`.ai/plans/cloud-phase-0b-manual-prep.md`. Phase 4 is local and executable.

Carried forward into later phases:
- Hub doc namespacing is **opt-in** until Phase 3 makes it default-on in workspace mode.
- The collab origin gate refuses-and-resyncs a violating canvas peer rather than
  disconnecting it; revisit before hardening if a false positive is ever observed.

_Older:_ `feature-kgai-ecosystem-integration` (2026-07-28). Two follow-ups need the owner:
`maude kg query "MATCH (f:Element {kind:'follow-up'}) RETURN f.name, f.props"`.

## Where it went

| Want | Ask the graph |
| --- | --- |
| history / "what happened with X" | `maude kg search "<feature>"` · milestone nodes are linked `PROGRESS_ON` → `plan:` |
| a decision's reasoning | `maude kg context --about "<element>"` (full body is stored) |
| my recent movements | `maude kg query "MATCH (d:Decision) WHERE d.author='$(git config user.name)' RETURN d.title, d.recorded_at ORDER BY d.recorded_at DESC LIMIT 10"` |
| where a paused session left off | `/flow:resume` — reconstructs from the last `session:` paused event |
| conflicts | `maude kg conflicts` |

The pre-migration file (930 KB, 88 progress blocks + 127 history rows) is preserved verbatim at
`.ai/archive/state/STATE-pre-kgai-2026-07-28.md`; all of it is in the graph as dated `milestone:` nodes.

## Loaded skills (skill-loader)

- 2026-08-12 (feature-canvas-render-performance): React/browser-render perf + Tauri WKWebView + motion — covered by built-ins (`web-perf`, `flow:motion-rules`, core React expertise); no terminal-skills fetch needed.

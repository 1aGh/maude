# Follow-ups for the v2 PR (collect here, fold into .ai/scenarios/maude-v2/PR.md)

- **Cloud canvas-only Can edit, write path** (Michal 2026-10-27, after v2.0): a single-canvas
  write capability that carries the grant's role, narrowed at the canvas door. Today the browser
  shows Viewing with "edit it in the desktop app". kg v2-p8-cloud-canvas-only-viewing-shell-matches-frame,
  v2-p8-secfix-f-cloud-canvas-only-frame-ro.
- **The role-denial toast on tool keys** in that case still offers "Ask to edit"; it should know
  appOnly (use-canvas-mode-lane / use-tool-panels).
- **One origin per canvas** (C4 named gap): canvas-only sessions now mount only the active frame
  (v2-p8-secfix-f-canvas-only-single-frame); full-role sibling frames still share the origin.
- **Collab handshake epoch**: the server should refuse peers from an earlier server instance
  (v2-p8-lead-captures-park-not-epoch). Deferred for now: it changes sync behaviour.
- **Legacy api.ts write path** still announces after the write lands (r9 left it; the gap is one
  file read).
- **describe-budget p95** goes over on the mini under load (machine-only).
- **Final security pair lows (V2-8.9-final-defender/attacker, 0 blockers):** D1/L-F1 the TS e2e switches
  (`isE2eEnv` in acp/probe.ts, readiness, login-state) ship in the release `maude-server` while the Rust ones are
  debug-only; fail-closed, but gate them on a release constant. D2 `routes/edit.ts:249` early "this write is the
  person's" note is not withdrawn when the write throws (30 s window). D3 `sync/local-kernel.ts` keeps up to 17
  source copies in memory for an untouched canvas; prune on write. D4 e2e `isOrphanBrowser` could reap a person's
  own agent-browser whose daemon died mid-run; check the run's start marker.
- screenshot.sh closes its agent-browser session on exit by design (r10: a capture must never outlive itself as a collab
  peer); the stale comment is corrected and the back-to-back EOF race is fixed (p8-ab-park-race). The agent's own
  browsing session on the same name still ends with each capture; a separate capture session name would keep it.
- **Command-gate evidence is self-asserted JSON** a tree writer can forge (old residual, attacker note).
- **V2-8.17 review lows (V2-8.9-final-v2-8.17.md):** L2 recovery writes follow a symlink at `_history/<slug>` (a
  hub/peer can't plant one, a committed repo symlink can); L3 each remote update during an open overlap check runs
  a merge of up to ~100 ms, up to 512 per check, on the server event loop (only when acks are delayed/withheld).
- **surface-frame-probe.test (sync-e2e harness) times out on the mini's headless Chromium** (timer throttling in the
  env -i slot); green locally. V2-8.1 is recorded on this Mac for that reason.
- (2026-10-28 final recheck, V2-8.9-final-recheck.md) N1 low: a canvas attached while offline keeps the overlap watch's
  default `online = true`, so its first offline episode is `exposed` and the #121 notice is lost (fails safe, old CRDT
  merge). Pass the provider's status after `projections.set` or start `online` unknown; add an attach-offline test.
- N2 info: `scripts/remote-lane.sh --slot` is not validated before `rm -rf "$R/home/slot$got"` (operator input).
- N3 info: nothing checks `dist/styles.css` freshness since dist-fresh leaves CSS out (d1437a15d).
- (V2-8.3 tabs red 2026-10-28, 7f5ef056c) The vendored macOS WebDriver (tauri-plugin-wdio-webdriver 1.2.0, `macos.rs:217`)
  reports a stale element as WebKit's opaque "A JavaScript exception occurred", so neither its own stale mapping nor
  webdriverio refetches. Port upstream 1.4.0 `describe_ns_error` (reads `WKJavaScriptExceptionMessage`), regenerate
  `webviews.patch` + VENDORED.md. Same held-handle long wait still in `git-branch-switcher.e2e.ts:41`,
  `file-tree-move.e2e.ts:77`, `offline-conflict.e2e.ts:102`, `team-project.e2e.ts:202,543`.
- Desktop e2e lane on the Mac mini (GUI-session launcher, isolation, probe), so a record doesn't need the MacBook.
- Hub `test/files-ctl-keepalive.test.mjs` "with the keep-alive, an idle control socket stays up" failed once inside V2-8.1 (2026-10-28 08:17, load ~19 falling); 3/3 green alone. Timing-sensitive (≈4 s idle window) under load.

## Phase 8 test round B — left for after the merge (lead, 2026-10-28)

Not built, either because no CONTRACT line names them or because the weekly budget was kept for the final gates:
- 01 cf-ai-drafting: the faint "Mobile — next" ghost and the "Desktop done · Mobile next" step line appear only in a board
  note. No CONTRACT line or slice names them. Not built; spec them if wanted.
- Hold tag "AI is drawing the footer" (S2.18 prose) vs. the fixed "AI is working" (decision v2-S5.11-neutral-ring-tags):
  kept neutral. If wanted, `holdsFor` in `client/v2/ai/runs-model.js` can build verb + element name (never the prompt).
- an-ai-write chips "Make these changes / Put them in a section" (board) vs. the generic follow-ups: no CONTRACT line.
- Tests not driven (follow-up): 13 ds-make-filling (desktop lane, ds-review part 4); 12 ia-more-ways, ia-edges;
  07 ve-footage (local hub presence stub);
  10 an-vote and co-mention-notify (in-app half) on a cell with minted sessions; the multiplayer `surface` catalogue
  through the Docker container.
- 05 es-all-trashed: a single teammate cannot empty a canvas ("A canvas keeps at least one artboard"); the state needs
  two people racing (hub stopped, A trashes a–c, B trashes d, B lands first). Drive it as a race lane or soak it.
- 12 ia-missing: "Waiting for alice's device" — the hub names the holder by e-mail local part and reports no Mac/PC kind
  yet ("Mac" in the board). Plan: run it inside team-cell's rate-limited window (alice's one write spent on a note).
- (p8-t-ai-runs, merged e54a7d545) ai-runs R1, ai-tereza, cf-busy, ed-edge-undo and ai-other-tab are driven and green ×2.
  The board draws these, but no CONTRACT line names them, so they were not built: ai-other-tab's toast "… 1 chat still
  running there" with Show, and the tab tooltip "AI is translating …"; cf-busy's "you stay in Edit" mode word. The
  would-undo canvas tag and the rings are inside the canvas iframe, so they are checked in shots only.
- (p8-t-missing-a) 12 ia-edges: A/F/G/H have no surface. The import-lines.js lines "Preparing" and "Saved a copy
  from the link" exist, but nothing calls them. The Figma "can't open" and Google-key sheets have no CONTRACT line,
  and the product's Figma words differ from the board's. E ("Added by Tereza" on another Mac) can't show, because
  S8-asset-sidecars §5.4 keeps `asset-origins.json` on one Mac. Syncing it is a contract change. ia-missing says
  "Waiting for Alice's device", not "Jonas's Mac", because the hub reports no device kind (`kind: null`).
  13 ds-make-filling: the "AI is setting the type" tag, the progress line and Stop need a live AI run that holds the
  Type section, so they are not driven.
- 05 es-all-trashed (board 19): two offline trashes of one canvas are held as a conflict (the second save is
  rejected), and the UI refuses to remove the last artboard. So the empty-canvas card is reachable only through an
  external edit (an AI or a hand edit of the file). The e2e drives it that way.
- (p8-t-missing-a, merged 478cc3b31) **es-all-trashed Restore on a synced copy: rc soak.** Two product bugs are
  fixed fail-first: the card's endless read/render loop (unstable default `fetchImpl`) and Restore refusing a canvas
  with no artboard left (`emptyCanvasPlace`). On a cell-linked copy the click answered ok in every run, but the file
  stayed empty in 2 of 3 runs. The suspected cause, unconfirmed: the restore is held against the hand edit that
  emptied the file, before the cell has taken that edit. The e2e now stops at the card and its button. The
  click-through goes on the soak list. Also: in the race case the cell sometimes leaves the two Macs apart (bob 3,
  alice 1, no conflict shown, still apart after 240 s). The spec pins only "never zero artboards". The silent
  divergence needs its own look.
- (p8-undo-collab-refuse, merged 6e87df463) Michal's b2 is built for the local runtime. ⌘Z on an annotation text a
  collaborator changed meanwhile is refused with a 409 `undo-conflict`, using the existing "Can't undo … someone else
  changed it since" notice, and their text stays (R7 is a real test again). Still open:
  - **Hub-linked projects (desktop ↔ hub, desktop ↔ cell, browser on a cell), traced by a scout 2026-10-29.**
    - **A peer edit that lands during my session survives.** In accepted mode, `server.ts:204` skips the room, so
      the peer's change is its own hub action and is already in my step's before (`kernel.mjs:351`).
    - **A peer edit that lands after my step: ⌘Z keeps their text when the edits don't overlap and silently drops it
      when they overlap.** `mergeLane('annotations')` always returns ok (`lanes.mjs:196`). `mergeText` lets "ours"
      win (`ops.ts:117`). The kernel never refuses.
    - **Fixed (p8-hub-undo-collision, merged b82b82f6c, Michal 2026-10-29).** The hub-linked runtime's
      `textUndoConflict` refuses with 409 only when reverting would collide. Non-overlapping merges go through.
      Accepted content comes from the hub history before/after hashes + blobs; the current text is the lane head.
      Studio-only, 1.x hubs unchanged, fail-open. Browser-on-cell is covered once the cell image rolls on a stable
      tag. Still open: multi-target undo (history / this chat) keeps the kernel's rule; the kernel-side refusal for
      old desktops.
    - **Legacy (non-accepted) mode, traced by a scout 2026-10-29 (read, not run).** This mode is still live for a
      desktop on a project with a committed `linkedHub` and for a browser on an existing cloud project, until the
      owner switches (`cells/wrangler.toml:152`). ⌘Z stays on the canvas stack.
      - **Text-session commit (the usual sticky/label edit).** The inverse is a non-strict `set text=before, expect=my
        final` (`annotations-layer.tsx:1601-1612`), and the server merges it 3-way (`mergeSource`). The peer's text
        survives when the edits don't overlap and is **silently lost when they overlap**. This holds in both
        timings, so it is the same gap as accepted mode (ii).
      - **Any other commit touching a text slot** (paste, AI/programmatic). The inverse is strict (`ops.ts:154,338`).
        A mismatch is skipped as `stale`, so the peer's text is kept. But it is **silent**: only a console.warn
        (`annotations-layer.tsx:1508`), and `use-undo-stack` has no stale notice.
      - **Not fixed by decision (Michal 2026-10-29). Mitigation: the update offer.** Update project switches a
        legacy project to accepted revisions (p8-update-to-accepted, kg
        `maude/v2-michal-update-project-switches-legacy-to-accepted`). A browser on a cell switches through the
        cloud dashboard.
      - **Possible fix, if ever needed.** (1) Make the session inverse refuse on collision, ~20-40 lines. (2) Surface `rejected/stale`
        to the undo stack and the existing notice, ~40-80 lines. Unverified: `sync/source-merge.ts` returning
        `ok:false` on overlap, and whether legacy hub ops go through the studio's `api.ts` or the hub's own merge
        mirror.
  - Merge text on undo (option 1).
  - The same refusal on the legacy canvas stack (`annotations-layer.tsx` `commitStrokes`).
  - Group draft writes into the commit step on the op log. Today each draft write is its own ⌘Z step.
  - Edits with no live room (`api.applyAnnotationOps`) record no contest.
  - The ledger is lost on restart, which is the same lifetime the ⌘Z stack has.
- (p8-browser-e2e-format, merged d1602ee99; closed for local projects by p8-undo-collab-refuse above) Undo drops a
  collaborator's concurrent text edit. I type into a sticky while a peer prefixes it ("Peer: …"). The commit keeps
  both texts, but ⌘Z restores the field's whole earlier value, and the peer's prefix is lost. `ops.ts` registers no
  `setTextMerge` in the canvas iframe, so undo's inverse takes the unmerged path. Fixing it needs a design call: undo
  either merges text the way the commit does, or refuses with "a collaborator changed this". The test is `todo` in
  `annotations-ui.e2e.mjs` R7 and still reported. Also: Group/Ungroup in `annotations-parity` click through
  `dispatchEvent`, because the top row's element bar can sit under the Preview bar island. That may be a layout
  issue (not ruled on).
- A remote peer's presence relayed through a hub is not role-stamped by the room (it arrives as the hub sent it).
- cloud-attach 2b shot: after "Moved to the cloud — your canvases are going up now." the sheet also shows a red
  "Sharing is not available right now. Try again in a minute." line the board does not draw — most likely the cloud
  stub has no access API. Check against a real cell on the rc soak.
- Real GitHub lifecycle (V2-8.16, iagh66/maude-git-smoke): green ×2 signed out. The signed-in PR path (Add to main →
  a real pull request, DDR-162) was not run — it needs a GitHub sign-in in the app and creates PRs, beyond the
  lifecycle-push consent. Ask Michal before running it.
- AI-driven canvas trash (`maude design trash move`, V2-8.16): the delete row is recorded like the UI's, as
  `canvas.delete` by the person, not under the AI run. Attribution needs a `runForCreate`-style claim from
  `X-Maude-Chat` on `DELETE /_api/canvas` plus a claim API for deletes.
- V2-8.9 round B A1 known gap: a person's own canvas save during the few seconds an auto-tier verb (no permission
  card) is actually running can still land in that AI run and its Undo. Closing it needs each writer verb to claim
  its own writes before writing (~40 verbs).

## From p8-format-gate-3 (merged 0c781ec4f)

- No real-hub leg covers a pre-1.9.0 hub's `hub-too-old` refusal (the 1.9.1 image is the compat hub and offers Update project). The refusal is unit-pinned in `migrate-v2-refusals.test.ts`. Adding a v1.8.1 hub image + one Docker-gate leg would close it.
- `apps/desktop/e2e/scenarios/offline-conflict.e2e.ts:86/94` still signals `hubPid` directly; route it through `hubProcess()` like team-project before that spec ever gets a container hub target (pid 0 → `kill(0)` stops the caller's process group).

## From p8-journey-fixes-2 (V2-8.16 S1/S7, merged)

- **V2-8.16 S7: interpreter writes are attributed by call window; A1 stays open but narrower.** Every AI Bash call that is
  not provably a read (`bashMayWrite`, `cli/lib/bash-guard.mjs`) now gets the same claim-only per-call window a
  `maude design` write verb has. That applies to the ACP stage (`shellOpensWindow`) and to the design hook's post-bash
  binding, so a `python3 - <<EOF … open(p,'w')` cut lands as an AI version with one-step Undo. The builder chose this
  approach (Michal left it to the builder): kg `maude/v2-p8-journey-s7-interpreter-write-attribution`. Still open:
  1. **V2-8.9 A1.** A person saves an existing canvas from an outside editor while such a call runs (or within 1 s
     after it). That save joins the AI run and its Undo. Closing this needs hash-claimed writes only: either the
     agent reports what it wrote, or each process's writes are traced.
  2. **Interpreter-made canvases.** A NEW canvas created by an interpreter call is not staged (S12.16 rule) and lands
     as "outside".
  3. **Reader list.** A reader that is not on the `READERS` list opens a harmless window. Grow the list only with
     commands that cannot write.
  4. **Terminal-lane runs** still take every unclaimed write for the whole turn (the v1 fallback). That is wider than
     ACP.
  5. **Synced projects.** `maude design history diff` is not available there, and history rows are labelled
     "Claude Code" (the prompt stays on this Mac on purpose). The agent picks "the version before the change" by
     position only.
- S1: the design hook's SessionStart now names `maude design history restore <canvas> <ref>` when the studio is up
  (kg `maude/v2-p8-journey-s1-session-start-restore-line`).

## From p8-update-to-accepted (merged 75df7c36f)
- **When the hub can't switch yet** (store-not-durable, browser-not-paired), a format-1 Update still goes ahead and
  says so in a note. A format-2 Update with nothing else to do is refused. The lead confirmed this: a blocked switch
  must not keep a project in view-only.
- **The owner's probe of a format-2 legacy project runs the hub's dry run**, which opens every document. A lighter
  probe would help.
- **`/_config.saveMode` reads `legacy` at first boot**, before the sync has heard the mode. The desktop's dry run
  corrects the offer, but the cloud pointer has no probe.
- **The cloud tab links to the dashboard root.** The client does not know the project id needed for
  `/projects/<id>/saving`.
- **E2E coverage.** The end-to-end run covered a project already at format 2 that still saved the old way, on a
  loopback hub. The format-1 + legacy order is unit-tested only. The browser click-through was not driven.


## From p8-app-port-range (merged b4c5bf13c)
- A project server keeps its port across a crash respawn by walking the 46399 ladder again. The port is not
  stored, so a project that rests and then wakes, or comes back after a relaunch, can land on another port. Its
  per-port localStorage then starts empty. `ProjectEntry.port` (`app_state.rs:69`) exists but nothing sets it.
  Storing the bound port there and passing `--port` on wake and relaunch would keep it. Michal to decide.

## From the V2-8.9 final delta pair (2026-10-29), not fixed before the freeze
- **F3 / D3: AI attribution goes by time, not by what the call names.** S7 opens a claim-only window for every Bash
  call that may write, so a person's outside save during a long `pnpm test` folds into the AI run and its Undo.
  This is the round B A1 class, now wider. The fix is to bind files by a pre/post hash diff, or by the paths the
  command names.
- **D7: every Update dry run asks the hub's save-mode preview**, which imports every document. Cache it per epoch,
  or skip it unless the call applies the update or comes from the same origin.
- **From p8-secfix-hook / p8-secfix-studio (merged f1515ed97, 80bf33494).**
  - Defence in depth for D1: keep each run base's sha256 in hook state. A python write to a computed path, which
    bash-guard cannot see, then cannot plant a base.
  - `_runs/<s>/shots.jsonl` (the screenshot gate) can still be planted.
  - Because Bash writes are bound by time (F3), a person's save during a long call gets the `.bash` marker. Stop then
    blocks once on that file's genuinely old findings.
  - A script run from a file (`python3 w.py` that forks) is not read for detaching.
  - Hub reads already in flight after the ⌘Z deadline run to their own 20 s transport timeout. An abort signal on
    `link.blob` / `link.laneHead` would end them sooner.
- **After p8-secfix-hook-2 (merged b55561072), still open:**
  - R2: keep the run base and snap hashes outside the design root, so an interpreter write after a `cd` can't plant a
    base.
  - R3: the ⌘Z collision check has a deadline, but the hub reads under it can't be aborted and their size isn't
    capped while they stream in. It needs an abort signal on the read and a byte cap at the transport.
  - R4: add the element label to the id-finding key.

## Docs gaps found at the freeze (lead, 2026-10-29), held back so the command gates stay fresh
Any commit outside `.ai/` makes V2-8.1/8.2/8.3/8.18 stale. Fold these into the next product commit, or into the rc.
- `docs/MIGRATING-V1-TO-V2.md` (+ site `moving-from-1.mdx`): no mention of the save-mode line from p8-update-to-accepted
  (*This project still saves the old way.* → **Update project**, the combined dialog paragraph, the toasts
  `toastBoth`/`toastSwitched`/`toastImporting`, and the cloud tab pointing at the dashboard). The toast quoted on
  line 37 is only the unlinked case. Source of truth: `SAVE_COPY` in `client/v2/shell/format-update.js`.
- `site/content/docs/cli.mdx:102`: "falls back to a random free port if taken". In fact the server walks
  4399–4408 and then stops with a message (`plugins/design/commands/browse.md:81` has it right). The app's own
  range 46399–46408 is not a user-facing knob and does not need a docs line.
- Neither the plugin README nor the site describes the post-edit gate's "only findings the edit introduced" rule
  (p8-gate-introduced). Nothing there is wrong; one sentence in `plugins/design/README.md` § files are the API would
  help agents.

## From the V2-8.16 live journeys at the freeze (2026-10-29), 19/22, no product FAIL
- Allow the read-only help forms in the auto tier (`maude --help`, `maude design --help`, `maude design <verb> --help`).
  Today only `Bash(maude design help:*)` matches. In S11 terminal, two `--help` denials made the agent decide all `maude`
  commands needed approval, and it never ran the allowed verbs. S6 terminal opened with the same denials.
- Make the journey text grader whitespace-tolerant (`>\s*All saved\s*<`). S2 acp wrote the text on its own line.
- Evidence: `.ai/plans/notes/v2-evidence/V2-8.16-journeys/2026-10-29-freeze/VERDICT.md`.
- Mac mini runner (`scripts/remote-lane.sh`): it was out ~14:40–15:20 on 2026-10-29. macOS privacy (TCC) blocked git
  from `/Volumes/D` during a Software Update, and its Playwright cache was empty (chromium-1228 reinstalled). If it
  happens again, run locally through `scripts/v2-test-lane.sh` (Michal).
- `scripts/dev/local-cell.mjs` writes the local cell's project (`local-cell-smoke`) without `formatVersion`, so a v2
  studio opens it view-only (format 1). The V2-8.4 rig needs it at 2. At the freeze, the slot-only patch is in
  `V2-8.4-tip-v2fmt/report.md`. Fix: wrap the config in `v2Config(...)` (`scripts/dev/v2-config.mjs`). Then rerun the
  desktop lanes whose fixtures use it (`e2e/fixtures/local-hub.mjs`, `share-roles-cell.mjs`, invite-landing), because they
  passed V2-8.3 on the format-1 project and may assert view-only behaviour without saying so.

## From the 2026-10-30 batch (orphans, CI Linux, the control sweep, locks)
- **Resolved (Michal 2026-10-30): Hide on a locked layer stays refused.** The current contract stays as it is
  (S2-edit-ops §3 rule 6: only the lock op touches a locked object). The eye of a shared-locked layer stays greyed with
  "This object is locked; unlock it first." No `locked: 'allow'` on `object.hide` (kg
  `v2-michal-hide-on-locked-stays-refused`).
- **Resolved (Michal 2026-10-30): import from a link in a cloud cell = A, refuse.** The answer stays "works on the Mac".
  Leave it as built (kg `v2-michal-link-import-cell-refuse`, `v2-p8-import-link-shell-only-no-decompress`).
- **Legacy artboard/clip routes ignore an artboard lock.** These are `resize-artboard`, `set-artboard-*`,
  `delete-artboard`, the `/_api/*-sequence` routes and `toggle-hide`. The dispatcher refuses artboard-wide ops on a
  locked artboard, but the UI offers no artboard lock, so nobody reaches this today. If an artboard lock ever ships, wire
  these routes to `lockedRefusal` the same way the object routes do (kg `v2-p8-lock-reasons-direct-writes-one-lookup`).
- **One-off CI hang in `test/draw-proof-harness.test.ts`** on f64071a18. The slug-refusal test sat ~43 min until the job
  timed out. It never reproduced: green on the next three runs and locally in 0.7 s. The suspect is `spawnSync` waiting on
  a pipe that a grandchild holds open, which neither bun's test timeout nor `spawnSync`'s timeout can break. If it
  recurs, give `runProof` `stdio: ['ignore','pipe','pipe']` plus a `killSignal`, or switch it to async `Bun.spawn` with a
  kill.
- **Timeline "Add title" 422** (`/_api/insert-sequence`) came from a dead-control shard run on the pre-reset rig. It
  never reproduced on a reset fixture, and the crawler now records the response body, so a recurrence names its own
  cause.
- **Why CI kept finding "new" failures all batch:** each Quality step stops the job, so every later step went unrun
  (containment pin, scripts/test Node 24, the surface catalogue). Before a freeze, run the whole `quality.yml` step list
  locally. The checklist is in `lead/checkpoint-2026-10-30.md` "Update ~09:50".

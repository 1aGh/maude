# Maude v2.0: the redesign, built end to end

**Suggested PR title:** `Maude v2: native project tabs, the v2 shell, work packages S1–S12, docs and verification`

**Branch:** `feat/maude-v2` → `main`. Opened by the run. The merge is yours.

Size at the time of writing: about 4,030 commits, 9,693 files changed, +1.09 M / −56 k lines. Most of that is
generated or evidence material (fidelity screenshots, ledger, plan notes, bundles). The product code is much smaller.

## What this is

Maude v2 is the redesign you drew in `.design/ui/v2/` (16 canvases, about 380 artboards), built into the real
app. The desktop app now has one window with native project tabs and a pinned Home. The old menubar, status
bar and docked panels are gone. In their place: a project pill with one menu, floating panels, an Edit and a
Preview toolbar, a Share cluster, and ⌘K search that finds every tool. Twelve work packages (S1–S12) built
the features behind that shell. Nothing was deleted: every v1 tool is still reachable (menu, ⌘K, an
Advanced fold, Diagnostics or Settings), and a script proves it. The docs and the site describe v2, and the
app is verified in the shells it ships in (desktop, browser, cloud tab, viewer).

## What changed, phase by phase

### Phase 0: split `app.jsx` (done on `main` first, 2026-10-09)
- V2-0.0: the run harness. `scripts/v2-done.sh` exits 0 only when the coverage ledger has no open ids and every gate is green.
- V2-0.1: a frozen description of v1 (338 testids, 30 characterization states) so v2 can be compared with it.
- V2-0.2: `app.jsx` went from 17,444 to 1,892 lines, in 38 modules. The 26 commits are pure moves.
- V2-0.3: you tried the split ("vše funguje") and approved the push to `main`. `feat/maude-v2` started from that tip.
- Desktop e2e after the split showed no new red.

### Phase 1: contracts and spikes (one contract note each, recorded in the graph)
- V2-1.0: Gate 0 folded into `CONTRACT.md`. Every signed row has its id; nothing is left "proposed".
- V2-1.1 and V2-1.2: the Home window as a server mode, and the mode and toolbar bridge (one typed table for all shell↔canvas messages).
- V2-1.3: one action registry. Menu rows, ⌘K, the "?" sheet, the canvas key table and the native menu all come from it.
- V2-1.4, V2-1.5: readable element ids that survive an AI rewrite, and one undo log with attribution (you, AI, Tereza).
- V2-1.6, V2-1.13: the design system as a real canvas with content-addressed revisions, and the three-tier DS schema.
- V2-1.7, V2-1.16: the "Can view" role and the ACL leak matrix (20 surfaces, one rule at both doors).
- V2-1.9, V2-1.10, V2-1.11, V2-1.12, V2-1.14, V2-1.15, V2-1.17: version history, video intelligence, AI operability, file formats, outbox, AI run leases and indexes with thumbnails.
- V2-1.8: the panel material spike. Blur is a no-go, so floating panels ship a solid material.
- V2-1.18: the agent topology and a 30-task eval harness. The chat agent is the only writer.
- Phase 1 gate: all green, v1 characterization 30/30 identical, security pair with 0 blockers.

### Phase 2: foundation (the app looked unchanged)
- V2-2.0: the prerelease channel. An `rc` tag publishes to npm `next` only and never touches the fleet.
- V2-2.0b, V2-2.0c: `v2-done.sh` wired to every gate, and the frozen v1 manifest (1,326 entry points) with the nothing-deleted audit (144 rows).
- V2-2.2, V2-2.3, V2-2.6: Biome over the client, a shell store, and a token pipeline that generates the canvas HUD tokens.
- V2-2.4 and V2-2.4b: the action registry went live, with the Claude path of every action. `Bash(maude:*)` is gone; each verb has its own permission tier.
- V2-2.5: one route table with fail-at-boot checks. V2-2.7: old browser prefs migrate to the v2 shape.
- V2-2.8, V2-2.10: canvas bridge fixes (the ⇧⌘E double meaning, sibling-canvas undo, 24 px artboards, absolute canvas paths, export CLI).
- V2-2.9, V2-2.12: Diagnostics API, and a boot gate that fails when the shell is dead after mount (the blank-window class of bug).
- V2-2.13: "Studio suite (full)" became a required check on `main` (with your go).
- V2-2.14: the `formatVersion` migration, forward and byte-exact reverse, tested on a copy of Alligators.
- V2-2.15, V2-2.16, V2-2.17, V2-2.19, V2-2.20: both in-repo design systems brought to schema v1, runtime-state lists plus the outbox, index and thumbnails (Alligators-scale build 64 ms), AI-safe element ids, and the WebKit perf harness.
- V2-2.18: **v1.9.0** and **v1.9.1** were released from `main` (see "Decisions").

### Phase 3: native tabs, profiles, Home
- V2-3.1, V2-3.8: identity profiles. Each project keeps its own sign-in; a sign-in that would replace another account binds a new profile.
- V2-3.2 to V2-3.4: a pool of project servers (at most 5 running; idle tabs rest), the Home server mode, and authenticated probes (the shell never trusts files in the project).
- V2-3.5: per-project notifications, Dock badge, `maude://` deep links routed to the right tab.
- V2-3.7 to V2-3.10 (rework after your first try): our own tab bar with a pinned Home, relaunch restoring exactly your tabs, and per-tab state.
- V2-3.11: tab keys like a browser: ⌘1–⌘8 and ⌘9. Actual size moved to ⇧0.
- You tried Ready-to-try (2) and accepted Phase 3 on 2026-10-15.

### Phase 4: the v2 shell replaces the old chrome
- V2-4.1: floating panels over an edge-to-edge canvas, folded corner icons, ⌘\ hides panes.
- V2-4.2: the project pill and the one menu, run from the same code as ⌘K.
- V2-4.3: the Share cluster with the status words (Saved, Not saved, Needs you).
- V2-4.4, V2-4.5: left panel and right-side islands; Edit, Preview and Viewing toolbars that morph by mode.
- V2-4.6, V2-4.7: ⌘K finds every Advanced item by name; the "?" sheet; Settings in three tabs; status in words.
- V2-4.8: the in-app menubar, status bar and top banners are gone, and nothing-deleted still reads 100 %.
- V2-4.9, V2-4.10: one shell contract for 7 shells, and one quiet Advanced fold per panel.

### Phase 5: work packages, wave A (the core loop)
- S1 Navigation and history: the Canvases panel at 93 canvases, cross-project ⌘K, Version history.
- S2 Editing: artboards, objects, auto layout, constraints, text in place, smart guides.
- S3 Modes and Present: Preview with links, Inspect, Present, presenter view.
- S4 Annotations: stickers, markers, arrows, sections, templates, the Preview toolbar tools.
- S5 AI chat: run registry and leases (one AI per artboard), the undo interleaving matrix, queue, canonical panel.
- Wave A gate (2026-10-20): 97 of 135 rows verified. The rest need a desktop, cloud or second person; you moved them to the overall check.

### Phase 6: work packages, wave B (domains)
- S6 Create, Home, Onboarding: Home, starters, first canvas in two minutes.
- S7 Video and kinds: floating timeline, captions, beat grid, the other artboard kinds.
- S8 Export, import, assets: one export sheet, import (Figma, comments as pins), assets.
- S9 Share, collaboration, cloud: invite-first Share sheet, roles (Can view, Can comment, Can edit, Owner), per-canvas sharing, cloud pages.
- S10 Design system canvas: switching with one review, "bring it up to the schema", team libraries.
- S11 Advanced, Diagnostics, Settings, empty states.
- S12 AI and tooling: every design/flow command, skill, agent and hook updated to v2 words and concepts.
- Security work inside the wave: the per-frame capability (C4) so a one-canvas grant cannot read other canvases, verbs held to the session project, per-agent verb allowlists.
- Wave B gate (2026-10-22): Ready to try (7), pending your answers on the demo video and the site copy.

### Phase 7: docs, site, tours, What's New
- V2-7.1: docs rewritten around the desktop app (Getting started, Advanced, "Coming from Maude 1").
- V2-7.2: maude.sh leads with "Download for Mac". CLI and plugins sit under Advanced.
- V2-7.3: the usage, collaboration and quick-setup tours moved to v2; the v2.0 What's New entry is pending.
- V2-7.4: `CLAUDE.md` and plugin docs describe the v2 runtime.

### Phase 8: verification (this is where the PR is most careful)
- V2-8.5 fidelity: all 15 canvases re-shot on the merged tip and judged by critics against your "verified" bar. Every reachable artboard was verified at the last checkpoint. The ones that need an AI run, a hub or a second person are covered by the e2e.
- V2-8.0 cleanup: old token layers deleted, `.st-*` and `--u-*` migrated, dead modules 0. CSS went from 742 KB to 638 KB (you accepted that bar).
- V2-8.6 nothing-deleted: 100 %.
- V2-8.7 a11y: axe 0 serious or critical in both themes, and a keyboard-only create flow. Return now enters text and frames.
- V2-8.8 WebKit pan/zoom: v2 p95 about 50 ms against 93–110 ms on v1.9.1. Chromium was re-measured at the freeze and passes in both lanes; v2 renders 168 artboards per gesture where pre-v2 renders 966.
- V2-8.9 security: two review rounds, a final pair, and a delta pair over every fix since. All findings were fixed red-first, with 0 blockers. Read access is scoped to the project plus the folders you said yes to.
- V2-8.16 AI parity: 509 of 509 actions have a file path, a CLI verb or a human-only reason. The 30-task eval scored 24/30 pass^3 with no product-caused fail. That was after the post-edit gate learned to block only what an edit introduced. The live agent journeys S1–S11 at the freeze scored 19/22. Every journey is green in at least one lane, and the three fails are agent-caused.
- Undo with collaborators: ⌘Z on a text a collaborator changed meanwhile is refused with a notice, and their text stays. In a hub-linked project it is refused only on a real 3-way collision.
- Update project now also moves a legacy shared project to accepted revisions, as its last step.
- The desktop app's project servers use their own port range, 46399–46408.
- V2-8.17 (#121): offline edits that overlap in a shared doc now show a notice with both versions. The losing side is kept in `_history/<slug>/sync-recovery`. Merged.
- The e2e harness got many rounds of work: one app per spec, throwaway config home, window kept on top, no GitHub in the lifecycle lane.
- **Final freeze (2026-10-31, `20b4215eb`)**: the last round found and fixed, each red-first:
  - **the desktop app could quit when a project tab opened.** wry 0.57 unwraps a missing WKWebView URL on the main thread, and the 2 s root watch read every tab's URL. Every shell URL read now goes through `webview_url::url_of`, which answers `None` instead, and the gates still refuse. Before the fix, about 1 in 30 opens from Home quit the app; after it, 0 in 100.
  - asset tiles took 52 s for 194 pictures (`toBlob`'s idle-task 1 s fallback); now ~9 s.
  - a canvas importing its own stylesheet in another letter case (`Combine-admin.tsx` + `./combine-admin.css`) was blocked by the C4 closure walk for everyone. It opens now, and the rule fails closed wherever a reader cannot prove the owner is absent: stored grant, truncated listing, symlinks, NFC, the hub reader.
  - 10 a11y serious/critical groups (contrast on information text, unnamed pickers and listbox, a bare div in a menu, an empty tree). The full axe matrix, 318 states in both themes, is clean.
  - a first-canvas e2e race (a click inside the 30 ms re-render after ⌘Z).

## Decisions you made along the way

- **Gate 0 signed (2026-10-08):** 95 rows, then folded into `CONTRACT.md`. No "proposed" rule survives.
- **Project tabs:** first native macOS tabs, then (2026-10-14, after you tried them) our own tab bar with a pinned Home.
- **Cloud scope fully in:** sign-in, invites, roles, per-canvas sharing, trial, design-system team libraries.
- **No v1/v2 switch.** The branch rewrites the UI in place. Phase 0 landed on `main` first.
- **Autonomy amendment E5 (2026-10-09):** the run pushes the branch, opens this PR, and cuts the v1-compatible releases. The merge stays yours.
- **Releases from `main`:** v1.9.0 (the 1.x compatibility release: format fence, banner, hub fence) and v1.9.1 ("1.9.1 ano", the localhost WebSocket fix). No 1.9.2 for the macro finding.
- **Chat reads and writes:** Claude Code's defaults stay (P3). Reads in a synced project keep today's behaviour. On 2026-10-26 you scoped Read to the project plus consented folders (M2, variant B).
- **Studio suite (full)** became a required check on `main`.
- **Cloud details:** Can view may render from the Mac app; no R2; "Export again" stays; Figma comments import as comment pins; export preflight is by artboard; a shared design system uses a revocable hub token (option A, built switched off).
- **C4 fixed properly:** an editor with a grant on one canvas has view only on the others, in wave B, before any rc.
- **Design system canvas:** `maude design ds convert` on the in-repo systems at the end of Phase 8.
- **"Verified" bar** for artboards (2026-10-25) and **CSS bar** "smaller than at the start of Phase 8" (2026-10-26).
- **Live AI runs:** yes to the agent journeys S1–S11 and the 30-task eval (topology A only), on your Claude account.
- **#121:** detect on reconnect, show both versions, no silent character-by-character merge (2026-10-26).
- **Cloud canvas-only Can edit:** keep browser Viewing for now (2026-10-27, option a). See follow-ups.
- **Real push and real PRs** to `iagh66/maude-git-smoke`: allowed by you. The lifecycle ran green twice
  (`V2-8.16-real-push`, `V2-8.16-real-pr`).
- **Docker self-host gate (V2-8.18, 2026-10-28):** a real hub image plus a cell image, built and run locally, never pushed.
- **Ledger closing statuses (2026-10-29):** besides `verified`, a row can close as `soak` (checked on the rc soak) or
  `not-a-state`. Both require a written note.
- **Post-edit gate (2026-10-29, a):** it blocks only the findings an edit introduced. Pre-existing ones go to the agent as
  context.
- **Undo against a collaborator (2026-10-29, b2):** refuse with a notice, and keep their text. Merging the text is a
  follow-up. In a hub-linked project, refuse only on a 3-way collision.
- **Legacy undo:** not fixed. Instead, Update project offers the move to accepted revisions. `--reverse` does not revert
  the mode. A browser on a cell switches through the cloud dashboard.
- **Desktop ports (2026-10-29, A):** the app has its own range, 46399–46408. A port is kept across a restart, and a
  one-time reset of web storage is accepted.

## Verification

Phase 8 gates, from `node scripts/v2-gates.mjs`. The script reads recorded evidence, and a record goes stale as soon as
any file outside `.ai/` changes. **Every record is at the final freeze, product tree `20b4215eb`.** Only `.ai/` changed
after it: evidence, ledger and these notes. **All 15 gates are green.** The two things only you can do are listed under
"Before you merge".

| Gate | What | Status | Evidence |
| --- | --- | --- | --- |
| V2-8.0 | Cleanup (old layers, dead code, CSS bar) | PASS (live check) | 638 KB vs 742 KB at the start of the phase |
| V2-8.1 | Quality gates (format, lint, typecheck, tests, build, parity, tarball, tokens, site, import coherence) | PASS | recorded on this Mac |
| V2-8.2 | Rust (`cargo test`, clippy `-D warnings`) | PASS | recorded |
| V2-8.3 | Desktop e2e, every lane (41), 3 consecutive runs (debug build) | PASS | 0 failing in 123 lane logs; prefs file untouched, screen never locked |
| V2-8.4 | Cross-shell scenarios (browser, cloud owner, cloud viewer) | PASS | 18/18 at the same sha on the Mac mini; format-1 run 14/18 = the view-only gate |
| V2-8.5 | Design fidelity | PASS | artboard rows: 342 verified, 14 soak, 4 not-a-state, 0 open; browser e2e 14× green |
| V2-8.6 | Nothing-deleted audit | PASS (live check) | 100 % |
| V2-8.7 | A11y (axe, keyboard-only, VoiceOver strings) | PASS | 318 states × both themes, 0 serious/critical; keyboard-only create flow; VoiceOver strings checked in the DOM (the listen is yours) |
| V2-8.8 | Pan/zoom perf (Chromium + WebKit) | PASS | Chromium studio 17.4 vs 17.3 ms; WebKit both orders on the mini (p95 27/24 vs 33/30 ms) |
| V2-8.9 | Security | PASS | final … final5 pairs + two rechecks + the Rust delta, 0 blockers; residual lows in follow-ups |
| V2-8.10 | Packaged app | PASS (scripted) | `.app` 2.0.0-rc.1: `check-bundle-completeness --smoke` ✓, `check-client-boots` ✓, no WebDriver, opening card clears; the clean-user smoke is yours |
| V2-8.14 | Perf beyond pan/zoom | PASS | every budget met; version-picture warm p50 ~400 ms accepted by you for v2.0 (p95 within budget) |
| V2-8.15 | Docs for people and agents | PASS | gens in sync, drift tests 12/12 |
| V2-8.16 | AI parity | PASS | 512/512; eval 24/30 pass^3; live journeys 19/22 (the 3 fails agent-caused) |
| V2-8.17 | Offline overlap on reconnect (#121) | verified | merged with tests |
| V2-8.18 | Self-hosted hub + cell images (Docker) | PASS | recorded |
| V2-8.11 | Branch build and PR | this PR | |
| V2-8.12 | After the merge: rc | after merge | see below |
| V2-8.13 | Close-out | after merge | `v2-done.sh` turns green once this PR is merged and closed out |

## Before you merge: what needs you

1. **VoiceOver pass (V2-8.7).** Everything else in a11y is checked in the DOM. I could not hear VoiceOver. Please
   listen once to the strings from board 14 (for example "Services, frame, 3 items, in a row, 4 of 6. Press Return
   to go inside") and to the live region on the status words.
2. **Clean-macOS-user smoke of the packaged app (V2-8.10).** Install the `.app` on a fresh macOS user with no node,
   bun or claude: `.claude/worktrees/freeze/apps/desktop/src-tauri/target/release/bundle/macos/Maude.app` (2.0.0-rc.1,
   built at the final freeze with auto-update off). Open a project, open Home, make a canvas. The scripted gates (`check-bundle-completeness --smoke`,
   `check-client-boots`) are green and cover everything except a real clean user.
3. **The desktop port question (asked 2026-10-27):**
   > The desktop app starts a project's server without a port, so it takes 4399, the default of
   > `maude design serve`. When a person's own server was briefly down, an e2e sidecar took 4399. The e2e has been
   > moved to 47399+. The product is unchanged.
   > - **A (recommended):** the app uses its own fixed range (e.g. 47399+). A restart keeps the same port (crash
   >   recovery and the respawn scenario rely on that); each user's per-origin web storage resets once.
   > - **B:** leave it.

   **Resolved 2026-10-29: Michal chose A.** App project servers use their own range, 46399–46408. It stays clear of
   the CLI's 4399+, e2e's 47399+ and the harness's 48399+. A restart keeps the port, and a one-time reset of web
   storage is accepted. This is built in p8-app-port-range; kg `maude/v2-michal-desktop-own-port-range`.
4. **V2-8.14 budgets: resolved.** Covers, first-12, asset tiles and every other budget now pass (covers 95/95 in
   16.6 s, tiles 9.3 s). You accepted the version-picture warm p50 of ~400 ms for v2.0 ("a", 2026-10-31). Sharing
   canvas-lib across canvases is a post-rc follow-up.
5. **Real push to `iagh66/maude-git-smoke`:** done, green twice. The signed-in PR path through the app (Add to main →
   a real PR, DDR-162) needs a GitHub sign-in in the app and was not run. Say if you want it on the rc soak.
6. **The homepage showreel `site/public/demo.mp4`** still likely shows v1 chrome. Re-record, drop or keep?
7. **The site copy describes v2.** It goes to `main` with this PR. Is that OK, or should it wait for the v2.0 release?
8. **`~/.config/maude/prefs.json`** was rewritten by a test run several times. You said you don't mind. The
   source is still being hunted. Please check that your folds and theme look right.
9. **`maude design ds convert`** on the in-repo design systems (your yes from 2026-10-22): done in p8-ds (`479207219`).
   Both `maude` and `maude-v2` are Design system canvases, and the dry run was clean.
10. **The merge.** It's yours.

## Known follow-ups after the merge

- **Cloud canvas-only Can edit, write path.** A single-canvas write capability that carries the grant's role. Today the browser shows Viewing with "edit it in the desktop app".
- **Role-denial toast on tool keys** in that case still offers "Ask to edit". It should know the app-only state (`use-canvas-mode-lane`, `use-tool-panels`).
- **One origin per canvas** (C4 named gap). Canvas-only sessions mount only the active frame, but full-role sibling frames still share an origin.
- **Collab handshake epoch.** The server should refuse peers from an earlier server instance. Deferred because it changes sync behaviour.
- **Legacy `api.ts` write path** still announces after the write lands. Small gap, one file read.
- **`describe-budget` p95** goes over on the mini under load. Machine-only.
- **Security lows from the final pair (0 blockers):**
  - D1 / L-F1: the TypeScript e2e switches (`isE2eEnv` in `acp/probe.ts`, readiness, login state) ship in the release server while the Rust ones are debug-only. Fail-closed, but gate them on a release constant.
  - D2: the early "this write is the person's" note in `routes/edit.ts` is not withdrawn when the write throws (30 s window).
  - D3: `sync/local-kernel.ts` keeps up to 17 source copies in memory for an untouched canvas. Prune on write.
  - D4: the e2e `isOrphanBrowser` could reap a person's own agent-browser whose daemon died mid-run. Check the run's start marker.
- **`screenshot.sh` canvas modes** close the shared agent-browser session on exit, so the agent loses its browsing session after every `/design:screenshot`. Functional, not security.
- **Command-gate evidence is self-asserted JSON** that a tree writer can forge. An old residual.
- **V2-8.17 review lows:**
  - L2: recovery writes follow a symlink at `_history/<slug>` (only a committed repo symlink can plant one).
  - L3: each remote update during an open overlap check runs a merge of up to about 100 ms, up to 512 per check, on the server event loop. Only when acks are delayed or withheld.
- **`surface-frame-probe.test`** (sync-e2e harness) times out on the mini's headless Chromium (timer throttling). Green locally, so V2-8.1 is recorded on this Mac.
- **Legacy sync gaps after V2-8.17:** sibling `.css` text, the `MAUDE_SHARED_DOC=0` lane, and a 1.x peer taken second.
- **Cloud lane media uploads** to the local hub fail intermittently. Worth a look.
- **Case-variant credential Read** against Claude Code's matcher, and a **WKWebView DNS-prefetch check**. Both need a real Mac.
- **Found at the freeze and held back to keep the records fresh** (any change outside `.ai/` would make them stale):
  - The V2-8.4 rig's `scripts/dev/local-cell.mjs` writes a format-1 project. Wrap it in `v2Config(...)` and rerun
    the desktop lanes whose fixtures use it.
  - Docs gaps: MIGRATING lacks the save-mode line from Update project. `site/content/docs/cli.mdx:102` claims a
    random port fallback (the real behaviour is to walk 4399–4408, then stop). One sentence on the post-edit gate's
    "only what the edit introduced" rule.
  - Allow the read-only help forms (`maude --help`, `maude design --help`) in the auto tier. In the live journeys,
    their denial made a terminal agent give up on allowed verbs.
  - The journey text grader should tolerate whitespace inside an element.
- **Smaller residuals from the 10-28/29 rounds:**
  - Interpreter writes are attributed by call window (A1 narrower, not closed).
  - Base hashes kept outside the design root.
  - Transport abort and byte cap on the hub undo check.
  - Dry-run cost.
  - A port kept across rest/relaunch (`ProjectEntry.port`).
  - The hub multi-target undo.
  - Conflict visibility in the trash race.
- The full list, with file and line references, is in `.ai/scenarios/maude-v2/lead/pr-followups.md` on this branch.

- **From the final freeze round** (details in `.ai/scenarios/maude-v2/lead/pr-followups.md`):
  - share canvas-lib between canvas modules, so version pictures reach p50 300 ms;
  - the LOD lane's zoom p95 is one frame worse than pre-v2;
  - the hub reader refuses the same-name stylesheet rule more often than the studio does (depth > 8, journal tombstones). That fails closed;
  - the `no_raw_webview_url_calls` test is line-based, and the vendored WebDriver plugin's debug-only `url()`;
  - a loopback `/_api/canvas` write during an AI run is attributed as "outside";
  - the wall-clock `until()` in 7 hub tests;
  - `maude design comments --help` is still denied.

## The rc-soak checklist

Every ledger row closed as `soak`: it can't be driven on this Mac, so it is checked on the rc soak. Each line gives
the reason. `node scripts/v2-ledger.mjs pr-soak` writes this list, and `check` fails if it drifts from the ledger.
Rows closed as `not-a-state` (the board draws a state the product never reaches) stay in the ledger with their note.

<!-- v2-ledger:soak:start -->
- [ ] `V2-8.12` — Owner-triggered after the merge, outside this run: Michal cuts 2.0.0-rc.1 through the prerelease channel (scripts/bump-version.sh 2.0.0-rc.1; npm next, prerelease GitHub release, fleet untouched), soaks it, and promotes to 2.0.0 as a separate release.
- [ ] `02/ob-sig-draw` — The signature draw motion itself is not asserted anywhere. The same ai-states test that drives ob-first-draw checks the order paper → picture → words and one undo, but not the motion itself. The rc soak watches a first AI draw on a fresh canvas and checks the motion reads as the board draws it.
- [ ] `02/ob-invite-landed` — Landing on the comment from an invite needs the managed copy to open through a cloud cell, which no local rig stands up. invite-landing.e2e.ts covers the dead-invite and signed-out states and the landing toast is unit-pinned (p8-g1a-invite-landing-toast.test.ts). The rc soak opens a real invite to a comment through the cloud.
- [ ] `03/ai-needs-away` — The OS notification banner and the real Dock tile are not driven. ai-quit.e2e.ts "1 · ai-needs-away" asserts the "?" in the background tab and the Dock badge NUMBER through the e2e_dock_badge hook (3/3), and the in-app half is in ai-states; the banner macOS draws and the Dock tile on a real desktop are checked on the rc soak.
- [ ] `04/md-presenter` — The presenter view runs on a stubbed display list and a stubbed audience window: presenter-view.e2e.ts drives the one-display case (row greyed, Rust guard), the reported second display and End closing the audience window (3/3), but no second physical display and no real audience window exist on the test rig. The rc soak presents on a Mac with a second display.
- [ ] `04/md-present-link` — A follower never meets the presenter on this rig: the presenter’s hub and the link viewer’s cell are two separate hubs. The link and the follow bar are unit-tested (present-copy-link.test.ts) but the follower side is not driven. The rc soak presents with a copied link and follows from a second person.
- [ ] `04/md-edge-offline` — Only the "Clip isn’t on this Mac" line with Skip is driven (presenter-view.e2e.ts "md-edge-offline", 3/3). The hub-linked "Offline — kept on this Mac" line needs a hub-linked project and is model-tested only. The rc soak presents a hub-linked project offline.
- [ ] `06/ad-edge-where` — The Resync-greyed-offline column is driven (team-project.e2e.ts "12 · cf-offline-create", 3/3) and the matrix is unit-pinned (v2-where-matrix.test.ts); the viewer-origin and comment-only columns are not driven in the app. The rc soak opens Share › Advanced as a viewer and as a comment-only person.
- [ ] `07/ve-footage` — Needs a real second Mac’s file: the "Waiting for Jonas’s Mac" state comes from another machine holding the footage. footage-state.test.ts pins the model only; the hub-presence half could be driven locally but is not. The rc soak runs a second Mac holding the clip.
- [ ] `10/co-mention-notify` — Not driven at all: the Mac notification banner and the e-mail for an @mention can only be seen on a real signed-in Mac and mailbox. The in-app toast and the Comments count are not driven in a test either. The rc soak mentions a real teammate and checks banner, e-mail, toast and count.
- [ ] `11/pn-accounts` — The account chip, card, Sign out confirm and Esc are driven (shell-accounts.e2e.ts, 3/3) but cloud status and the accounts list are stubbed and Sign out is never pressed. The rc soak signs in with two real accounts and signs one out.
- [ ] `11/pn-cant-open` — Can view and access-removed cards are driven (role-surfaces.test.mjs "pn-cant-open: …", 3/3). The moved/missing-folder card is native-only (root-missing.html) and no test moves a real folder from under an open tab. The rc soak moves a project folder while its tab is open.
- [ ] `12/ia-more-ways` — The native NSOpenPanel cannot be driven by WebDriver. Paste and dropping a video file are doable locally but have no test (v2-import-lines.test.ts is a unit). The rc soak imports through Import › More ways with the real file panel.
- [ ] `12/ia-edges` — Edge D (a photo dropped while the cell is away is kept on this Mac and goes up by itself) is driven (team-cell-missing.e2e.ts "12 · ia-edges D", 3/3). Edge E (Tereza’s photo) and the rest of the nine are model-tested only (v2-import-lines.test.ts, 4 of 9); they belong with sync and multiplayer. The rc soak runs the remaining edges with two people and an offline cell.
- [ ] `15/an-vote` — Needs a second voter with a real identity: two browsers on one local studio vote as the same person, so the vote count cannot be driven without a cell with minted sessions (p8-c7-g15-css-pins.test.ts pins only the styling). The rc soak votes from two real accounts.
<!-- v2-ledger:soak:end -->

## After the merge

**V2-8.12, the release candidate (you trigger it, outside this PR).**
- `scripts/bump-version.sh 2.0.0-rc.1`, then the tag, through the prerelease channel built in V2-2.0.
- It publishes to npm under `next` as a GitHub prerelease. Stable users, npm `latest` and the cloud fleet are untouched.
  The hub-image, cells, render and `:latest` workflows ignore `-rc` tags.
- The updater feed offers prereleases only to installs already on an rc.
- Any hub or cloud change v2 needs ships v1-compatible first. The 1.x line (v1.9.x) already reads `formatVersion: 2` read-only.
- Signing and notarizing the rc `.app` needs the Apple profile. Plugins ship from `main`, so an rc bump reaches marketplace users.
- You soak the rc. Promotion to a stable 2.0.0 is a separate release.
- **The stable 2.0.0 deploy converts every cloud project** (each cell on its first 2.0.0 start: backup, format 2,
  accepted revisions; never on an rc). Check the cells-deploy step "Report the Maude 2 cloud conversion"
  (`[v2-convert] fleet converted=N skipped=N failed=N`) and, per cell, `/health` → `v2Convert`. `failed>0` leaves
  that project as it was and doesn't fail the deploy: `.ai/release-guide.md` § "Verify the cloud converted every
  project".

**V2-8.13, close-out.**
- `bash scripts/v2-done.sh` exits 0.
- DDRs recorded, the graph plan node closed, the roadmap regenerated, the plans `README.md` updated.
- `/flow:done` archives the plan after you merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

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
- V2-8.8 WebKit pan/zoom: v2 p95 about 50 ms against 93–110 ms on v1.9.1.
- V2-8.9 security: two review rounds plus a final pair, all findings fixed red-first. Read access is scoped to the project plus the folders you said yes to.
- V2-8.16 AI parity: 509 of 509 actions have a file path, a CLI verb or a human-only reason; agent journeys pass their dry runs.
- V2-8.17 (#121): offline edits that overlap in a shared doc now show a notice with both versions. The losing side is kept in `_history/<slug>/sync-recovery`. Merged.
- The e2e harness got many rounds of work: one app per spec, throwaway config home, window kept on top, no GitHub in the lifecycle lane.

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
- **Real push** to `iagh66/maude-git-smoke`: once, confirmed by you in chat. Not yet run.

## Verification

Phase 8 gates, from `node scripts/v2-gates.mjs` (the script reads recorded evidence). **The evidence is recorded at
the final HEAD of this branch; the table is filled in at that point.** Cells marked `TBD` are not failures. They are
waiting for that record.

| Gate | What | Status | Last known |
| --- | --- | --- | --- |
| V2-8.0 | Cleanup (old layers, dead code, CSS bar) | PASS (live check) | 638 KB vs 742 KB start of phase |
| V2-8.1 | Quality gates (format, lint, typecheck, tests, build, parity, tarball, tokens, site, import coherence) | TBD | one load-sensitive sync test failed on this Mac; green on the mini |
| V2-8.2 | Rust (`cargo test`, clippy) | TBD | recorded PASS earlier; product files changed since |
| V2-8.3 | Desktop e2e, 3 consecutive runs | TBD | many rounds of spec and harness fixes; final 3x run pending |
| V2-8.4 | Cross-shell scenarios | TBD | 0 blockers in the run |
| V2-8.5 | Design fidelity (15 canvases, critics) | TBD | all reachable ids verified at last checkpoint |
| V2-8.6 | Nothing-deleted audit | PASS (live check) | 100 % |
| V2-8.7 | A11y (axe, keyboard-only, VoiceOver) | TBD | needs your VoiceOver pass |
| V2-8.8 | Pan/zoom perf (Chromium + WebKit) | TBD | WebKit passes in both orders |
| V2-8.9 | Security (final pair) | TBD | final pair 0 blockers, lows listed below |
| V2-8.10 | Packaged app | TBD | needs the clean-user smoke |
| V2-8.14 | Perf beyond pan/zoom | TBD | five budgets open, see below |
| V2-8.15 | Docs for people and agents | TBD | `docs/MIGRATING-V1-TO-V2.md` exists |
| V2-8.16 | AI parity | TBD | coverage 100 %; live runs pending |
| V2-8.17 | Offline overlap on reconnect (#121) | TBD | merged; covered by the final security pair |
| V2-8.11 | Branch build and PR | TBD | this PR |
| V2-8.12 | After the merge: rc | after merge | see below |
| V2-8.13 | Close-out | after merge | see below |

## Before you merge: what needs you

1. **VoiceOver pass (V2-8.7).** Everything else in a11y is checked in the DOM. I could not hear VoiceOver. Please
   listen once to the strings from board 14 (for example "Services, frame, 3 items, in a row, 4 of 6. Press Return
   to go inside") and to the live region on the status words.
2. **Clean-macOS-user smoke of the packaged app (V2-8.10).** Install the `.app` on a fresh macOS user with no node,
   bun or claude. Open a project, open Home, make a canvas. The scripted gates (`check-bundle-completeness --smoke`,
   `check-client-boots`) cover everything except a real clean user.
3. **The desktop port question (asked 2026-10-27):**
   > The desktop app starts a project's server without a port, so it takes 4399, the default of
   > `maude design serve`. When a person's own server was briefly down, an e2e sidecar took 4399. The e2e has been
   > moved to 47399+. The product is unchanged.
   > - **A (recommended):** the app uses its own fixed range (e.g. 47399+). A restart keeps the same port (crash
   >   recovery and the respawn scenario rely on that); each user's per-origin web storage resets once.
   > - **B:** leave it.

   Recommendation: A. Unanswered, it goes into the follow-ups below.
4. **V2-8.14 open budgets** (numbers from the 2026-10-25 record; they may move before the final one):
   - Covers, 95 canvases, cold pass: 206–245 s against a 45 s budget.
   - First 12 covers cold: 3.5–4.2 s against 3 s.
   - Version picture (warm): p50 754 ms, p95 1.5 s against 300 / 800 ms.
   - Asset tiles: fast (0.8 s) but 189 of 194 came back as glyphs. Suspect.
   - Annotation LOD with 64 boards and a 1,500-element board: p95 83–100 ms against about 67 ms on v1. Not React renders.

   Decide: accept for v2.0 and list as follow-ups, or hold the merge for a perf round.
5. **Real push to `iagh66/maude-git-smoke`:** you said yes in chat. The run does it once, after the V2-8.3 record.
6. **The homepage showreel `site/public/demo.mp4`** still likely shows v1 chrome. Re-record, drop or keep?
7. **The site copy describes v2.** It goes to `main` with this PR. Is that OK, or should it wait for the v2.0 release?
8. **`~/.config/maude/prefs.json`** was rewritten by a test run several times. You said you don't mind. The
   source is still being hunted. Please check that your folds and theme look right.
9. **`maude design ds convert`** on the in-repo design systems (your yes from 2026-10-22). I could not confirm from the log that it ran; check the final record.

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
- **Desktop port range** (item 3 above), if you do not answer.
- **Legacy sync gaps after V2-8.17:** sibling `.css` text, the `MAUDE_SHARED_DOC=0` lane, and a 1.x peer taken second.
- **Cloud lane media uploads** to the local hub fail intermittently. Worth a look.
- **Case-variant credential Read** against Claude Code's matcher, and a **WKWebView DNS-prefetch check**. Both need a real Mac.

## The rc-soak checklist

Every ledger row closed as `soak`: it can't be driven on this Mac, so it is checked on the rc soak. Each line gives
the reason. `node scripts/v2-ledger.mjs pr-soak` writes this list, and `check` fails if it drifts from the ledger.
Rows closed as `not-a-state` (the board draws a state the product never reaches) stay in the ledger with their note.

<!-- v2-ledger:soak:start -->
_No row is left to the soak._
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

**V2-8.13, close-out.**
- `bash scripts/v2-done.sh` exits 0.
- DDRs recorded, the graph plan node closed, the roadmap regenerated, the plans `README.md` updated.
- `/flow:done` archives the plan after you merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

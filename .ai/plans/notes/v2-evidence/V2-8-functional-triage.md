# V2-8 pre-merge triage (read-only scout, 2026-10-29)

Sources: `.ai/scenarios/maude-v2/lead/pr-followups.md`, `.ai/scenarios/maude-v2/PR.md` § Known follow-ups; tree at `007be8c75`.
Sizes: S under a day of one builder, M a builder-day or two, L a design call or several days.
"Reproduces" = by code reading at the cited line, not by running anything.

## Table 1 - follow-ups, FUNCTIONAL items

| # | Item | Files / lines | Still reproduces? | Size |
|---|------|---------------|-------------------|------|
| F1 | Cloud canvas-only "Can edit": browser shows Viewing, "edit it in the desktop app". No write path. | `client/v2/access/access-client.js:153-154` (appOnly copy), `client/v2/shell/save-status.js:113`, `share-cluster-host.jsx:142` | Yes - intended v2.0 posture, copy says "comes later". A flow a Can-edit person cannot finish in a browser. | L |
| F2 | Role-denial toast on a tool key still offers "Ask to edit" when the person already can edit (appOnly) | `client/v2/shell/role-denial.js:46-58` (`showRoleDenial` has no appOnly input), callers `use-tool-panels.js:81`, `use-canvas-mode-lane.js:43` | Yes - no appOnly anywhere in role-denial.js. | S |
| F3 | Collab handshake epoch: server accepts peers from an earlier server instance | decision `v2-p8-lead-captures-park-not-epoch`; not traced | Unverified; deliberately deferred ("changes sync behaviour"). | M-L |
| F4 | Legacy `api.ts` write path announces after the write lands (⌘Z/watcher can see the edit as "outside") | `api.ts:3134` (`announceWritten`), callers 2593/2710/2854/3276 | Yes by shape (announce is post-write); consequence is narrow, workspace mode only. | S |
| F5 | D2: "this write is the person's" note is not withdrawn when the write throws (30 s window) | `routes/edit.ts:250-262` - `catch` emits only `activity:unsuppress`, never withdraws `source-writing`; window `sync/local-kernel.ts:84` (`WRITE_NOTE_MS`) | Yes. A later outside edit in 30 s is misattributed. | S |
| F6 | `screenshot.sh` canvas modes close the shared agent-browser session; the agent loses its browsing session after each capture | `bin/screenshot.sh:220-228` (`_ab-park.sh` closes by design, r10) | Yes, by design. Fix = separate capture session name. | S |
| F7 | N1: a canvas attached while offline starts the overlap watch `online = true`; first offline episode is `exposed`, the #121 notice is lost (falls back to CRDT merge) | `sync/offline-overlap.ts:133` (`let online = true`), 154, 187 | Yes. Fails safe. | S |
| F8 | Legacy sync gaps after V2-8.17: sibling `.css` text, `MAUDE_SHARED_DOC=0` lane, 1.x peer taken second | PR.md:226 only; no file named | Unverified - no line cited anywhere. | M |
| F9 | Cloud lane: media uploads to the local hub fail. **Seen in the V2-8.3 logs, 3 of 3 runs.** | log `run1-e2e-cloud.log:2084` ("3 changes need your attention: 3 media uploads failed"); the spec accepts it as terminal, `e2e/scenarios/cloud-attach.e2e.ts:404-408` (a03b8c562) | Yes in the rig; unknown whether rig (local hub media path) or product. Not "intermittent" in this record. | M |
| F10 | AI attribution by time window: a person's outside save during an AI Bash call (or 1 s after) folds into the AI run and its Undo. Also: interpreter-made new canvases land "outside"; terminal-lane runs take every unclaimed write; `.bash` marker makes Stop block once on old findings | pr-followups.md:138-140, 149-165, 191-200; `cli/lib/bash-guard.mjs` (`bashMayWrite`) | Yes - named by the builders as narrowed, not closed. A person's save can be undone with the AI run. | L |
| F11 | Legacy (non-accepted) mode: ⌘Z on a text edit silently drops an overlapping peer edit; strict-inverse mismatch only `console.warn` | `annotations-layer.tsx:1601-1612`, `:1508`; `sync/source-merge.ts` | Yes. Michal decided 2026-10-29 not to fix; mitigation is the Update project offer. | S-M |
| F12 | Hub multi-target undo (history / this chat) keeps the kernel's rule; no kernel-side refusal for old desktops | pr-followups.md:95-96 | Yes by the note. | M |
| F13 | Each annotation draft write is its own ⌘Z step; edits with no live room record no contest (`api.applyAnnotationOps`) | pr-followups.md:116-118 | Yes by the note. | M |
| F14 | es-all-trashed Restore on a cell-linked copy: click answers ok but the file stays empty in 2 of 3 runs (suspected: restore held against the hand edit) | `history/restore-artboard.ts` (`emptyCanvasPlace`); pr-followups.md:74-81 | Open, cause unconfirmed. Data does not come back. | M |
| F15 | Silent divergence after a trash race: two Macs apart (bob 3 / alice 1 artboards), no conflict shown, still apart after 240 s | pr-followups.md:79-81 | Open, needs its own look. | L |
| F16 | ia-edges A/F/G/H have no surface: "Preparing" and "Saved a copy from the link" exist in import-lines.js but nothing calls them; Figma "can't open" and Google-key sheets undrawn in the product | pr-followups.md:64-70 | Per the builder; not re-traced. | M |
| F17 | AI-driven `maude design trash move` is recorded as the person's `canvas.delete`, not under the AI run | pr-followups.md:136-137; `DELETE /_api/canvas` | Open by the note. | M |
| F18 | A project server's port is not kept across rest/wake or relaunch, so per-port localStorage starts empty | `src-tauri/src/app_state.rs:69` (`ProjectEntry.port`, set only to `None` at :274; only `home.rs` stores a port) | Yes. Michal to decide. | S |
| F19 | `/_config.saveMode` says `legacy` at first boot (offer correct only after the desktop dry run); cloud tab links to the dashboard root, not the project | pr-followups.md:175-178 | By the note. | S |
| F20 | Synced projects: `maude design history diff` unavailable; history rows labelled "Claude Code" | pr-followups.md:163-165 | By the note. | M |
| F21 | Group/Ungroup top row can sit under the Preview bar island (tests click via `dispatchEvent`) | pr-followups.md:125-127 | Unverified layout issue; "not ruled on". | S |

**FUNCTIONAL: 21.** Smallest safe wins before the merge: F2, F5, F7, F18 (if Michal decides), F6. F9 is the one that shows in a green record today and should be diagnosed first.

## Table 1b - everything else

| Class | Items |
|-------|-------|
| DONE (7) | `local-cell.mjs` formatVersion 2 (`80d395fd7`, merged `ff29651ce`); help flag forms in the auto tier (`e5df1df03`, `actions/verbs.ts` HELP_ALLOW_RULES); journey text grader whitespace (`e5df1df03`); three freeze docs gaps (MIGRATING, `cli.mdx:102`, plugin README, `e5df1df03`); D4 `isOrphanBrowser` now requires `started >= lane start` (`b6bbd47ab`, `e2e/helpers/app-lifecycle.ts:120-125`, residual narrow); local-project collaborator-text undo (`6e87df463`) and hub-linked collision refusal (`b82b82f6c`); SessionStart restore line, screenshot EOF race (`p8-ab-park-race`) |
| SECURITY-RESIDUAL (~12) | one origin per canvas (C4); D1 `isE2eEnv` in release server (`acp/probe.ts:166`, fail-closed); command-gate evidence forgeable; L2 `_history/<slug>` symlink; peer presence not role-stamped; base hashes outside design root (R2); hub read abort + byte cap (R3); R4 label in id-finding key; `_runs/<s>/shots.jsonl` plantable; script-from-file detaching; sha256 of run base in hook state; case-variant credential Read; WKWebView DNS prefetch (last two also OWNER, need a real Mac) |
| PERF (5) | `describe-budget` p95 on the mini; D3 `local-kernel` source copies (already capped at `MAX_SUPERSEDED = 16`, `local-kernel.ts:86` - nearly DONE); L3 overlap-check merge up to ~100 ms x 512; D7 / owner-probe Update dry run opens every doc; hub reads in flight after the ⌘Z deadline |
| COSMETIC (6) | cf-ai-drafting ghost "Mobile - next"; hold tag "AI is drawing the footer" vs fixed "AI is working"; an-ai-write chips; ai-other-tab toast and tab tooltip, cf-busy mode word; ia-missing "Alice's device" vs "Jonas's Mac"; ia-edges E "Added by Tereza" |
| TEST/HARNESS (14) | surface-frame-probe on the mini; N2 `remote-lane.sh --slot` unvalidated; N3 `dist/styles.css` freshness unchecked; vendored WebDriver stale-element mapping (`macos.rs:217`) + held-handle waits in 5 specs; desktop e2e lane on the mini; hub `files-ctl-keepalive` timing flake; mini runner TCC outage; no pre-1.9.0 `hub-too-old` Docker leg; `offline-conflict.e2e.ts:86,94` signals `hubPid` directly; update-to-accepted browser click-through not driven; tests not driven (13 ds-make-filling, 12 ia-more-ways/ia-edges, 07 ve-footage, 10 an-vote, multiplayer catalogue on Docker); 05 es-all-trashed race lane; ai-runs shot-only checks; 12 ia-missing timing plan |
| OWNER (3) | signed-in GitHub PR path (needs sign-in, creates PRs); ProjectEntry.port decision (F18); 12.8 rc.1 cut |
| SOAK (15) | the 14 ledger rows in PR.md:254-270 (V2-8.12 is OWNER) (ob-sig-draw, ob-invite-landed, ai-needs-away, md-presenter, md-present-link, md-edge-offline, ad-edge-where, ve-footage, co-mention-notify, pn-accounts, pn-cant-open, ia-more-ways, ia-edges, an-vote), plus cloud-attach 2b red "Sharing is not available right now" line (code: `share-sheet.jsx:433-436` / `errorWords` `share-model.js:276`; probably the cloud stub) |

## Table 2 - errors in the run logs

Scope read: the 125 files under `.../lanes-20261029T124508/` (V2-8.3, three runs); `V2-8.16-journeys/2026-10-29-freeze/` (run.log, VERDICT.md, tools.jsonl); the live trial dirs.
Fact: **the lane logs are wdio logs. They carry no `[studio]`, `[sync]`, `[thumbs]`, `[index]`, `[home]` or sidecar stderr**, so server-side errors would not show in them. The one adapter stream that leaks in is the Diagnostics sheet text.
Not present anywhere (logs, repo evidence, `.ai/`): `Unexpected case`, `background_tasks_changed`, `unhandledRejection`, `uncaughtException`, `TypeError`, `ReferenceError`, `panicked`, `EADDRINUSE`, app-code stack traces. `ENOENT`/`EACCES`/`EPIPE`/`ECONNRESET`: 0.
Journeys: `${TMPDIR}/maude-agent-journeys/2026-10-29-freeze/` no longer exists (only `.../2026-10-29/S1` fault fixtures and `dry-results.json`). In-repo freeze evidence has only `tools.jsonl` + `grade.json`, no stderr files. The 3 red journey rows (S2 acp, S6 terminal, S11 terminal) are grader/permission findings, since fixed in `e5df1df03`; not log errors.

| # | Message (normalised) | Count | First occurrence | Source | Verdict |
|---|----------------------|-------|------------------|--------|---------|
| E1 | `[acp-adapter] (node:N) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call...` | 6 lines (2 procs x 3 runs, `run{1,2,3}-e2e.log`) | `run1-e2e.log:986` (inside the Diagnostics sheet text) | `@anthropic-ai/claude-agent-sdk` 0.3.202 (`sdk.mjs`), emitted through the adapter's stderr into the AI log | **NOISE**, verified. The session runs in bypassPermissions in that spec; `bridge.ts:1616-1619` documents that bypass short-circuits the gate; the "AI may" switches are DENY rules that hold in bypass (`bridge.ts:726-731`). |
| E2 | `ERROR diagnostics: Tauri Driver: tauri-driver not found. Install it with: cargo install tauri-driver` | 270 | `run1-e2e.log:21` (every lane, line ~21) | `@wdio/tauri-service` 1.1.0 diagnostics | **NOISE**. We use the embedded vendored WebDriver (`src-tauri/vendor/`), not the external driver. |
| E3 | `WARN tauri-service:service: Failed to clear mock store: A sessionId is required` | 270 | `run1-e2e.log:319` | same service, teardown after the session ended | **NOISE** (no mocks used). |
| E4 | `Window 'main' not found. Available: [home, strip, p-<id>]` (get window states / validate label) | ~1000 | `run1-e2e-acp-cold-start.log:104` | same service assumes a window `main`; Maude has one `shell` window with child webviews (`tabs.rs`) | **NOISE**, by design (webview labels are the handles). |
| E5 | `Tauri core.invoke not available after Ns timeout` | 48 | `run1-e2e-cell-tab.log:191` | same service, label validation on a webview that is not yet loaded | **NOISE**; the switch proceeds directly. |
| E6 | `WARN launcher: Embedded WebDriver on port 4455 is unreachable - restarting...` | 156 (3 in acp-fake, 1 in each `run*-e2e.log`) | `run1-e2e-acp-fake.log:1029` | service health probe | **NOISE/EXPECTED**: probes fire across app relaunch; every lane ends green. |
| E7 | `ERROR webdriver: A JavaScript exception occurred` on execute/async (+ `no such element` 3694) | 606 ERROR / 630 WARN | `run1-e2e.log:3341`; lanes lifecycle, ds-edges, ds-switch | WebKit's opaque message for a stale element, `vendor/.../macos.rs:217`; known follow-up (pr-followups.md:36-40) | **EXPECTED-IN-TEST / harness**: retried by wdio, spec waits for the element. Not product. |
| E8 | `UND_ERR_CLOSED ... Suppressing error closing the session` | 27 | `run1-e2e-ai-quit.log:2774` | wdio closing a session whose app already quit | **EXPECTED-IN-TEST**: ai-quit, relaunch, remember quit the app on purpose. |
| E9 | `UND_ERR_SOCKET` then `ECONNREFUSED` on execute/async | 3 / 3 | `run1-e2e-ai-quit.log:6921,6925` (also run2:6925, run3:6933) | app quit mid-call | **EXPECTED-IN-TEST**: ai-quit "quit with AI running". |
| E10 | `That project isn't one this tab can open.` (WARN + ERROR) | 3 | `run1-e2e-tabs-identity.log:6033,6037` | the refusal text, asserted by `e2e/scenarios/project-tabs-identity.e2e.ts:304-318` | **EXPECTED-IN-TEST**. |
| E11 | `RESULT { __wdio_error__: 'Load failed' }` | 3 | `run1-e2e-tabs-identity.log:438` | WebKit fetch failure inside a test script, same spec family as E10 | **EXPECTED-IN-TEST** (likely; the fetch is the test's own, not traced further). |
| E12 | `[smoke] canvas-iframe DOM not assertable (known boundary - cross-origin / bundled-runtime canvas render)` | 3 | `run1-e2e.log:7557` | spec's own message; DDR-054 origin split | **NOISE**, a stated boundary. |
| E13 | `N changes need your attention in project: 3 media uploads failed.` (Sync note text) | 9 lines, 3 runs | `run1-e2e-cloud.log:2084` | the app's own sync presentation (`presentation.ts` attention phase), tolerated by `cloud-attach.e2e.ts:404-408` | **REAL (product or rig), user-visible.** See F9. Not a thrown error, but it is a failed media upload every run. |
| E14 | `[acp-adapter] Unexpected case: {...}` incl. `background_tasks_changed` | **0 in all logs** | n/a | see below | **REAL, latent** - protocol message we do not handle, harmless today. |

### `Unexpected case: background_tasks_changed` (not in these logs; traced from code)

- Emitter: `apps/studio/node_modules/@agentclientprotocol/claude-agent-acp/dist/utils.js:69-78`, `unreachable()` calls `logger.error("Unexpected case: <json>")`. Called from the SDK-message switches in `acp-agent.js`: `switch (message.subtype)` for `type:"system"` messages (line 896, default at **1251**) and for `result` messages (1360, default at 1415).
- The unhandled message is an SDK **`system` message with `subtype: "background_tasks_changed"`**. It is not an ACP `session/update` type, so ACP clients never see it. The adapter's known system subtypes include `hook_*`, `files_persisted`, `task_started/notification/progress/updated`, `status`, `session_state_changed` (lines 904-1164); `background_tasks_changed` is not among them. The adapter's SDK is 0.3.202 (`package.json:67`), whose typings only know `subtype: 'background_tasks'` (`sdk.d.ts:2869`).
- Who emits it: the CLI. The adapter spawns the person's `claude` via `CLAUDE_CODE_EXECUTABLE` (`bridge.ts:1443-1451`). The user's `~/.local/bin/claude` is 2.1.307 and **contains** the string (17 hits); the bundled `claude-agent-sdk-darwin-arm64` 0.3.202 binary contains 0, so a lane using the bundled/stub CLI never produces it, which is why the lane logs are clean.
- Effect: logged and ignored (`break`), nothing is lost. Our bridge (`bridge.ts`) never sees it, so the bridge is not the place to handle it. The fix is an adapter bump (`@agentclientprotocol/claude-agent-acp` 0.57.0 -> a release that handles it); alternatively filter that one line from the adapter stderr that feeds the Diagnostics AI log. Same applies to any other new subtype the person's newer CLI adds: each lands as one `Unexpected case` log line.

### Counts

Table 2: REAL 2 (E13, E14), EXPECTED-IN-TEST 5 (E7-E11 incl. E7 as harness), NOISE 7 (E1-E6, E12). Zero unhandled rejections or app stack traces.

## Could not verify

- Server/sidecar stderr during V2-8.3 (not captured in the lane logs); sidecar logs would have to come from `~/.../maude` log files of the run, which no longer exist or were not collected.
- Freeze journey stderr/transcripts (dir deleted).
- F3, F8, F16, F20, F21: no code location cited by the follow-up lists and not traced.

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
- **screenshot.sh canvas modes close the shared agent-browser session on exit**, contradicting its own comment; the
  agent loses its browsing session after every /design:screenshot (functional, not security).
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

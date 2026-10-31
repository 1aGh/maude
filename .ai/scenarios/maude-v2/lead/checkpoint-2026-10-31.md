# Lead checkpoint — 2026-10-31 (final freeze 20b4215eb)

**State:**
- Every phase-8 gate is green at product `20b4215eb`: 15/15 in `node scripts/v2-gates.mjs`.
- feat is pushed at `a06c8acf2`. Everything after 20b4215eb is `.ai/` only.
- PR 1aGh/maude#160 is still a draft; its body is `.ai/scenarios/maude-v2/PR.md`.
- READY TO TRY (10) is in the Progress log.
- The .app: `.claude/worktrees/freeze/apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, 2.0.0-rc.1, built with `MAUDE_NO_AUTO_UPDATE=1`.

**What this round found (all fixed red-first, merged, recorded in kg):**
- V2-8.7 / V2-8.14 had never been attested. a11y-final fixed 10 serious/critical groups, and the full matrix is clean (318 states). The empty "Other project files" tree is fixed.
- perf-814: asset tiles 52 s → 9 s (`toBlob` idle fallback). Combine-admin was blocked by the C4 closure (lower-cased stylesheet owner).
- Closure lows ×3 rounds:
  - stored grant;
  - listing must prove absence;
  - unlisted twins;
  - the hub reader reports its omissions;
  - NFC;
  - per-folder cache;
  - `.html` stored grant;
  - realpath parent;
  - the hub cache key.
- **The desktop app quit when a project tab opened.** wry 0.57 unwraps a nil WKWebView URL on the main thread, and the root watch hit it. Fix: `webview_url::url_of`.
- first-canvas e2e race (`content-visibility` hit-test gap after ⌘Z).
- Michal "a": version-picture warm p50 ~400 ms is accepted for v2.0.

**Used the Mac mini** (Michal's go) for display-free runs at the same sha:
- V2-8.4 rig and browser e2e.
- WebKit A/B, through Michal's GUI-session `safaridriver -p 4488`, which the perf probe adopts.

**`v2-done.sh`: 2 red, both Michal's:**
- The ledger still has V2-8.11 (the PR merge) and V2-8.13 (close-out after the merge) open.
- `packaged-app.json` has `pass: false` until Michal's clean-user smoke. Flip it after he confirms.

**For Michal before the merge:**
- the VoiceOver listen;
- the clean-user smoke;
- the showreel;
- the site copy timing;
- then the merge.
